/**
 * approve.js — coordinator approval, per line and select-all (rule 16), stamped with the
 * "Reviewing as" name. The server moves open lines to coord_approved with its own
 * timestamp, and reports any key it skipped (already approved, exported, not found).
 * Row selection itself lives in components/table.js, shared with the PM page.
 */

import { api } from '../api.js';

export { selectableBoxes, selectedKeys, bindSelection } from '../components/table.js';

export function approveLines({ keys, reviewerName, coordinator }) {
  return api.call('approve_lines_coord', { keys, reviewer_name: reviewerName, coordinator });
}
