/**
 * modal.js — small dialogs.
 *   confirmDialog({...}) → true (confirm) or false (cancel, Escape, click outside)
 *   promptDialog({...})  → the typed note (trimmed, required), or null when cancelled
 * Focus moves into the dialog, stays there, and returns to where it was on close.
 */

import { t } from '../i18n/i18n.js';
import { esc } from '../utils/dom.js';

export function confirmDialog(options) {
  return openDialog({ ...options, input: null }).then((value) => value !== null);
}

/** Enter submits; Shift+Enter is a new line. */
export function promptDialog({ label, placeholder = '', maxLength = 500, ...options }) {
  return openDialog({ ...options, input: { label, placeholder, maxLength } });
}

function openDialog({ title, body, confirmLabel, cancelLabel, input }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalBody">
        <h3 id="modalTitle">${esc(title)}</h3>
        <p id="modalBody">${esc(body)}</p>
        ${input ? `
          <label class="modal-label" for="modalInput">${esc(input.label)}</label>
          <textarea id="modalInput" rows="3" maxlength="${Number(input.maxLength) || 500}" dir="auto" placeholder="${esc(input.placeholder)}"></textarea>
          <div class="form-error hidden" id="modalError" role="alert"></div>` : ''}
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-answer="no">${esc(cancelLabel || t('modal_cancel'))}</button>
          <button type="button" class="btn btn-primary" data-answer="yes">${esc(confirmLabel || t('modal_confirm'))}</button>
        </div>
      </div>`;
    const field = backdrop.querySelector('#modalInput');
    const error = backdrop.querySelector('#modalError');
    const focusables = Array.from(backdrop.querySelectorAll('textarea, [data-answer]'));

    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus({ preventScroll: true });
      resolve(value);
    };
    const submit = () => {
      if (!field) {
        close('');
        return;
      }
      const value = field.value.replace(/\s+/g, ' ').trim();
      if (!value) {
        error.textContent = t('modal_required');
        error.classList.remove('hidden');
        field.focus();
        return;
      }
      close(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      } else if (e.key === 'Enter' && e.target === field && !e.shiftKey) {
        e.preventDefault();
        submit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const i = focusables.indexOf(document.activeElement);
        focusables[(i + (e.shiftKey ? focusables.length - 1 : 1) + focusables.length) % focusables.length].focus();
      }
    };

    backdrop.addEventListener('click', (e) => {
      const button = e.target.closest('[data-answer]');
      if (button) {
        if (button.dataset.answer === 'yes') submit();
        else close(null);
      } else if (e.target === backdrop) {
        close(null);
      }
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    (field || backdrop.querySelector('[data-answer="yes"]')).focus();
  });
}
