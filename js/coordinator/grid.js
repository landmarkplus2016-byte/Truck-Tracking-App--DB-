/**
 * grid.js — the coordinator grid: each trip as a brief head row, its sites as child rows
 * (CLAUDE.md §6.5). Only site_id, job_code, contractor and period are editable (rule 11);
 * cost is read-only and there is no add/remove of sites here.
 *
 * renderGrid builds the card. patchRow refreshes one row in place after a commit or a
 * server answer, leaving the focused control alone, so tabbing on keeps its caret (§6.2).
 * bindGridEvents reports commits on blur / Enter / select change — never per keystroke.
 */

import { t } from '../i18n/i18n.js';
import { esc } from '../utils/dom.js';
import { formatMoney } from '../utils/money.js';
import { isManual } from '../utils/resolve.js';
import { periodBadge, isInHouse, warnFlag } from '../components/badge.js';
import { isOpen, isApproved, isLocked } from './autofill.js';

const EMPTY = '—';
const HEAD_COLUMNS = ['site_id', 'job_code', 'route', 'contractor', 'period', 'cost', 'status'];
const WARNINGS = {
  unknown_site: ['warn_unknown_site', 'warn_unknown_site_tip'],
  conflict: ['warn_conflict', 'warn_conflict_tip'],
  missing_job_code: ['warn_missing_job_code', 'warn_missing_job_code_tip'],
};
const MANUAL_FLAG = { job_code: 'jc_manual', contractor: 'contractor_manual', period: 'period_manual' };

/* ---------- Render ---------- */

/** lines (already ordered by trip) → the grid card. ctx: { contractors: [] }. */
export function renderGrid(lines, ctx) {
  const rows = groupByTrip(lines).map((group) => tripHeadHtml(group) + group.map((line) => rowHtml(line, ctx)).join('')).join('');
  return `
    <div class="card">
      <div class="grid-wrap">
        <table class="coord-grid">
          <thead><tr>
            <th class="col-check"></th>
            ${HEAD_COLUMNS.map((c) => `<th>${esc(t('grid_col_' + c))}</th>`).join('')}
            <th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="card-body grid-foot">
        <div class="legend">
          <span>${periodBadge('old')} / ${periodBadge('new')} ${esc(t('legend_period'))}</span>
          <span>${warnFlag(t('warn_unknown_site'))} ${esc(t('legend_unknown'))}</span>
          <span><span class="editable manual">•</span> ${esc(t('legend_manual'))}</span>
          <span><span class="badge b-approved">${esc(t('status_approved'))}</span> ${esc(t('legend_revert'))}</span>
        </div>
      </div>
    </div>`;
}

function groupByTrip(lines) {
  const groups = new Map();
  lines.forEach((line) => {
    if (!groups.has(line.trip_id)) groups.set(line.trip_id, []);
    groups.get(line.trip_id).push(line);
  });
  return Array.from(groups.values());
}

/** date · route · driver · total over n sites → per site. The lines re-sum to the trip total exactly. */
function tripHeadHtml(group) {
  const first = group[0];
  const total = group.reduce((sum, line) => sum + (Number(line.split_cost) || 0), 0);
  const brief = group.length === 1
    ? t('grid_trip_brief_one', { total: formatMoney(total) })
    : t('grid_trip_brief', { total: formatMoney(total), count: group.length, per: formatMoney(first.split_cost) });
  return `
    <tr class="trip-head" data-trip="${esc(first.trip_id)}">
      <td colspan="${HEAD_COLUMNS.length + 2}">
        <span class="num">${esc(first.date)}</span> ·
        <span dir="auto">${esc(first.route)}</span> ·
        ${esc(t('grid_driver'))} <span dir="auto">${esc(first.driver)}</span> ·
        <span class="num">${esc(brief)}</span>
      </td>
    </tr>`;
}

function rowHtml(line, ctx) {
  return `<tr class="${rowClass(line)}" data-key="${esc(line.line_key)}">${cellsOf(line, ctx).map((html) => `<td>${html}</td>`).join('')}</tr>`;
}

function rowClass(line) {
  return ['child', isApproved(line) && 'row-approved', isLocked(line) && 'row-locked', isOpen(line) && WARNINGS[line.warn] && 'row-warn']
    .filter(Boolean)
    .join(' ');
}

/** The inner HTML of each cell, in column order. */
function cellsOf(line, ctx) {
  const locked = isLocked(line);
  return [
    `<input type="checkbox" class="rowcb" aria-label="${esc(t('grid_select_line', { site: line.site_id }))}"${isOpen(line) ? '' : ' disabled'}>`,
    editableHtml(line, 'site_id', locked, 'site num'),
    editableHtml(line, 'job_code', locked, 'num'),
    `<span dir="auto">${esc(line.route)}</span>`,
    selectHtml(line, 'contractor', contractorOptions(line, ctx), locked),
    selectHtml(line, 'period', [['old', t('period_old')], ['new', t('period_new')]], locked),
    `<span class="num">${esc(formatMoney(line.split_cost))}</span>`,
    statusHtml(line),
    isOpen(line) ? `<button type="button" class="btn btn-ghost btn-sm approve1">${esc(t('grid_approve'))}</button>` : '',
  ];
}

function editableHtml(line, field, locked, className) {
  const value = text(line[field]);
  const manual = MANUAL_FLAG[field] && isManual(line[MANUAL_FLAG[field]]);
  const classes = ['editable', className, manual && 'manual', !value && 'is-empty'].filter(Boolean).join(' ');
  const editing = locked ? '' : ' contenteditable="true" role="textbox" spellcheck="false"';
  const tip = manual ? ` title="${esc(t('grid_manual_tip'))}"` : '';
  return `<span class="${classes}" data-field="${field}" data-value="${esc(value)}"${editing} aria-label="${esc(t('grid_col_' + field))}"${tip}>${esc(value || EMPTY)}</span>`;
}

/** A badge-coloured picker. The first option ('') hands the field back to the master. */
function selectHtml(line, field, options, locked) {
  const value = text(line[field]);
  const manual = isManual(line[MANUAL_FLAG[field]]);
  const list = options.slice();
  if (value && !list.some(([v]) => v === value)) list.push([value, value]);
  const optionsHtml = [['', t('grid_auto_option')], ...list]
    .map(([v, label]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
  const tip = manual ? ` title="${esc(t('grid_manual_tip'))}"` : '';
  return `<span class="cell-wrap${manual ? ' manual' : ''}"${tip}>
      <select class="cell-select ${badgeClass(field, value)}" data-field="${field}" aria-label="${esc(t('grid_col_' + field))}"${locked ? ' disabled' : ''} dir="auto">${optionsHtml}</select>
    </span>`;
}

function contractorOptions(line, ctx) {
  return (ctx.contractors || []).map((name) => [name, name]);
}

function badgeClass(field, value) {
  if (!value) return 'b-warn';
  if (field === 'period') return value === 'old' ? 'b-old' : value === 'new' ? 'b-new' : 'b-warn';
  return isInHouse(value) ? 'b-inhouse' : 'b-contractor';
}

function statusHtml(line) {
  const badge = (cls, label) => `<span class="badge ${cls}" dir="auto">${esc(label)}</span>`;
  switch (line.status) {
    case 'coord_approved':
      return badge('b-approved', line.approved_by_coord ? t('status_coord_approved', { name: line.approved_by_coord }) : t('status_approved'));
    case 'pm_approved':
      return badge('b-approved', t('status_pm_approved'));
    case 'exported':
      return badge('b-pending', t('status_exported'));
    case 'returned':
      return `${badge('b-warn', t('status_returned'))} ${warnHtml(line)}${line.return_note ? `<div class="return-note" dir="auto">${esc(line.return_note)}</div>` : ''}`;
    default:
      return warnHtml(line) || badge('b-pending', t('status_pending'));
  }
}

function warnHtml(line) {
  const labels = WARNINGS[line.warn];
  return labels ? warnFlag(t(labels[0]), t(labels[1])) : '';
}

/* ---------- Patch in place ---------- */

/** Refreshes one row from `line`. The focused control is updated, never replaced. */
export function patchRow(tr, line, ctx) {
  const box = tr.querySelector('.rowcb');
  const wasChecked = Boolean(box && box.checked);
  const active = document.activeElement;
  const cells = cellsOf(line, ctx);
  tr.className = rowClass(line);

  Array.from(tr.children).forEach((td, i) => {
    if (!td.contains(active)) {
      td.innerHTML = cells[i];
      return;
    }
    const el = td.querySelector('[data-field]');
    if (!el) return;
    const field = el.dataset.field;
    const value = text(line[field]);
    const manual = MANUAL_FLAG[field] && isManual(line[MANUAL_FLAG[field]]);
    if (el.tagName === 'SELECT') {
      if (!Array.from(el.options).some((o) => o.value === value)) el.add(new Option(value, value));
      el.value = value;
      el.className = `cell-select ${badgeClass(field, value)}`;
      el.parentElement.classList.toggle('manual', Boolean(manual));
    } else if (el.textContent.trim() === text(el.dataset.value)) {
      // Focus just arrived and nothing is typed yet — safe to show the new value.
      el.textContent = value;
      el.classList.toggle('manual', Boolean(manual));
      el.classList.remove('is-empty');
    }
    el.dataset.value = value;
  });

  const newBox = tr.querySelector('.rowcb');
  if (newBox && !newBox.disabled) newBox.checked = wasChecked;
}

/* ---------- Events ---------- */

/** handlers: onCommit(lineKey, field, rawValue), onApprove(lineKey). Bind once on the grid host. */
export function bindGridEvents(root, { onCommit, onApprove }) {
  const editableOf = (target) => (target.closest ? target.closest('.editable[contenteditable="true"]') : null);
  const keyOf = (el) => el.closest('tr').dataset.key;

  root.addEventListener('focusin', (e) => {
    const el = editableOf(e.target);
    if (el && el.classList.contains('is-empty')) {
      el.textContent = '';
      el.classList.remove('is-empty');
    }
  });

  root.addEventListener('focusout', (e) => {
    const el = editableOf(e.target);
    if (!el) return;
    const previous = text(el.dataset.value);
    if (el.dataset.cancelled) {
      delete el.dataset.cancelled;
      showValue(el, previous);
      return;
    }
    const value = el.textContent.replace(/\s+/g, ' ').trim();
    if (value === previous) {
      showValue(el, previous);
      return;
    }
    if (!value) showValue(el, '');
    onCommit(keyOf(el), el.dataset.field, value);
  });

  root.addEventListener('keydown', (e) => {
    const el = editableOf(e.target);
    if (!el) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      el.dataset.cancelled = '1';
      el.blur();
    }
  });

  // Paste as plain, single-line text.
  root.addEventListener('paste', (e) => {
    const el = editableOf(e.target);
    if (!el) return;
    e.preventDefault();
    const pasted = (e.clipboardData ? e.clipboardData.getData('text') : '').replace(/\s+/g, ' ').trim();
    document.execCommand('insertText', false, pasted);
  });

  root.addEventListener('change', (e) => {
    const select = e.target.closest ? e.target.closest('select.cell-select') : null;
    if (select) onCommit(keyOf(select), select.dataset.field, select.value);
  });

  root.addEventListener('click', (e) => {
    const button = e.target.closest ? e.target.closest('.approve1') : null;
    if (button) onApprove(keyOf(button));
  });
}

function showValue(el, value) {
  el.textContent = value || EMPTY;
  el.classList.toggle('is-empty', !value);
}

function text(value) {
  return value === null || value === undefined ? '' : String(value);
}
