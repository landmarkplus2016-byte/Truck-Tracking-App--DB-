/**
 * state.js — in-memory app state for this tab. Nothing here is persisted:
 * the admin password hash in particular is never stored (CLAUDE.md §4).
 */

export const state = {
  config: null,          // get_config result (never contains secrets)
  coordinators: [],      // list_coordinators — auto-detected from Trips (rule 31)
  reviewerNames: {},     // coordinator page → its "Reviewing as" name, stamped on approvals
  adminPwHash: null,     // SHA-256 hex, held for the tab's lifetime once Admin is unlocked
  masterPromise: null,   // shared in-flight get_sitelookup for the resolver
};
