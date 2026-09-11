/**
 * Pm.gs — the PM's final gate (CLAUDE.md §3.5, rules 16–17).
 *
 *   approve_lines_pm {keys[]}    coord_approved → pm_approved, stamped approved_pm_at
 *   return_lines {keys[], note}  coord_approved / pm_approved → returned, with a note the
 *                                coordinator sees on their page
 *
 * The PM reads lines through list_lines {statuses}. dashboard_query arrives in Stage 9.
 * Keys that aren't in the right status are skipped and reported, never an error, so a
 * page that went stale while a coordinator edited can't approve the wrong thing.
 */

const PM_ACTOR = 'pm';
const MAX_RETURN_NOTE = 500;
const RETURNABLE_STATUSES = ['coord_approved', 'pm_approved'];

/** approve_lines_pm — the final approval before export. */
function approveLinesPm_(payload) {
  const keys = lineKeys_(payload.keys);
  return withScriptLock(function () {
    const byKey = indexLines_();
    const now = nowIso_();
    const rows = [];
    const skipped = [];
    keys.forEach(function (key) {
      const row = byKey[key];
      if (!row || cleanText_(row.status) !== LINE_STATUS.COORD_APPROVED) {
        skipped.push(key);
        return;
      }
      row.status = LINE_STATUS.PM_APPROVED;
      row.approved_pm_at = now;
      row.updated_at = now;
      row.updated_by = PM_ACTOR;
      rows.push(row);
    });
    updateObjects(SHEET.LINES, rows);
    return { lines: rows.map(publicLine_), skipped: skipped };
  });
}

/**
 * return_lines — sends lines back to their coordinator with a note. The approval stamps
 * are cleared: the coordinator fixes the line and approves it again from scratch.
 */
function returnLines_(payload) {
  const keys = lineKeys_(payload.keys);
  const note = cleanText_(payload.note).replace(/\s+/g, ' ');
  if (!note) throw appError_('note_required', 'A return needs a note for the coordinator');
  if (note.length > MAX_RETURN_NOTE) throw appError_('bad_request', 'The note is too long');

  return withScriptLock(function () {
    const byKey = indexLines_();
    const now = nowIso_();
    const rows = [];
    const skipped = [];
    keys.forEach(function (key) {
      const row = byKey[key];
      if (!row || RETURNABLE_STATUSES.indexOf(cleanText_(row.status)) === -1) {
        skipped.push(key);
        return;
      }
      row.status = LINE_STATUS.RETURNED;
      row.return_note = note;
      row.approved_by_coord = '';
      row.approved_coord_at = '';
      row.approved_pm_at = '';
      row.updated_at = now;
      row.updated_by = PM_ACTOR;
      rows.push(row);
    });
    updateObjects(SHEET.LINES, rows);
    return { lines: rows.map(publicLine_), skipped: skipped };
  });
}
