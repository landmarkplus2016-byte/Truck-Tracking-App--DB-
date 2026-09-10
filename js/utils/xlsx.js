/**
 * xlsx.js — thin wrappers over the xlsx-js-style global (XLSX) pinned in index.html.
 * Reading a workbook and a plain download live here now; the styled finance sheets
 * (CLAUDE.md §7.2) are added in Stage 10.
 */

const MAX_SERIAL = 2958465; // 9999-12-31

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
 * Builds and downloads a workbook. sheets: [{ name, rows, widths? }] where rows are
 * arrays of cell values and rows[0] is the header (written bold).
 */
export function downloadWorkbook(fileName, sheets) {
  const X = lib();
  const wb = X.utils.book_new();
  sheets.forEach(({ name, rows, widths }) => {
    const ws = X.utils.aoa_to_sheet(rows);
    (rows[0] || []).forEach((_, c) => {
      const cell = ws[X.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = { font: { bold: true } };
    });
    if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
    X.utils.book_append_sheet(wb, ws, name);
  });
  X.writeFile(wb, fileName);
}
