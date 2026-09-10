/**
 * resolve.js — fills a line's job_code / contractor / period from the Site-JC master
 * (CLAUDE.md §6.2), client-side, on the line's own trip date.
 *
 * For a matched site the master's Old/New and Contractor are used as-is (rule 14 —
 * deliberately unlike Settlement Checker). fiscal_new_from_year only decides the
 * period of a site that is not in the master. Warnings are amber and never block.
 *
 * Everything below loadMaster is pure. The grid calls applyEdit on blur/commit —
 * never per keystroke — and pushes the returned values into the row in place.
 */

import { api } from '../api.js';
import { state } from '../state.js';
import { parseTypedDate, yearOf } from './dates.js';
import { normalizeSiteId } from './explode.js';

export const WARN = {
  NONE: '',
  UNKNOWN_SITE: 'unknown_site',
  CONFLICT: 'conflict',
  MISSING_JOB_CODE: 'missing_job_code',
};

// Each hand-editable classification field and its sticky override flag.
const MANUAL_FLAG = { job_code: 'jc_manual', contractor: 'contractor_manual', period: 'period_manual' };
const UNSET_CONFLICT = ['', 'false', 'no', 'n', '0'];

/* ---------- The cached master ---------- */

/** The master index, fetched once per session; concurrent callers share one request. */
export function loadMaster() {
  if (!state.masterPromise) {
    const pending = api.call('get_sitelookup').then(buildIndex);
    state.masterPromise = pending;
    // A failed load must not stay cached; the next caller retries.
    pending.catch(() => {
      if (state.masterPromise === pending) state.masterPromise = null;
    });
  }
  return state.masterPromise;
}

/** Drop the cache (after an admin upload) so the next grid open refetches. */
export function invalidateMaster() {
  state.masterPromise = null;
}

/**
 * Master rows → { bySite: Map(site_id → candidates), size, skipped }.
 * 'SITE-JC' is split on the hyphen (neither part ever contains one). Candidates
 * are sorted newest task_date first, undated last.
 */
export function buildIndex(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const bySite = new Map();
  let skipped = 0;
  list.forEach((row) => {
    const parts = splitSiteJc(row.site_jc);
    if (!parts) {
      skipped++;
      return;
    }
    if (!bySite.has(parts.site_id)) bySite.set(parts.site_id, []);
    bySite.get(parts.site_id).push({
      job_code: parts.job_code,
      task_date: parseTypedDate(row.task_date),
      old_new: normalizePeriod(row.old_new),
      contractor: String(row.contractor === null || row.contractor === undefined ? '' : row.contractor).trim(),
      conflict: isConflictSet(row.conflict),
    });
  });
  bySite.forEach((candidates) => candidates.sort(newestFirst));
  return { bySite, size: list.length - skipped, skipped };
}

/** 'SITE-JC' → {site_id, job_code}, split on the first hyphen; null if either part is missing. */
export function splitSiteJc(value) {
  const key = String(value === null || value === undefined ? '' : value).trim();
  const cut = key.indexOf('-');
  const siteId = cut > 0 ? normalizeSiteId(key.slice(0, cut)) : '';
  const jobCode = cut > 0 ? key.slice(cut + 1).trim() : '';
  return siteId && jobCode ? { site_id: siteId, job_code: jobCode } : null;
}

function newestFirst(a, b) {
  if (a.task_date === b.task_date) return 0;
  if (!a.task_date) return 1;
  if (!b.task_date) return -1;
  return a.task_date < b.task_date ? 1 : -1;
}

/* ---------- Picking and resolving ---------- */

/**
 * The candidate in force on entryDate (the line's own trip date, never a batch year):
 * the newest task on or before that date; else the earliest dated task; else the first.
 */
export function pickCandidate(candidates, entryDate) {
  if (!candidates || !candidates.length) return null;
  if (entryDate) {
    const inForce = candidates.find((c) => c.task_date && c.task_date <= entryDate);
    if (inForce) return inForce;
  }
  const dated = candidates.filter((c) => c.task_date);
  if (dated.length) return dated[dated.length - 1];
  return candidates[0];
}

/** Fallback period for a site not in the master: year ≥ fiscal_new_from_year → 'new'. */
export function derivePeriod(entryDate, fiscalNewFromYear) {
  const year = yearOf(entryDate);
  const fromYear = Number(fiscalNewFromYear);
  if (!year || !fromYear) return '';
  return year >= fromYear ? 'new' : 'old';
}

/**
 * line → a new line with site_id normalised, and job_code / contractor / period / warn
 * filled from the master. Fields whose *_manual flag is set are left exactly as they are.
 */
export function resolveLine(line, master, { fiscalNewFromYear } = {}) {
  const siteId = normalizeSiteId(line.site_id);
  const entryDate = parseTypedDate(line.date);
  const candidates = (siteId && master.bySite.get(siteId)) || [];
  const picked = pickCandidate(candidates, entryDate);
  const next = { ...line, site_id: siteId };
  const manual = (field) => isManual(line[MANUAL_FLAG[field]]);

  if (!picked) {
    if (!manual('job_code')) next.job_code = '';
    if (!manual('contractor')) next.contractor = '';
    if (!manual('period')) next.period = derivePeriod(entryDate, fiscalNewFromYear);
    next.warn = WARN.UNKNOWN_SITE;
    return next;
  }

  // The contractor rides with the job code: a hand-typed JC that exists for this
  // site brings its own contractor and period, not the date-picked row's.
  const chosen = manual('job_code')
    ? candidates.find((c) => sameCode(c.job_code, line.job_code))
    : null;
  const source = chosen || picked;

  if (chosen) next.job_code = chosen.job_code; // canonical spelling from the master
  else if (!manual('job_code')) next.job_code = source.job_code;
  if (!manual('contractor')) next.contractor = source.contractor;
  if (!manual('period')) next.period = source.old_new || derivePeriod(entryDate, fiscalNewFromYear);

  const periods = new Set(candidates.map((c) => c.old_new).filter(Boolean));
  if (periods.size > 1 || source.conflict) next.warn = WARN.CONFLICT;
  else if (!String(next.job_code || '').trim()) next.warn = WARN.MISSING_JOB_CODE;
  else next.warn = WARN.NONE;
  return next;
}

/**
 * The coordinator committed a value in one of the four classification fields.
 * - site_id: a changed site clears every manual flag and re-resolves.
 * - job_code / contractor / period: a typed value becomes a sticky override;
 *   clearing the field hands it back to the master.
 * Committing an unchanged value changes nothing (a blur is not an edit).
 */
export function applyEdit(line, field, rawValue, master, options) {
  if (field === 'site_id') {
    const siteId = normalizeSiteId(rawValue);
    if (siteId === normalizeSiteId(line.site_id)) return resolveLine(line, master, options);
    return resolveLine(
      { ...line, site_id: siteId, jc_manual: false, contractor_manual: false, period_manual: false },
      master,
      options,
    );
  }

  const flag = MANUAL_FLAG[field];
  if (!flag) throw new Error(`Not a classification field: ${field}`);
  const value = field === 'period' ? normalizePeriod(rawValue) : String(rawValue === null || rawValue === undefined ? '' : rawValue).trim();
  if (value !== '' && value === String(line[field] || '')) return resolveLine(line, master, options);
  return resolveLine({ ...line, [field]: value, [flag]: value !== '' }, master, options);
}

/* ---------- Small helpers ---------- */

export function normalizePeriod(value) {
  const p = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return p === 'old' || p === 'new' ? p : '';
}

export function isManual(flag) {
  return flag === true || String(flag).toLowerCase() === 'true';
}

export function isConflictSet(value) {
  if (value === true) return true;
  return UNSET_CONFLICT.indexOf(String(value === null || value === undefined ? '' : value).trim().toLowerCase()) === -1;
}

function sameCode(a, b) {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}
