/**
 * money.js — number parsing and display. toLatinDigits and toMoney mirror
 * toLatinDigits_ / toMoney_ in apps-script/Utils.gs exactly.
 */

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → 0-9, so typed numbers parse. */
export function toLatinDigits(value) {
  return String(value)
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0));
}

/** A typed money value → a number. Blank or unreadable → 0. */
export function toMoney(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  const s = toLatinDigits(value === null || value === undefined ? '' : value)
    .replace(/٫/g, '.')        // Arabic decimal separator
    .replace(/[^\d.\-]/g, '');      // drop thousands separators, spaces, currency text
  const n = Number(s);
  return s && isFinite(n) ? n : 0;
}

/** 1250 → "1,250" (whole EGP, as the prototype shows money). */
export function formatMoney(value) {
  return Math.round(toMoney(value)).toLocaleString('en-US');
}
