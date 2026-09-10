/**
 * config.js — Admin › Config. The auto-detected coordinators (read-only, rule 31), the
 * contractor list, fiscal new-from year, export default, and changing the admin
 * password. Every save goes through save_config, gated by the held admin hash.
 */

import { api } from '../api.js';
import { state } from '../state.js';
import { t, errorText } from '../i18n/i18n.js';
import { $, esc } from '../utils/dom.js';
import { sha256Hex } from '../utils/hash.js';
import { IN_HOUSE, isInHouse } from '../components/badge.js';
import { toast } from '../components/toast.js';

const EXPORT_DEFAULTS = ['weekly', 'range']; // mirrors EXPORT_DEFAULTS in Config.gs
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MIN_PASSWORD_LENGTH = 8;
const MAX_CONTRACTOR_NAME = 60;

/** Fetches fresh config + coordinators (another admin may have changed them), then draws. */
export function renderConfigTab(el, ctx) {
  el.innerHTML = `<div class="loading"><div class="spinner"></div><div>${esc(t('admin_loading'))}</div></div>`;
  Promise.all([api.call('get_config'), api.call('list_coordinators')])
    .then(([config, coordinators]) => {
      state.config = config || {};
      if (ctx.isCurrent()) drawConfig(el, ctx, Array.isArray(coordinators) ? coordinators : []);
    })
    .catch((err) => {
      if (!ctx.isCurrent()) return;
      el.innerHTML = `
        <div class="card"><div class="card-body">
          <div class="form-error" role="alert">${esc(errorText(err))}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="configRetry">${esc(t('action_retry'))}</button>
        </div></div>`;
      $('#configRetry', el).addEventListener('click', () => renderConfigTab(el, ctx));
    });
}

function drawConfig(el, ctx, coordinators) {
  const saved = settingsOf(state.config);
  const contractors = [...saved.contractors];

  el.innerHTML = `
    <div class="stack">
      <div class="two">
        <div class="card">
          <div class="card-head">
            <h3>${esc(t('config_coordinators'))}</h3><div class="spacer"></div>
            <span class="badge b-pending">${esc(t('config_auto_detected'))}</span>
          </div>
          <div class="card-body">
            ${coordinators.length
              ? `<div class="taglist">${coordinators.map((c) => `<span class="tag" dir="auto">${esc(c)}</span>`).join('')}</div>`
              : `<div class="hint">${esc(t('config_no_coordinators'))}</div>`}
            <div class="note">${esc(t('config_coordinators_note'))}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h3>${esc(t('config_contractors'))}</h3></div>
          <div class="card-body">
            <div class="taglist" id="contractorTags"></div>
            <form class="inline-form" id="contractorAdd" novalidate>
              <input type="text" id="contractorName" maxlength="${MAX_CONTRACTOR_NAME}" dir="auto" autocomplete="off"
                     placeholder="${esc(t('config_contractor_placeholder'))}" aria-label="${esc(t('config_contractor_placeholder'))}">
              <button type="submit" class="btn btn-ghost btn-sm">${esc(t('config_add_contractor'))}</button>
            </form>
            <div class="form-error below hidden" id="contractorError" role="alert"></div>
            <div class="note">${esc(t('config_contractors_note'))}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${esc(t('config_settings'))}</h3></div>
        <div class="card-body">
          <form id="settingsForm" novalidate>
            <div class="kv">
              <label class="k" for="fiscalYear">${esc(t('config_fiscal_year'))}</label>
              <div class="v">
                <input type="number" id="fiscalYear" class="short" min="${MIN_YEAR}" max="${MAX_YEAR}" step="1" value="${esc(saved.fiscal_new_from_year)}">
                <span class="hint">${esc(t('config_fiscal_year_hint'))}</span>
              </div>
              <div class="k">${esc(t('config_period_source'))}</div>
              <div class="v">
                <span class="badge b-inhouse">${esc(t('config_period_source_value'))}</span>
                <span class="hint">${esc(t('config_period_source_hint'))}</span>
              </div>
              <label class="k" for="exportDefault">${esc(t('config_export_default'))}</label>
              <div class="v">
                <select id="exportDefault">
                  ${EXPORT_DEFAULTS.map((v) => `<option value="${v}"${v === saved.export_default ? ' selected' : ''}>${esc(t('export_default_' + v))}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-error below hidden" id="settingsError" role="alert"></div>
            <div class="actions">
              <button type="submit" class="btn btn-primary" id="settingsSave" disabled>${esc(t('config_save'))}</button>
              <span class="hint hidden" id="settingsDirty">${esc(t('config_unsaved'))}</span>
            </div>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>${esc(t('config_admin_password'))}</h3></div>
        <div class="card-body">
          <form id="passwordForm" novalidate>
            <div class="kv">
              <label class="k" for="newPw">${esc(t('config_new_password'))}</label>
              <div class="v">
                <input type="password" id="newPw" autocomplete="new-password">
                <span class="hint">${esc(t('config_password_hint', { min: MIN_PASSWORD_LENGTH }))}</span>
              </div>
              <label class="k" for="confirmPw">${esc(t('config_confirm_password'))}</label>
              <div class="v"><input type="password" id="confirmPw" autocomplete="new-password"></div>
            </div>
            <div class="form-error below hidden" id="passwordError" role="alert"></div>
            <div class="actions">
              <button type="submit" class="btn btn-primary" id="passwordSave">${esc(t('config_change_password'))}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;

  const tags = $('#contractorTags', el);
  const nameInput = $('#contractorName', el);
  const contractorError = $('#contractorError', el);
  const yearInput = $('#fiscalYear', el);
  const exportSelect = $('#exportDefault', el);
  const settingsError = $('#settingsError', el);
  const saveBtn = $('#settingsSave', el);
  const dirtyHint = $('#settingsDirty', el);
  const newPw = $('#newPw', el);
  const confirmPw = $('#confirmPw', el);
  const passwordError = $('#passwordError', el);
  const passwordBtn = $('#passwordSave', el);

  /* ----- Contractors (saved with Settings) ----- */

  const drawTags = () => {
    tags.innerHTML = contractors.map((name, i) => (isInHouse(name)
      ? `<span class="tag" dir="auto" title="${esc(t('config_in_house_locked'))}">${esc(name)}</span>`
      : `<span class="tag" dir="auto">${esc(name)}<button type="button" data-remove="${i}" aria-label="${esc(t('config_remove_contractor', { name }))}">×</button></span>`
    )).join('');
  };

  tags.addEventListener('click', (e) => {
    const button = e.target.closest('[data-remove]');
    if (!button) return;
    contractors.splice(Number(button.dataset.remove), 1);
    drawTags();
    refreshDirty();
  });

  $('#contractorAdd', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    let problem = '';
    if (!name) problem = 'config_contractor_required';
    else if (name.includes('/')) problem = 'config_contractor_slash';
    else if (contractors.some((c) => c.toLowerCase() === name.toLowerCase())) problem = 'config_contractor_duplicate';
    setError(contractorError, problem ? t(problem, { name }) : '');
    if (!problem) {
      contractors.push(name);
      nameInput.value = '';
      drawTags();
      refreshDirty();
    }
    nameInput.focus();
  });

  /* ----- Settings ----- */

  const current = () => ({
    fiscal_new_from_year: yearInput.value.trim(),
    export_default: exportSelect.value,
    contractors,
  });
  const isDirty = () => {
    const now = current();
    return now.fiscal_new_from_year !== saved.fiscal_new_from_year
      || now.export_default !== saved.export_default
      || now.contractors.join('/') !== saved.contractors.join('/');
  };
  const refreshDirty = () => {
    const dirty = isDirty();
    saveBtn.disabled = !dirty;
    dirtyHint.classList.toggle('hidden', !dirty);
  };

  yearInput.addEventListener('input', refreshDirty);
  exportSelect.addEventListener('change', refreshDirty);

  $('#settingsForm', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isDirty()) return;
    const now = current();
    const year = Number(now.fiscal_new_from_year);
    if (!now.fiscal_new_from_year || !Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
      setError(settingsError, t('config_year_invalid', { min: MIN_YEAR, max: MAX_YEAR }));
      yearInput.focus();
      return;
    }
    setError(settingsError, '');
    saveBtn.disabled = true;
    try {
      const config = await ctx.call('save_config', {
        config: { fiscal_new_from_year: year, export_default: now.export_default, contractors: [...now.contractors] },
      });
      state.config = config || {};
      if (!ctx.isCurrent()) return;
      toast(t('config_saved'));
      drawConfig(el, ctx, coordinators);
    } catch (err) {
      if (!ctx.isCurrent()) return;
      refreshDirty();
      setError(settingsError, errorText(err));
    }
  });

  /* ----- Admin password ----- */

  $('#passwordForm', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = newPw.value;
    let problem = '';
    if (password.length < MIN_PASSWORD_LENGTH) problem = t('config_password_short', { min: MIN_PASSWORD_LENGTH });
    else if (password !== confirmPw.value) problem = t('config_password_mismatch');
    setError(passwordError, problem);
    if (problem) {
      newPw.focus();
      return;
    }

    passwordBtn.disabled = true;
    try {
      const hash = await sha256Hex(password);
      if (hash === state.adminPwHash) {
        setError(passwordError, t('config_password_same'));
        return;
      }
      // admin_pw_hash (added by ctx.call) is the current password; this is the new one.
      const config = await ctx.call('save_config', { config: { admin_password_hash: hash } });
      state.adminPwHash = hash;
      state.config = config || state.config;
      if (!ctx.isCurrent()) return;
      newPw.value = '';
      confirmPw.value = '';
      toast(t('config_password_changed'));
    } catch (err) {
      if (ctx.isCurrent()) setError(passwordError, errorText(err));
    } finally {
      passwordBtn.disabled = false;
    }
  });

  drawTags();
}

/** get_config → the form's starting values. In-House is always present (it's built in). */
function settingsOf(config) {
  const list = Array.isArray(config.contractors) ? config.contractors.map((c) => String(c).trim()).filter(Boolean) : [];
  return {
    fiscal_new_from_year: config.fiscal_new_from_year ? String(config.fiscal_new_from_year) : '',
    export_default: EXPORT_DEFAULTS.includes(config.export_default) ? config.export_default : EXPORT_DEFAULTS[0],
    contractors: list.some(isInHouse) ? list : [IN_HOUSE, ...list],
  };
}

function setError(node, text) {
  node.textContent = text;
  node.classList.toggle('hidden', !text);
}
