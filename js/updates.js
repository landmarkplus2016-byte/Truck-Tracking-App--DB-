/**
 * updates.js — registers service-worker.js and offers Reload when a new version is out
 * (CLAUDE.md Deployment).
 *
 * A push that bumps APP_VERSION changes the worker file. The browser notices, installs the new
 * worker next to the running one and leaves it waiting; this shows a bar with Reload. Nothing
 * reloads on its own — someone mid-edit decides when. Reload tells the waiting worker to take
 * over, and the page reloads onto the new files once it has.
 */

import { t } from './i18n/i18n.js';
import { esc } from './utils/dom.js';

const CHECK_EVERY_MS = 30 * 60 * 1000;

let bar = null;
let reloadRequested = false;

export function startUpdates() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  // A first install also changes the controller, so only reload when Reload was pressed.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) location.reload();
  });

  navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
    .then((registration) => {
      const offerIfWaiting = () => {
        if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
      };
      offerIfWaiting();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') offerIfWaiting();
        });
      });
      // Desks keep the app open for days: look for a new version now and then, and on return to the tab.
      const check = () => registration.update().then(offerIfWaiting, () => {});
      setInterval(check, CHECK_EVERY_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    })
    .catch((err) => console.warn('[updates] service worker not registered:', err));
}

function offer(worker) {
  if (bar) return;
  bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `
    <span>${esc(t('update_available'))}</span>
    <button type="button" class="btn btn-primary btn-sm" data-update="reload" title="${esc(t('update_reload_tip'))}">${esc(t('update_reload'))}</button>
    <button type="button" class="btn btn-ghost btn-sm" data-update="later">${esc(t('update_later'))}</button>`;

  bar.addEventListener('click', (e) => {
    const button = e.target.closest('[data-update]');
    if (!button) return;
    if (button.dataset.update === 'later') {
      bar.remove();
      bar = null; // offered again at the next check
      return;
    }
    bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    if (worker.state === 'installed') {
      reloadRequested = true;
      worker.postMessage({ type: 'skip_waiting' });
    } else {
      location.reload(); // another tab already switched this worker on
    }
  });
  document.body.appendChild(bar);
}
