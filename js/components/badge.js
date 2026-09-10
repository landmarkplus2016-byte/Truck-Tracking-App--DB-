/**
 * badge.js — the small coloured labels: period (Old = amber, New = blue), contractor
 * (In-House vs external) and the amber warning flag. Status badges arrive with the
 * coordinator grid.
 */

import { t } from '../i18n/i18n.js';
import { esc } from '../utils/dom.js';
import { normalizePeriod } from '../utils/resolve.js';

// Built in: In-House exports as two files (Old, New); every other contractor as one.
export const IN_HOUSE = 'In-House';

export function isInHouse(name) {
  return String(name === null || name === undefined ? '' : name).trim().toLowerCase() === IN_HOUSE.toLowerCase();
}

/** 'Old' / 'new' → the period badge; '' for anything that isn't a period. */
export function periodBadge(value) {
  const period = normalizePeriod(value);
  return period ? `<span class="badge b-${period}">${esc(t('period_' + period))}</span>` : '';
}

export function contractorBadge(name) {
  const label = String(name === null || name === undefined ? '' : name).trim();
  if (!label) return '';
  return `<span class="badge ${isInHouse(label) ? 'b-inhouse' : 'b-contractor'}" dir="auto">${esc(label)}</span>`;
}

export function warnFlag(text, title = '') {
  const tip = title ? ` title="${esc(title)}"` : '';
  return `<span class="flag"${tip}>⚠ <span dir="auto">${esc(text)}</span></span>`;
}
