/**
 * Ingest.gs — a Form submission becomes one Trips row and N Lines rows.
 *
 * The trigger only explodes and routes (CLAUDE.md rule 15): each line gets its site
 * and split cost; job_code / contractor / period stay blank for the coordinator's
 * grid to resolve. Form Responses 1 is read, never written (rule 7).
 *
 * Ingest is idempotent on source_row, so a duplicate trigger fire or a re-run of
 * ingestPending never creates a second trip for the same response.
 */

// Form Responses 1 column order (CLAUDE.md §2.1). Read by position because that tab's
// row-1 headers are the Form's question titles, not our keys.
const FORM_COLUMNS = ['timestamp', 'date', 'site_rep', 'coordinator', 'sites', 'route', 'driver',
  'labor', 'park', 'truck', 'hotel', 'week'];

const INGEST_ACTOR = 'form_ingest';
const TRIP_SEQ_PROPERTY = 'trip_seq';
const TRIGGER_LOCK_WAIT_MS = 120000;

/** Installable trigger handler — see installFormTrigger. */
function onFormSubmit(e) {
  if (!e || !e.range) throw new Error('onFormSubmit runs from the form-submit trigger; use ingestPending to run by hand');
  if (e.range.getSheet().getName() !== SHEET.FORM) return;
  const row = e.range.getRow();
  const result = withScriptLock(function () { return ingestRows_([row]); }, TRIGGER_LOCK_WAIT_MS);
  console.log('Ingested response row ' + row + ': ' + JSON.stringify(result));
}

/**
 * Run by hand from the editor. Ingests every Form response not yet in Trips —
 * the first-time seed, and the catch-up if a trigger run ever failed.
 */
function ingestPending() {
  const result = withScriptLock(function () {
    const lastRow = getSheet_(SHEET.FORM).getLastRow();
    const rows = [];
    for (let r = 2; r <= lastRow; r++) rows.push(r);
    return ingestRows_(rows);
  }, TRIGGER_LOCK_WAIT_MS);
  console.log('ingestPending: ' + JSON.stringify(result));
}

/**
 * Run once from the editor. The script is standalone, so the spreadsheet trigger has to
 * be created in code. Replaces any existing onFormSubmit trigger, so re-running is safe.
 */
function installFormTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'onFormSubmit'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(getSpreadsheet_()).onFormSubmit().create();
  console.log('onFormSubmit trigger installed');
}

/* ---------- Core ---------- */

function ingestRows_(rowNumbers) {
  const seen = {};
  readColumn(SHEET.TRIPS, 'source_row').forEach(function (v) { if (v !== '') seen[Number(v)] = true; });
  const todo = rowNumbers.filter(function (r) { return r >= 2 && !seen[r]; });
  if (!todo.length) return { trips: 0, lines: 0, skipped: rowNumbers.length };

  const responses = readResponses_(todo).filter(function (res) { return !isBlankResponse_(res); });
  if (!responses.length) return { trips: 0, lines: 0, skipped: rowNumbers.length };

  const tz = spreadsheetTz_();
  const now = nowIso_();
  const ids = allocateTripIds_(responses.length);
  const trips = [];
  const lines = [];
  responses.forEach(function (res, i) {
    const trip = buildTrip_(res, ids[i], tz, now);
    if (!trip.sites) console.warn(trip.trip_id + ' (response row ' + res._row + ') has no sites — no lines created');
    if (!trip.date) console.warn(trip.trip_id + ' (response row ' + res._row + ') has no readable date');
    trips.push(trip);
    buildLines_(trip, now).forEach(function (line) { lines.push(line); });
  });

  appendObjects(SHEET.TRIPS, trips);
  appendObjects(SHEET.LINES, lines);
  return { trips: trips.length, lines: lines.length, skipped: rowNumbers.length - trips.length };
}

/** The given Form rows as objects keyed by FORM_COLUMNS, read in one range. */
function readResponses_(rowNumbers) {
  const sheet = getSheet_(SHEET.FORM);
  const first = Math.min.apply(null, rowNumbers);
  const last = Math.max.apply(null, rowNumbers);
  const values = sheet.getRange(first, 1, last - first + 1, FORM_COLUMNS.length).getValues();
  return rowNumbers.map(function (r) {
    const res = { _row: r };
    FORM_COLUMNS.forEach(function (key, c) { res[key] = values[r - first][c]; });
    return res;
  });
}

function isBlankResponse_(res) {
  return res.timestamp === '' && res.coordinator === '' && res.sites === '';
}

function buildTrip_(res, tripId, tz, now) {
  const date = entryDateOf(res.date, res.timestamp, tz);
  return {
    trip_id: tripId,
    source_row: res._row,
    date: date,
    coordinator: text_(res.coordinator, tz).trim(),
    driver: text_(res.driver, tz),   // verbatim — never parsed or trimmed (rule 22)
    route: text_(res.route, tz),
    sites: parseSites(res.sites).join('/'),
    labor: toMoney_(res.labor),
    park: toMoney_(res.park),
    truck: toMoney_(res.truck),
    hotel: toMoney_(res.hotel),
    week: text_(res.week, tz).trim() || (date ? isoWeek_(date) : ''),
    month: date ? Number(date.slice(5, 7)) : '',
    year: date ? Number(date.slice(0, 4)) : '',
    updated_at: now,
    updated_by: INGEST_ACTOR,
  };
}

function buildLines_(trip, now) {
  return explodeTrip(trip).map(function (part) {
    return {
      line_key: trip.trip_id + ':' + part.site_index,
      trip_id: trip.trip_id,
      date: trip.date,
      coordinator: trip.coordinator,
      site_id: part.site_id,
      job_code: '',
      contractor: '',
      period: '',
      jc_manual: false,
      contractor_manual: false,
      period_manual: false,
      route: trip.route,
      driver: trip.driver,
      split_cost: part.split_cost,
      warn: 'missing_job_code',   // true until the coordinator's grid resolves it
      status: 'pending',
      approved_by_coord: '',
      approved_coord_at: '',
      approved_pm_at: '',
      return_note: '',
      export_batch_id: '',
      exported_at: '',
      updated_at: now,
      updated_by: INGEST_ACTOR,
    };
  });
}

/**
 * Reserves `count` new trip ids (T-00001…). The counter lives in a script property and
 * is also checked against the highest id in Trips, so an id is never handed out twice —
 * even if trip rows are deleted or the property is lost. Caller must hold the lock.
 */
function allocateTripIds_(count) {
  const props = PropertiesService.getScriptProperties();
  let last = Math.max(Number(props.getProperty(TRIP_SEQ_PROPERTY)) || 0, maxTripSeqInSheet_());
  const ids = [];
  for (let i = 0; i < count; i++) {
    last++;
    ids.push('T-' + ('0000' + last).slice(-Math.max(5, String(last).length)));
  }
  props.setProperty(TRIP_SEQ_PROPERTY, String(last));
  return ids;
}

function maxTripSeqInSheet_() {
  return readColumn(SHEET.TRIPS, 'trip_id').reduce(function (max, id) {
    const m = String(id).match(/^T-(\d+)$/);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
}

function text_(value, tz) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return toIsoDate_(value, tz);
  return String(value);
}
