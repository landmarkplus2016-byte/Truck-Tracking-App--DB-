/**
 * main.js — boot. Make sure this device knows the Apps Script URL, load config and
 * the auto-detected coordinators, then hand over to the router.
 * There is no login screen (CLAUDE.md rule 4).
 */

import { api } from './api.js';
import { state } from './state.js';
import { t, errorText } from './i18n/i18n.js';
import { $, esc } from './utils/dom.js';
import { icon } from './components/icons.js';
import { renderSidebar, markActiveNav } from './components/sidebar.js';
import { startRouter, paths } from './router.js';

const els = {
  sidebar: $('#sidebar'),
  title: $('#pageTitle'),
  sub: $('#pageSub'),
  content: $('#content'),
};
let routerStarted = false;

boot();

function boot() {
  renderSidebar(els.sidebar, { coordinators: [] });
  if (api.hasScriptUrl()) connect();
  else showSetup();
}

async function connect() {
  setHead(t('boot_connecting_title'), '');
  els.content.innerHTML = `
    <div class="loading"><div class="spinner"></div><div>${esc(t('boot_connecting'))}</div></div>`;
  let config;
  let coordinators;
  try {
    [config, coordinators] = await Promise.all([
      api.call('get_config'),
      api.call('list_coordinators'),
    ]);
  } catch (err) {
    showBootError(err);
    return;
  }
  state.config = config || {};
  state.coordinators = Array.isArray(coordinators) ? coordinators : [];
  renderSidebar(els.sidebar, { coordinators: state.coordinators });
  startApp();
}

function startApp() {
  if (routerStarted) return;
  routerStarted = true;
  startRouter({
    host: els.content,
    defaultPath: () => (state.coordinators.length ? paths.coordinator(state.coordinators[0]) : paths.approvals),
    onRoute: ({ path, title, sub }) => {
      setHead(title, sub);
      markActiveNav(els.sidebar, path);
    },
  });
}

function setHead(title, sub) {
  els.title.textContent = title || '';
  els.sub.textContent = sub || '';
  document.title = title ? `${title} · ${t('app_name')}` : t('app_name');
}

/* ---------- First launch on this device: ask for the Web App URL ---------- */

function showSetup() {
  setHead(t('setup_title'), t('setup_sub'));
  els.content.innerHTML = `
    <div class="lock-wrap lock-wrap-wide">
      <div class="ring">${icon('link', { size: 24 })}</div>
      <h3>${esc(t('setup_heading'))}</h3>
      <p>${esc(t('setup_body'))}</p>
      <form id="setupForm" novalidate>
        <input type="url" id="scriptUrl" class="input-url" autocomplete="off" spellcheck="false"
               placeholder="${esc(t('setup_placeholder'))}" value="${esc(api.getScriptUrl())}">
        <div class="form-error hidden" id="setupError" role="alert"></div>
        <button type="submit" class="btn btn-primary btn-block">${esc(t('setup_connect'))}</button>
      </form>
      <p class="lock-hint">${esc(t('setup_hint'))}</p>
    </div>`;

  const input = $('#scriptUrl');
  const error = $('#setupError');
  input.focus();
  $('#setupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (!api.isValidScriptUrl(url)) {
      error.textContent = t('setup_invalid_url');
      error.classList.remove('hidden');
      input.focus();
      return;
    }
    api.setScriptUrl(url);
    connect();
  });
}

function showBootError(err) {
  setHead(t('boot_error_title'), '');
  els.content.innerHTML = `
    <div class="lock-wrap lock-wrap-wide">
      <div class="ring ring-danger">${icon('alert', { size: 24 })}</div>
      <h3>${esc(t('boot_error_heading'))}</h3>
      <p>${esc(errorText(err))}</p>
      <div class="lock-actions">
        <button type="button" class="btn btn-primary" id="bootRetry">${esc(t('boot_retry'))}</button>
        <button type="button" class="btn btn-ghost" id="bootChangeUrl">${esc(t('boot_change_url'))}</button>
      </div>
    </div>`;
  $('#bootRetry').addEventListener('click', connect);
  $('#bootChangeUrl').addEventListener('click', showSetup);
}
