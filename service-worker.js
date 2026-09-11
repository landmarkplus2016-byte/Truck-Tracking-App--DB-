/**
 * service-worker.js — caches the app shell, so the app opens fast and installs as a PWA.
 *
 * >>> BUMP APP_VERSION IN EVERY PUSH (CLAUDE.md Deployment). <<<
 * The browser only compares this file. Changing this one line is what makes an open app
 * notice a new version; js/updates.js then offers Reload. Forget it and nobody is told.
 *
 * - The shell (this site's HTML, CSS, JS modules, manifest, icons) is served from the cache of
 *   the current version; anything not in it falls through to the network.
 * - The pinned xlsx-js-style script (exact version in its URL) is cached the same way.
 * - Every other request — every Apps Script call in particular — is left to the network,
 *   untouched. No data is ever cached: there is no offline editing (CLAUDE.md Non-Goals).
 *
 * Add a new file to SHELL when you add one to the app. A file missing from the list still
 * works online (it is fetched), it just isn't cached.
 */

const APP_VERSION = '2026.09.11-2'; // YYYY.MM.DD-n — bump on every push
const CACHE_PREFIX = 'tt-shell-';
const CACHE = CACHE_PREFIX + APP_VERSION;

const SHELL = [
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'assets/lmp-logo-white.png',
  'assets/app-background.jpg',
  'css/tokens.css',
  'css/base.css',
  'css/components.css',
  'css/grid.css',
  'js/main.js',
  'js/router.js',
  'js/api.js',
  'js/state.js',
  'js/updates.js',
  'js/i18n/i18n.js',
  'js/i18n/en.js',
  'js/i18n/ar.js',
  'js/utils/dates.js',
  'js/utils/dom.js',
  'js/utils/explode.js',
  'js/utils/hash.js',
  'js/utils/money.js',
  'js/utils/resolve.js',
  'js/utils/xlsx.js',
  'js/components/badge.js',
  'js/components/brandMark.js',
  'js/components/icons.js',
  'js/components/modal.js',
  'js/components/sidebar.js',
  'js/components/table.js',
  'js/components/toast.js',
  'js/coordinator/approve.js',
  'js/coordinator/autofill.js',
  'js/coordinator/grid.js',
  'js/coordinator/page.js',
  'js/trips/tripCard.js',
  'js/trips/tripsByDay.js',
  'js/pm/approvals.js',
  'js/pm/dashboard.js',
  'js/pm/export.js',
  'js/pm/exportTemplate.js',
  'js/admin/adminGate.js',
  'js/admin/config.js',
  'js/admin/master.js',
];

// Must match the <script src> in index.html exactly.
const CDN = ['https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.min.js'];

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the HTTP cache, so a new version never stores a stale file.
  // One failed file is logged, not fatal: a typo in SHELL must not block every future update.
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all([
    ...SHELL.map((path) => cache.add(new Request(scopeUrl(path), { cache: 'reload' }))
      .catch((err) => console.warn('[sw] not cached:', path, err))),
    ...CDN.map((url) => cache.add(new Request(url, { mode: 'cors', credentials: 'omit', cache: 'reload' }))
      .catch((err) => console.warn('[sw] not cached:', url, err))),
  ])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// updates.js sends this when someone presses Reload.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip_waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);

  if (url.origin === scope.origin) {
    // Opening the app (any #/route): the cached index.html.
    const isAppPage = url.pathname === scope.pathname || url.pathname === scope.pathname + 'index.html';
    if (request.mode === 'navigate' && isAppPage) {
      event.respondWith(fromCache(scopeUrl('index.html')).then((hit) => hit || fetch(request)));
      return;
    }
    event.respondWith(fromCache(request).then((hit) => hit || fetch(request)));
    return;
  }

  if (CDN.includes(request.url)) {
    event.respondWith(fromCache(request).then((hit) => hit || fetch(request)));
  }
  // Anything else (Apps Script, …): not intercepted.
});

function fromCache(request) {
  return caches.open(CACHE).then((cache) => cache.match(request));
}
