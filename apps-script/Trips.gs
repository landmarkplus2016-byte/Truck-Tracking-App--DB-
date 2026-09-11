/**
 * Trips.gs — the Trips tab.
 *
 *   list_coordinators          — auto-detected coordinator names (rule 31)
 *   list_trips_by_day {date?}  — one day's trips with their lines, for the Trips-by-day editor
 *   save_trip {trip_id, labor, park, truck, hotel, sites[]}
 *
 * save_trip is the ONLY place money or a trip's site list changes (rules 9, 11). It re-splits
 * the trip's lines evenly (rule 10) and clears every approval on the trip (rule 12).
 */

const TRIP_COSTS = ['labor', 'park', 'truck', 'hotel'];
const TRIPS_ACTOR = 'trips_by_day';
const MAX_TRIP_SITES = 50;
const MAX_COST = 1e9;

/** list_coordinators — the distinct coordinator names present in Trips (CLAUDE.md rule 31), A→Z. */
function listCoordinators_() {
  const seen = {};
  readColumn(SHEET.TRIPS, 'coordinator').forEach(function (value) {
    const name = String(value === null || value === undefined ? '' : value).trim();
    if (name) seen[name] = true;
  });
  return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b); });
}

/* ---------- Read ---------- */

/**
 * list_trips_by_day {date?} — that day's trips, each with its lines, by trip id.
 * No date → the latest day that has trips. prev_date / next_date are the nearest days
 * with trips on either side ('' when there is none), for stepping through days.
 */
function listTripsByDay_(payload) {
  const tz = spreadsheetTz_();
  const trips = readObjects(SHEET.TRIPS).filter(function (t) { return cleanText_(t.trip_id) !== ''; });
  const dayMap = {};
  trips.forEach(function (t) {
    t.date = toIsoDate_(t.date, tz) || cleanText_(t.date);
    if (t.date) dayMap[t.date] = true;
  });
  const days = Object.keys(dayMap).sort();

  const asked = cleanText_(payload.date);
  const date = asked ? toIsoDate_(asked, tz) : (days[days.length - 1] || '');
  if (asked && !date) throw appError_('bad_request', 'Not a date: ' + asked);

  const linesByTrip = {};
  const dayTrips = trips.filter(function (t) { return t.date === date; });
  dayTrips.forEach(function (t) { linesByTrip[cleanText_(t.trip_id)] = []; });
  readObjects(SHEET.LINES).forEach(function (l) {
    const bucket = linesByTrip[cleanText_(l.trip_id)];
    if (bucket) bucket.push(publicLine_(l));
  });

  return {
    date: date,
    prev_date: days.filter(function (d) { return d < date; }).pop() || '',
    next_date: days.filter(function (d) { return d > date; })[0] || '',
    trips: dayTrips
      .map(function (t) { return publicTrip_(t, linesByTrip[cleanText_(t.trip_id)]); })
      .sort(function (a, b) { return a.trip_id.localeCompare(b.trip_id); }),
  };
}

/* ---------- Structure & money ---------- */

/**
 * save_trip — writes the four costs and the site list, then rebuilds the trip's lines:
 * one per site, split evenly with the remainder on the last site (mirror of explode.js).
 *
 * - A site still on the trip keeps its classification (JC, contractor, period, overrides).
 * - An added site starts unclassified, warn = unknown_site, for the coordinator to fill.
 * - Every coord_approved / pm_approved line on the trip reverts to pending (rule 12);
 *   a returned line stays returned with its note.
 * - A trip with an exported line is locked (rule 19): trip_locked.
 * - Saving the same money and sites changes nothing and reverts nothing.
 */
function saveTrip_(payload) {
  const tripId = cleanText_(payload.trip_id);
  if (!tripId) throw appError_('bad_request', 'Missing trip_id');
  const costs = {};
  TRIP_COSTS.forEach(function (key) { costs[key] = costOf_(payload[key], key); });
  const sites = sitesOf_(payload.sites);

  return withScriptLock(function () {
    const trip = readObjects(SHEET.TRIPS).filter(function (t) { return cleanText_(t.trip_id) === tripId; })[0];
    if (!trip) throw appError_('trip_not_found', 'No trip ' + tripId);
    trip.date = toIsoDate_(trip.date, spreadsheetTz_()) || cleanText_(trip.date);

    const oldLines = readObjects(SHEET.LINES)
      .filter(function (l) { return cleanText_(l.trip_id) === tripId; })
      .sort(function (a, b) { return siteIndexOf_(a.line_key) - siteIndexOf_(b.line_key); });
    if (oldLines.some(function (l) { return cleanText_(l.status) === LINE_STATUS.EXPORTED; })) {
      throw appError_('trip_locked', tripId + ' has exported lines and is locked');
    }

    const sameMoney = TRIP_COSTS.every(function (key) { return toMoney_(trip[key]) === costs[key]; });
    const sameSites = parseSites(trip.sites).join('/') === sites.join('/') && oldLines.length === sites.length;
    if (sameMoney && sameSites) {
      return { trip: publicTrip_(trip, oldLines.map(publicLine_)), reverted: 0, unchanged: true };
    }

    const now = nowIso_();
    TRIP_COSTS.forEach(function (key) { trip[key] = costs[key]; });
    trip.sites = sites.join('/');
    trip.updated_at = now;
    trip.updated_by = TRIPS_ACTOR;
    const lines = resplitLines_(trip, oldLines, now);
    const reverted = oldLines.filter(function (l) { return APPROVED_STATUSES.indexOf(cleanText_(l.status)) !== -1; }).length;

    updateObjects(SHEET.TRIPS, [trip]);
    // Reuse the trip's existing rows, then append or delete the difference.
    // Deletes run last and bottom-up, so no row number is used after it moves.
    const reused = Math.min(oldLines.length, lines.length);
    for (let i = 0; i < reused; i++) lines[i]._row = oldLines[i]._row;
    updateObjects(SHEET.LINES, lines.slice(0, reused));
    appendObjects(SHEET.LINES, lines.slice(reused));
    deleteRows(SHEET.LINES, oldLines.slice(reused).map(function (l) { return l._row; }));

    return { trip: publicTrip_(trip, lines.map(publicLine_)), reverted: reverted, unchanged: false };
  });
}

/**
 * The trip's new lines, one per site. Each new site is matched to an old line of the same
 * site — the same position first, then the first unused one — so a removed or inserted site
 * never hands its classification to a neighbour.
 */
function resplitLines_(trip, oldLines, now) {
  const parts = explodeTrip(trip);
  const matchOf = [];
  const used = {};
  parts.forEach(function (part, i) {
    if (oldLines[i] && normalizeSiteId(oldLines[i].site_id) === part.site_id) {
      matchOf[i] = i;
      used[i] = true;
    }
  });
  parts.forEach(function (part, i) {
    if (matchOf[i] !== undefined) return;
    for (let j = 0; j < oldLines.length; j++) {
      if (!used[j] && normalizeSiteId(oldLines[j].site_id) === part.site_id) {
        matchOf[i] = j;
        used[j] = true;
        return;
      }
    }
  });

  return parts.map(function (part, i) {
    const old = matchOf[i] === undefined ? null : oldLines[matchOf[i]];
    const returned = Boolean(old) && cleanText_(old.status) === LINE_STATUS.RETURNED;
    return {
      line_key: trip.trip_id + ':' + i,
      trip_id: trip.trip_id,
      date: trip.date,
      coordinator: cleanText_(trip.coordinator),
      site_id: part.site_id,
      job_code: old ? cleanText_(old.job_code) : '',
      contractor: old ? cleanText_(old.contractor) : '',
      period: old ? cleanText_(old.period) : '',
      jc_manual: old ? flagOf_(old.jc_manual) : false,
      contractor_manual: old ? flagOf_(old.contractor_manual) : false,
      period_manual: old ? flagOf_(old.period_manual) : false,
      route: trip.route,
      driver: trip.driver,
      split_cost: part.split_cost,
      warn: old ? cleanText_(old.warn) : 'unknown_site',
      status: returned ? LINE_STATUS.RETURNED : LINE_STATUS.PENDING,
      approved_by_coord: '',
      approved_coord_at: '',
      approved_pm_at: '',
      return_note: returned ? cleanText_(old.return_note) : '',
      export_batch_id: '',
      exported_at: '',
      updated_at: now,
      updated_by: TRIPS_ACTOR,
    };
  });
}

/* ---------- Helpers ---------- */

/** A trip row → what the client sees: typed costs, the site list, the total, and its lines. */
function publicTrip_(t, lines) {
  const trip = {
    trip_id: cleanText_(t.trip_id),
    date: cleanText_(t.date),
    coordinator: cleanText_(t.coordinator),
    driver: t.driver === null || t.driver === undefined ? '' : String(t.driver), // verbatim (rule 22)
    route: t.route === null || t.route === undefined ? '' : String(t.route),
    sites: parseSites(t.sites),
    week: cleanText_(t.week),
    updated_at: cleanText_(t.updated_at),
    updated_by: cleanText_(t.updated_by),
  };
  TRIP_COSTS.forEach(function (key) { trip[key] = toMoney_(t[key]); });
  trip.total = tripTotal(trip);
  trip.lines = (lines || []).slice().sort(compareLines_);
  trip.approved = trip.lines.filter(function (l) { return APPROVED_STATUSES.indexOf(l.status) !== -1; }).length;
  trip.exported = trip.lines.filter(function (l) { return l.status === LINE_STATUS.EXPORTED; }).length;
  return trip;
}

/** A typed cost → a number (0 when blank). Negative, non-numeric or absurd → bad_trip. */
function costOf_(value, key) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(toLatinDigits_(value).replace(/[,\s]/g, ''));
  if (!isFinite(n) || n < 0 || n > MAX_COST) throw appError_('bad_trip', key + ' must be a number, 0 or more');
  return Math.round(n * 100) / 100;
}

/** sites[] → normalised site ids, blanks dropped. At least one; none may contain '/'. */
function sitesOf_(value) {
  if (!Array.isArray(value)) throw appError_('bad_trip', 'sites must be a list');
  value.forEach(function (site) {
    if (String(site === null || site === undefined ? '' : site).indexOf('/') !== -1) {
      throw appError_('bad_trip', 'A site ID cannot contain "/"');
    }
  });
  const sites = parseSites(value);
  if (!sites.length) throw appError_('bad_trip', 'A trip needs at least one site');
  if (sites.length > MAX_TRIP_SITES) throw appError_('bad_trip', 'Too many sites on one trip');
  return sites;
}

function flagOf_(value) {
  return value === true || String(value).toLowerCase() === 'true';
}
