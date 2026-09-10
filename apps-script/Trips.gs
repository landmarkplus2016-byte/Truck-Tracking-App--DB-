/**
 * Trips.gs — the Trips tab.
 * Now: coordinator auto-detection. Stage 7 adds save_trip (re-split + revert approvals).
 */

/** list_coordinators — the distinct coordinator names present in Trips (CLAUDE.md rule 31), A→Z. */
function listCoordinators_() {
  const seen = {};
  readColumn(SHEET.TRIPS, 'coordinator').forEach(function (value) {
    const name = String(value === null || value === undefined ? '' : value).trim();
    if (name) seen[name] = true;
  });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); });
}
