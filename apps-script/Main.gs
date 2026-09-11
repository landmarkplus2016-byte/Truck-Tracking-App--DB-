/**
 * Main.gs — the single Web App entry point.
 *
 * Request:  POST body (sent as text/plain to avoid a CORS preflight)
 *           {"action": "get_config", "payload": {...}}
 * Response: {"ok": true, "data": ...}  or  {"ok": false, "error": "snake_case_code", "message": "..."}
 *
 * The app is open by design (CLAUDE.md rule 30): there is no session token.
 * Admin actions check admin_pw_hash inside their own handlers (requireAdmin_ in Admin.gs).
 */

// Handlers are wrapped so they resolve at call time, not when this file loads
// (Apps Script evaluates files in order and the handlers live in later files).
const ACTIONS = {
  get_config: function (payload) { return getConfig_(payload); },
  list_coordinators: function () { return listCoordinators_(); },
  get_sitelookup: function () { return getSiteLookup_(); },

  // Trips by day — open
  list_trips_by_day: function (payload) { return listTripsByDay_(payload); },
  save_trip: function (payload) { return saveTrip_(payload); },

  // Coordinator — open
  list_lines: function (payload) { return listLines_(payload); },
  save_line_classification: function (payload) { return saveLineClassification_(payload); },
  approve_lines_coord: function (payload) { return approveLinesCoord_(payload); },

  // PM — open
  approve_lines_pm: function (payload) { return approveLinesPm_(payload); },
  return_lines: function (payload) { return returnLines_(payload); },

  // Admin — password-gated
  check_admin_pw: function (payload) { return checkAdminPw_(payload); },
  upload_sitelookup: function (payload) { return uploadSiteLookup_(payload); },
  save_config: function (payload) { return saveConfig_(payload); },
};

function doPost(e) {
  try {
    const body = parseBody_(e);
    const handler = Object.prototype.hasOwnProperty.call(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!handler) throw appError_('unknown_action', 'Unknown action: ' + body.action);
    return json_({ ok: true, data: handler(body.payload || {}) });
  } catch (err) {
    return json_(errorEnvelope_(err));
  }
}

/** Health check — open the /exec URL in a browser to confirm the deployment answers. */
function doGet() {
  return json_({ ok: true, data: { app: 'trucks-tracking', status: 'up' } });
}

function parseBody_(e) {
  const raw = e && e.postData && e.postData.contents;
  if (!raw) throw appError_('bad_request', 'Empty request body');
  let body;
  try {
    body = JSON.parse(raw);
  } catch (err) {
    throw appError_('bad_request', 'Body is not valid JSON');
  }
  if (!body || typeof body.action !== 'string' || !body.action) {
    throw appError_('bad_request', 'Missing action');
  }
  return body;
}

/** Coded errors are ours and safe to show; anything else is logged and hidden. */
function errorEnvelope_(err) {
  if (err && err.code) return { ok: false, error: err.code, message: err.message };
  console.error(err && err.stack ? err.stack : err);
  return { ok: false, error: 'server_error', message: 'Unexpected server error' };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
