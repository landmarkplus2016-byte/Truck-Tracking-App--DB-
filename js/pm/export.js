/**
 * export.js — PM › Export (#/pm/export): the finance files (CLAUDE.md §7, rules 20–23).
 *
 *   1. Select    a week or a date range, and any drivers to leave out (exact typed string, rule 22).
 *                Each change re-runs export_query — a preview that writes nothing.
 *   2. Generate  shows the file cards (In-House Old, In-House New, one per contractor) and a
 *                preview of each — still nothing written.
 *   3. Confirm   export_commit stamps exactly the previewed rows exported under the server lock;
 *                the files are then built here (exportTemplate.js) and downloaded.
 *
 * Changing the selection after Generate drops back to step 1, so what is confirmed is always
 * what was shown. Excluded drivers' rows stay pm_approved and come back in the next run.
 */

import { api } from '../api.js';
import { t, errorText } from '../i18n/i18n.js';
import { $, $$, esc } from '../utils/dom.js';
import { isoWeek, isoWeekBounds, parseTypedDate, weekRangeText } from '../utils/dates.js';
import { formatMoney } from '../utils/money.js';
import { periodBadge, contractorBadge } from '../components/badge.js';
import { icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { state } from '../state.js';
import { downloadExportFile, exportFileTitle, sitesLabel } from './exportTemplate.js';

const UNFILED_SHOWN = 8;
const PREVIEW_COLUMNS = ['grid_col_site_id', 'grid_col_job_code', 'grid_col_route', 'grid_col_period', 'grid_col_cost'];

// The PM's selection, kept while the tab is open.
const selection = { mode: '', week: '', from: '', to: '', excluded: new Set() };

export function renderExport({ host, isCurrent }) {
  if (!selection.mode) selection.mode = state.config && state.config.export_default === 'range' ? 'range' : 'week';
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>${esc(t('export_loading'))}</div></div>`;
  query()
    .then((data) => {
      if (isCurrent()) mount(host, data, isCurrent);
    })
    .catch((err) => {
      if (!isCurrent()) return;
      host.innerHTML = `
        <div class="card"><div class="card-body">
          <div class="form-error" role="alert">${esc(errorText(err))}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="exRetry">${esc(t('action_retry'))}</button>
        </div></div>`;
      $('#exRetry', host).addEventListener('click', () => {
        Object.assign(selection, { week: '', from: '', to: '' }); // a remembered scope may be what failed
        renderExport({ host, isCurrent });
      });
    });
}

/** The scope to ask for. A range with no dates yet asks for the week, and adopt() turns it into its range. */
function scopePayload() {
  if (selection.mode === 'range' && selection.from && selection.to) {
    return { mode: 'range', from: selection.from, to: selection.to };
  }
  return { mode: 'week', week: selection.week };
}

function query() {
  return api.call('export_query', { scope: scopePayload(), excluded_drivers: Array.from(selection.excluded) });
}

/** The server's scope → the selection. */
function adopt(scope) {
  if (scope.mode === 'range') {
    selection.from = scope.from;
    selection.to = scope.to;
    return;
  }
  selection.week = scope.week;
  if (selection.mode === 'range') {
    const bounds = isoWeekBounds(scope.week);
    if (bounds) Object.assign(selection, { from: bounds.start, to: bounds.end });
  }
}

function mount(host, first, isCurrent) {
  host.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>${esc(t('export_selection'))}</h3></div>
      <div class="card-body">
        <div class="filters" id="exFilters">
          <div class="field">
            <label for="exMode">${esc(t('dash_filter_range'))}</label>
            <select id="exMode" data-filter="mode">
              <option value="week">${esc(t('dash_range_week'))}</option>
              <option value="range">${esc(t('dash_range_dates'))}</option>
            </select>
          </div>
          <div class="field" data-mode="week">
            <label for="exWeek">${esc(t('pm_filter_week'))}</label>
            <select id="exWeek" data-filter="week"></select>
          </div>
          <div class="field" data-mode="range">
            <label for="exFrom">${esc(t('dash_filter_from'))}</label>
            <input type="date" id="exFrom" data-filter="from">
          </div>
          <div class="field" data-mode="range">
            <label for="exTo">${esc(t('dash_filter_to'))}</label>
            <input type="date" id="exTo" data-filter="to">
          </div>
        </div>
        <div class="field-label" id="exChipsLabel">${esc(t('export_exclude_label'))}</div>
        <div class="chips" id="exChips" role="group" aria-labelledby="exChipsLabel"></div>
        <div class="hint export-hint">${esc(t('export_exclude_hint'))}</div>
        <div class="actions">
          <button type="button" class="btn btn-primary" id="exGenerate">${esc(t('export_generate'))}</button>
          <button type="button" class="btn btn-primary hidden" id="exCommit">${icon('lock', { size: 14 })}${esc(t('export_commit'))}</button>
          <button type="button" class="btn btn-ghost hidden" id="exNew">${esc(t('export_new'))}</button>
          <span class="hint" id="exSummary"></span>
        </div>
      </div>
    </div>
    <div class="export-body stack" id="exBody"></div>`;

  const form = $('#exFilters', host);
  const chips = $('#exChips', host);
  const body = $('#exBody', host);
  const buttons = { generate: $('#exGenerate', host), commit: $('#exCommit', host), fresh: $('#exNew', host) };

  let data = first;          // the last export_query or export_commit result on screen
  let phase = 'select';      // select → generated → committed
  let previewIndex = -1;
  let busy = false;
  let seq = 0;
  let good = snapshot();     // the selection `data` was loaded with

  function snapshot() {
    return { mode: selection.mode, week: selection.week, from: selection.from, to: selection.to, excluded: new Set(selection.excluded) };
  }

  function draw() {
    const locked = busy || phase === 'committed';
    const weeks = (data.options && data.options.weeks) || [];
    const pairs = weeks.map((w) => [w.week, w.ready ? t('export_week_ready', { label: weekLabel(w.week), count: w.ready }) : weekLabel(w.week)]);
    if (selection.week && !weeks.some((w) => w.week === selection.week)) pairs.unshift([selection.week, weekLabel(selection.week)]);

    $('#exMode', form).value = selection.mode;
    setOptions($('#exWeek', form), pairs, selection.week);
    [['#exFrom', 'from'], ['#exTo', 'to']].forEach(([id, key]) => {
      const input = $(id, form);
      if (document.activeElement !== input) input.value = selection[key];
    });
    $$('[data-mode]', form).forEach((field) => { field.hidden = field.dataset.mode !== selection.mode; });
    $$('select, input', form).forEach((control) => { control.disabled = locked; });

    chips.innerHTML = chipsHtml(data.drivers || [], locked);
    let summary = tn('export_summary', data.row_count || 0, { total: formatMoney(data.total) });
    if (data.excluded_count) summary += t('export_summary_excluded', { rows: data.excluded_count });
    $('#exSummary', host).textContent = summary;

    buttons.generate.classList.toggle('hidden', phase === 'committed');
    // Once generated, Confirm is the one primary action.
    buttons.generate.classList.toggle('btn-primary', phase !== 'generated');
    buttons.generate.classList.toggle('btn-ghost', phase === 'generated');
    buttons.generate.disabled = busy;
    buttons.commit.classList.toggle('hidden', phase !== 'generated');
    buttons.commit.disabled = busy;
    buttons.fresh.classList.toggle('hidden', phase !== 'committed');
    buttons.fresh.disabled = busy;

    body.classList.toggle('is-busy', busy);
    body.innerHTML = bodyHtml(data, phase, previewIndex);
  }

  function setBusy(on) {
    busy = on;
    draw();
  }

  function load({ generate = false } = {}) {
    const mine = ++seq;
    phase = 'select';
    setBusy(true);
    query()
      .then((result) => {
        if (!isCurrent() || mine !== seq) return;
        data = result;
        adopt(result.scope);
        good = snapshot();
        phase = generate && result.row_count ? 'generated' : 'select';
        previewIndex = firstWithRows(result.files);
        busy = false;
        draw();
        if (generate && !result.row_count) toast(t('export_nothing'), { error: true });
      })
      .catch((err) => {
        if (!isCurrent() || mine !== seq) return;
        Object.assign(selection, good, { excluded: new Set(good.excluded) }); // back to what is shown
        busy = false;
        draw();
        toast(errorText(err), { error: true });
      });
  }

  async function commit() {
    if (busy || phase !== 'generated') return;
    const keys = data.files.flatMap((file) => file.trips.flatMap((trip) => trip.rows.map((row) => row.line_key)));
    const ok = await confirmDialog({
      title: tn('export_confirm_title', keys.length),
      body: t('export_confirm_body', { files: data.files.filter((f) => f.row_count).length, total: formatMoney(data.total) }),
      confirmLabel: t('export_confirm_ok'),
    });
    if (!ok || !isCurrent() || phase !== 'generated') return;

    const mine = ++seq;
    setBusy(true);
    try {
      const result = await api.call('export_commit', {
        scope: scopeOf(data.scope),
        excluded_drivers: (data.drivers || []).filter((d) => d.excluded).map((d) => d.driver),
        keys,
      });
      if (!isCurrent() || mine !== seq) return;
      data = result;
      phase = 'committed';
      previewIndex = firstWithRows(result.files);
      busy = false;
      draw();
      downloadAll(result);
      if (result.skipped) toast(t('export_done_skipped', { count: result.skipped }), { error: true });
    } catch (err) {
      if (!isCurrent() || mine !== seq) return;
      busy = false;
      toast(errorText(err), { error: true });
      if (err.code === 'nothing_to_export') load();
      else draw();
    }
  }

  function downloadAll(result) {
    const files = result.files.filter((file) => file.row_count);
    try {
      files.forEach((file) => downloadExportFile(file, fileMeta(result)));
      toast(t('export_downloaded', { count: files.length }));
    } catch (err) {
      toast(t('export_download_failed', { error: errorText(err) }), { error: true });
    }
  }

  form.addEventListener('change', (e) => {
    const name = e.target.dataset.filter;
    if (!name || busy || phase === 'committed') return;
    const value = e.target.value;
    if (name === 'mode') {
      selection.mode = value;
      if (value === 'range') {
        const bounds = isoWeekBounds(selection.week);
        if (bounds) Object.assign(selection, { from: bounds.start, to: bounds.end });
      } else {
        selection.week = isoWeek(selection.from) || selection.week;
      }
    } else if (name === 'from' || name === 'to') {
      selection[name] = parseTypedDate(value);
      if (!selection.from || !selection.to) return; // wait for both dates
      // Moving one end past the other drags the other along, so the date just typed stays.
      if (selection.from > selection.to) selection[name === 'from' ? 'to' : 'from'] = selection[name];
    } else {
      selection[name] = value;
    }
    load();
  });

  chips.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-driver]');
    if (!button || busy || phase === 'committed') return;
    const driver = (data.drivers || [])[Number(button.dataset.driver)];
    if (!driver) return;
    if (selection.excluded.has(driver.driver)) selection.excluded.delete(driver.driver);
    else selection.excluded.add(driver.driver);
    load();
  });

  buttons.generate.addEventListener('click', () => {
    if (!busy) load({ generate: true });
  });
  buttons.commit.addEventListener('click', commit);
  buttons.fresh.addEventListener('click', () => {
    if (!busy) load();
  });

  body.addEventListener('click', (e) => {
    const preview = e.target.closest('button[data-preview]');
    if (preview) {
      previewIndex = Number(preview.dataset.preview);
      draw();
      return;
    }
    const download = e.target.closest('button[data-download]');
    if (download && phase === 'committed') {
      try {
        downloadExportFile(data.files[Number(download.dataset.download)], fileMeta(data));
      } catch (err) {
        toast(t('export_download_failed', { error: errorText(err) }), { error: true });
      }
    }
  });

  adopt(first.scope);
  good = snapshot();
  draw();
}

/* ---------- Markup ---------- */

function bodyHtml(data, phase, previewIndex) {
  const files = data.files || [];
  const unfiled = unfiledHtml(data.unfiled || []);
  if (phase === 'select') {
    return `<div class="note">${esc(t('export_intro'))}</div>${unfiled}`;
  }
  const lead = phase === 'committed'
    ? `<div class="export-done" role="status">${icon('check', { size: 20 })}<div>
         <h3>${esc(t('export_done_title', { batch: data.batch.export_batch_id }))}</h3>
         <p>${esc(tn('export_done_body', data.row_count))}</p>
       </div></div>`
    : `<div class="note">${esc(t('export_generated_note'))}</div>`;
  return `
    ${lead}
    <div class="files">${files.map((file, i) => fileCardHtml(file, i, phase, previewIndex)).join('')}</div>
    ${unfiled}
    ${previewHtml(files[previewIndex])}`;
}

function fileCardHtml(file, index, phase, previewIndex) {
  const empty = !file.row_count;
  const badge = file.in_house ? periodBadge(file.period) : contractorBadge(file.contractor);
  const meta = empty ? t('export_file_empty') : tn('export_file_meta', file.row_count, { total: formatMoney(file.total) });
  return `
    <div class="file${empty ? ' is-empty' : ''}${index === previewIndex ? ' active' : ''}">
      <div class="xl">
        <div class="ic">${esc(t('export_xls'))}</div>
        <div><div class="fname">${esc(file.name)}</div><div class="meta">${esc(meta)}</div></div>
      </div>
      <div>${badge}</div>
      <div class="file-actions">
        <button type="button" class="btn btn-ghost btn-sm" data-preview="${index}"${empty ? ' disabled' : ''}>${esc(t('export_preview'))}</button>
        ${phase === 'committed' && !empty
          ? `<button type="button" class="btn btn-primary btn-sm" data-download="${index}">${icon('download', { size: 14 })}${esc(t('export_download'))}</button>`
          : ''}
      </div>
    </div>`;
}

function previewHtml(file) {
  if (!file || !file.row_count) return '';
  const trips = file.trips.map((trip) => `
    <tr class="trip-head">
      <td colspan="4">
        <span class="num">${esc(trip.date)}</span> · <span dir="auto">${esc(trip.route)}</span> ·
        <span dir="auto">${esc(driverLabel(trip.driver))}</span> · <span class="num">${esc(trip.trip_id)}</span> · ${esc(sitesLabel(trip))}
      </td>
      <td class="num cost-cell">${esc(formatMoney(trip.total))}</td>
    </tr>
    ${trip.rows.map((row) => `
      <tr class="child">
        <td><span class="site num">${esc(row.site_id)}</span></td>
        <td><span class="num">${esc(row.job_code || '—')}</span></td>
        <td dir="auto">${esc(trip.route)}</td>
        <td>${periodBadge(row.period) || '—'}</td>
        <td class="num cost-cell">${esc(formatMoney(row.split_cost))}</td>
      </tr>`).join('')}`).join('');
  return `
    <div class="card export-preview">
      <div class="card-head">
        <h3 dir="auto">${esc(t('export_preview_title', { name: exportFileTitle(file) }))}</h3>
        <div class="spacer"></div>
        <span class="badge b-inhouse">${esc(t('export_layout_badge'))}</span>
      </div>
      <div class="grid-wrap">
        <table>
          <thead><tr>${PREVIEW_COLUMNS.map((key) => `<th>${esc(t(key))}</th>`).join('')}</tr></thead>
          <tbody>
            ${trips}
            <tr class="trip-head file-total">
              <td colspan="4">${esc(t('export_file_total'))}</td>
              <td class="num cost-cell">${esc(formatMoney(file.total))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`;
}

function chipsHtml(drivers, locked) {
  if (!drivers.length) return `<span class="hint">${esc(t('export_no_drivers'))}</span>`;
  return drivers.map((d, i) => {
    const label = driverLabel(d.driver);
    const action = t(d.excluded ? 'export_include_driver' : 'export_exclude_driver', { driver: label });
    return `
      <span class="chip${d.excluded ? ' excluded' : ''}" title="${esc(t('export_driver_meta', { rows: d.rows, total: formatMoney(d.total) }))}">
        <span dir="auto">${esc(label)}</span>
        <span class="num chip-count">${d.rows}</span>
        <button type="button" data-driver="${i}" aria-label="${esc(action)}" aria-pressed="${d.excluded}"${locked ? ' disabled' : ''}>${d.excluded ? '+' : '×'}</button>
      </span>`;
  }).join('');
}

function unfiledHtml(lines) {
  if (!lines.length) return '';
  const items = lines.slice(0, UNFILED_SHOWN).map((line) => `<li dir="auto">${esc(t('export_unfiled_item', {
    trip: line.trip_id, site: line.site_id, driver: driverLabel(line.driver), reason: t('export_reason_' + line.reason),
  }))}</li>`).join('');
  const more = lines.length > UNFILED_SHOWN ? `<li>${esc(t('export_unfiled_more', { count: lines.length - UNFILED_SHOWN }))}</li>` : '';
  return `
    <div class="warn-box" role="status">
      <b>${esc(t('export_unfiled_title', { count: lines.length }))}</b> ${esc(t('export_unfiled_body'))}
      <ul>${items}${more}</ul>
    </div>`;
}

/* ---------- Helpers ---------- */

function scopeOf(scope) {
  return scope.mode === 'range' ? { mode: 'range', from: scope.from, to: scope.to } : { mode: 'week', week: scope.week };
}

function fileMeta(result) {
  const scope = result.scope;
  return {
    scopeText: scope.mode === 'range' ? t('export_scope_range', { from: scope.from, to: scope.to }) : weekLabel(scope.week),
    batchId: result.batch.export_batch_id,
    exportedDate: parseTypedDate(new Date(result.batch.exported_at)),
  };
}

/** t(key) with {rows: count}, using the key's _one variant when count is 1. */
function tn(key, count, vars = {}) {
  return t(count === 1 ? key + '_one' : key, { ...vars, rows: count });
}

function firstWithRows(files) {
  return (files || []).findIndex((file) => file.row_count > 0);
}

function driverLabel(driver) {
  return String(driver || '').trim() ? driver : t('export_no_driver');
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
