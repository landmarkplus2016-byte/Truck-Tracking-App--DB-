/**
 * Lines.gs — the per-site Lines tab, as the coordinator's page reads and edits it.
 *
 *   list_lines {coordinator?}
 *   save_line_classification {changes[] | one change, autofill?, reviewer_name?}
 *   approve_lines_coord {keys[], reviewer_name, coordinator?}
 *
 * A coordinator owns classification only — site_id, job_code, contractor, period and
 * their *_manual flags (rule 11). Cost and the number of sites are never written here.
 */

const LINE_STATUS = {
  PENDING: 'pending',
  COORD_APPROVED: 'coord_approved',
  PM_APPROVED: 'pm_approved',
  RETURNED: 'returned',
  EXPORTED: 'exported',
};
// Statuses a coordinator can approve, and that the grid's auto-fill may write without reverting anything.
const OPEN_STATUSES = ['pending', 'returned'];
const APPROVED_STATUSES = ['coord_approved', 'pm_approved'];
const LINE_WARNS = ['', 'unknown_site', 'conflict', 'missing_job_code'];
const CLASSIFICATION_VALUES = ['site_id', 'job_code', 'contractor', 'period'];
const CLASSIFICATION_FLAGS = ['jc_manual', 'contractor_manual', 'period_manual'];
const MAX_LINE_FIELD = 100;
const MAX_REVIEWER_NAME = 60;
const MAX_KEYS_PER_CALL = 2000;

/* ---------- Read ---------- */

/** list_lines — every line (for one coordinator when given), by date, trip, then site order. */
function listLines_(payload) {
  const coordinator = cleanText_(payload.coordinator);
  return readObjects(SHEET.LINES)
    .filter(function (r) {
      return cleanText_(r.line_key) !== '' && (!coordinator || cleanText_(r.coordinator) === coordinator);
    })
    .map(publicLine_)
    .sort(compareLines_);
}

/* ---------- Classification ---------- */

/**
 * save_line_classification — writes the classification fields of one or more lines.
 *
 * A change to site_id / job_code / contractor / period on an approved line reverts it to
 * pending and clears its approval stamps (rule 18). A change that only moves a *_manual
 * flag or warn never reverts. Unchanged values are not written at all.
 *
 * autofill: true is the grid applying the master on open. It only touches open lines
 * (pending / returned) and silently skips the rest, so re-resolving can never undo a
 * sign-off. A human edit (autofill false) on an exported line is refused: line_locked.
 */
function saveLineClassification_(payload) {
  const changes = Array.isArray(payload.changes) ? payload.changes : [payload];
  if (!changes.length || changes.length > MAX_KEYS_PER_CALL) throw appError_('bad_request', 'No changes to save');
  const autofill = payload.autofill === true;
  const actor = reviewerName_(payload.reviewer_name, false) || 'coordinator';

  return withScriptLock(function () {
    const byKey = indexLines_();
    const now = nowIso_();
    const touched = {};
    const skipped = [];
    const siteRenames = [];

    // Validate and apply in memory first; nothing is written if any change is refused.
    changes.forEach(function (change) {
      if (!change || typeof change !== 'object') throw appError_('bad_line', 'A change must be an object');
      const key = cleanText_(change.line_key);
      const row = byKey[key];
      if (!row) throw appError_('line_not_found', 'No line ' + key);
      const status = row.status || LINE_STATUS.PENDING;

      if (autofill && OPEN_STATUSES.indexOf(status) === -1) {
        skipped.push(key);
        return;
      }
      if (status === LINE_STATUS.EXPORTED) throw appError_('line_locked', 'Line ' + key + ' is exported and locked');

      const patch = classificationPatch_(row, change);
      if (!patch) return;

      const reclassified = CLASSIFICATION_VALUES.some(function (k) { return k in patch; });
      if ('site_id' in patch) siteRenames.push({ trip_id: row.trip_id, index: siteIndexOf_(key), site_id: patch.site_id });
      Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
      if (reclassified && APPROVED_STATUSES.indexOf(status) !== -1) {
        row.status = LINE_STATUS.PENDING;
        row.approved_by_coord = '';
        row.approved_coord_at = '';
        row.approved_pm_at = '';
      }
      row.updated_at = now;
      row.updated_by = actor;
      touched[key] = row;
    });

    const rows = Object.keys(touched).map(function (k) { return touched[k]; });
    updateObjects(SHEET.LINES, rows);
    if (siteRenames.length) renameTripSites_(siteRenames, now, actor);
    return { lines: rows.map(publicLine_), skipped: skipped };
  });
}

/** The fields of `change` that differ from `row`, validated — or null when nothing differs. */
function classificationPatch_(row, change) {
  const next = {};
  if ('site_id' in change) {
    next.site_id = normalizeSiteId(change.site_id);
    if (!next.site_id) throw appError_('bad_line', 'Site ID cannot be empty');
    if (next.site_id.indexOf('/') !== -1) throw appError_('bad_line', 'Site ID cannot contain "/"');
  }
  if ('job_code' in change) next.job_code = lineText_(change.job_code, 'Job code');
  if ('contractor' in change) next.contractor = lineText_(change.contractor, 'Contractor');
  if ('period' in change) {
    next.period = cleanText_(change.period).toLowerCase();
    if (['', 'old', 'new'].indexOf(next.period) === -1) throw appError_('bad_line', 'Period must be old, new, or blank');
  }
  CLASSIFICATION_FLAGS.forEach(function (flag) {
    if (flag in change) next[flag] = change[flag] === true;
  });
  if ('warn' in change) {
    if (LINE_WARNS.indexOf(change.warn) === -1) throw appError_('bad_line', 'Unknown warning: ' + change.warn);
    next.warn = change.warn;
  }

  const patch = {};
  let changed = false;
  Object.keys(next).forEach(function (k) {
    if (!sameCell_(row[k], next[k])) {
      patch[k] = next[k];
      changed = true;
    }
  });
  return changed ? patch : null;
}

/**
 * A corrected site id is written into the same slot of its trip's site list, so
 * Trips.sites (the structure, rule 9) stays in step and a later re-split keeps it.
 */
function renameTripSites_(renames, now, actor) {
  const trips = {};
  readObjects(SHEET.TRIPS).forEach(function (t) { trips[t.trip_id] = t; });
  const changed = {};
  renames.forEach(function (r) {
    const trip = trips[r.trip_id];
    if (!trip) return;
    const sites = parseSites(trip.sites);
    if (r.index >= sites.length || sites[r.index] === r.site_id) return;
    sites[r.index] = r.site_id;
    trip.sites = sites.join('/');
    trip.updated_at = now;
    trip.updated_by = actor;
    changed[trip.trip_id] = trip;
  });
  updateObjects(SHEET.TRIPS, Object.keys(changed).map(function (id) { return changed[id]; }));
}

/* ---------- Coordinator approval ---------- */

/**
 * approve_lines_coord — open lines (pending / returned) → coord_approved, stamped with the
 * typed reviewer name and the server time. Lines that are not open, not found, or not this
 * coordinator's are skipped and reported, never an error, so a stale select-all is harmless.
 */
function approveLinesCoord_(payload) {
  const name = reviewerName_(payload.reviewer_name, true);
  const keys = lineKeys_(payload.keys);
  const coordinator = cleanText_(payload.coordinator);

  return withScriptLock(function () {
    const byKey = indexLines_();
    const now = nowIso_();
    const rows = [];
    const skipped = [];
    keys.forEach(function (key) {
      const row = byKey[key];
      const open = row && OPEN_STATUSES.indexOf(row.status || LINE_STATUS.PENDING) !== -1;
      if (!open || (coordinator && cleanText_(row.coordinator) !== coordinator)) {
        skipped.push(key);
        return;
      }
      row.status = LINE_STATUS.COORD_APPROVED;
      row.approved_by_coord = name;
      row.approved_coord_at = now;
      row.approved_pm_at = '';
      row.updated_at = now;
      row.updated_by = name;
      rows.push(row);
    });
    updateObjects(SHEET.LINES, rows);
    return { lines: rows.map(publicLine_), skipped: skipped };
  });
}

/* ---------- Helpers ---------- */

function indexLines_() {
  const byKey = {};
  readObjects(SHEET.LINES).forEach(function (r) {
    const key = cleanText_(r.line_key);
    if (key) byKey[key] = r;
  });
  return byKey;
}

/** A sheet row → the line the client sees: every Lines column, typed, plus site_index. */
function publicLine_(r) {
  const line = {};
  COLUMNS.Lines.forEach(function (k) {
    line[k] = r[k] === null || r[k] === undefined ? '' : r[k];
  });
  CLASSIFICATION_FLAGS.forEach(function (k) {
    line[k] = r[k] === true || String(r[k]).toLowerCase() === 'true';
  });
  line.split_cost = toMoney_(r.split_cost);
  line.status = cleanText_(r.status) || LINE_STATUS.PENDING;
  line.site_index = siteIndexOf_(line.line_key);
  return line;
}

function compareLines_(a, b) {
  return String(a.date).localeCompare(String(b.date))
    || String(a.trip_id).localeCompare(String(b.trip_id))
    || a.site_index - b.site_index;
}

function siteIndexOf_(lineKey) {
  const m = String(lineKey).match(/:(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function lineKeys_(keys) {
  if (!Array.isArray(keys) || !keys.length) throw appError_('bad_request', 'No lines selected');
  if (keys.length > MAX_KEYS_PER_CALL) throw appError_('bad_request', 'Too many lines in one call');
  const seen = {};
  return keys.map(cleanText_).filter(function (k) {
    if (!k || seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

function reviewerName_(value, required) {
  const name = cleanText_(value).replace(/\s+/g, ' ');
  if (required && !name) throw appError_('name_required', 'Type your name in "Reviewing as" first');
  if (name.length > MAX_REVIEWER_NAME) throw appError_('bad_request', 'Reviewer name is too long');
  return name;
}

function lineText_(value, label) {
  const text = cleanText_(value);
  if (text.length > MAX_LINE_FIELD) throw appError_('bad_line', label + ' is too long');
  return text;
}

function cleanText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function sameCell_(a, b) {
  if (typeof b === 'boolean') return (a === true || String(a).toLowerCase() === 'true') === b;
  return cleanText_(a) === cleanText_(b);
}
