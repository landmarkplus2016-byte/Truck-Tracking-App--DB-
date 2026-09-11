/**
 * Config.gs — the key/value Config tab.
 *
 * Read by position (column A = key, column B = value) so it works with or without
 * a 'key | value' header row. Secrets never leave the server.
 */

const SECRET_CONFIG_KEYS = ['admin_password_hash'];

// What save_config may write. app_name / company_name / coordinator_overrides are
// edited in the sheet by the project owner.
const EDITABLE_CONFIG_KEYS = ['fiscal_new_from_year', 'export_default', 'contractors', 'admin_password_hash'];
const EXPORT_DEFAULTS = ['weekly', 'range'];   // week (default) or a date range — CLAUDE.md §7.3
const IN_HOUSE = 'In-House';                   // built in: exports as two files, Old and New
const MAX_CONTRACTOR_NAME = 60;

function readConfigMap_() {
  const sheet = getSheet_(SHEET.CONFIG);
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return {};
  const map = {};
  sheet.getRange(1, 1, lastRow, 2).getValues().forEach(function (row) {
    const key = String(row[0]).trim();
    if (!key || key.toLowerCase() === 'key') return;
    map[key] = typeof row[1] === 'string' ? row[1].trim() : row[1];
  });
  return map;
}

/** get_config — every Config key except secrets, with the structured ones parsed. */
function getConfig_() {
  const raw = readConfigMap_();
  const config = {};
  Object.keys(raw).forEach(function (key) {
    if (SECRET_CONFIG_KEYS.indexOf(key) === -1) config[key] = raw[key];
  });

  if ('fiscal_new_from_year' in config) {
    config.fiscal_new_from_year = Number(config.fiscal_new_from_year) || null;
  }
  if ('contractors' in config) {
    config.contractors = String(config.contractors).split('/')
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }
  if ('coordinator_overrides' in config) {
    config.coordinator_overrides = parseJsonOr_(config.coordinator_overrides, {});
  }
  return config;
}

/**
 * save_config's `config` → a clean {key: cellValue} patch, or bad_config.
 * Only EDITABLE_CONFIG_KEYS are accepted; each is checked and normalised.
 */
function validateConfigPatch_(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw appError_('bad_config', 'config must be an object');
  }
  const keys = Object.keys(config);
  if (!keys.length) throw appError_('bad_config', 'Nothing to save');

  const patch = {};
  keys.forEach(function (key) {
    if (EDITABLE_CONFIG_KEYS.indexOf(key) === -1) throw appError_('bad_config', 'Not an editable setting: ' + key);
    const value = config[key];

    if (key === 'fiscal_new_from_year') {
      const year = Number(value);
      if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        throw appError_('bad_config', 'Fiscal new-from year must be a year between 2000 and 2100');
      }
      patch[key] = year;
    } else if (key === 'export_default') {
      if (EXPORT_DEFAULTS.indexOf(value) === -1) {
        throw appError_('bad_config', 'Export default must be one of: ' + EXPORT_DEFAULTS.join(', '));
      }
      patch[key] = value;
    } else if (key === 'contractors') {
      patch[key] = normalizeContractors_(value).join('/');
    } else if (key === 'admin_password_hash') {
      const hash = String(value || '').trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(hash)) throw appError_('bad_config', 'The new password hash is not a SHA-256 hex');
      patch[key] = hash;
    }
  });
  return patch;
}

/** An array (or '/'-joined string) of names → trimmed, de-duplicated, In-House present. */
function normalizeContractors_(value) {
  const list = Array.isArray(value) ? value : String(value === null || value === undefined ? '' : value).split('/');
  const seen = {};
  const names = [];
  list.forEach(function (item) {
    const name = String(item === null || item === undefined ? '' : item).trim();
    if (!name) return;
    if (name.indexOf('/') !== -1) throw appError_('bad_config', 'A contractor name cannot contain "/": ' + name);
    if (name.length > MAX_CONTRACTOR_NAME) throw appError_('bad_config', 'Contractor name is too long: ' + name);
    const folded = name.toLowerCase();
    if (seen[folded]) return;
    seen[folded] = true;
    names.push(name);
  });
  if (!seen[IN_HOUSE.toLowerCase()]) throw appError_('bad_config', IN_HOUSE + ' cannot be removed from contractors');
  return names;
}

/**
 * Writes each patch key into column B of its row, appending a row for a new key.
 * Matches the LAST row with that key, the same one readConfigMap_ reads.
 * Text is written as plain text so a hash or a name is never turned into a number.
 */
function writeConfigValues_(patch) {
  const sheet = getSheet_(SHEET.CONFIG);
  const lastRow = sheet.getLastRow();
  const keys = lastRow
    ? sheet.getRange(1, 1, lastRow, 1).getValues().map(function (r) { return String(r[0]).trim(); })
    : [];
  Object.keys(patch).forEach(function (key) {
    let row = keys.lastIndexOf(key) + 1;
    if (!row) {
      keys.push(key);
      row = keys.length;
      sheet.getRange(row, 1).setNumberFormat('@').setValue(key);
    }
    const value = patch[key];
    sheet.getRange(row, 2).setNumberFormat(typeof value === 'number' ? 'General' : '@').setValue(value);
  });
}

/** Config contractors by lower-cased name → their Config spelling, so 'el-khayal' groups as 'El-Khayal'. */
function contractorNames_() {
  const names = {};
  (getConfig_().contractors || []).forEach(function (name) { names[name.toLowerCase()] = name; });
  return names;
}

function parseJsonOr_(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}
