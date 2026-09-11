/**
 * dashboard.js — PM › Dashboard (#/pm/dashboard): total spend, the four per-item cards, and
 * totals by contractor and by coordinator (CLAUDE.md §8, rule 24).
 *
 * The slices — week or date range, coordinator, driver — are trip-level, so they narrow
 * everything on the page. Contractor and Old/New live on the line (one trip can straddle
 * In-House and a contractor), so they only ever cut the total: the by-contractor bars.
 * There is deliberately no contractor or period filter, and the boundary is stated on the
 * page. The server aggregates (dashboard_query); this page only draws.
 */

import { api } from '../api.js';
import { t, errorText } from '../i18n/i18n.js';
import { $, esc } from '../utils/dom.js';
import { isoWeek, isoWeekBounds, parseTypedDate, weekRangeText } from '../utils/dates.js';
import { formatMoney } from '../utils/money.js';
import { isInHouse } from '../components/badge.js';
import { icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { state } from '../state.js';

// [component key, label key], in the prototype's card order.
const COMPONENTS = [['labor', 'trip_cost_labor'], ['truck', 'trip_cost_truck'], ['hotel', 'trip_cost_hotel'], ['park', 'trip_cost_park']];
const SERIES_COLORS = 5; // --series-1 … --series-5 in tokens.css
const DEFAULT_FILTERS = { mode: 'week', week: '', from: '', to: '', coordinator: '', driver: '' };

// The PM's slices, kept while the tab is open.
const filters = { ...DEFAULT_FILTERS };

export function renderDashboard({ host, isCurrent }) {
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>${esc(t('dash_loading'))}</div></div>`;
  query()
    .then((data) => {
      if (isCurrent()) mount(host, data, isCurrent);
    })
    .catch((err) => {
      if (!isCurrent()) return;
      host.innerHTML = `
        <div class="card"><div class="card-body">
          <div class="form-error" role="alert">${esc(errorText(err))}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="dashRetry">${esc(t('action_retry'))}</button>
        </div></div>`;
      $('#dashRetry', host).addEventListener('click', () => {
        Object.assign(filters, DEFAULT_FILTERS); // a remembered scope may be what failed
        renderDashboard({ host, isCurrent });
      });
    });
}

function query() {
  return api.call('dashboard_query', { scope: { ...filters } });
}

function mount(host, first, isCurrent) {
  host.innerHTML = `
    <div class="filters" id="dashFilters">
      <div class="field">
        <label for="dashMode">${esc(t('dash_filter_range'))}</label>
        <select id="dashMode" data-filter="mode">
          <option value="week">${esc(t('dash_range_week'))}</option>
          <option value="range">${esc(t('dash_range_dates'))}</option>
        </select>
      </div>
      <div class="field" data-mode="week">
        <label for="dashWeek">${esc(t('pm_filter_week'))}</label>
        <select id="dashWeek" data-filter="week"></select>
      </div>
      <div class="field" data-mode="range">
        <label for="dashFrom">${esc(t('dash_filter_from'))}</label>
        <input type="date" id="dashFrom" data-filter="from">
      </div>
      <div class="field" data-mode="range">
        <label for="dashTo">${esc(t('dash_filter_to'))}</label>
        <input type="date" id="dashTo" data-filter="to">
      </div>
      <div class="field">
        <label for="dashCoordinator">${esc(t('pm_filter_coordinator'))}</label>
        <select id="dashCoordinator" data-filter="coordinator" dir="auto"></select>
      </div>
      <div class="field">
        <label for="dashDriver">${esc(t('dash_filter_driver'))}</label>
        <select id="dashDriver" data-filter="driver" dir="auto"></select>
      </div>
      <div class="spacer"></div>
      <span class="hint dash-counts" id="dashCounts"></span>
      <button type="button" class="btn btn-ghost btn-sm push-end" id="dashRefresh">${esc(t('pm_refresh'))}</button>
    </div>
    <div class="dash-body" id="dashBody"></div>`;

  const form = $('#dashFilters', host);
  const body = $('#dashBody', host);
  let last = first;
  let seq = 0;

  function showMode() {
    form.querySelectorAll('[data-mode]').forEach((field) => { field.hidden = field.dataset.mode !== filters.mode; });
  }

  /** The controls ← filters and the options the server sent. A focused date input is left alone. */
  function syncControls(data) {
    const options = data.options || {};
    const weeks = options.weeks || [];
    $('#dashMode', form).value = filters.mode;
    setOptions($('#dashWeek', form),
      (filters.week && !weeks.includes(filters.week) ? [filters.week, ...weeks] : weeks).map((w) => [w, weekLabel(w)]),
      filters.week);
    setOptions($('#dashCoordinator', form),
      [['', t('pm_all')], ...(options.coordinators || []).map((c) => [c, c])], filters.coordinator);
    setOptions($('#dashDriver', form),
      [['', t('pm_all')], ...(options.drivers || []).map((d) => [d, d])], filters.driver);
    ['from', 'to'].forEach((name) => {
      const input = $(name === 'from' ? '#dashFrom' : '#dashTo', form);
      if (document.activeElement !== input) input.value = filters[name];
    });
    $('#dashCounts', form).textContent = t('dash_counts', { trips: data.trip_count || 0, lines: data.line_count || 0 });
    showMode();
  }

  function draw(data) {
    last = data;
    Object.assign(filters, data.scope);
    syncControls(data);
    body.classList.remove('is-busy');
    body.innerHTML = bodyHtml(data);
  }

  function load() {
    const mine = ++seq;
    body.classList.add('is-busy');
    query()
      .then((data) => {
        if (isCurrent() && mine === seq) draw(data);
      })
      .catch((err) => {
        if (!isCurrent() || mine !== seq) return;
        Object.assign(filters, last.scope); // put the controls back on what is shown
        syncControls(last);
        body.classList.remove('is-busy');
        toast(errorText(err), { error: true });
      });
  }

  form.addEventListener('change', (e) => {
    const name = e.target.dataset.filter;
    if (!name) return;
    const value = e.target.value;
    if (name === 'mode') {
      filters.mode = value;
      // Carry the period across: a week opens as its Monday–Sunday range, a range as its first week.
      if (value === 'range') {
        const bounds = isoWeekBounds(filters.week);
        if (bounds) Object.assign(filters, { from: bounds.start, to: bounds.end });
      } else if (!filters.week) {
        filters.week = isoWeek(filters.from);
      }
      syncControls(last);
      if (value === 'range' && !(filters.from && filters.to)) return;
    } else if (name === 'from' || name === 'to') {
      filters[name] = parseTypedDate(value);
      if (!filters.from || !filters.to) return; // wait for both dates
      // Moving one end past the other drags the other along, so the date just typed stays.
      if (filters.from > filters.to) filters[name === 'from' ? 'to' : 'from'] = filters[name];
    } else {
      filters[name] = value;
    }
    load();
  });
  $('#dashRefresh', host).addEventListener('click', load);

  draw(first);
}

/* ---------- Markup ---------- */

function bodyHtml(data) {
  if (!data.trip_count) {
    const hasTrips = ((data.options && data.options.weeks) || []).length > 0;
    return `<div class="card"><div class="empty">${icon('chart')}<div>${esc(t(hasTrips ? 'dash_empty' : 'trips_empty_all'))}</div></div></div>`;
  }
  const components = data.components || {};
  const mismatch = Math.abs((data.total || 0) - (data.trip_total || 0)) >= 0.01;
  const contractorOrder = seriesOrder(data.by_contractor || []);
  const byContractor = splitRows(data.by_contractor || [], {
    label: (row) => row.name || t('dash_unclassified'),
    color: (row) => contractorColor(row.name, contractorOrder),
    title: (row) => t('dash_row_contractor', { lines: row.lines }),
  });
  const byCoordinator = splitRows(data.by_coordinator || [], {
    label: (row) => row.name,
    color: () => 'var(--primary)',
    title: (row) => t('dash_row_coordinator', { trips: row.trips, lines: row.lines }),
  });
  const noLines = `<div class="hint">${esc(t('dash_no_lines'))}</div>`;

  return `
    <div class="stats">
      ${statHtml('total', t('dash_total_spend'), data.total)}
      ${COMPONENTS.map(([key, label]) => statHtml(key, t(label), components[key])).join('')}
    </div>
    ${mismatch ? `<div class="warn-box dash-mismatch" role="status">${esc(t('dash_mismatch', { lines: formatMoney(data.total), trips: formatMoney(data.trip_total) }))}</div>` : ''}
    <div class="two">
      <div class="card">
        <div class="card-head">
          <h3>${esc(t('dash_by_contractor'))}</h3>
          <div class="spacer"></div>
          <span class="badge b-pending">${esc(t('dash_total_only'))}</span>
        </div>
        <div class="card-body">
          ${byContractor || noLines}
          <div class="note">${esc(t('dash_boundary_note'))}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h3>${esc(t('dash_by_coordinator'))}</h3></div>
        <div class="card-body">${byCoordinator || noLines}</div>
      </div>
    </div>`;
}

function statHtml(kind, label, amount) {
  return `
    <div class="stat stat-${kind}">
      <div class="accent"></div>
      <div class="k">${esc(label)}</div>
      <div class="v"><span class="num">${esc(formatMoney(amount))}</span><small>${esc(t('dash_currency'))}</small></div>
    </div>`;
}

/** Breakdown rows → bars scaled to the biggest total. fns: { label, color, title }. */
function splitRows(rows, fns) {
  const max = rows.reduce((m, row) => Math.max(m, row.total), 0);
  return rows.map((row) => {
    const pct = max > 0 ? Math.round((row.total / max) * 100) : 0;
    return `
      <div class="split-row" title="${esc(fns.title(row))}">
        <div class="name${row.name ? '' : ' unclassified'}" dir="auto">${esc(fns.label(row))}</div>
        <div class="track"><div class="fill" style="width:${pct}%;background:${fns.color(row)}"></div></div>
        <div class="amt num">${esc(formatMoney(row.total))}</div>
      </div>`;
  }).join('');
}

/**
 * External contractors in colour order: the Config list first, so a contractor keeps its
 * colour whatever the filters, then any name only the data has. Lower-cased.
 */
function seriesOrder(rows) {
  const configured = state.config && Array.isArray(state.config.contractors) ? state.config.contractors : [];
  const names = [...configured, ...rows.map((row) => row.name)]
    .map((name) => String(name || '').trim().toLowerCase())
    .filter((name) => name && !isInHouse(name));
  return Array.from(new Set(names));
}

function contractorColor(name, order) {
  if (!name) return 'var(--bar-empty)';
  if (isInHouse(name)) return 'var(--primary)';
  const index = Math.max(0, order.indexOf(name.toLowerCase()));
  return `var(--series-${(index % SERIES_COLORS) + 1})`;
}

function setOptions(select, pairs, value) {
  select.innerHTML = pairs
    .map(([v, label]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
}

/** '2025-W41' → '2025-W41 (6–12 Oct)'. */
function weekLabel(week) {
  const range = weekRangeText(week);
  return range ? t('pm_week_option', { week, range }) : week;
}
