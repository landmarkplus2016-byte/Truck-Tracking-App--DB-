/**
 * modal.js — a small confirm dialog. confirmDialog({...}) resolves true (confirm) or
 * false (cancel, Escape, or a click outside). Focus goes to Confirm and returns to
 * wherever it was when the dialog closes.
 */

import { t } from '../i18n/i18n.js';
import { esc } from '../utils/dom.js';

export function confirmDialog({ title, body, confirmLabel, cancelLabel }) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalBody">
        <h3 id="modalTitle">${esc(title)}</h3>
        <p id="modalBody">${esc(body)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-answer="no">${esc(cancelLabel || t('modal_cancel'))}</button>
          <button type="button" class="btn btn-primary" data-answer="yes">${esc(confirmLabel || t('modal_confirm'))}</button>
        </div>
      </div>`;
    const buttons = Array.from(backdrop.querySelectorAll('[data-answer]'));

    const close = (answer) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus({ preventScroll: true });
      resolve(answer);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Tab') {
        // Keep focus on the two buttons while the dialog is open.
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement);
        buttons[(i + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
      }
    };

    backdrop.addEventListener('click', (e) => {
      const button = e.target.closest('[data-answer]');
      if (button) close(button.dataset.answer === 'yes');
      else if (e.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    buttons[1].focus();
  });
}
