/**
 * xlsx.js — thin wrappers over the xlsx-js-style global (XLSX) pinned in index.html:
 * reading a workbook, and writing one with cell styles (fonts, fills, borders, number
 * formats), which the free SheetJS build would drop on write.
 */

const MAX_SERIAL = 2958465; // 9999-12-31
const MAX_SHEET_NAME = 31;

function lib() {
  const X = globalThis.XLSX;
  if (!X) throw coded('xlsx_unavailable');
  return X;
}

function coded(code, detail = '') {
  return Object.assign(new Error(detail || code), { code, detail });
}

/**
 * A picked or dropped File → workbook. Dates are left as Excel serial numbers (no
 * cellDates) and turned into ISO by excelSerialToIso, so the browser's time zone can
 * never shift a task date by a day.
 */
export async function readWorkbookFile(file) {
  const X = lib();
  const buffer = await file.arrayBuffer();
  try {
    return X.read(buffer, { type: 'array' });
  } catch (err) {
    throw coded('bad_file', err && err.message);
  }
}

/**
 * One tab as arrays of raw cell values. firstRow is the sheet row number of rows[0],
 * so firstRow + i is what the admin sees in Excel.
 */
export function sheetRows(workbook, sheetName) {
  const X = lib();
  const ws = workbook.Sheets[sheetName];
  if (!ws || !ws['!ref']) return { rows: [], firstRow: 1 };
  const rows = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
  return { rows, firstRow: X.utils.decode_range(ws['!ref']).s.r + 1 };
}

export function isDate1904(workbook) {
  return Boolean(workbook && workbook.Workbook && workbook.Workbook.WBProps && workbook.Workbook.WBProps.date1904);
}

/** An Excel date serial → 'YYYY-MM-DD' (time of day dropped). '' if it isn't a usable serial. */
export function excelSerialToIso(serial, date1904 = false) {
  if (typeof serial !== 'number' || !isFinite(serial) || serial < 1 || serial > MAX_SERIAL) return '';
  const days = Math.floor(serial) + (date1904 ? 1462 : 0);
  return new Date(Date.UTC(1899, 11, 30) + days * 86400000).toISOString().slice(0, 10);
}

/**
 * A design token (a CSS custom property from tokens.css) → 'RRGGBB' for a cell style, or ''
 * when it isn't a hex colour. Sheet colours come from here, so no hex lives outside tokens.css.
 */
export function tokenRgb(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(value);
  if (m) return m[1].toUpperCase();
  m = /^#([0-9a-f]{3})$/i.exec(value);
  return m ? m[1].split('').map((c) => c + c).join('').toUpperCase() : '';
}

/**
 * sheets: [{ name, rows, merges?, cols? }] → a workbook. Each row is an array of cells: a plain
 * value, or { v, s } with an xlsx-js-style style s (font, fill, border, alignment, numFmt).
 * merges: [[firstRow, firstCol, lastRow, lastCol]] (0-based). cols: character widths.
 */
export function buildWorkbook(sheets) {
  const X = lib();
  const wb = X.utils.book_new();
  sheets.forEach(({ name, rows, merges, cols }) => {
    const values = rows.map((row) => row.map((cell) => {
      const v = isStyledCell(cell) ? cell.v : cell;
      return v === null || v === undefined ? '' : v;
    }));
    const ws = X.utils.aoa_to_sheet(values);
    rows.forEach((row, r) => row.forEach((cell, c) => {
      if (!isStyledCell(cell) || !cell.s) return;
      const ref = X.utils.encode_cell({ r, c });
      if (ws[ref]) ws[ref].s = cell.s;
    }));
    if (merges && merges.length) {
      ws['!merges'] = merges.map(([r1, c1, r2, c2]) => ({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } }));
    }
    if (cols) ws['!cols'] = cols.map((wch) => ({ wch }));
    X.utils.book_append_sheet(wb, ws, safeSheetName(name));
  });
  return wb;
}

/** Saves a workbook as a download. */
export function saveWorkbook(wb, fileName) {
  lib().writeFile(wb, fileName);
}

/**
 * Builds and downloads a plain workbook. sheets: [{ name, rows, widths? }] where rows are
 * arrays of cell values and rows[0] is the header (written bold).
 */
export function downloadWorkbook(fileName, sheets) {
  saveWorkbook(buildWorkbook(sheets.map(({ name, rows, widths }) => ({
    name,
    rows: rows.map((row, r) => (r === 0 ? row.map((v) => ({ v, s: { font: { bold: true } } })) : row)),
    cols: widths,
  }))), fileName);
}

function isStyledCell(cell) {
  return cell !== null && typeof cell === 'object' && !(cell instanceof Date);
}

/** Excel's sheet-name rules: at most 31 characters, none of []:*?/\ */
function safeSheetName(name) {
  return String(name || '').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, MAX_SHEET_NAME) || 'Sheet1';
}
