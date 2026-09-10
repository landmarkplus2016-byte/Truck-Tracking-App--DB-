/**
 * explode.js — a trip → one line per site, the trip total split evenly
 * (CLAUDE.md §6.3). Mirror of the split in apps-script/Utils.gs: any change here
 * must be made identically there, so the client preview and the server agree exactly.
 */

import { toLatinDigits, toMoney } from './money.js';

/** How a site id is compared everywhere: Latin digits, trimmed, upper-case. */
export function normalizeSiteId(value) {
  return toLatinDigits(value === null || value === undefined ? '' : value).trim().toUpperCase();
}

/** A '/'-joined site list (or an array) → normalised site ids, blanks dropped. Order kept. */
export function parseSites(sites) {
  if (Array.isArray(sites)) sites = sites.join('/');
  return String(sites === null || sites === undefined ? '' : sites)
    .split('/')
    .map(normalizeSiteId)
    .filter(Boolean);
}

export function tripTotal(trip) {
  return toMoney(trip.labor) + toMoney(trip.park) + toMoney(trip.truck) + toMoney(trip.hotel);
}

/** round(total / n) for each part; the last part takes the remainder so the parts re-sum exactly. */
export function divideEven(total, n) {
  if (!(n > 0)) return [];
  const base = Math.round(total / n);
  const parts = [];
  for (let i = 0; i < n - 1; i++) parts.push(base);
  parts.push(total - base * (n - 1));
  return parts;
}

/** trip → [{site_index, site_id, split_cost}], one per site. Money only; nothing else is split. */
export function explodeTrip(trip) {
  const sites = parseSites(trip.sites);
  const parts = divideEven(tripTotal(trip), sites.length);
  return sites.map((siteId, i) => ({ site_index: i, site_id: siteId, split_cost: parts[i] }));
}
