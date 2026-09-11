/**
 * approvals.js — PM › Approvals (#/pm/approvals): every coordinator-approved line,
 * consolidated (CLAUDE.md §3.5, rules 16–17).
 *
 * Filter by week / coordinator / period (and whether to show lines still awaiting the PM,
 * already PM-approved, or both). Approve per line or the selected set — the final gate
 * before export — or return lines to their coordinator with a note.
 */

import { api } from '../api.js';
import { t, errorText } from '../i18n/i18n.js';
import { $, esc } from '../utils/dom.js';
import { isoWeek, weekRangeText } from '../utils/dates.js';
import { formatMoney } from '../utils/money.js';
import { normalizePeriod } from '../utils/resolve.js';
import { periodBadge, contractorBadge, lineWarnFlag } from '../components/badge.js';
import { toast } from '../components/toast.js';
import { promptDialog } from '../components/modal.js';
import { icon } from '../components/icons.js';
import { selectedKeys, bindSelection } from '../components/table.js';

const EMPTY = '—';
const MISSING = '<span class="badge b-warn">—</span>';
const LISTED = ['coord_approved', 'pm_approved'];
const VIEWS = { awaiting: ['coord_approved'], approved: ['pm_approved'], all: LISTED };
const COLUMNS = ['pm_col_date', 'pm_col_coordinator', 'pm_col_site', 'grid_col_job_code', 'pm_col_driver',
  'grid_col_cost', 'grid_col_period', 'grid_col_contractor', 'grid_col_status'];

// The PM's filters, kept while the tab is open.
const filters = { week: '', coordinator: '', period: '', view: 'awaiting' };

export function renderApprovals({ host, isCurrent }) {
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>${esc(t('pm_loading'))}</div></div>`;
  api.call('list_lines', { statuses: LISTED })
    .then((lines) => {
      if (isCurrent()) mount(host, Array.isArray(lines) ? lines : [], isCurrent);
    })
    .catch((err) => {
      if (!isCurrent()) return;
      host.innerHTML = `
        <div class="card"><div class="card-body">
          <div class="form-error" role="alert">${esc(errorText(err))}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="pmRetry">${esc(t('action_retry'))}</button>
        </div></div>`;
      $('#pmRetry', host).addEventListener('click', () => renderApprovals({ host, isCurrent }));
    });
}

function mount(host, lines, isCurrent) {
  const order = lines.map((line) => line.line_key);
  const model = new Map(lines.map((line) => [line.line_key, line]));
  const weeks = unique(lines.map((line) => isoWeek(line.date))).sort().reverse();
  const coordinators = unique(lines.map((line) => line.coordinator)).sort((a, b) => a.localeCompare(b));
  if (!weeks.includes(filters.week)) filters.week = '';
  if (!coordinators.includes(filters.coordinator)) filters.coordinator = '';

  const option = (value, label, current) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
  host.innerHTML = `
    <div class="filters" id="pmFilters">
      <div class="field">
        <label for="pmWeek">${esc(t('pm_filter_week'))}</label>
        <select id="pmWeek" data-filter="week">
          ${option('', t('pm_all_weeks'), filters.week)}${weeks.map((w) => option(w, weekLabel(w), filters.week)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="pmCoordinator">${esc(t('pm_filter_coordinator'))}</label>
        <select id="pmCoordinator" data-filter="coordinator" dir="auto">
          ${option('', t('pm_all'), filters.coordinator)}${coordinators.map((c) => option(c, c, filters.coordinator)).join('')}
        </select>
      </div>
      <div class="field">
        <label for="pmPeriod">${esc(t('pm_filter_period'))}</label>
        <select id="pmPeriod" data-filter="period">
          ${option('', t('pm_all'), filters.period)}${option('old', t('period_old'), filters.period)}${option('new', t('period_new'), filters.period)}
        </select>
      </div>
      <div class="field">
        <label for="pmView">${esc(t('pm_filter_view'))}</label>
        <select id="pmView" data-filter="view">
          ${Object.keys(VIEWS).map((v) => option(v, t('pm_view_' + v), filters.view)).join('')}
        </select>
      </div>
      <div class="spacer"></div>
      <button type="button" class="btn btn-ghost btn-sm push-end" id="pmRefresh">${esc(t('pm_refresh'))}</button>
    </div>
    <div class="bar">
      <label class="check-label"><input type="checkbox" id="pmSelAll"> ${esc(t('coord_select_all'))}</label>
      <span class="count" id="pmCount"></span>
      <div class="spacer"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="pmReturnSel">${esc(t('pm_return_selected'))}</button>
      <button type="button" class="btn btn-primary btn-sm" id="pmApproveSel">${esc(t('pm_approve_selected'))}</button>
    </div>
    <div id="pmGrid"></div>`;

  const grid = $('#pmGrid', host);
  const bulkButtons = [$('#pmReturnSel', host), $('#pmApproveSel', host)];
  const syncSelection = bindSelection(grid, $('#pmSelAll', host), () => {});
  const rowOf = (key) => grid.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  let busy = false;

  const inScope = (line) => (!filters.week || isoWeek(line.date) === filters.week)
    && (!filters.coordinator || line.coordinator === filters.coordinator)
    && (!filters.period || normalizePeriod(line.period) === filters.period);

  function draw() {
    const rows = order.map((key) => model.get(key)).filter((line) => inScope(line) && VIEWS[filters.view].includes(line.status));
    grid.innerHTML = rows.length
      ? tableHtml(rows)
      : `<div class="card"><div class="empty">${icon('check')}<div>${esc(t(lines.length ? 'pm_empty' : 'pm_empty_all'))}</div></div></div>`;
    updateCount();
    syncSelection();
  }

  function updateCount() {
    let awaiting = 0;
    let approved = 0;
    model.forEach((line) => {
      if (!inScope(line)) return;
      if (line.status === 'coord_approved') awaiting++;
      else if (line.status === 'pm_approved') approved++;
    });
    const bold = (n) => `<b class="num">${n}</b>`;
    $('#pmCount', host).innerHTML = esc(t('pm_counts')).replace('{awaiting}', bold(awaiting)).replace('{approved}', bold(approved));
  }

  function setBusy(keys, on) {
    busy = on;
    bulkButtons.forEach((button) => { button.disabled = on; });
    keys.forEach((key) => {
      const tr = rowOf(key);
      if (tr) tr.classList.toggle('row-saving', on);
    });
  }

  /** Server lines → the model and their rows, in place. Rows stay until the filters change. */
  function apply(result) {
    ((result && result.lines) || []).forEach((line) => {
      model.set(line.line_key, line);
      const tr = rowOf(line.line_key);
      if (tr) tr.outerHTML = rowHtml(line);
    });
    updateCount();
    syncSelection();
    const skipped = (result && result.skipped) || [];
    if (skipped.length) toast(t('pm_skipped', { count: skipped.length }), { error: true });
  }

  async function approve(keys) {
    if (busy) return;
    if (!keys.length) {
      toast(t('coord_select_first'), { error: true });
      return;
    }
    setBusy(keys, true);
    try {
      const result = await api.call('approve_lines_pm', { keys });
      if (!isCurrent()) return;
      const n = ((result && result.lines) || []).length;
      if (n) toast(t(n === 1 ? 'pm_approved_one' : 'pm_approved_many', { count: n }));
      apply(result);
    } catch (err) {
      if (isCurrent()) toast(errorText(err), { error: true });
    } finally {
      setBusy(keys, false);
    }
  }

  async function returnLines(keys) {
    if (busy) return;
    if (!keys.length) {
      toast(t('coord_select_first'), { error: true });
      return;
    }
    const note = await promptDialog({
      title: t(keys.length === 1 ? 'pm_return_title_one' : 'pm_return_title_many', { count: keys.length }),
      body: t('pm_return_body'),
      label: t('pm_return_note_label'),
      placeholder: t('pm_return_placeholder'),
      confirmLabel: t('pm_return_confirm'),
    });
    if (note === null || !isCurrent()) return;
    setBusy(keys, true);
    try {
      const result = await api.call('return_lines', { keys, note });
      if (!isCurrent()) return;
      const n = ((result && result.lines) || []).length;
      if (n) toast(t(n === 1 ? 'pm_returned_one' : 'pm_returned_many', { count: n }));
      apply(result);
    } catch (err) {
      if (isCurrent()) toast(errorText(err), { error: true });
    } finally {
      setBusy(keys, false);
    }
  }

  $('#pmFilters', host).addEventListener('change', (e) => {
    const name = e.target.dataset.filter;
    if (!name) return;
    filters[name] = e.target.value;
    draw();
  });
  $('#pmRefresh', host).addEventListener('click', () => renderApprovals({ host, isCurrent }));
  $('#pmApproveSel', host).addEventListener('click', () => approve(selectedKeys(grid)));
  $('#pmReturnSel', host).addEventListener('click', () => returnLines(selectedKeys(grid)));
  grid.addEventListener('click', (e) => {
    const button = e.target.closest('.pm-approve1, .pm-return1');
    if (!button) return;
    const key = button.closest('tr').dataset.key;
    if (button.classList.contains('pm-approve1')) approve([key]);
    else returnLines([key]);
  });

  draw();
}

/* ---------- Markup ---------- */

function tableHtml(rows) {
  return `
    <div class="card">
      <div class="grid-wrap">
        <table class="pm-grid">
          <thead><tr>
            <th class="col-check"></th>
            ${COLUMNS.map((key) => `<th>${esc(t(key))}</th>`).join('')}
            <th></th>
          </tr></thead>
          <tbody>${rows.map(rowHtml).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

function rowHtml(line) {
  const awaiting = line.status === 'coord_approved';
  const returnable = LISTED.includes(line.status);
  const rowClass = line.status === 'pm_approved' ? 'row-approved' : line.status === 'returned' ? 'row-locked' : '';
  const actions = [
    awaiting ? `<button type="button" class="btn btn-ghost btn-sm pm-approve1">${esc(t('pm_approve'))}</button>` : '',
    returnable ? `<button type="button" class="btn btn-ghost btn-sm pm-return1">${esc(t('pm_return'))}</button>` : '',
  ].join('');
  return `
    <tr class="${rowClass}" data-key="${esc(line.line_key)}">
      <td class="col-check"><input type="checkbox" class="rowcb" aria-label="${esc(t('grid_select_line', { site: line.site_id }))}"${awaiting ? '' : ' disabled'}></td>
      <td><span class="num">${esc(line.date)}</span></td>
      <td dir="auto">${esc(line.coordinator)}</td>
      <td><span class="site num">${esc(line.site_id)}</span> ${lineWarnFlag(line.warn)}</td>
      <td><span class="num">${esc(line.job_code || EMPTY)}</span></td>
      <td dir="auto">${esc(line.driver)}</td>
      <td><span class="num">${esc(formatMoney(line.split_cost))}</span></td>
      <td>${periodBadge(line.period) || MISSING}</td>
      <td>${contractorBadge(line.contractor) || MISSING}</td>
      <td>${statusHtml(line)}</td>
      <td class="row-actions">${actions}</td>
    </tr>`;
}

function statusHtml(line) {
  const note = (text) => `<div class="return-note" dir="auto">${esc(text)}</div>`;
  if (line.status === 'pm_approved') return `<span class="badge b-approved">${esc(t('status_approved'))}</span>`;
  if (line.status === 'returned') return `<span class="badge b-warn">${esc(t('status_returned'))}</span>${line.return_note ? note(line.return_note) : ''}`;
  const by = line.approved_by_coord ? ` title="${esc(t('pm_coord_approved_by', { name: line.approved_by_coord }))}"` : '';
  return `<span class="badge b-pending"${by}>${esc(t('status_awaiting_pm'))}</span>${line.return_note ? note(t('pm_returned_before', { note: line.return_note })) : ''}`;
}

/** '2025-W41' → '2025-W41 (6–12 Oct)'. */
function weekLabel(week) {
  const range = weekRangeText(week);
  return range ? t('pm_week_option', { week, range }) : week;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
