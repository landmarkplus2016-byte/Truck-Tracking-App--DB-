/**
 * dates.js — every date in the app is an ISO 'YYYY-MM-DD' string, so dates compare
 * as plain strings. Parsing mirrors toIsoDate_ / entryDateOf / isoWeek_ in
 * apps-script/Utils.gs.
 */

import { toLatinDigits } from './money.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * A typed or stored date → 'YYYY-MM-DD', or '' if it can't be read.
 * Accepts a Date, 'YYYY-MM-DD' (a trailing time is ignored), day-first 'D/M/YYYY'
 * (also '-' or '.'), and 'DD-Mon-YYYY' / 'DD-Mon-YY' as used in the master.
 */
export function parseTypedDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? '' : isoFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const s = toLatinDigits(String(value)).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoFromParts(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return isoFromParts(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return isoFromParts(year, MONTHS[m[2].toLowerCase()], +m[1]);
  }
  return '';
}

/** The date a row is "about": its own date, else the fallback (e.g. a timestamp). */
export function entryDateOf(value, fallback) {
  return parseTypedDate(value) || parseTypedDate(fallback) || '';
}

/** ISO-8601 week of a date, as 'YYYY-Www'. '' if the date can't be read. */
export function isoWeek(value) {
  const iso = parseTypedDate(value);
  if (!iso) return '';
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const dow = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dow); // Thursday of this week decides the year
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${pad2(week)}`;
}

/** 'YYYY-Www' → { start: Monday, end: Sunday } as ISO dates, or null if it isn't an ISO week. */
export function isoWeekBounds(week) {
  const m = /^(\d{4})-W(\d{2})$/.exec(String(week || ''));
  if (!m) return null;
  const jan4 = new Date(Date.UTC(Number(m[1]), 0, 4)); // 4 January is always in week 1
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (Number(m[2]) - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

/** Calendar year of a date, or 0 if it can't be read. */
export function yearOf(value) {
  const iso = parseTypedDate(value);
  return iso ? Number(iso.slice(0, 4)) : 0;
}

function isoFromParts(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}
