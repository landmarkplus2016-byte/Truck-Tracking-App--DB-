/**
 * Pm.gs — the PM's final gate (CLAUDE.md §3.5, rules 16–17).
 *
 *   approve_lines_pm {keys[]}    coord_approved → pm_approved, stamped approved_pm_at
 *   return_lines {keys[], note}  coord_approved / pm_approved → returned, with a note the
 *                                coordinator sees on their page
 *   dashboard_query {scope}      totals, components and breakdowns for the dashboard (§8)
 *
 * The PM reads lines through list_lines {statuses}.
 * Keys that aren't in the right status are skipped and reported, never an error, so a
 * page that went stale while a coordinator edited can't approve the wrong thing.
 */

const PM_ACTOR = 'pm';
const MAX_RETURN_NOTE = 500;
const RETURNABLE_STATUSES = ['coord_approved', 'pm_approved'];

/** approve_lines_pm — the final approval before export. */
function approveLinesPm_(payload) {
  const keys = lineKeys_(payload.keys);
  return withScriptLock(function () {
    const byKey = indexLines_();
    const now = nowIso_();
    const rows = [];
    const skipped = [];
    keys.forEach(function (key) {
      const row = byKey[key];
      if (!row || cleanText_(row.status) !== LINE_STATUS.COORD_APPROVED) {
        skipped.push(key);
        return;
      }
      row.status = LINE_STATUS.PM_APPROVED;
      row.approved_pm_at = now;
      row.updated_at = now;
      row.updated_by = PM_ACTOR;
      rows.push(row);
    });
    updateObjects(SHEET.LINES, rows);
    return { lines: rows.map(publicLine_), skipped: skipped };
  });
}

/**
 * return_lines — sends lines back to their coordinator with a note. The approval stamps
 * are cleared: the coordinator fixes the line and approves it again from scratch.
 */
function returnLines_(payload) {
  const keys = lineKeys_(payload.keys);
  const note = cleanText_(payload.note).replace(/\s+/g, ' ');
  if (!note) throw appError_('note_required', 'A return needs a note for the coordinator');
  if (note.length > MAX_RETURN_NOTE) throw appError_('bad_request', 'The note is too long');

  return withScriptLock(function () {
    const byKey = indexLines_();
    const now = nowIso_();
    const rows = [];
    const skipped = [];
    keys.forEach(function (key) {
      const row = byKey[key];
      if (!row || RETURNABLE_STATUSES.indexOf(cleanText_(row.status)) === -1) {
        skipped.push(key);
        return;
      }
      row.status = LINE_STATUS.RETURNED;
      row.return_note = note;
      row.approved_by_coord = '';
      row.approved_coord_at = '';
      row.approved_pm_at = '';
      row.updated_at = now;
      row.updated_by = PM_ACTOR;
      rows.push(row);
    });
    updateObjects(SHEET.LINES, rows);
    return { lines: rows.map(publicLine_), skipped: skipped };
  });
}

/* ---------- Dashboard ---------- */

/**
 * dashboard_query {scope} — the PM dashboard's figures (CLAUDE.md §8, rule 24).
 *
 * scope: {mode: 'week' | 'range', week?, from?, to?, coordinator?, driver?}. Every one of these
 * is a trip-level slice, so it narrows the components and the totals alike. The scope sent
 * back is the one actually used: no week → the latest week with trips; a coordinator or driver
 * that isn't among the options → cleared.
 *
 * - components (labor / park / truck / hotel) are summed from the Trips rows in scope — the
 *   only place those figures exist (rule 9).
 * - total, by_coordinator and by_contractor are summed from the Lines of those same trips.
 *   Contractor lives on the line, so it cuts the total only: there is no component figure per
 *   contractor or per period, because one trip can straddle In-House and a contractor.
 * - trip_total (the components' sum) equals total whenever every trip's lines are in step
 *   with it (rule 10); the page flags any difference.
 *
 * Every line status counts — this is spend, not what has been approved. Read-only, no lock.
 */
function dashboardQuery_(payload) {
  const asked = payload.scope && typeof payload.scope === 'object' ? payload.scope : {};
  const tz = spreadsheetTz_();
  const trips = readObjects(SHEET.TRIPS)
    .map(function (t) { return dashboardTrip_(t, tz); })
    .filter(function (t) { return t.trip_id && t.date; });
  const latestWeek = trips.reduce(function (latest, t) { return t.week > latest ? t.week : latest; }, '');
  const scope = parseScope_(asked, latestWeek, tz);
  scope.coordinator = cleanText_(asked.coordinator);
  scope.driver = typeof asked.driver === 'string' ? asked.driver : ''; // exact typed string (rule 22)

  const weeks = distinct_(trips.map(function (t) { return t.week; })).sort().reverse();
  const coordinators = distinct_(trips.map(function (t) { return t.coordinator; })).sort(byName_);
  if (coordinators.indexOf(scope.coordinator) === -1) scope.coordinator = '';

  const coordTrips = trips.filter(function (t) {
    return inScope_(scope, t.date) && (!scope.coordinator || t.coordinator === scope.coordinator);
  });
  const drivers = distinct_(coordTrips.map(function (t) { return t.driver; })).sort(byName_);
  if (drivers.indexOf(scope.driver) === -1) scope.driver = '';
  const inScope = coordTrips.filter(function (t) { return !scope.driver || t.driver === scope.driver; });

  // Components and trip counts from the trips.
  const components = {};
  TRIP_COSTS.forEach(function (key) { components[key] = 0; });
  const byTrip = {};
  const coordRows = {};
  inScope.forEach(function (t) {
    byTrip[t.trip_id] = t;
    TRIP_COSTS.forEach(function (key) { components[key] += t[key]; });
    breakdownRow_(coordRows, t.coordinator, t.coordinator).trips++;
  });
  let tripTotalSum = 0;
  TRIP_COSTS.forEach(function (key) {
    tripTotalSum += components[key];
    components[key] = round2_(components[key]);
  });

  // Totals from the lines of those trips. Contractor names group case-insensitively,
  // shown with the Config spelling when the contractor is listed there.
  const canonical = contractorNames_();
  const contractorRows = {};
  let total = 0;
  let lineCount = 0;
  readObjects(SHEET.LINES).forEach(function (r) {
    const trip = byTrip[cleanText_(r.trip_id)];
    if (!trip || !cleanText_(r.line_key)) return;
    const cost = toMoney_(r.split_cost);
    const contractor = cleanText_(r.contractor);
    const folded = contractor.toLowerCase();
    total += cost;
    lineCount++;
    addLineCost_(breakdownRow_(coordRows, trip.coordinator, trip.coordinator), cost);
    addLineCost_(breakdownRow_(contractorRows, folded, canonical[folded] || contractor), cost);
  });

  return {
    scope: scope,
    options: { weeks: weeks, coordinators: coordinators, drivers: drivers },
    trip_count: inScope.length,
    line_count: lineCount,
    total: round2_(total),
    trip_total: round2_(tripTotalSum),
    components: components,
    by_coordinator: breakdownList_(coordRows, true),
    by_contractor: breakdownList_(contractorRows, false),
  };
}

/** A Trips row → the trip-level figures the dashboard slices on. */
function dashboardTrip_(t, tz) {
  const date = toIsoDate_(t.date, tz);
  const trip = {
    trip_id: cleanText_(t.trip_id),
    date: date,
    week: date ? isoWeek_(date) : '',
    coordinator: cleanText_(t.coordinator),
    driver: t.driver === null || t.driver === undefined ? '' : String(t.driver), // verbatim (rule 22)
  };
  TRIP_COSTS.forEach(function (key) { trip[key] = toMoney_(t[key]); });
  return trip;
}

function breakdownRow_(rows, key, name) {
  if (!rows[key]) rows[key] = { name: name, total: 0, lines: 0, trips: 0 };
  return rows[key];
}

function addLineCost_(row, cost) {
  row.total += cost;
  row.lines++;
}

/** Breakdown rows, biggest total first. withTrips false drops the trip count (contractor rows). */
function breakdownList_(rows, withTrips) {
  return Object.keys(rows)
    .map(function (key) {
      const row = rows[key];
      const out = { name: row.name, total: round2_(row.total), lines: row.lines };
      if (withTrips) out.trips = row.trips;
      return out;
    })
    .sort(function (a, b) { return b.total - a.total || byName_(a.name, b.name); });
}

/** Distinct non-blank values, as given (not trimmed — a driver string stays verbatim). */
function distinct_(values) {
  const seen = {};
  return values.filter(function (v) {
    if (!String(v).trim() || seen[v]) return false;
    seen[v] = true;
    return true;
  });
}

function byName_(a, b) {
  return String(a).localeCompare(String(b));
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}
