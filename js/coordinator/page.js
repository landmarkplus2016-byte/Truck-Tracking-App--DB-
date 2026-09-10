/**
 * page.js — a coordinator's page (#/coordinator/<name>): the "Reviewing as" name box,
 * the approve bar, and the grid host.
 *
 * On open: list_lines for this coordinator + the cached master → autofill (open lines
 * only) → render → the auto-filled values are saved in the background. Every edit is
 * resolved locally on commit, shown at once, and saved through one ordered queue.
 * Approving first makes sure the server holds exactly the classification on screen.
 */

import { api } from '../api.js';
import { state } from '../state.js';
import { t, errorText } from '../i18n/i18n.js';
import { $, esc } from '../utils/dom.js';
import { loadMaster, applyEdit, resolveLine } from '../utils/resolve.js';
import { icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/modal.js';
import { renderGrid, patchRow, bindGridEvents } from './grid.js';
import {
  autofillLines, resolverOptions, classificationOf, sameClassification,
  isOpen, isApproved, isLocked, CLASSIFICATION_FIELDS,
} from './autofill.js';
import { approveLines, selectedKeys, bindSelection } from './approve.js';

const SAVE_CHUNK = 400;
const MAX_NAME = 60;

export async function renderCoordinatorPage({ host, params, isCurrent }) {
  const coordinator = params.name;
  host.innerHTML = `<div class="loading"><div class="spinner"></div><div>${esc(t('coord_loading'))}</div></div>`;

  let lines;
  let loaded;
  try {
    [lines] = await Promise.all([api.call('list_lines', { coordinator }), loadMaster()]);
    lines = Array.isArray(lines) ? lines : [];
    loaded = await autofillLines(lines);
  } catch (err) {
    if (!isCurrent()) return;
    host.innerHTML = `
      <div class="lock-wrap lock-wrap-wide">
        <div class="ring ring-danger">${icon('alert', { size: 24 })}</div>
        <p>${esc(errorText(err))}</p>
        <button type="button" class="btn btn-primary" id="coordRetry">${esc(t('action_retry'))}</button>
      </div>`;
    $('#coordRetry', host).addEventListener('click', () => renderCoordinatorPage({ host, params, isCurrent }));
    return;
  }
  if (isCurrent()) mountPage({ host, coordinator, serverLines: lines, loaded, isCurrent });
}

function mountPage({ host, coordinator, serverLines, loaded, isCurrent }) {
  const { master } = loaded;
  const order = loaded.lines.map((line) => line.line_key);
  const model = new Map(loaded.lines.map((line) => [line.line_key, line]));   // what the grid shows
  const lastSaved = new Map(serverLines.map((line) => [line.line_key, line])); // what the server has
  const unsaved = new Set(loaded.changed);  // keys whose classification the server doesn't have yet
  const versions = new Map();               // local edit counter per key
  const busy = new Set();
  const ctx = { contractors: contractorList() };
  let showExported = false;
  let queue = Promise.resolve();

  if (typeof state.reviewerNames[coordinator] !== 'string') state.reviewerNames[coordinator] = coordinator;

  host.innerHTML = `
    <div class="namebox">
      <label for="revName">${esc(t('coord_reviewing_as'))}</label>
      <input type="text" id="revName" maxlength="${MAX_NAME}" dir="auto" autocomplete="name" value="${esc(state.reviewerNames[coordinator])}">
      <span class="tip">${esc(t('coord_reviewing_tip'))}</span>
    </div>
    <div class="bar">
      <label class="check-label"><input type="checkbox" id="selAll"> ${esc(t('coord_select_all'))}</label>
      <span class="count" id="coordCount"></span>
      <div class="spacer"></div>
      <label class="check-label quiet hidden" id="showExportedWrap"><input type="checkbox" id="showExported"> ${esc(t('coord_show_exported'))}</label>
      <button type="button" class="btn btn-primary btn-sm" id="approveSel">${esc(t('coord_approve_selected'))}</button>
    </div>
    <div id="gridHost"></div>`;

  const nameInput = $('#revName', host);
  const selectAll = $('#selAll', host);
  const count = $('#coordCount', host);
  const approveBtn = $('#approveSel', host);
  const gridHost = $('#gridHost', host);
  const showExportedBox = $('#showExported', host);

  const reviewerName = () => nameInput.value.replace(/\s+/g, ' ').trim();
  const rowOf = (key) => gridHost.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
  const syncSelection = bindSelection(gridHost, selectAll, () => {});

  /* ---------- Drawing ---------- */

  function draw() {
    const all = order.map((key) => model.get(key));
    const exportedTrips = new Set();
    const tripHasOther = new Set();
    all.forEach((line) => (isLocked(line) ? exportedTrips : tripHasOther).add(line.trip_id));
    tripHasOther.forEach((id) => exportedTrips.delete(id));

    $('#showExportedWrap', host).classList.toggle('hidden', exportedTrips.size === 0);
    const visible = showExported ? all : all.filter((line) => !exportedTrips.has(line.trip_id));
    gridHost.innerHTML = visible.length
      ? renderGrid(visible, ctx)
      : `<div class="card"><div class="empty">${icon('grid')}<div>${esc(t(all.length ? 'coord_empty_open' : 'coord_empty', { name: coordinator }))}</div></div></div>`;
    busy.forEach((key) => markBusy(key));
    updateCount();
    syncSelection();
  }

  function updateCount() {
    let pending = 0;
    model.forEach((line) => { if (isOpen(line)) pending++; });
    const bold = (n) => `<b class="num">${n}</b>`;
    // Escape the sentence first, then drop the bold numbers into its {slots}.
    count.innerHTML = esc(t('coord_counts'))
      .replace('{pending}', bold(pending))
      .replace('{approved}', bold(model.size - pending));
  }

  function patch(key) {
    const tr = rowOf(key);
    if (!tr || !model.has(key)) return;
    patchRow(tr, model.get(key), ctx);
    markBusy(key);
  }

  function markBusy(key) {
    const tr = rowOf(key);
    if (tr) tr.classList.toggle('row-saving', busy.has(key));
  }

  function setBusy(keys, on) {
    keys.forEach((key) => {
      if (on) busy.add(key);
      else busy.delete(key);
      markBusy(key);
    });
  }

  /* ---------- Saving ---------- */

  /**
   * Sends the current classification of `keys` still unsaved, in order after anything
   * already queued. A server answer is applied to a row only if it wasn't edited again
   * meanwhile. A failed human edit is rolled back to what the server has.
   */
  function save(keys, { autofill }) {
    const run = async () => {
      const sending = keys.filter((key) => unsaved.has(key) && model.has(key));
      for (let i = 0; i < sending.length; i += SAVE_CHUNK) {
        const chunk = sending.slice(i, i + SAVE_CHUNK);
        const sent = new Map(chunk.map((key) => [key, versions.get(key) || 0]));
        const changes = chunk.map((key) => classificationOf(model.get(key)));
        const current = (key) => (versions.get(key) || 0) === sent.get(key);
        setBusy(chunk, true);
        try {
          const result = await api.call('save_line_classification', { changes, autofill, reviewer_name: reviewerName() });
          changes.forEach((change) => {
            if (!current(change.line_key)) return;
            unsaved.delete(change.line_key);
            lastSaved.set(change.line_key, { ...lastSaved.get(change.line_key), ...change });
          });
          (result && result.lines || []).forEach((serverLine) => {
            const key = serverLine.line_key;
            lastSaved.set(key, serverLine);
            if (!model.has(key)) return;
            const merged = current(key) ? serverLine : { ...serverLine, ...pick(model.get(key), CLASSIFICATION_FIELDS) };
            model.set(key, merged);
            if (isCurrent()) patch(key);
          });
        } catch (err) {
          if (!autofill) chunk.forEach((key) => { if (current(key)) rollBack(key); });
          throw err;
        } finally {
          setBusy(chunk, false);
          if (isCurrent()) updateCount();
        }
      }
    };
    const job = queue.then(run);
    queue = job.catch(() => {});
    return job;
  }

  function rollBack(key) {
    const saved = lastSaved.get(key);
    if (!saved) return;
    const shown = isOpen(saved) ? resolveLine(saved, master, resolverOptions()) : saved;
    model.set(key, shown);
    if (sameClassification(saved, shown)) unsaved.delete(key);
    else unsaved.add(key);
    if (isCurrent()) patch(key);
  }

  /* ---------- Editing ---------- */

  async function onCommit(key, field, rawValue) {
    const line = model.get(key);
    if (!line || isLocked(line)) return;
    const next = applyEdit(line, field, rawValue, master, resolverOptions());
    if (sameClassification(line, next)) {
      patch(key); // e.g. 'k4429' typed for 'K4429' — show the normalised value
      return;
    }
    if (isApproved(line)) {
      const yes = await confirmDialog({
        title: t('coord_revert_title'),
        body: t(line.status === 'pm_approved' ? 'coord_revert_body_pm' : 'coord_revert_body_coord'),
        confirmLabel: t('coord_revert_confirm'),
      });
      if (!isCurrent()) return;
      if (!yes || model.get(key) !== line) {
        patch(key);
        return;
      }
    }

    model.set(key, next);
    versions.set(key, (versions.get(key) || 0) + 1);
    unsaved.add(key);
    patch(key);
    try {
      await save([key], { autofill: false });
      if (isCurrent() && isApproved(line) && isOpen(model.get(key))) toast(t('coord_reverted'));
    } catch (err) {
      if (isCurrent()) toast(t('coord_save_failed', { error: errorText(err) }), { error: true });
    }
  }

  /* ---------- Approving ---------- */

  async function approve(keys) {
    if (!keys.length) {
      toast(t('coord_select_first'), { error: true });
      return;
    }
    const name = reviewerName();
    if (!name) {
      toast(t('error_name_required'), { error: true });
      nameInput.focus();
      return;
    }
    approveBtn.disabled = true;
    try {
      // The server approves what it holds — make that the classification on screen.
      const dirty = keys.filter((key) => unsaved.has(key));
      if (dirty.length) await save(dirty, { autofill: false });
      setBusy(keys, true);
      const result = await approveLines({ keys, reviewerName: name, coordinator });
      const approved = (result && result.lines) || [];
      approved.forEach((serverLine) => {
        lastSaved.set(serverLine.line_key, serverLine);
        model.set(serverLine.line_key, serverLine);
      });
      if (!isCurrent()) return;
      setBusy(keys, false);
      approved.forEach((serverLine) => patch(serverLine.line_key));
      updateCount();
      syncSelection();
      if (approved.length) {
        toast(approved.length === 1
          ? t('coord_approved_one', { name })
          : t('coord_approved_many', { count: approved.length, name }));
      }
      const skipped = (result && result.skipped) || [];
      if (skipped.length) toast(t('coord_skipped', { count: skipped.length }), { error: !approved.length });
    } catch (err) {
      if (isCurrent()) toast(errorText(err), { error: true });
    } finally {
      setBusy(keys, false);
      approveBtn.disabled = false;
    }
  }

  /* ---------- Wiring ---------- */

  nameInput.addEventListener('input', () => { state.reviewerNames[coordinator] = nameInput.value; });
  showExportedBox.addEventListener('change', () => {
    showExported = showExportedBox.checked;
    draw();
  });
  approveBtn.addEventListener('click', () => approve(selectedKeys(gridHost)));
  bindGridEvents(gridHost, { onCommit, onApprove: (key) => approve([key]) });

  draw();

  if (unsaved.size) {
    save(Array.from(unsaved), { autofill: true }).catch((err) => {
      if (isCurrent()) toast(t('coord_autofill_failed', { error: errorText(err) }), { error: true });
    });
  }
}

function contractorList() {
  const list = state.config && Array.isArray(state.config.contractors) ? state.config.contractors : [];
  return list.map((name) => String(name).trim()).filter(Boolean);
}

function pick(obj, fields) {
  const out = {};
  fields.forEach((field) => { out[field] = obj[field]; });
  return out;
}
