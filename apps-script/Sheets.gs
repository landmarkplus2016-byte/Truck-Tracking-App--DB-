/**
 * Sheets.gs — workbook access and row helpers. Rows travel as plain objects keyed
 * by the row-1 header, so column order in a tab never matters to callers.
 *
 * The workbook is opened by the SPREADSHEET_ID script property. That ID never
 * leaves Apps Script (CLAUDE.md rule 3).
 */

const SHEET = {
  FORM: 'Form Responses 1',
  TRIPS: 'Trips',
  LINES: 'Lines',
  SITE_LOOKUP: 'SiteLookup',
  CONFIG: 'Config',
  EXPORT_LOG: 'ExportLog',
};

// CLAUDE.md §2. ensureColumns appends any missing header; it never reorders or removes.
// Form Responses 1 and Config are not listed: the Form owns the first, Config is read by position.
const COLUMNS = {
  Trips: ['trip_id', 'source_row', 'date', 'coordinator', 'driver', 'route', 'sites',
    'labor', 'park', 'truck', 'hotel', 'week', 'month', 'year', 'updated_at', 'updated_by'],
  Lines: ['line_key', 'trip_id', 'date', 'coordinator', 'site_id', 'job_code', 'contractor', 'period',
    'jc_manual', 'contractor_manual', 'period_manual', 'route', 'driver', 'split_cost', 'warn', 'status',
    'approved_by_coord', 'approved_coord_at', 'approved_pm_at', 'return_note', 'export_batch_id',
    'exported_at', 'updated_at', 'updated_by'],
  SiteLookup: ['site_jc', 'task_date', 'old_new', 'contractor', 'conflict'],
  ExportLog: ['export_batch_id', 'generated_at', 'generated_by', 'scope', 'excluded_drivers', 'files', 'row_count'],
};

// Everything not listed here is written as plain text, so Sheets never turns
// '2025-10-06' into a Date or site '0079' into the number 79.
const NUMBER_COLUMNS = ['source_row', 'labor', 'park', 'truck', 'hotel', 'month', 'year', 'split_cost', 'row_count'];
const BOOLEAN_COLUMNS = ['jc_manual', 'contractor_manual', 'period_manual'];

let ss_ = null;
let tableCache_ = {};

function getSpreadsheet_() {
  if (ss_) return ss_;
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw appError_('not_configured', 'Script property SPREADSHEET_ID is not set');
  ss_ = SpreadsheetApp.openById(id);
  return ss_;
}

function spreadsheetTz_() {
  return getSpreadsheet_().getSpreadsheetTimeZone();
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw appError_('missing_sheet', 'Tab not found: ' + name);
  return sheet;
}

/**
 * Makes sure row 1 of sheet contains every key, appending missing ones after the
 * last header. Returns the full header list (trimmed), in sheet order.
 */
function ensureColumns(sheet, keys) {
  const lastCol = sheet.getLastColumn();
  const headers = lastCol
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
    : [];
  const missing = keys.filter(function (k) { return headers.indexOf(k) === -1; });
  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    missing.forEach(function (k) { headers.push(k); });
  }
  return headers;
}

/** Sheet + its headers, checked once per execution. */
function openTable_(name) {
  if (!tableCache_[name]) {
    const sheet = getSheet_(name);
    tableCache_[name] = { name: name, sheet: sheet, headers: ensureColumns(sheet, COLUMNS[name] || []) };
  }
  return tableCache_[name];
}

/** Every non-blank data row as an object, with _row = its 1-based sheet row. */
function readObjects(name) {
  const t = openTable_(name);
  const lastRow = t.sheet.getLastRow();
  if (lastRow < 2) return [];
  const tz = spreadsheetTz_();
  const values = t.sheet.getRange(2, 1, lastRow - 1, t.headers.length).getValues();
  const rows = [];
  values.forEach(function (row, i) {
    if (row.every(function (v) { return v === '' || v === null; })) return;
    const obj = { _row: i + 2 };
    t.headers.forEach(function (h, c) {
      if (h) obj[h] = cellOut_(row[c], tz);
    });
    rows.push(obj);
  });
  return rows;
}

/** One column's data values (row 2 down), or [] if the header is absent. */
function readColumn(name, key) {
  const t = openTable_(name);
  const c = t.headers.indexOf(key);
  const lastRow = t.sheet.getLastRow();
  if (c === -1 || lastRow < 2) return [];
  return t.sheet.getRange(2, c + 1, lastRow - 1, 1).getValues().map(function (r) { return r[0]; });
}

/** Appends objects as rows in one write. Unknown keys are ignored; missing keys are blank. */
function appendObjects(name, objects) {
  if (!objects.length) return;
  const t = openTable_(name);
  writeObjectsAt_(t, t.sheet.getLastRow() + 1, objects);
}

/**
 * Replaces every data row with objects: one write over row 2 down, then any old rows
 * left below are cleared. Row 1 (the headers) is kept.
 */
function replaceObjects(name, objects) {
  const t = openTable_(name);
  const oldLastRow = t.sheet.getLastRow();
  if (objects.length) writeObjectsAt_(t, 2, objects);
  const firstStale = objects.length + 2;
  if (oldLastRow >= firstStale) {
    t.sheet.getRange(firstStale, 1, oldLastRow - firstStale + 1, t.sheet.getLastColumn()).clearContent();
  }
}

/**
 * Writes whole row objects (as readObjects returns them) back to their own rows (obj._row),
 * one write per run of adjacent rows. Call under the script lock, on objects read in it.
 */
function updateObjects(name, objects) {
  if (!objects.length) return;
  const t = openTable_(name);
  const sorted = objects.slice().sort(function (a, b) { return a._row - b._row; });
  let run = [sorted[0]];
  for (let i = 1; i <= sorted.length; i++) {
    const next = sorted[i];
    if (next && next._row === run[run.length - 1]._row + 1) {
      run.push(next);
      continue;
    }
    writeObjectsAt_(t, run[0]._row, run);
    run = next ? [next] : [];
  }
}

/** One write of objects starting at startRow, growing the sheet first if it is too short. */
function writeObjectsAt_(t, startRow, objects) {
  const values = objects.map(function (o) {
    return t.headers.map(function (h) { return cellIn_(h, o[h]); });
  });
  const formats = objects.map(function () { return t.headers.map(columnFormat_); });
  const lastNeeded = startRow + objects.length - 1;
  const maxRows = t.sheet.getMaxRows();
  if (lastNeeded > maxRows) t.sheet.insertRowsAfter(maxRows, lastNeeded - maxRows);
  t.sheet.getRange(startRow, 1, objects.length, t.headers.length).setNumberFormats(formats).setValues(values);
}

/** Overwrites only the given fields on one sheet row. */
function updateFields(name, rowNumber, patch) {
  const t = openTable_(name);
  Object.keys(patch).forEach(function (key) {
    const c = t.headers.indexOf(key);
    if (c === -1) throw appError_('unknown_column', name + ' has no column ' + key);
    t.sheet.getRange(rowNumber, c + 1).setNumberFormat(columnFormat_(key)).setValue(cellIn_(key, patch[key]));
  });
}

function columnFormat_(key) {
  return NUMBER_COLUMNS.indexOf(key) !== -1 || BOOLEAN_COLUMNS.indexOf(key) !== -1 ? 'General' : '@';
}

function cellIn_(key, value) {
  if (BOOLEAN_COLUMNS.indexOf(key) !== -1) return value === true;
  if (value === null || value === undefined) return '';
  if (NUMBER_COLUMNS.indexOf(key) !== -1) return value === '' ? '' : Number(value);
  return String(value);
}

/** A hand-typed date in a text column can still come back as a Date; normalise it. */
function cellOut_(value, tz) {
  if (Object.prototype.toString.call(value) === '[object Date]') return toIsoDate_(value, tz);
  return value;
}
