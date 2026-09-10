/**
 * api.js — the ONLY file that talks to Apps Script (CLAUDE.md rule 25).
 *
 * The Web App URL lives in localStorage on each device and is never in code (rule 2).
 * Pages call api.call('action', payload) and get the `data` back, or an ApiError
 * whose `code` is the server's snake_case error (or a transport code below).
 */

const SCRIPT_URL_KEY = 'tt_script_url';
const TIMEOUT_MS = 60000;
const SCRIPT_URL_PATTERN = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/;

export class ApiError extends Error {
  constructor(code, detail) {
    super(detail || code);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail || '';
  }
}

function getScriptUrl() {
  try {
    return localStorage.getItem(SCRIPT_URL_KEY) || '';
  } catch {
    return '';
  }
}

function setScriptUrl(url) {
  localStorage.setItem(SCRIPT_URL_KEY, String(url).trim());
}

function hasScriptUrl() {
  return getScriptUrl() !== '';
}

function isValidScriptUrl(url) {
  return SCRIPT_URL_PATTERN.test(String(url).trim());
}

async function call(action, payload = {}) {
  const url = getScriptUrl();
  if (!url) throw new ApiError('no_script_url');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      // text/plain keeps this a "simple" request, so the browser skips the CORS
      // preflight that Apps Script cannot answer.
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new ApiError(err.name === 'AbortError' ? 'timeout' : 'network_error', err.message);
    }
    if (!res.ok) throw new ApiError('http_error', 'HTTP ' + res.status);

    let body;
    try {
      body = await res.json();
    } catch {
      throw new ApiError('bad_response');
    }
    if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean') throw new ApiError('bad_response');
    if (!body.ok) throw new ApiError(body.error || 'server_error', body.message);
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

export const api = { call, getScriptUrl, setScriptUrl, hasScriptUrl, isValidScriptUrl };
