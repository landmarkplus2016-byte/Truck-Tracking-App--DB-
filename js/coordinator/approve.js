/**
 * approve.js — coordinator approval, per line and select-all (rule 16), stamped with the
 * "Reviewing as" name. The server moves open lines to coord_approved with its own
 * timestamp, and reports any key it skipped (already approved, exported, not found).
 */

import { api } from '../api.js';
import { $$ } from '../utils/dom.js';

export function approveLines({ keys, reviewerName, coordinator }) {
  return api.call('approve_lines_coord', { keys, reviewer_name: reviewerName, coordinator });
}

/** Row checkboxes that can still be ticked — open lines only. */
export function selectableBoxes(root) {
  return $$('.rowcb:not(:disabled)', root);
}

export function selectedKeys(root) {
  return selectableBoxes(root)
    .filter((box) => box.checked)
    .map((box) => box.closest('tr').dataset.key);
}

/**
 * Wires "Select all" to the row boxes under root. onChange(selectedCount) runs after every
 * change. Returns sync(), to call after rows are patched or re-rendered.
 */
export function bindSelection(root, selectAll, onChange) {
  const sync = () => {
    const boxes = selectableBoxes(root);
    const checked = boxes.filter((box) => box.checked).length;
    selectAll.checked = boxes.length > 0 && checked === boxes.length;
    selectAll.indeterminate = checked > 0 && checked < boxes.length;
    selectAll.disabled = boxes.length === 0;
    onChange(checked);
  };
  selectAll.addEventListener('change', () => {
    selectableBoxes(root).forEach((box) => { box.checked = selectAll.checked; });
    sync();
  });
  root.addEventListener('change', (e) => {
    if (e.target.classList && e.target.classList.contains('rowcb')) sync();
  });
  return sync;
}
