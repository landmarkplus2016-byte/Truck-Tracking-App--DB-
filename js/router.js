/**
 * router.js — hash routes (CLAUDE.md §5.2) → render functions.
 *
 * Each route renders into the content host. Pages not built yet use
 * renderPlaceholder; each build stage swaps its real render function in here.
 */

import { t } from './i18n/i18n.js';
import { esc } from './utils/dom.js';
import { icon } from './components/icons.js';

export const paths = {
  coordinator: (name) => '/coordinator/' + encodeURIComponent(name),
  trips: '/trips',
  approvals: '/pm/approvals',
  dashboard: '/pm/dashboard',
  export: '/pm/export',
  admin: '/admin',
};

const ROUTES = [
  {
    pattern: /^\/coordinator\/([^/]+)$/,
    params: (m) => ({ name: decodeURIComponent(m[1]) }),
    path: (p) => paths.coordinator(p.name),
    title: (p) => p.name,
    sub: (p) => t('page_coordinator_sub', { name: p.name }),
    render: renderPlaceholder,
  },
  { pattern: /^\/trips$/, title: () => t('page_trips_title'), sub: () => t('page_trips_sub'), render: renderPlaceholder },
  { pattern: /^\/pm\/approvals$/, title: () => t('page_approvals_title'), sub: () => t('page_approvals_sub'), render: renderPlaceholder },
  { pattern: /^\/pm\/dashboard$/, title: () => t('page_dashboard_title'), sub: () => t('page_dashboard_sub'), render: renderPlaceholder },
  { pattern: /^\/pm\/export$/, title: () => t('page_export_title'), sub: () => t('page_export_sub'), render: renderPlaceholder },
  { pattern: /^\/admin$/, title: () => t('page_admin_title'), sub: () => t('page_admin_sub'), render: renderPlaceholder },
];

let renderSeq = 0;

/**
 * Starts listening to the hash. An empty or unknown hash is replaced with defaultPath().
 * onRoute({path, title, sub}) runs before each render so the shell can update the
 * topbar and the active nav item. Renders get isCurrent() to drop stale async results.
 */
export function startRouter({ host, defaultPath, onRoute }) {
  const handle = () => {
    const found = resolve(location.hash);
    if (!found) {
      // replace() keeps the bad hash out of history; the hashchange it fires renders the default.
      // Built from location.href so a <base> tag can never redirect to another document.
      const target = new URL(location.href);
      target.hash = defaultPath();
      location.replace(target.href);
      return;
    }
    const seq = ++renderSeq;
    onRoute({ path: found.path, title: found.title, sub: found.sub });
    found.route.render({ host, params: found.params, isCurrent: () => seq === renderSeq });
  };
  window.addEventListener('hashchange', handle);
  handle();
}

function resolve(hash) {
  const raw = hash.replace(/^#/, '');
  for (const route of ROUTES) {
    const m = raw.match(route.pattern);
    if (!m) continue;
    try {
      const params = route.params ? route.params(m) : {};
      return {
        route,
        params,
        path: route.path ? route.path(params) : raw,
        title: route.title(params),
        sub: route.sub(params),
      };
    } catch {
      return null; // malformed percent-encoding in the hash
    }
  }
  return null;
}

function renderPlaceholder({ host }) {
  host.innerHTML = `
    <div class="card">
      <div class="empty">${icon('grid')}<div>${esc(t('page_placeholder'))}</div></div>
    </div>`;
}
