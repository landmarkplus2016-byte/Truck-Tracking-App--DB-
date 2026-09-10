/**
 * Admin.gs — the Site-JC master and config administration.
 *
 * get_sitelookup is an OPEN read (the resolver caches it client-side).
 * Everything else here is password-gated (CLAUDE.md rule 5): the handler checks
 * admin_pw_hash against Config.admin_password_hash before it touches anything.
 * Hiding the Admin page in the UI is only UX — this file is the gate.
 */

const HEX64_ = /^[0-9a-f]{64}$/;
const ADMIN_PW_PLAINTEXT_PROPERTY = 'ADMIN_PW_PLAINTEXT';
const MAX_MASTER_ROWS = 50000;

/* ---------- The gate ---------- */

/** Throws unless payload.admin_pw_hash matches Config. Every gated handler calls this first. */
function requireAdmin_(payload) {
  const stored = String(readConfigMap_().admin_password_hash || '').trim().toLowerCase();
  if (!HEX64_.test(stored)) {
    throw appError_('admin_not_set', 'No admin password is set — put a SHA-256 hex in Config.admin_password_hash');
  }
  const given = String((payload && payload.admin_pw_hash) || '').trim().toLowerCase();
  if (!HEX64_.test(given) || !constantTimeEquals_(given, stored)) {
    throw appError_('forbidden', 'Wrong admin password');
  }
}

function constantTimeEquals_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** check_admin_pw — lets the Admin page confirm the password on Unlock. Writes nothing. */
function checkAdminPw_(payload) {
  requireAdmin_(payload);
  return { unlocked: true };
}

/* ---------- SiteLookup ---------- */

/**
 * get_sitelookup — every master row, trimmed. task_date is sent as ISO when it can be
 * read (a real date cell or a typed '07-Dec-2025'), otherwise as the stored text.
 */
function getSiteLookup_() {
  const tz = spreadsheetTz_();
  return readObjects(SHEET.SITE_LOOKUP)
    .map(function (r) { return masterRow_(r, tz); })
    .filter(function (r) { return r.site_jc !== ''; });
}

/**
 * upload_sitelookup {rows[], admin_pw_hash} — replaces SiteLookup wholesale.
 * Rows with a blank site_jc are dropped; everything else is stored as uploaded
 * (the resolver decides what a malformed key means, so nothing is second-guessed here).
 */
function uploadSiteLookup_(payload) {
  requireAdmin_(payload);
  const input = payload.rows;
  if (!Array.isArray(input) || !input.length) {
    throw appError_('bad_master', 'The upload has no rows — the current master was kept');
  }
  if (input.length > MAX_MASTER_ROWS) {
    throw appError_('bad_master', 'The upload has more than ' + MAX_MASTER_ROWS + ' rows');
  }

  const tz = spreadsheetTz_();
  const rows = input
    .map(function (r) { return masterRow_(r && typeof r === 'object' ? r : {}, tz); })
    .filter(function (r) { return r.site_jc !== ''; });
  if (!rows.length) {
    throw appError_('bad_master', 'No row has a Site ID-JC — the current master was kept');
  }

  return withScriptLock(function () {
    replaceObjects(SHEET.SITE_LOOKUP, rows);
    SpreadsheetApp.flush();
    console.log('SiteLookup replaced: ' + rows.length + ' rows');
    return { rows: rows.length, dropped: input.length - rows.length };
  });
}

function masterRow_(r, tz) {
  return {
    site_jc: cellString_(r.site_jc),
    task_date: toIsoDate_(r.task_date, tz) || cellString_(r.task_date),
    old_new: cellString_(r.old_new),
    contractor: cellString_(r.contractor),
    conflict: r.conflict === true ? 'TRUE' : r.conflict === false ? '' : cellString_(r.conflict),
  };
}

function cellString_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

/* ---------- Config ---------- */

/**
 * save_config {config, admin_pw_hash} — writes the editable keys, then returns the
 * fresh config (still without secrets). Changing the password is
 * config.admin_password_hash = the NEW hash; admin_pw_hash is the current one.
 */
function saveConfig_(payload) {
  requireAdmin_(payload);
  const patch = validateConfigPatch_(payload.config);
  return withScriptLock(function () {
    writeConfigValues_(patch);
    console.log('Config saved: ' + Object.keys(patch).join(', '));
    return getConfig_();
  });
}

/* ---------- One-off helper (run from the editor) ---------- */

/**
 * Hashes a plaintext password into the admin_password_hash to paste into Config.
 * The plaintext is passed in a script property, never typed into code, and the
 * property is deleted as soon as it is read.
 *
 *   1. Project Settings → Script properties → add ADMIN_PW_PLAINTEXT = the password
 *      (exactly as it will be typed — no extra spaces).
 *   2. Pick hashAdminPassword in the toolbar → Run.
 *   3. Copy the hex from the execution log into Config, column B of admin_password_hash.
 *
 * Same bytes as the browser's hash (SHA-256 of the UTF-8 text, lowercase hex).
 */
function hashAdminPassword() {
  const props = PropertiesService.getScriptProperties();
  const plaintext = props.getProperty(ADMIN_PW_PLAINTEXT_PROPERTY);
  props.deleteProperty(ADMIN_PW_PLAINTEXT_PROPERTY);
  if (!plaintext) {
    throw new Error('Add the script property ' + ADMIN_PW_PLAINTEXT_PROPERTY + ' first, then run again');
  }
  console.log('admin_password_hash = ' + sha256Hex_(plaintext));
  console.log('Paste that into Config. The ' + ADMIN_PW_PLAINTEXT_PROPERTY + ' property has been deleted.');
}

function sha256Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}
