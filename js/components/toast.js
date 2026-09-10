/**
 * toast.js — the one-line confirmation at the bottom of the screen. One element,
 * reused; a new toast replaces the one showing.
 */

import { esc } from '../utils/dom.js';
import { icon } from './icons.js';

const SHOW_MS = 2800;
let el = null;
let timer = 0;

export function toast(message) {
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="ok">${icon('check', { size: 16 })}</span><span dir="auto">${esc(message)}</span>`;
  // Next frame, so the slide-in also plays for the very first toast.
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), SHOW_MS);
}
