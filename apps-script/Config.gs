/**
 * Config.gs — the key/value Config tab.
 *
 * Read by position (column A = key, column B = value) so it works with or without
 * a 'key | value' header row. Secrets never leave the server.
 */

const SECRET_CONFIG_KEYS = ['admin_password_hash'];

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

function parseJsonOr_(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}
