/**
 * adminGate.js — the Admin page: the password lock, then the Site master / Config tabs.
 *
 * The typed password is SHA-256-hashed in the browser and only the hash travels.
 * Unlock confirms it with check_admin_pw; the hash is then held in state for this
 * tab's lifetime — never stored, never committed (CLAUDE.md §4). The server checks it
 * again on every admin action, so a wrong or rotated hash simply locks the page again.
 */

import { api, ApiError } from '../api.js';
import { state } from '../state.js';
import { t, errorText } from '../i18n/i18n.js';
import { $, $$, esc } from '../utils/dom.js';
import { sha256Hex } from '../utils/hash.js';
import { icon } from '../components/icons.js';
import { renderMasterTab } from './master.js';
import { renderConfigTab } from './config.js';

const TABS = [
  { id: 'master', label: 'admin_tab_master', render: renderMasterTab },
  { id: 'config', label: 'admin_tab_config', render: renderConfigTab },
];
// Server answers that mean the held hash is no good.
const RELOCK_CODES = ['forbidden', 'admin_not_set'];

let activeTab = TABS[0].id;

export function renderAdmin({ host, isCurrent }) {
  if (state.adminPwHash) renderUnlocked(host, isCurrent);
  else renderLock(host, isCurrent);
}

/* ---------- Locked ---------- */

function renderLock(host, isCurrent, message = '') {
  host.innerHTML = `
    <div class="lock-wrap">
      <div class="ring">${icon('lock', { size: 24 })}</div>
      <h3>${esc(t('admin_lock_heading'))}</h3>
      <p>${esc(t('admin_lock_body'))}</p>
      <form id="adminUnlock" novalidate>
        <input type="password" id="adminPw" autocomplete="current-password"
               placeholder="${esc(t('admin_pw_placeholder'))}" aria-label="${esc(t('admin_pw_placeholder'))}">
        <div class="form-error${message ? '' : ' hidden'}" id="adminPwError" role="alert">${esc(message)}</div>
        <button type="submit" class="btn btn-primary btn-block" id="adminUnlockBtn">${esc(t('admin_unlock'))}</button>
      </form>
      <p class="lock-hint">${esc(t('admin_lock_hint'))}</p>
    </div>`;

  const input = $('#adminPw', host);
  const error = $('#adminPwError', host);
  const button = $('#adminUnlockBtn', host);
  const showError = (text) => {
    error.textContent = text;
    error.classList.remove('hidden');
  };
  input.focus();

  $('#adminUnlock', host).addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = input.value;
    if (!password) {
      showError(t('admin_pw_required'));
      input.focus();
      return;
    }
    button.disabled = true;
    try {
      const hash = await sha256Hex(password);
      await api.call('check_admin_pw', { admin_pw_hash: hash });
      state.adminPwHash = hash;
      if (isCurrent()) renderUnlocked(host, isCurrent);
    } catch (err) {
      if (!isCurrent()) return;
      button.disabled = false;
      showError(errorText(err));
      input.select();
    }
  });
}

/* ---------- Unlocked ---------- */

function renderUnlocked(host, isCurrent) {
  host.innerHTML = `
    <div class="admin-bar">
      <div class="tabs">
        ${TABS.map((tab) => `<button type="button" data-tab="${tab.id}">${esc(t(tab.label))}</button>`).join('')}
      </div>
      <div class="spacer"></div>
      <button type="button" class="btn btn-ghost btn-sm" id="adminLock">${icon('lock', { size: 14 })}${esc(t('admin_lock'))}</button>
    </div>
    <div id="adminTab"></div>`;

  const tabHost = $('#adminTab', host);
  let tabSeq = 0;

  const lock = (message) => {
    tabSeq++; // drops any answer still on its way to the tab being torn down
    state.adminPwHash = null;
    if (isCurrent()) renderLock(host, isCurrent, message);
  };

  const show = (id) => {
    const tab = TABS.find((x) => x.id === id) || TABS[0];
    activeTab = tab.id;
    const seq = ++tabSeq;
    $$('[data-tab]', host).forEach((b) => {
      const on = b.dataset.tab === tab.id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    tab.render(tabHost, {
      isCurrent: () => isCurrent() && seq === tabSeq,
      call: (action, payload) => adminCall(action, payload, () => lock(t('admin_relocked'))),
    });
  };

  $$('[data-tab]', host).forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  $('#adminLock', host).addEventListener('click', () => lock(''));
  show(activeTab);
}

/** api.call with the held hash added. A hash the server rejects is dropped and the page re-locks. */
async function adminCall(action, payload, relock) {
  if (!state.adminPwHash) {
    relock();
    throw new ApiError('forbidden');
  }
  try {
    return await api.call(action, { ...payload, admin_pw_hash: state.adminPwHash });
  } catch (err) {
    if (RELOCK_CODES.includes(err.code)) relock();
    throw err;
  }
}
