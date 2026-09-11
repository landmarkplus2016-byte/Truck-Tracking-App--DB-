/**
 * i18n.js — t(key, vars). English only for now; ar.js is stubbed and registered,
 * so Arabic is a matter of filling it in and switching `lang` (CLAUDE.md §9.1).
 */

import en from './en.js';
import ar from './ar.js';

const DICTIONARIES = { en, ar };
let lang = 'en';
const warned = new Set();

export function t(key, vars) {
  const dict = DICTIONARIES[lang] || en;
  let text = dict[key] !== undefined ? dict[key] : en[key];
  if (text === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn('[i18n] missing key:', key);
    }
    return key;
  }
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
  }
  return text;
}

export function hasKey(key) {
  return (DICTIONARIES[lang] || en)[key] !== undefined || en[key] !== undefined;
}

/** A readable message for an ApiError (or any error), via error_<code> keys. */
export function errorText(err) {
  // Only our snake_case codes; browser errors carry numeric DOMException codes.
  const code = err && typeof err.code === 'string' ? err.code : 'unknown';
  const key = 'error_' + code;
  return hasKey(key) ? t(key, { detail: (err && err.detail) || '' }) : t('error_generic', { code });
}
