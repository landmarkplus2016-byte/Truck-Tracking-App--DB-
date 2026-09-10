/**
 * Admin.gs — the Site-JC master and config administration.
 * Now: get_sitelookup (an OPEN read — the resolver caches it client-side).
 * Stage 5 adds the password-gated upload_sitelookup and save_config.
 */

/**
 * get_sitelookup — every master row, trimmed. task_date is sent as ISO when it can be
 * read (a real date cell or a typed '07-Dec-2025'), otherwise as the stored text.
 */
function getSiteLookup_() {
  const tz = spreadsheetTz_();
  return readObjects(SHEET.SITE_LOOKUP)
    .map(function (r) {
      return {
        site_jc: cellString_(r.site_jc),
        task_date: toIsoDate_(r.task_date, tz) || cellString_(r.task_date),
        old_new: cellString_(r.old_new),
        contractor: cellString_(r.contractor),
        conflict: r.conflict === true ? 'TRUE' : r.conflict === false ? '' : cellString_(r.conflict),
      };
    })
    .filter(function (r) { return r.site_jc !== ''; });
}

function cellString_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
