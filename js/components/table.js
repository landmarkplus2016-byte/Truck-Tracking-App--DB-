/**
 * table.js — row selection shared by the approval tables (coordinator grid, PM approvals).
 * A row is selectable through its .rowcb checkbox; a disabled box is not selectable.
 * The row's <tr> carries data-key.
 */

import { $$ } from '../utils/dom.js';

/** Row checkboxes that can still be ticked. */
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
