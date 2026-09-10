/**
 * Utils.gs — shared helpers: errors, the script lock, dates, money, and the
 * per-site split (the server mirror of js/utils/explode.js).
 */

const LOCK_WAIT_MS = 30000;

function appError_(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function nowIso_() {
  return new Date().toISOString();
}

/* ---------- Script lock (re-entrant) ---------- */

let lockDepth_ = 0;

/**
 * Runs fn under the script lock. Nested calls in the same execution run straight
 * through, so a locked handler can call another locked helper without deadlocking
 * or releasing the outer lock early.
 */
function withScriptLock(fn, waitMs) {
  if (lockDepth_ > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs || LOCK_WAIT_MS)) {
    throw appError_('busy', 'Another save is in progress — try again in a moment');
  }
  lockDepth_++;
  try {
    return fn();
  } finally {
    lockDepth_--;
    lock.releaseLock();
  }
}

/* ---------- Dates ---------- */

const MONTHS_ = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * The ISO date (YYYY-MM-DD) a row is "about": its own date value, or the fallback
 * (e.g. the Form timestamp) when the date is blank or unreadable. '' if neither parses.
 * tz is the spreadsheet time zone, so a date cell's midnight stays on its own day.
 */
function entryDateOf(value, fallback, tz) {
  return toIsoDate_(value, tz) || toIsoDate_(fallback, tz) || '';
}

/**
 * Accepts a Date (what getValues returns for date cells), 'YYYY-MM-DD',
 * day-first 'D/M/YYYY' (also '-' or '.'), and 'DD-Mon-YYYY' as used in the master.
 */
function toIsoDate_(value, tz) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, tz || 'UTC', 'yyyy-MM-dd');
  }
  const s = toLatinDigits_(String(value)).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoFromParts_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return isoFromParts_(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2}|\d{4})$/);
  if (m && MONTHS_[m[2].toLowerCase()]) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return isoFromParts_(year, MONTHS_[m[2].toLowerCase()], +m[1]);
  }
  return '';
}

function isoFromParts_(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return y + '-' + pad2_(mo) + '-' + pad2_(d);
}

/** ISO-8601 week of an ISO date, as 'YYYY-Www'. */
function isoWeek_(isoDate) {
  const p = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  const dow = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dow); // Thursday of this week decides the year
  const yearStart = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((dt.getTime() - yearStart) / 86400000 + 1) / 7);
  return dt.getUTCFullYear() + '-W' + pad2_(week);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/* ---------- Text & money ---------- */

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → 0-9, so typed numbers parse. */
function toLatinDigits_(s) {
  return String(s)
    .replace(/[٠-٩]/g, function (c) { return String(c.charCodeAt(0) - 0x0660); })
    .replace(/[۰-۹]/g, function (c) { return String(c.charCodeAt(0) - 0x06F0); });
}

/** A Form money answer → a number. Blank or unreadable → 0. */
function toMoney_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  const s = toLatinDigits_(value === null || value === undefined ? '' : value)
    .replace(/٫/g, '.')        // Arabic decimal separator
    .replace(/[^\d.\-]/g, '');      // drop thousands separators, spaces, currency text
  const n = Number(s);
  return s && isFinite(n) ? n : 0;
}

/* ---------- The per-site split — mirror of js/utils/explode.js ---------- */
// Any change here must be made identically in explode.js (CLAUDE.md §6.3):
// the client preview and the server must agree to the pound.

/** How a site id is compared everywhere: Latin digits, trimmed, upper-case. */
function normalizeSiteId(value) {
  return toLatinDigits_(value === null || value === undefined ? '' : value).trim().toUpperCase();
}

/** A '/'-joined site list (or an array) → normalised site ids, blanks dropped. Order kept. */
function parseSites(sites) {
  if (Array.isArray(sites)) sites = sites.join('/');
  return String(sites === null || sites === undefined ? '' : sites)
    .split('/')
    .map(normalizeSiteId)
    .filter(Boolean);
}

function tripTotal(trip) {
  return toMoney_(trip.labor) + toMoney_(trip.park) + toMoney_(trip.truck) + toMoney_(trip.hotel);
}

/** round(total / n) for each part; the last part takes the remainder so the parts re-sum exactly. */
function divideEven(total, n) {
  if (!(n > 0)) return [];
  const base = Math.round(total / n);
  const parts = [];
  for (let i = 0; i < n - 1; i++) parts.push(base);
  parts.push(total - base * (n - 1));
  return parts;
}

/** trip → [{site_index, site_id, split_cost}], one per site. Money only; nothing else is split. */
function explodeTrip(trip) {
  const sites = parseSites(trip.sites);
  const parts = divideEven(tripTotal(trip), sites.length);
  return sites.map(function (siteId, i) {
    return { site_index: i, site_id: siteId, split_cost: parts[i] };
  });
}
