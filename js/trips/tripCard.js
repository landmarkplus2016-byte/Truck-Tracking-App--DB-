/**
 * tripCard.js — one trip on the Trips-by-day page (CLAUDE.md §6.4).
 *
 * The trip is where money and the site list live (rule 9). The card shows the four costs
 * with a live total and a live re-split preview, and the site list with add / remove.
 * "Save money change" sends the costs; adding or removing a site applies at once. Both go
 * through save_trip, which re-splits on the server and reverts the trip's approvals (rule 12).
 */

import { api } from '../api.js';
import { t, errorText } from '../i18n/i18n.js';
import { $, $$, esc } from '../utils/dom.js';
import { toMoney, formatMoney } from '../utils/money.js';
import { divideEven, normalizeSiteId } from '../utils/explode.js';
import { periodBadge, contractorBadge } from '../components/badge.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';

const COSTS = ['labor', 'park', 'truck', 'hotel'];
const EMPTY = '—';
const MAX_SITE_ID = 40;

/** Renders `trip` (a list_trips_by_day / save_trip trip) into el and keeps it in step. */
export function mountTripCard(el, initialTrip, { isCurrent }) {
  let trip = initialTrip;       // as the server has it
  let draft = costsOf(trip);    // the cost inputs, as typed
  let busy = false;

  const locked = () => trip.exported > 0;
  const moneyDirty = () => COSTS.some((key) => toMoney(draft[key]) !== toMoney(trip[key]));

  function render(errorMessage = '') {
    el.innerHTML = cardHtml(trip, draft, { locked: locked(), busy });
    const error = $('.trip-error', el);
    error.textContent = errorMessage;
    error.classList.toggle('hidden', !errorMessage);
    refresh();
  }

  /** Live total + re-split preview from the typed costs. Never re-renders, so the caret stays. */
  function refresh() {
    let valid = true;
    $$('input[data-cost]', el).forEach((input) => {
      const bad = input.validity.badInput || (input.value !== '' && Number(input.value) < 0);
      input.classList.toggle('invalid', bad);
      input.setAttribute('aria-invalid', String(bad));
      if (bad) valid = false;
      draft[input.dataset.cost] = input.value;
    });
    const total = COSTS.reduce((sum, key) => sum + toMoney(draft[key]), 0);
    const dirty = moneyDirty();
    const parts = divideEven(total, trip.sites.length);
    $('.trip-total', el).textContent = formatMoney(total);
    $$('[data-split]', el).forEach((cell) => {
      cell.textContent = formatMoney(parts[Number(cell.dataset.split)]);
      cell.classList.toggle('dirty', dirty);
    });
    $('.save-note', el).classList.toggle('hidden', !dirty);
    const save = $('.save-money', el);
    if (save) save.disabled = !dirty || !valid || busy || locked();
  }

  /** One save_trip call. keepDraft leaves typed-but-unsaved money in the inputs. */
  async function apply({ sites, costs, keepDraft, confirm, done }) {
    if (confirm && trip.approved > 0) {
      const yes = await confirmDialog({
        title: confirm.title,
        body: t('trip_revert_body', { count: trip.approved }),
        confirmLabel: confirm.label,
      });
      if (!yes || !isCurrent()) return;
    }
    busy = true;
    render();
    try {
      const result = await api.call('save_trip', { trip_id: trip.trip_id, ...costs, sites });
      trip = result.trip;
      if (!keepDraft) draft = costsOf(trip);
      busy = false;
      if (!isCurrent()) return;
      render();
      done(result);
    } catch (err) {
      busy = false;
      if (isCurrent()) render(errorText(err));
    }
  }

  const reverted = (result) => (result.reverted ? t('trip_reverted_suffix', { count: result.reverted }) : '');

  function saveMoney() {
    const costs = {};
    COSTS.forEach((key) => { costs[key] = toMoney(draft[key]); });
    apply({
      sites: trip.sites,
      costs,
      keepDraft: false,
      done: (result) => toast(result.unchanged
        ? t('trip_unchanged')
        : t('trip_saved', { trip: trip.trip_id, count: trip.sites.length }) + reverted(result)),
    });
  }

  function removeSite(index) {
    const site = trip.sites[index];
    if (site === undefined || trip.sites.length <= 1) return;
    apply({
      sites: trip.sites.filter((_, i) => i !== index),
      costs: costsOf(trip),
      keepDraft: true,
      confirm: { title: t('trip_remove_title', { site }), label: t('trip_remove_confirm') },
      done: (result) => toast(t('trip_site_removed', { site, count: trip.sites.length }) + reverted(result)),
    });
  }

  function addSite() {
    const input = $('.add-site-input', el);
    const raw = input.value;
    const site = normalizeSiteId(raw);
    let problem = '';
    if (!site) problem = t('trip_site_required');
    else if (raw.includes('/')) problem = t('trip_site_slash');
    else if (trip.sites.includes(site)) problem = t('trip_site_duplicate', { site });
    if (problem) {
      const error = $('.trip-error', el);
      error.textContent = problem;
      error.classList.remove('hidden');
      input.focus();
      return;
    }
    apply({
      sites: [...trip.sites, site],
      costs: costsOf(trip),
      keepDraft: true,
      confirm: { title: t('trip_add_title', { site }), label: t('trip_add_confirm') },
      done: (result) => toast(t('trip_site_added', { site, count: trip.sites.length }) + reverted(result)),
    });
  }

  el.addEventListener('input', (e) => {
    if (e.target.matches('input[data-cost]')) refresh();
  });
  el.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove]');
    if (remove) removeSite(Number(remove.dataset.remove));
    else if (e.target.closest('.add-site')) addSite();
    else if (e.target.closest('.save-money')) saveMoney();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.add-site-input')) {
      e.preventDefault();
      addSite();
    }
  });

  render();
}

/* ---------- Markup ---------- */

function cardHtml(trip, draft, { locked, busy }) {
  const n = trip.sites.length;
  const off = locked || busy ? ' disabled' : '';
  const lineAt = new Map((trip.lines || []).map((line) => [Number(line.site_index), line]));

  const badges = [
    `<span class="badge b-pending">${esc(t(n === 1 ? 'trip_sites_one' : 'trip_sites_many', { count: n }))}</span>`,
    trip.approved ? `<span class="badge b-approved">${esc(t('trip_approved_count', { count: trip.approved }))}</span>` : '',
    locked ? `<span class="badge b-warn">${esc(t('trip_locked'))}</span>` : '',
  ].join('');

  const costField = (key) => {
    const id = `cost-${trip.trip_id}-${key}`;
    return `
      <div class="f">
        <label for="${esc(id)}">${esc(t('trip_cost_' + key))}</label>
        <input type="number" id="${esc(id)}" data-cost="${key}" min="0" step="any" inputmode="decimal" value="${esc(draft[key])}"${off}>
      </div>`;
  };

  const rows = trip.sites.map((site, i) => {
    const line = lineAt.get(i) || {};
    const remove = locked ? '' : `
      <button type="button" class="rm-site" data-remove="${i}" title="${esc(t('trip_remove_site', { site }))}"
              aria-label="${esc(t('trip_remove_site', { site }))}"${n <= 1 || busy ? ' disabled' : ''}>×</button>`;
    return `
      <tr>
        <td><span class="site num">${esc(site)}</span></td>
        <td><span class="num">${esc(line.job_code || EMPTY)}</span></td>
        <td>${contractorBadge(line.contractor) || EMPTY}</td>
        <td>${periodBadge(line.period) || EMPTY}</td>
        <td><span class="num split-cost" data-split="${i}">${esc(formatMoney(line.split_cost))}</span></td>
        <td class="rm-cell">${remove}</td>
      </tr>`;
  }).join('');

  const actions = locked
    ? `<div class="note">${esc(t('trip_locked_note'))}</div>`
    : `
      <div class="site-actions">
        <input type="text" class="add-site-input" maxlength="${MAX_SITE_ID}" spellcheck="false" autocomplete="off"
               placeholder="${esc(t('trip_new_site_placeholder'))}" aria-label="${esc(t('trip_new_site_placeholder'))}"${off}>
        <button type="button" class="btn btn-ghost btn-sm add-site"${off}>${esc(t('trip_add_site'))}</button>
        <span class="hint">${esc(t('trip_sites_hint'))}</span>
        <div class="spacer"></div>
        <button type="button" class="btn btn-primary btn-sm save-money" disabled>${esc(t('trip_save_money'))}</button>
      </div>`;

  return `
    <div class="th">
      <span class="id">${esc(trip.trip_id)}</span>
      <div class="meta">
        <span dir="auto">${esc(trip.coordinator)}</span><span>·</span>
        <span dir="auto">${esc(trip.route)}</span><span>·</span>
        <span dir="auto">${esc(trip.driver)}</span>
      </div>
      <div class="spacer"></div>
      ${badges}
    </div>
    <div class="comp${busy ? ' is-busy' : ''}">
      ${COSTS.map(costField).join('')}
      <div class="tot">
        <div class="k">${esc(t('trip_total'))}</div>
        <div class="v num trip-total">${esc(formatMoney(trip.total))}</div>
      </div>
    </div>
    <div class="save-note hidden">${esc(t(n === 1 ? 'trip_money_note_one' : 'trip_money_note', { count: n }))}</div>
    <div class="sites${busy ? ' is-busy' : ''}">
      <table>
        <thead><tr>
          <th>${esc(t('trip_col_site'))}</th>
          <th>${esc(t('grid_col_job_code'))}</th>
          <th>${esc(t('grid_col_contractor'))}</th>
          <th>${esc(t('grid_col_period'))}</th>
          <th>${esc(t('trip_col_split'))}</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${actions}
      <div class="form-error below hidden trip-error" role="alert"></div>
    </div>`;
}

function costsOf(trip) {
  const costs = {};
  COSTS.forEach((key) => { costs[key] = toMoney(trip[key]); });
  return costs;
}
