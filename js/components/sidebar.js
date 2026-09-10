/**
 * sidebar.js — brand, auto-detected coordinators (rule 31), PM pages, Trips by day,
 * and the lock-badged Admin. Links are real hash hrefs, so a coordinator's page URL
 * can be copied and handed to them.
 */

import { t } from '../i18n/i18n.js';
import { esc } from '../utils/dom.js';
import { paths } from '../router.js';
import { icon } from './icons.js';
import { renderBrandMark } from './brandMark.js';

export function renderSidebar(el, { coordinators }) {
  const coordinatorLinks = coordinators.length
    ? coordinators.map(coordinatorLink).join('')
    : `<div class="nav-empty">${esc(t('nav_no_coordinators'))}</div>`;

  el.innerHTML = `
    ${renderBrandMark()}
    <nav aria-label="${esc(t('nav_label'))}">
      <div class="nav-sec">
        <div class="nav-lbl">${esc(t('nav_coordinators'))} <span class="hint">${esc(t('nav_auto_detected'))}</span></div>
        ${coordinatorLinks}
      </div>
      <div class="nav-sec">
        <div class="nav-lbl">${esc(t('nav_project_manager'))}</div>
        ${navLink(paths.approvals, icon('check'), t('nav_approvals'))}
        ${navLink(paths.dashboard, icon('chart'), t('nav_dashboard'))}
        ${navLink(paths.export, icon('download'), t('nav_export'))}
      </div>
      <div class="nav-sec">
        <div class="nav-lbl">${esc(t('nav_tools'))}</div>
        ${navLink(paths.trips, icon('edit'), t('nav_trips_by_day'))}
      </div>
      <div class="nav-sec">
        <div class="nav-lbl">${esc(t('nav_restricted'))}</div>
        ${navLink(paths.admin, icon('cog'), t('nav_admin'), icon('lock', { className: 'lock' }))}
      </div>
    </nav>
    <div class="foot">${esc(t('sidebar_foot'))}</div>`;
}

/** Highlights the link whose path matches the current route. */
export function markActiveNav(el, path) {
  el.querySelectorAll('.nav-link').forEach((a) => {
    const active = a.dataset.path === path;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function coordinatorLink(name) {
  return navLink(paths.coordinator(name), `<span class="av">${esc(initialOf(name))}</span>`, name);
}

function navLink(path, lead, label, trail = '') {
  return `<a class="nav-link" href="#${esc(path)}" data-path="${esc(path)}">${lead}<span class="nav-text" dir="auto">${esc(label)}</span>${trail}</a>`;
}

function initialOf(name) {
  const first = Array.from(String(name).trim())[0];
  return first ? first.toUpperCase() : '?';
}
