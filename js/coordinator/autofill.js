/**
 * autofill.js — applies the resolver to a coordinator's lines when the grid opens
 * (CLAUDE.md rule 15, §6.2).
 *
 * Open lines (pending / returned) take the master's job code, contractor and period for
 * their own trip date; *_manual overrides are left exactly as they are. Approved and
 * exported lines are shown as they were signed off — a master re-upload never changes a
 * number or a code under an approval.
 */

import { state } from '../state.js';
import { loadMaster, resolveLine, isManual } from '../utils/resolve.js';

export const OPEN_STATUSES = ['pending', 'returned'];
export const APPROVED_STATUSES = ['coord_approved', 'pm_approved'];
// What a coordinator's page owns on a line (rule 11) — everything save_line_classification writes.
export const CLASSIFICATION_FIELDS = ['site_id', 'job_code', 'contractor', 'period', 'jc_manual', 'contractor_manual', 'period_manual', 'warn'];

export const isOpen = (line) => OPEN_STATUSES.includes(line.status || 'pending');
export const isApproved = (line) => APPROVED_STATUSES.includes(line.status);
export const isLocked = (line) => line.status === 'exported';

export function resolverOptions() {
  return { fiscalNewFromYear: state.config ? state.config.fiscal_new_from_year : undefined };
}

/**
 * lines → { master, lines, changed }. `lines` is the list to show (open lines resolved);
 * `changed` holds the keys whose classification now differs from what the server has.
 */
export async function autofillLines(lines) {
  const master = await loadMaster();
  const options = resolverOptions();
  const changed = [];
  const resolved = lines.map((line) => {
    if (!isOpen(line)) return line;
    const next = resolveLine(line, master, options);
    if (!sameClassification(line, next)) changed.push(next.line_key);
    return next;
  });
  return { master, lines: resolved, changed };
}

export function sameClassification(a, b) {
  return CLASSIFICATION_FIELDS.every((field) => (field.endsWith('_manual')
    ? isManual(a[field]) === isManual(b[field])
    : text(a[field]) === text(b[field])));
}

/** A line's classification as a save_line_classification change. */
export function classificationOf(line) {
  const change = { line_key: line.line_key };
  CLASSIFICATION_FIELDS.forEach((field) => {
    change[field] = field.endsWith('_manual') ? isManual(line[field]) : text(line[field]);
  });
  return change;
}

function text(value) {
  return value === null || value === undefined ? '' : String(value);
}
