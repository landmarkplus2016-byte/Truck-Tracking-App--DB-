/**
 * exportTemplate.js — one finance file as a styled sheet (CLAUDE.md §7.2, rule 21):
 *
 *   title                  In-House — Old / the contractor
 *   sub-title              scope · batch · rows · export date
 *   header                 Date | Trip | Site | Job code | Route | Driver | Period | Cost (EGP)
 *   brief    (per trip)    date, trip, "2 of 4 sites", route, driver, the trip's amount in this file
 *     site rows            site, job code, route, period, cost
 *   file total
 *
 * A file can hold only part of a trip (its other sites belong to another file), so the brief
 * amount is this file's share and the brief says how many of the trip's sites are here — the
 * briefs always add up to the file total. Colours are read from tokens.css when the file is built
 * (rule 29); xlsx-js-style keeps fonts, fills, borders and number formats on write.
 */

import { t } from '../i18n/i18n.js';
import { buildWorkbook, saveWorkbook, tokenRgb } from '../utils/xlsx.js';

const HEADER_KEYS = ['export_col_date', 'export_col_trip', 'grid_col_site_id', 'grid_col_job_code',
  'grid_col_route', 'export_col_driver', 'grid_col_period', 'export_col_cost'];
const COL_WIDTHS = [12, 10, 14, 13, 38, 28, 9, 14];
const LAST_COL = HEADER_KEYS.length - 1;

/** 'In-House — Old' for an In-House file, else the contractor's name. */
export function exportFileTitle(file) {
  return file.in_house ? t('export_title_inhouse', { period: t('period_' + file.period) }) : file.contractor;
}

/** '3 sites', or '2 of 4 sites' when the trip's other sites are in another file or not exported yet. */
export function sitesLabel(trip) {
  const n = trip.rows.length;
  if (trip.site_count > n) return t('export_sites_part', { count: n, total: trip.site_count });
  return t(n === 1 ? 'export_sites_one' : 'export_sites_many', { count: n });
}

/**
 * A file from export_commit → its workbook.
 * meta: { scopeText, batchId, exportedDate } for the sub-title.
 */
export function buildExportWorkbook(file, meta) {
  const st = sheetStyles();
  const rows = [];
  const merges = [];
  const fullWidth = (text, style) => {
    merges.push([rows.length, 0, rows.length, LAST_COL]);
    rows.push([cell(text, style), ...blanks(LAST_COL, style)]);
  };

  fullWidth(exportFileTitle(file), st.title);
  fullWidth(t(file.row_count === 1 ? 'export_sheet_sub_one' : 'export_sheet_sub', {
    scope: meta.scopeText, batch: meta.batchId, rows: file.row_count, date: meta.exportedDate,
  }), st.sub);
  rows.push([]);
  rows.push(HEADER_KEYS.map((key, c) => cell(t(key), c === LAST_COL ? st.headEnd : st.head)));

  file.trips.forEach((trip) => {
    rows.push([
      cell(trip.date, st.brief),
      cell(trip.trip_id, st.brief),
      cell(sitesLabel(trip), st.brief),
      cell('', st.brief),
      cell(trip.route, st.briefRtl),
      cell(trip.driver, st.briefRtl),
      cell('', st.brief),
      money(trip.total, st.brief),
    ]);
    trip.rows.forEach((row) => {
      rows.push([
        cell('', st.site),
        cell('', st.site),
        cell(row.site_id, st.siteId),
        cell(row.job_code, st.site),
        cell(trip.route, st.siteRtl),
        cell('', st.site),
        row.period ? cell(t('period_' + row.period), st['period_' + row.period]) : cell('', st.site),
        money(row.split_cost, st.site),
      ]);
    });
  });

  merges.push([rows.length, 0, rows.length, LAST_COL - 1]);
  rows.push([cell(t('export_file_total'), st.total), ...blanks(LAST_COL - 1, st.total), money(file.total, st.total)]);

  return buildWorkbook([{ name: exportFileTitle(file), rows, merges, cols: COL_WIDTHS }]);
}

/** Builds the file and downloads it under its server-given name. */
export function downloadExportFile(file, meta) {
  saveWorkbook(buildExportWorkbook(file, meta), file.name);
}

/* ---------- Cells & styles ---------- */

function cell(v, s) {
  return { v, s };
}

function blanks(n, s) {
  return Array.from({ length: n }, () => cell('', s));
}

/** Whole pounds show as 1,250; a cost with piastres keeps its two decimals. */
function money(value, style) {
  const v = Number(value) || 0;
  return { v, s: { ...style, numFmt: Number.isInteger(v) ? '#,##0' : '#,##0.00', alignment: { horizontal: 'right' } } };
}

function sheetStyles() {
  // ARGB — Excel reads a colour as 8 hex digits, alpha first.
  const color = (token) => {
    const rgb = tokenRgb(token);
    return rgb ? { rgb: 'FF' + rgb } : undefined;
  };
  const fill = (token) => (color(token) ? { patternType: 'solid', fgColor: color(token) } : undefined);
  const font = { name: 'Calibri', sz: 11, color: color('--text') };
  const rtl = { horizontal: 'right', readingOrder: 2 };

  const head = { font: { ...font, bold: true, color: color('--inverse') }, fill: fill('--navy'), alignment: { vertical: 'center' } };
  const brief = { font: { ...font, bold: true }, fill: fill('--surface-3'), border: { top: { style: 'thin', color: color('--border') } } };
  const site = { font };
  const period = (key) => ({
    font: { ...font, bold: true, color: color(`--${key}-fg`) },
    fill: fill(`--${key}-bg`),
    alignment: { horizontal: 'center' },
  });

  // JSON drops the colour keys a missing token left undefined.
  return JSON.parse(JSON.stringify({
    title: { font: { ...font, sz: 14, bold: true, color: color('--navy') } },
    sub: { font: { ...font, sz: 10, color: color('--text-2') } },
    head,
    headEnd: { ...head, alignment: { ...head.alignment, horizontal: 'right' } },
    brief,
    briefRtl: { ...brief, alignment: rtl },
    site,
    siteId: { font: { ...font, bold: true } },
    siteRtl: { font, alignment: rtl },
    period_old: period('old'),
    period_new: period('new'),
    total: {
      font: { ...font, sz: 12, bold: true, color: color('--navy') },
      fill: fill('--primary-subtle'),
      border: { top: { style: 'medium', color: color('--navy') } },
    },
  }));
}
