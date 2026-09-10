/**
 * master.js — Admin › Site master. The uploaded SiteID_JC_New.xlsx is read in the
 * browser with xlsx-js-style and previewed; "Upload & replace" sends the rows to
 * upload_sitelookup (SiteLookup is replaced wholesale) and drops the resolver's cached
 * master, so grids opened afterwards resolve against the new file (CLAUDE.md §2.4, §6.2).
 */

import { api } from '../api.js';
import { t, errorText } from '../i18n/i18n.js';
import { $, esc } from '../utils/dom.js';
import { parseTypedDate } from '../utils/dates.js';
import { readWorkbookFile, sheetRows, isDate1904, excelSerialToIso, downloadWorkbook } from '../utils/xlsx.js';
import { invalidateMaster, splitSiteJc, normalizePeriod, isConflictSet } from '../utils/resolve.js';
import { periodBadge, contractorBadge, warnFlag } from '../components/badge.js';
import { toast } from '../components/toast.js';
import { icon } from '../components/icons.js';

// The master file's own tab and headers. These are the file format, not UI text:
// matched loosely on import, written verbatim by "Download current".
const FILE_SHEET = 'Tracking';
const FILE_NAME = 'SiteID_JC_New.xlsx';
const FILE_HEADERS = {
  site_jc: 'Site ID-JC',
  task_date: 'Task Date',
  old_new: 'Old/New',
  contractor: 'Contractor',
  conflict: 'Conflict',
};
const FIELDS = Object.keys(FILE_HEADERS);
const REQUIRED = ['site_jc', 'task_date', 'old_new', 'contractor'];
const COLUMN_LABELS = ['master_col_site_jc', 'master_col_task_date', 'master_col_old_new', 'master_col_contractor', 'master_col_conflict'];
const HEADER_SCAN_ROWS = 20;
const SAMPLE_ROWS = 8;
const EXAMPLE_ROWS = 5;

// 'Site ID-JC', 'site_jc', 'SITE ID - JC' … all reduce to the same token.
const HEADER_ALIASES = new Map();
FIELDS.forEach((field) => {
  HEADER_ALIASES.set(headerToken(FILE_HEADERS[field]), field);
  HEADER_ALIASES.set(headerToken(field), field);
});

export function renderMasterTab(el, ctx) {
  el.innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="card-head"><h3>${esc(t('master_upload_title'))}</h3></div>
        <div class="card-body">
          <div class="drop" id="masterDrop">
            ${esc(t('master_drop_lead')).replace('{file}', `<b>${esc(FILE_NAME)}</b>`)}
            <button type="button" class="link-btn" id="masterBrowse">${esc(t('master_browse'))}</button>
            <span class="hint">${esc(t('master_drop_hint'))}</span>
            <input type="file" id="masterFile" accept=".xlsx,.xls" class="hidden">
          </div>
          <div class="form-error below hidden" id="masterError" role="alert"></div>
          <div id="masterPreview"></div>
          <div class="actions">
            <button type="button" class="btn btn-primary" id="masterUpload" disabled>${esc(t('master_upload'))}</button>
            <button type="button" class="btn btn-ghost" id="masterDownload" disabled>${esc(t('master_download'))}</button>
          </div>
        </div>
      </div>
      <div class="card" id="masterCurrent"></div>
    </div>`;

  const drop = $('#masterDrop', el);
  const fileInput = $('#masterFile', el);
  const error = $('#masterError', el);
  const preview = $('#masterPreview', el);
  const uploadBtn = $('#masterUpload', el);
  const downloadBtn = $('#masterDownload', el);
  const current = $('#masterCurrent', el);

  let pending = null;      // the parsed file waiting for "Upload & replace"
  let currentRows = null;  // the server's master, for "Download current"
  let pickSeq = 0;
  let loadSeq = 0;

  const showError = (text) => {
    error.textContent = text;
    error.classList.toggle('hidden', !text);
  };

  const clearPick = () => {
    pickSeq++;
    pending = null;
    preview.innerHTML = '';
    uploadBtn.disabled = true;
  };

  async function pick(file) {
    clearPick();
    showError('');
    const seq = pickSeq;
    if (!/\.xlsx?$/i.test(file.name)) {
      showError(errorText({ code: 'bad_file' }));
      return;
    }
    try {
      const parsed = parseMaster(await readWorkbookFile(file));
      if (!ctx.isCurrent() || seq !== pickSeq) return;
      pending = { fileName: file.name, ...parsed };
      preview.innerHTML = previewHtml(pending);
      $('#masterClear', preview).addEventListener('click', clearPick);
      uploadBtn.disabled = false;
    } catch (err) {
      if (ctx.isCurrent() && seq === pickSeq) showError(errorText(err));
    }
  }

  async function loadCurrent() {
    const seq = ++loadSeq;
    currentRows = null;
    downloadBtn.disabled = true;
    current.innerHTML = `${currentHead()}
      <div class="loading"><div class="spinner"></div><div>${esc(t('admin_loading'))}</div></div>`;
    try {
      const rows = await api.call('get_sitelookup');
      if (!ctx.isCurrent() || seq !== loadSeq) return;
      currentRows = Array.isArray(rows) ? rows : [];
      current.innerHTML = currentHtml(currentRows);
      downloadBtn.disabled = !currentRows.length;
    } catch (err) {
      if (!ctx.isCurrent() || seq !== loadSeq) return;
      current.innerHTML = `${currentHead()}
        <div class="card-body">
          <div class="form-error" role="alert">${esc(errorText(err))}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="masterRetry">${esc(t('action_retry'))}</button>
        </div>`;
      $('#masterRetry', current).addEventListener('click', loadCurrent);
    }
  }

  $('#masterBrowse', el).addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = ''; // picking the same file again still fires change
    if (file) pick(file);
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', (e) => {
    if (!drop.contains(e.relatedTarget)) drop.classList.remove('over');
  });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) pick(file);
  });

  uploadBtn.addEventListener('click', async () => {
    if (!pending) return;
    const { rows } = pending;
    uploadBtn.disabled = true;
    showError('');
    try {
      const result = await ctx.call('upload_sitelookup', { rows });
      if (!ctx.isCurrent()) return;
      toast(t('master_uploaded', { count: count(result && result.rows) }));
      clearPick();
      loadCurrent();
    } catch (err) {
      if (!ctx.isCurrent()) return;
      uploadBtn.disabled = !pending;
      showError(errorText(err));
    } finally {
      // Even a failed or timed-out upload may have written; never keep a stale master.
      invalidateMaster();
    }
  });

  downloadBtn.addEventListener('click', () => {
    if (!currentRows || !currentRows.length) return;
    try {
      downloadWorkbook(`SiteLookup_${parseTypedDate(new Date())}.xlsx`, [{
        name: FILE_SHEET,
        rows: [FIELDS.map((f) => FILE_HEADERS[f]), ...currentRows.map((r) => FIELDS.map((f) => r[f]))],
        widths: [20, 12, 9, 18, 14],
      }]);
    } catch (err) {
      showError(errorText(err));
    }
  });

  loadCurrent();
}

/* ---------- Parsing the file ---------- */

/**
 * workbook → { sheetName, rows, report }. Uses the 'Tracking' tab when there is one,
 * else the first tab carrying the master's headers (found in the first rows, so a title
 * row above them is fine). Throws master_missing_columns / master_empty.
 */
function parseMaster(workbook) {
  const names = workbook.SheetNames || [];
  const isTracking = (name) => name.trim().toLowerCase() === FILE_SHEET.toLowerCase();
  const ordered = [...names.filter(isTracking), ...names.filter((n) => !isTracking(n))];
  const date1904 = isDate1904(workbook);

  let missing = REQUIRED;
  for (const name of ordered) {
    const { rows, firstRow } = sheetRows(workbook, name);
    const header = findHeader(rows);
    if (!header) continue;
    const lacking = REQUIRED.filter((f) => header.columns[f] === undefined);
    if (lacking.length) {
      if (lacking.length < missing.length) missing = lacking;
      continue;
    }
    return { sheetName: name, ...readRows(rows, firstRow, header, date1904) };
  }
  throw coded('master_missing_columns', missing.map((f) => FILE_HEADERS[f]).join(', '));
}

function findHeader(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const columns = {};
    (rows[i] || []).forEach((cell, c) => {
      const field = HEADER_ALIASES.get(headerToken(cell));
      if (field && columns[field] === undefined) columns[field] = c;
    });
    if (columns.site_jc !== undefined) return { index: i, columns };
  }
  return null;
}

/** Data rows under the header → upload rows, plus what the preview should warn about. */
function readRows(rows, firstRow, { index, columns }, date1904) {
  const cell = (row, field) => (columns[field] === undefined ? '' : row[columns[field]]);
  const out = [];
  const sites = new Set();
  const report = { badKey: [], undated: [], badPeriod: [], conflicts: 0 };

  for (let i = index + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const siteJc = text(cell(row, 'site_jc'));
    if (!siteJc) continue;
    const sheetRow = firstRow + i;
    const item = {
      site_jc: siteJc,
      task_date: dateCell(cell(row, 'task_date'), date1904),
      old_new: text(cell(row, 'old_new')),
      contractor: text(cell(row, 'contractor')),
      conflict: conflictCell(cell(row, 'conflict')),
    };
    // Same rules the resolver applies, so the warnings describe what it will actually do.
    const parts = splitSiteJc(item.site_jc);
    if (parts) sites.add(parts.site_id);
    else report.badKey.push(sheetRow);
    if (!parseTypedDate(item.task_date)) report.undated.push(sheetRow);
    if (!normalizePeriod(item.old_new)) report.badPeriod.push(sheetRow);
    if (isConflictSet(item.conflict)) report.conflicts++;
    out.push(item);
  }

  if (!out.length) throw coded('master_empty');
  return { rows: out, report: { ...report, sites: sites.size } };
}

/** A date cell → ISO. A real date arrives as a serial; typed text is parsed, or kept as typed. */
function dateCell(value, date1904) {
  if (typeof value === 'number') return excelSerialToIso(value, date1904);
  const s = text(value);
  return parseTypedDate(s) || s;
}

function conflictCell(value) {
  if (value === true) return 'TRUE';
  if (value === false) return '';
  return text(value);
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function headerToken(value) {
  return text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function coded(code, detail = '') {
  return Object.assign(new Error(detail || code), { code, detail });
}

/* ---------- Markup ---------- */

function previewHtml({ fileName, sheetName, rows, report }) {
  const warnings = [
    ['master_warn_bad_key', report.badKey],
    ['master_warn_undated', report.undated],
    ['master_warn_bad_period', report.badPeriod],
  ]
    .filter(([, list]) => list.length)
    .map(([key, list]) => `<li>${esc(t(key, { count: count(list.length), rows: exampleRows(list) }))}</li>`);

  const summary = t('master_preview_summary', {
    sheet: sheetName,
    tasks: count(rows.length),
    sites: count(report.sites),
    conflicts: count(report.conflicts),
  });
  return `
    <div class="file-pick">
      <span><b dir="auto">${esc(fileName)}</b> · <span dir="auto">${esc(summary)}</span></span>
      <button type="button" class="link-btn" id="masterClear">${esc(t('master_clear'))}</button>
    </div>
    ${warnings.length ? `<div class="warn-box"><ul>${warnings.join('')}</ul></div>` : ''}
    <div class="note">${esc(t('master_replace_note'))}</div>`;
}

function currentHead(badge = '') {
  return `<div class="card-head"><h3>${esc(t('master_current_title'))}</h3><div class="spacer"></div>${badge}</div>`;
}

function currentHtml(rows) {
  const sites = new Set();
  rows.forEach((r) => {
    const parts = splitSiteJc(r.site_jc);
    if (parts) sites.add(parts.site_id);
  });
  const badge = `<span class="badge b-pending">${esc(t('master_counts', { tasks: count(rows.length), sites: count(sites.size) }))}</span>`;
  if (!rows.length) {
    return `${currentHead(badge)}<div class="empty">${icon('grid')}<div>${esc(t('master_current_empty'))}</div></div>`;
  }
  return `${currentHead(badge)}
    <div class="grid-wrap">
      <table>
        <thead><tr>${COLUMN_LABELS.map((key) => `<th>${esc(t(key))}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, SAMPLE_ROWS).map(sampleRowHtml).join('')}</tbody>
      </table>
    </div>`;
}

function sampleRowHtml(r) {
  const period = periodBadge(r.old_new) || (r.old_new ? warnFlag(r.old_new, t('master_bad_period_title')) : '');
  const conflictText = String(r.conflict).trim().toLowerCase() === 'true' ? t('master_conflict') : r.conflict;
  return `<tr>
      <td class="site num">${esc(r.site_jc)}</td>
      <td class="num">${esc(r.task_date)}</td>
      <td>${period}</td>
      <td>${contractorBadge(r.contractor)}</td>
      <td>${isConflictSet(r.conflict) ? warnFlag(conflictText) : ''}</td>
    </tr>`;
}

function exampleRows(list) {
  const shown = list.slice(0, EXAMPLE_ROWS).join(', ');
  return list.length > EXAMPLE_ROWS ? `${shown}, …` : shown;
}

function count(n) {
  return (Number(n) || 0).toLocaleString('en-US');
}
