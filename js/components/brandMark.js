/**
 * brandMark.js — the truck mark + app name block at the top of the sidebar.
 */

import { t } from '../i18n/i18n.js';
import { esc } from '../utils/dom.js';
import { icon } from './icons.js';

export function renderBrandMark() {
  return `
    <div class="brand">
      <div class="mark">${icon('truck')}</div>
      <div><h1>${esc(t('app_name'))}</h1><span>${esc(t('brand_sub'))}</span></div>
    </div>`;
}
