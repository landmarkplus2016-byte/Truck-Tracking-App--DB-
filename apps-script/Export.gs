/**
 * Export.gs — the finance files (CLAUDE.md §7, rules 19–23).
 *
 *   export_query  {scope, excluded_drivers[]}          preview — the files and their rows; writes nothing
 *   export_commit {scope, excluded_drivers[], keys[]}  claim-then-build — under the script lock, re-selects,
 *                                                       stamps the rows exported, logs the batch, and
 *                                                       returns the file datasets for the page to build
 *
 * A line is exported when it is pm_approved (an exported line never is again — rule 19), its trip's
 * date is in scope (a week or a date range), and its trip's driver is not excluded. Exclusion matches
 * the driver string exactly as typed (rule 22); excluded lines are simply not stamped, so they stay
 * pm_approved and come back in a later run.
 *
 * Files (rule 20): In-House lines split by period into InHouse_OLD and InHouse_NEW (both always
 * listed, even when empty); every other contractor gets one file with all periods. A line with no
 * contractor, or an In-House line with no period, fits no file: it is reported as unfiled and never
 * stamped, so nothing is locked without being settled.
 *
 * export_commit stamps only keys[] — the rows the PM previewed — that still qualify, so a commit never
 * settles a row nobody saw; rows that changed since are counted as skipped. A second commit of the same
 * rows re-reads under the lock, finds them exported and settles nothing (rule 23).
 */

const EXPORT_ACTOR = 'pm';
const EXPORT_BATCH_PREFIX = 'EXP-';
const MAX_EXCLUDED_DRIVERS = 500;
const EXPORT_PERIODS = ['old', 'new'];

/** export_query — what committing this selection would export, and what is left out and why. */
function exportQuery_(payload) {
  const lineRows = readObjects(SHEET.LINES);
  const sel = exportSelection_(payload, lineRows);
  return exportResult_(sel, sel.rows);
}

/** export_commit — claim the previewed rows, then hand back the files to build. */
function exportCommit_(payload) {
  const keys = lineKeys_(payload.keys);
  return withScriptLock(function () {
    const lineRows = readObjects(SHEET.LINES); // re-read inside the lock
    const sel = exportSelection_(payload, lineRows);
    const wanted = {};
    keys.forEach(function (key) { wanted[key] = true; });
    const claim = sel.rows.filter(function (item) { return wanted[item.line_key] === true; });
    if (!claim.length) throw appError_('nothing_to_export', 'None of these rows can be exported any more');

    const now = nowIso_();
    const batchId = nextExportBatchId_(lineRows);
    claim.forEach(function (item) {
      item.raw.status = LINE_STATUS.EXPORTED;
      item.raw.export_batch_id = batchId;
      item.raw.exported_at = now;
      item.raw.updated_at = now;
      item.raw.updated_by = EXPORT_ACTOR;
    });
    // The stamp is the dedup guarantee, so it is written first; the log follows in the same lock.
    updateObjects(SHEET.LINES, claim.map(function (item) { return item.raw; }));

    const result = exportResult_(sel, claim);
    appendObjects(SHEET.EXPORT_LOG, [{
      export_batch_id: batchId,
      generated_at: now,
      generated_by: EXPORT_ACTOR,
      scope: scopeText_(sel.scope),
      excluded_drivers: JSON.stringify(result.drivers
        .filter(function (d) { return d.excluded; })
        .map(function (d) { return d.driver; })),
      files: JSON.stringify(result.files
        .filter(function (f) { return f.row_count > 0; })
        .map(function (f) { return { name: f.name, rows: f.row_count, total: f.total }; })),
      row_count: claim.length,
    }]);

    result.batch = { export_batch_id: batchId, exported_at: now };
    result.skipped = keys.length - claim.length;
    return result;
  });
}

/* ---------- Selection ---------- */

/**
 * The export selection over lineRows: the parsed scope and exclusions, the weeks on offer, and
 * every pm_approved line in scope sorted into rows (to export), excludedRows and unfiled.
 * The default week is the newest one that still has pm_approved lines.
 */
function exportSelection_(payload, lineRows) {
  const tz = spreadsheetTz_();
  const trips = {};
  readObjects(SHEET.TRIPS).forEach(function (t) {
    const trip = exportTrip_(t, tz);
    if (trip.trip_id && trip.date) trips[trip.trip_id] = trip;
  });

  const siteCounts = {};
  const approved = [];
  const ready = {};
  lineRows.forEach(function (r) {
    const trip = trips[cleanText_(r.trip_id)];
    if (!trip || !cleanText_(r.line_key)) return;
    siteCounts[trip.trip_id] = (siteCounts[trip.trip_id] || 0) + 1;
    if (cleanText_(r.status) !== LINE_STATUS.PM_APPROVED) return;
    approved.push(r);
    ready[trip.week] = (ready[trip.week] || 0) + 1;
  });

  const weeks = distinct_(Object.keys(trips).map(function (id) { return trips[id].week; })).sort().reverse();
  const readyWeeks = Object.keys(ready).sort().reverse();
  const scope = parseScope_(payload.scope, readyWeeks[0] || weeks[0] || '', tz);
  const excluded = excludedDrivers_(payload.excluded_drivers);
  const isExcluded = Object.create(null);
  excluded.forEach(function (driver) { isExcluded[driver] = true; });
  const canonical = contractorNames_();

  const sel = {
    scope: scope,
    weeks: weeks.map(function (week) { return { week: week, ready: ready[week] || 0 }; }),
    trips: trips,
    siteCounts: siteCounts,
    isExcluded: isExcluded,
    candidates: [],
    rows: [],
    excludedRows: [],
    unfiled: [],
  };
  approved.forEach(function (r) {
    const trip = trips[cleanText_(r.trip_id)];
    if (!inScope_(scope, trip.date)) return;
    const item = exportItem_(r, trip, canonical);
    sel.candidates.push(item);
    if (isExcluded[trip.driver]) sel.excludedRows.push(item);
    else if (!item.file_key) sel.unfiled.push(item);
    else sel.rows.push(item);
  });
  return sel;
}

/** A Trips row → the trip fields a file needs. Route and driver stay verbatim (rule 22). */
function exportTrip_(t, tz) {
  const trip = dashboardTrip_(t, tz);
  trip.route = t.route === null || t.route === undefined ? '' : String(t.route);
  return trip;
}

/**
 * A pm_approved line → an export item: its classification, cost, and which file it belongs to.
 * file_key is 'inhouse_old' / 'inhouse_new' / 'c:<contractor>', or '' with a reason when none fits.
 */
function exportItem_(r, trip, canonical) {
  const contractor = cleanText_(r.contractor);
  const folded = contractor.toLowerCase();
  const inHouse = folded === IN_HOUSE.toLowerCase();
  const rawPeriod = cleanText_(r.period).toLowerCase();
  const period = EXPORT_PERIODS.indexOf(rawPeriod) === -1 ? '' : rawPeriod;
  let fileKey = '';
  let reason = '';
  if (!contractor) reason = 'no_contractor';
  else if (inHouse && !period) reason = 'no_period';
  else fileKey = inHouse ? 'inhouse_' + period : 'c:' + folded;
  return {
    raw: r,
    trip: trip,
    line_key: cleanText_(r.line_key),
    site_index: siteIndexOf_(r.line_key),
    site_id: cleanText_(r.site_id),
    job_code: cleanText_(r.job_code),
    contractor: inHouse ? IN_HOUSE : (canonical[folded] || contractor),
    period: period,
    split_cost: toMoney_(r.split_cost),
    file_key: fileKey,
    reason: reason,
  };
}

function excludedDrivers_(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw appError_('bad_request', 'excluded_drivers must be a list');
  if (value.length > MAX_EXCLUDED_DRIVERS) throw appError_('bad_request', 'Too many excluded drivers');
  const seen = Object.create(null);
  return value.filter(function (driver) {
    if (typeof driver !== 'string' || seen[driver]) return false;
    seen[driver] = true;
    return true;
  });
}

/* ---------- Result ---------- */

/** The selection with `items` as the exported rows → what the page shows and builds. */
function exportResult_(sel, items) {
  const drivers = [];
  const byDriver = Object.create(null);
  sel.candidates.forEach(function (item) {
    const name = item.trip.driver;
    if (!byDriver[name]) {
      byDriver[name] = { driver: name, rows: 0, total: 0, excluded: sel.isExcluded[name] === true };
      drivers.push(byDriver[name]);
    }
    byDriver[name].rows++;
    byDriver[name].total += item.split_cost;
  });
  drivers.forEach(function (d) { d.total = round2_(d.total); });
  drivers.sort(function (a, b) { return byName_(a.driver, b.driver); });

  return {
    scope: sel.scope,
    options: { weeks: sel.weeks },
    files: exportFiles_(sel, items),
    row_count: items.length,
    total: round2_(sumCosts_(items)),
    drivers: drivers,
    excluded_count: sel.excludedRows.length,
    excluded_total: round2_(sumCosts_(sel.excludedRows)),
    unfiled: sel.unfiled.map(function (item) {
      return {
        line_key: item.line_key,
        trip_id: item.trip.trip_id,
        date: item.trip.date,
        coordinator: item.trip.coordinator,
        driver: item.trip.driver,
        site_id: item.site_id,
        contractor: cleanText_(item.raw.contractor),
        period: item.period,
        split_cost: item.split_cost,
        reason: item.reason,
      };
    }),
  };
}

/**
 * items → the files: InHouse_OLD, InHouse_NEW, then one per contractor A→Z. Within a file, trips by
 * date then id, each with its sites in trip order (rule 21). Names are '<stem>_<week or from_to>.xlsx';
 * a contractor stem is its name's letters and digits, made unique with _2, _3… when two collide.
 */
function exportFiles_(sel, items) {
  const byKey = {};
  EXPORT_PERIODS.forEach(function (period) {
    byKey['inhouse_' + period] = newExportFile_('inhouse_' + period, IN_HOUSE, period);
  });
  items.forEach(function (item) {
    if (!byKey[item.file_key]) byKey[item.file_key] = newExportFile_(item.file_key, item.contractor, '');
    addExportRow_(byKey[item.file_key], item, sel);
  });
  const contractorFiles = Object.keys(byKey)
    .filter(function (key) { return key.indexOf('inhouse_') !== 0; })
    .map(function (key) { return byKey[key]; })
    .sort(function (a, b) { return byName_(a.contractor, b.contractor); });

  const tag = sel.scope.mode === 'week' ? sel.scope.week : sel.scope.from + '_' + sel.scope.to;
  const used = {};
  return [byKey.inhouse_old, byKey.inhouse_new].concat(contractorFiles).map(function (file) {
    let stem = file.in_house
      ? 'InHouse_' + file.period.toUpperCase()
      : (file.contractor.replace(/[^A-Za-z0-9]+/g, '') || 'Contractor');
    if (used[stem.toLowerCase()]) {
      let n = 2;
      while (used[(stem + '_' + n).toLowerCase()]) n++;
      stem = stem + '_' + n;
    }
    used[stem.toLowerCase()] = true;
    return finishExportFile_(file, stem + '_' + tag + '.xlsx');
  });
}

function newExportFile_(key, contractor, period) {
  return { key: key, in_house: period !== '', contractor: contractor, period: period, tripsById: {}, tripList: [] };
}

function addExportRow_(file, item, sel) {
  const trip = item.trip;
  let group = file.tripsById[trip.trip_id];
  if (!group) {
    group = {
      trip_id: trip.trip_id,
      date: trip.date,
      coordinator: trip.coordinator,
      route: trip.route,
      driver: trip.driver,
      site_count: sel.siteCounts[trip.trip_id] || 0,
      total: 0,
      rows: [],
    };
    file.tripsById[trip.trip_id] = group;
    file.tripList.push(group);
  }
  group.rows.push({
    line_key: item.line_key,
    site_index: item.site_index,
    site_id: item.site_id,
    job_code: item.job_code,
    period: item.period,
    split_cost: item.split_cost,
  });
  group.total += item.split_cost;
}

function finishExportFile_(file, name) {
  let total = 0;
  let rowCount = 0;
  const trips = file.tripList.sort(function (a, b) {
    return a.date.localeCompare(b.date) || a.trip_id.localeCompare(b.trip_id);
  });
  trips.forEach(function (group) {
    group.rows.sort(function (a, b) { return a.site_index - b.site_index; });
    total += group.total;
    rowCount += group.rows.length;
    group.total = round2_(group.total);
  });
  return {
    key: file.key,
    name: name,
    in_house: file.in_house,
    contractor: file.contractor,
    period: file.period,
    row_count: rowCount,
    total: round2_(total),
    trips: trips,
  };
}

/* ---------- Helpers ---------- */

/** EXP-00001, EXP-00002… one past the highest id in ExportLog or on any line. Call under the lock. */
function nextExportBatchId_(lineRows) {
  let max = 0;
  const consider = function (value) {
    const m = String(value === null || value === undefined ? '' : value).match(/^EXP-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  };
  readColumn(SHEET.EXPORT_LOG, 'export_batch_id').forEach(consider);
  lineRows.forEach(function (r) { consider(r.export_batch_id); });
  let n = String(max + 1);
  while (n.length < 5) n = '0' + n;
  return EXPORT_BATCH_PREFIX + n;
}

function sumCosts_(items) {
  return items.reduce(function (sum, item) { return sum + item.split_cost; }, 0);
}
