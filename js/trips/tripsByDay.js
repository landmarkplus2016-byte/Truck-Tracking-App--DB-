/**
 * tripsByDay.js — Trips by day (#/trips): pick a day, see that day's trips as cards.
 * Money and the site list are fixed here and only here (rule 11); each card saves through
 * save_trip. Opens on the latest day that has trips; ‹ › step to the nearest days with trips.
 */

import { api } from '../api.js';
import { t, errorText } from '../i18n/i18n.js';
import { $, esc } from '../utils/dom.js';
import { icon } from '../components/icons.js';
import { mountTripCard } from './tripCard.js';

let lastDay = ''; // the day picked, kept while the tab is open

export function renderTripsByDay({ host, isCurrent }) {
  host.innerHTML = `
    <div class="filters">
      <div class="field">
        <label for="dayPick">${esc(t('trips_day'))}</label>
        <div class="day-nav">
          <button type="button" class="btn btn-ghost btn-sm" id="dayPrev" title="${esc(t('trips_prev_day'))}" aria-label="${esc(t('trips_prev_day'))}" disabled>‹</button>
          <input type="date" id="dayPick" value="${esc(lastDay)}">
          <button type="button" class="btn btn-ghost btn-sm" id="dayNext" title="${esc(t('trips_next_day'))}" aria-label="${esc(t('trips_next_day'))}" disabled>›</button>
        </div>
      </div>
      <div class="field"><label>&nbsp;</label><span class="day-count" id="dayCount"></span></div>
    </div>
    <div class="note note-lead">${esc(t('trips_note'))}</div>
    <div id="tripCards"></div>`;

  const dayPick = $('#dayPick', host);
  const prev = $('#dayPrev', host);
  const next = $('#dayNext', host);
  const count = $('#dayCount', host);
  const cards = $('#tripCards', host);
  let seq = 0;
  let prevDate = '';
  let nextDate = '';

  async function load(date) {
    const mine = ++seq;
    const current = () => isCurrent() && mine === seq;
    prev.disabled = true;
    next.disabled = true;
    count.textContent = '';
    cards.innerHTML = `<div class="loading"><div class="spinner"></div><div>${esc(t('trips_loading'))}</div></div>`;
    try {
      const data = await api.call('list_trips_by_day', { date });
      if (!current()) return;
      lastDay = data.date || '';
      dayPick.value = lastDay;
      prevDate = data.prev_date || '';
      nextDate = data.next_date || '';
      prev.disabled = !prevDate;
      next.disabled = !nextDate;

      const trips = Array.isArray(data.trips) ? data.trips : [];
      count.textContent = t(trips.length === 1 ? 'trips_count_one' : 'trips_count_many', { count: trips.length });
      if (!trips.length) {
        cards.innerHTML = `<div class="card"><div class="empty">${icon('edit')}<div>${esc(t(data.date ? 'trips_empty_day' : 'trips_empty_all'))}</div></div></div>`;
        return;
      }
      cards.innerHTML = trips.map((trip) => `<div class="trip-card" data-trip="${esc(trip.trip_id)}"></div>`).join('');
      trips.forEach((trip, i) => mountTripCard(cards.children[i], trip, { isCurrent: current }));
    } catch (err) {
      if (!current()) return;
      cards.innerHTML = `
        <div class="card"><div class="card-body">
          <div class="form-error" role="alert">${esc(errorText(err))}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="tripsRetry">${esc(t('action_retry'))}</button>
        </div></div>`;
      $('#tripsRetry', cards).addEventListener('click', () => load(date));
    }
  }

  dayPick.addEventListener('change', () => {
    if (dayPick.value) load(dayPick.value);
  });
  prev.addEventListener('click', () => { if (prevDate) load(prevDate); });
  next.addEventListener('click', () => { if (nextDate) load(nextDate); });

  load(lastDay);
}
