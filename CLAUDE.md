# CLAUDE.md — Trucks Tracking
> This file is Claude Code's persistent memory for this project.
> Read this at the start of every session before writing any code.

---

## What We Are Building

A web app that replaces the Google Form + Google Sheet workflow used to cost the fleet's daily truck trips. A warehouse rep still enters each trip on the existing **Google Form**. From there the app takes over: it splits every trip into its sites, auto-fills each site's Job Code, contractor, and Old/New period from an uploaded master, routes the trip to the right coordinator's page for review, and — once the coordinators and then the PM have approved line by line — extracts the finance Excel files for the in-house teams and for each contractor.

- **Warehouse rep:** stays on the **Google Form**. Enters one trip (date, coordinator, sites, route, driver, and the four costs). Never opens the app.
- **Coordinators (several):** each has his **own page** in the app, listing the trips routed to him, exploded one row per site with JC / contractor / period auto-filled. He reviews, corrects the classification, and approves line by line. No login — he identifies himself by a name typed on his page, stamped on what he approves.
- **PM:** sees every coordinator-approved line consolidated, approves line by line (the final gate), watches a totals + per-item dashboard, and generates the export files.
- **Admin (project owner):** the only password-protected area. Uploads the Site-JC master and edits config. Has direct Google Sheet and Apps Script access; nobody else does.
- Hosted on **GitHub Pages** (static site — no server).
- **Google Sheets** as the sole database, reached through a **single Google Apps Script Web App**.
- **No Firebase. No npm. No build tools. No frameworks.** Pure HTML, CSS, and vanilla JavaScript. Third-party libraries (xlsx-js-style) via CDN only.

> This app is **unauthenticated by design** (see Governance). It is an internal tool for a known handful of people. The one password guards the Admin area only.

---

## What's Different From the Old Sheet

This is not a digitised copy of the workbook. It is a rebuild of the *workflow* the giant Google-Sheets array formula was carrying.

| Concern | Old Form + Sheet | Trucks Tracking (this repo) |
|---|---|---|
| Trip entry | Google Form → responses sheet | **Unchanged** — same Google Form |
| Per-site cost | One `=LET/REDUCE/MAKEARRAY` spill formula | Plain JS: explode each trip, split the total evenly per site |
| Job Code | Reverse-looked-up in the sheet | Rep no longer types it; auto-filled from the master by Site ID |
| Contractor & Old/New | `VLOOKUP` on `Site-JC` into ExcelData | Auto-filled per site from the uploaded master; contractor rides with the picked JC |
| Coordinator review | Edits happen by hand in the sheet | Each coordinator gets his own page; edits the four classification fields, approves per line |
| PM sign-off | A typed "approved" in a column | Per-line approval, the final gate before export |
| Fixing a wrong amount | Edit a cell, hope the spill recovers | Fix it on the **Trips by day** page; the per-site split recalculates automatically |
| Finance output | Manual copy / filter / save | App extracts **In-House Old**, **In-House New**, and **one file per contractor**, and stamps rows so nothing settles twice |
| Double-settlement | Caught (or missed) by eye | Server-side dedup: an exported row is never pulled into a second file |

The old Form + Sheet stays in use until the app reaches parity. The Form itself is kept forever — it is still the front door.

---

## Tech Stack — Plain HTML/CSS/JS, No Build Tools

Intentionally framework-free and build-tool-free, exactly like Settlement Checker and the other LMP tools:

- **No npm, no package.json, no node_modules, no bundler.**
- **No React, no Vue, no framework** — UI is plain JS functions that return HTML strings (template literals) inserted via `innerHTML`.
- **No Tailwind** — plain CSS files using CSS custom properties (design tokens) in `css/tokens.css`.
- **Third-party libs via CDN only** — **xlsx-js-style** (the `XLSX` global) via a pinned `<script src="https://cdn...">` in `index.html`. It is SheetJS with cell styling; the free SheetJS build drops fonts/fills/borders on write, which the finance files need. Same API, so both the export and the master import run on it.
- **Routing** — hash-based (`#/coordinator/<name>`, `#/trips`, `#/pm/approvals`, `#/pm/dashboard`, `#/pm/export`, `#/admin`), read from `location.hash`.
- **i18n** — English only for now, but every visible string still goes through `t('key')` against `en.js`, so Arabic can be added later without a rewrite. Data (routes, driver names) is Arabic and rendered as-is.
- **Backend** — a single Google Apps Script Web App deployment, reached only through `js/api.js`.

### Deployment

GitHub Pages serves the repo root directly. No build, no `gh-pages` branch, no `dist/`. Editing a file and pushing to `main` is the entire deploy. The Apps Script is deployed once from the Apps Script editor; its Web App URL lives in `localStorage` as `tt_script_url` on each device — **never in code, never committed**.

**Bump `APP_VERSION` in `service-worker.js` in the same push.** A browser only checks the worker file for changes, so that one line is what tells an already-open app a new version exists; `js/updates.js` then offers a Reload button. Forgetting the bump ships the files and tells nobody.

---

## Who Uses What — Quick Reference

| Area | Who | Sees | Can do |
|---|---|---|---|
| Google Form | Warehouse rep | — | Enters a trip. Never opens the app. |
| Coordinator page | Each coordinator | Only trips routed to him | Edit the four classification fields per line; approve/select-all. Stamps his typed name. |
| Trips by day | Anyone (open) | All trips for a chosen day | Fix a trip's money; add/remove a site. Re-splits automatically. |
| PM pages | The PM | All coordinator-approved lines | Final per-line approval; dashboard; generate export files. |
| Admin | Project owner | Master + config | Upload the Site-JC master; edit config. **Password-gated.** |

> Nobody except the project owner opens a Google Sheet directly. Everyone else uses the app or the Form. The Sheets are a silent database.

---

## Non-Negotiable Rules

Everything downstream depends on these. Never break one without confirming with the project owner.

### Backend and data

1. **Never call Google Sheets directly from the frontend.** All reads/writes go through `js/api.js` → Apps Script. No exceptions.
2. **The Apps Script URL is never in code.** It lives in `localStorage.tt_script_url`, set on each device's first launch. Never committed.
3. **No Sheet ID ever leaves the Apps Script.** The frontend never knows a spreadsheet ID.
4. **There is no login and no user table.** The app is open. Coordinators are *identified*, not *authenticated*: a coordinator picks/types his name on his page, and it is stamped on what he approves. Do not build sessions, tokens, or passwords for anyone except Admin.
5. **The Admin password is the one gate, and it is checked server-side.** `upload_sitelookup` and `save_config` require an admin-password hash in the payload; the handler compares it to `admin_password_hash` in Config before doing anything. Hiding the Admin page in the UI is for UX; the server is the gate. Every other action is open.
6. **The Google Form is the only entry point for trips.** The app never creates a trip from scratch. It reads what the Form produced.
7. **Raw Form responses are immutable.** The on-submit trigger copies each response into the **Trips** sheet; all human corrections happen there. Never write back to the Form's response tab.
8. **Every write sets `updated_at` / `updated_by` server-side**, never trusted from the client. Same for `approved_*` and `exported_at`.

### The trip → line model (the heart of the app)

9. **Money and the site list live on the trip, nowhere else.** A **trip** is one Form submission: a date, a coordinator, a driver, a route, a `/`-joined list of sites, and four costs — `labor`, `park`, `truck`, `hotel`. The trip total is their sum. Per-site cost is **derived**, never stored as an editable figure.
10. **A trip explodes into one line per site.** The trip total is **split evenly** across its sites — `round(total / n)` each, with the rounding remainder on the **last** site so the lines re-sum to the trip exactly. Only money is split; nothing else.
11. **Structure vs classification is a hard split of ownership.**
    - **Structure** — *which sites a trip has, and how much money* — is owned by the **Trips by day** page only. Adding/removing a site and editing the four cost fields happen there.
    - **Classification** — *what each existing site is*: `site_id`, `job_code`, `contractor`, `period` — is owned by the **coordinator's page**. He can correct these four fields on the lines that exist; he **cannot** change the number of sites (Option A).
12. **Any structure or money change on a trip re-splits its lines and reverts that trip's approvals to pending.** Changing a cost, adding a site, or removing a site clears every `coord_approved` / `pm_approved` on that trip's lines. A number can never change under an already-signed-off line.
13. **`period` and `contractor` come from the Site-JC master, not free typing.** When a line's `site_id` resolves against the master, its `job_code`, `contractor`, and `period` auto-fill. The coordinator may override any of them per line (a manual override is sticky until he clears it or changes the site id).
14. **The master's Old/New wins for a matched site; derivation is only the unknown-site fallback.** ⚠️ **This deliberately differs from Settlement Checker.** There, `period` is always derived from the task date and the file's Old/New column is ignored. Here the master (`Site ID-JC`, `Task Date`, `Old/New`, `Contractor`, `Conflict`) is authoritative: a matched candidate's stored `Old/New` and `Contractor` are used as-is. The `fiscal_new_from_year` rule (year ≥ it → `new`) applies **only** when a site is not in the master at all. A site that appears in both periods (or is flagged in the master's `Conflict` column) is surfaced **amber** for the coordinator to decide; it never blocks.
15. **The resolver runs client-side, off a cached master, on the row's own date.** See Section 6.2. The on-submit trigger only explodes the trip (site + split cost, classification blank) and routes it; JC/contractor/period fill in the coordinator's grid when he opens it. A master re-upload therefore shows up the next time a grid is opened, and server and client never disagree.

### Approvals

16. **Approval is per line, with a select-all, at both stages.** Coordinator approves his lines (stamped with his typed name); the PM then approves line by line (the final gate). Either can select-all.
17. **The status machine is `pending → coord_approved → pm_approved → exported`, with `returned` as a side branch.**
    - Coordinator **approves** a `pending` line → `coord_approved` (stamps `approved_by_coord`, `approved_coord_at`).
    - PM **approves** a `coord_approved` line → `pm_approved` (stamps `approved_pm_at`).
    - PM **returns** a line with a note → `returned` (visible on the coordinator's page).
    - Export **commits** `pm_approved` rows → `exported`.
18. **Editing a classification field on an approved line reverts that line to `pending`.** Same principle as rule 12, one line at a time.
19. **An `exported` line is locked.** No edits, no re-approval, no second export. This is the dedup guarantee.

### Export and dashboard

20. **Export produces two in-house files and one per contractor.** In-House → **two** files, **Old** and **New**. Each external contractor → **one** file, all periods combined. Pulls only `pm_approved`, not-yet-`exported` rows.
21. **Each file is a daily brief then its per-site detail then a total.** Group by day/trip: a brief line (date, route, driver, trip total), the site rows beneath it, and a file total at the end. This is the layout the PM asked for.
22. **A driver can be excluded from a run.** Exclusion is by the driver string **exactly as the rep typed it** (name + vehicle are one field and carry meaning — never parse or split it). Excluded rows are simply not stamped `exported`; they stay available for a later run. Exclusion is a filter, never a delete.
23. **Committing an export is server-side and atomic** — re-select the same predicate and stamp `exported` in one pass, so two runs can't double-settle a row.
24. **The dashboard reads components from the trip and totals from the lines.** Labor / Truck / Hotel / Park are trip-level, so they slice by coordinator, week, date, and driver — **not** by contractor or Old/New (one trip can straddle In-House and a contractor). Contractor and Old/New slice the **totals** only. Do not invent a per-contractor component breakdown.

### Frontend architecture

25. **No backend calls from any file except `js/api.js`.** Pages call `api.call('action', payload)`.
26. **Hash-router only.** GitHub Pages has no server routing.
27. **One file, one job.** See the File Map (Section 10.1).
28. **All UI text through `t('key')`.** Every key exists in `en.js` (Arabic added later).
29. **No hardcoded hex outside `css/tokens.css`.** Reference the CSS variable.

### Governance

30. **The app is unauthenticated by design.** The Apps Script URL is the only secret and is kept out of code. Admin actions are password-gated server-side. Accept this posture deliberately for an internal tool; do not bolt on a login without confirming with the project owner.
31. **Coordinators are auto-detected from the data.** The sidebar lists the distinct `coordinator` values present in the trips. To add a coordinator, add his name to the **Google Form's** coordinator dropdown — his page appears on his first submission. An optional Config list may hide or rename someone later, but detection is the default.
32. **Never add a feature not in this file without confirming with the project owner.**

---

## Non-Goals (Explicit)

- **No change to the Google Form.** The rep's entry surface stays exactly as it is. The app reads its output.
- **No login / users / sessions / roles** beyond the single Admin password. Approvals are name-stamped, not authenticated.
- **No component-level contractor or Old/New breakdown** on the dashboard (rule 24).
- **No offline data editing.** The app shell is a PWA (installable, cached), but reads and writes need connectivity. Coordinators and the PM work at a desk.
- **No driver-name parsing.** The driver string is stored and shown verbatim.
- **No real-time collaboration.** Two people editing the same trip is last-write-wins.
- **No notifications.** People check the app.
- **No file storage.** The only files produced are the finance `.xlsx` downloads.

---

# Section 2 — Google Sheets Schema

## Design principles

- One workbook, **Trucks Tracking DB**. No per-coordinator sheets (there is no isolation requirement without login).
- The Form is bound to this workbook's **Form Responses 1** tab. Everything else is written by Apps Script.
- Keys are `snake_case`. Dates are ISO (`YYYY-MM-DD`). Money is a plain number, EGP.

## 2.1 `Form Responses 1` — form-bound, immutable

Exactly the Form's output. Do not edit or reorder; the Form owns it.
`timestamp, date, site_rep, coordinator, sites, route, driver, labor, park, truck, hotel, week` (no job code — the rep no longer enters it).

## 2.2 `Trips` — the mutable working copy (Trips by day edits this)

One row per submission, seeded from `Form Responses 1` by the on-submit trigger, then human-corrected.
`trip_id, source_row, date, coordinator, driver, route, sites, labor, park, truck, hotel, week, month, year, updated_at, updated_by`
- `sites` is the authoritative `/`-joined site list (structure lives here).
- `trip_id` is stable (`T-00001`…), assigned once, never reused.

## 2.3 `Lines` — the exploded per-site working table (coordinator + PM read this)

One row per (trip × site), created by explode; classification filled in the grid.
`line_key (trip_id + ':' + site_index), trip_id, date, coordinator, site_id, job_code, contractor, period, jc_manual, contractor_manual, period_manual, route, driver, split_cost, warn, status, approved_by_coord, approved_coord_at, approved_pm_at, return_note, export_batch_id, exported_at, updated_at, updated_by`
- `split_cost` is server-computed (rule 10), never a client figure.
- `warn` ∈ `{'', unknown_site, conflict, missing_job_code}`.
- `status` ∈ `{pending, coord_approved, pm_approved, returned, exported}`.

## 2.4 `SiteLookup` — the master the Admin uploads

As uploaded (`SiteID_JC_New.xlsx` → tab `Tracking`):
`site_jc ("Site ID-JC"), task_date, old_new, contractor, conflict`
- The key is combined; parse on the hyphen into `site_id` + `job_code` (neither ever contains a hyphen — confirmed). A site may repeat (several job codes over time).
- Replaced wholesale on upload.

## 2.5 `Config` — key/value

`app_name=Trucks Tracking, company_name, fiscal_new_from_year=2026, export_default=weekly, admin_password_hash, contractors=In-House/El-Khayal/LM+, coordinator_overrides` (optional hide/rename map).

## 2.6 `ExportLog`

`export_batch_id, generated_at, generated_by, scope (week or date range), excluded_drivers, files, row_count`.

---

# Section 3 — Apps Script API Surface

## 3.1 Transport and envelope

`doPost` receives `{action, payload}`; returns `{ok, data}` or `{ok:false, error}`. No session token (open app). Admin actions carry `admin_pw_hash` in the payload.

## 3.2 Read (open)

- `get_config` — app config (no secrets; never returns `admin_password_hash`).
- `get_sitelookup` — the master, for client-side caching by the resolver.
- `list_lines {coordinator?}` — lines, filtered to a coordinator for his page, or all for the PM.
- `list_trips_by_day {date}` — trips + their derived lines for the editor.
- `list_coordinators` — distinct coordinator values (for the sidebar).

## 3.3 Trips — structure & money (open)

- `save_trip {trip_id, labor, park, truck, hotel, sites[]}` — writes the trip, **re-splits** its lines server-side, reverts that trip's approvals (rule 12), returns the refreshed lines.

## 3.4 Coordinator (open)

- `save_line_classification {line_key, site_id?, job_code?, contractor?, period?, *_manual}` — per-line edit; if the line was approved it reverts to `pending` (rule 18).
- `approve_lines_coord {keys[], reviewer_name}` — stamps `coord_approved` + the typed name.

## 3.5 PM (open)

- `approve_lines_pm {keys[]}` — `coord_approved` → `pm_approved`.
- `return_lines {keys[], note}` → `returned`.
- `dashboard_query {scope}` — aggregates (totals + components + slices).

## 3.6 Export (open to run, atomic to commit)

- `export_query {scope, excluded_drivers[]}` — preview: the files and their rows, no writes.
- `export_commit {scope, excluded_drivers[]}` — claim-then-build: stamps `pm_approved` rows `exported` in one pass, writes `ExportLog`, returns the file datasets.

## 3.7 Admin — password-gated

- `upload_sitelookup {rows[], admin_pw_hash}` — replaces `SiteLookup`.
- `save_config {config, admin_pw_hash}`.

## 3.8 Cross-cutting rules

- Server computes every split and every audit field; the client never sends `split_cost`, `status`, or a timestamp.
- Admin handlers verify `admin_pw_hash` against Config first, or return `forbidden`.
- `save_trip` and `export_commit` run under a script lock (re-entrant) so concurrent calls can't double-split or double-settle.

---

# Section 4 — No Auth; the Admin Password

- **No sessions, no user table.** The app loads straight into the coordinator sidebar.
- **Identity is a name, not a credential.** The coordinator's "Reviewing as" name is stamped on approvals. It is convenience, not security.
- **Admin unlock:** the Admin page prompts for a password; the client SHA-256-hashes it and sends the hash with `upload_sitelookup` / `save_config`. The hash is held in memory for the tab's lifetime, never stored, never committed. The server compares it to `admin_password_hash`.
- Set/rotate the admin password by writing a new SHA-256 hex into `Config.admin_password_hash` (a tiny one-off helper in Admin.gs can hash a value for you).

---

# Section 5 — App Structure

## 5.1 One shell, page areas

A single shell renders a sidebar (auto-detected coordinators, PM pages, Trips by day, Admin) and a content host. No role gating — every area is reachable; Admin prompts for its password on entry.

## 5.2 Routing

Hash-based: `#/coordinator/<name>`, `#/trips`, `#/pm/approvals`, `#/pm/dashboard`, `#/pm/export`, `#/admin`. `router.js` maps hash → render function.

## 5.3 Rendering

Plain functions returning HTML strings via `innerHTML`; events bound after insert (`bind*`). The approved visual reference is `design/Trucks_Tracking_Prototype.html` — match its look exactly.

---

# Section 6 — Core Logic

## 6.1 The status machine

`pending → coord_approved → pm_approved → exported`, `returned` as a side branch (rule 17). Structure/money change reverts a trip's lines to `pending` (rule 12); a classification edit reverts one line (rule 18); `exported` is terminal (rule 19).

## 6.2 The resolver — `js/utils/resolve.js` (client-side)

Reuses the agreed `pickCandidate` logic. Fetch `get_sitelookup` **once per session** (a shared in-flight promise); invalidate on admin edit.
- **Index:** parse each master key `SITE-JC` on the hyphen → `site_id`, `job_code`. Uppercase `site_id`. Group rows by `site_id`; sort candidates **newest `task_date` first**, undated last. Each candidate carries `job_code`, `task_date`, `old_new`, `contractor`, `conflict`.
- **pickCandidate(candidates, entryDate)** where `entryDate` is **the row's own trip date**, never a batch year:
  1. empty → `null`;
  2. first candidate with `task_date <= entryDate`;
  3. else the last dated candidate (earliest);
  4. else `candidates[0]` (newest).
- **On a match:** fill `job_code`, `contractor`, and `period = old_new` **from the master** (rule 14). If the site's candidates span both periods, or the picked row's `conflict` is set → `warn = conflict` (amber).
- **On no match:** leave `job_code`/`contractor` blank (`warn = unknown_site`, amber, non-blocking); `period` falls back to `year(entryDate) >= fiscal_new_from_year ? 'new' : 'old'`.
- **Manual overrides are sticky:** editing `job_code`/`contractor`/`period` by hand sets its `*_manual` flag; the resolver won't overwrite a manual value. Clearing it hands control back. Changing `site_id` clears the manual flags and re-resolves. Resolve **on blur/commit, not per keystroke**, and push values into the row without a full re-render (keep the caret).

## 6.3 Per-site explosion & split — `js/utils/explode.js`

`explode(trip)`: `n = sites.length`, `total = labor+park+truck+hotel`, `base = round(total/n)`; each site gets `base` except the **last**, which gets `total - base*(n-1)`. Money only. Mirrored server-side in `save_trip` and on ingest — the client preview and the server must agree exactly.

## 6.4 Trips by day — the editor

Pick a day → its trips as cards: the four cost fields (live total), and the site list with add/remove. Editing costs → **Save money change** persists and re-splits. Add/remove a site → applies and re-splits (a new site starts unclassified, `warn = unknown_site`, for the coordinator to fill). Either path reverts that trip's approvals (rule 12).

## 6.5 The coordinator grid

Lines for one coordinator, grouped by trip (brief head + per-site rows). Editable: `site_id`, `job_code`, `contractor`, `period` (rule 11). Cost is read-only. Warnings show amber. Per-line **Approve** + **Select all**, stamped with the "Reviewing as" name. No add/remove of sites here.

---

# Section 7 — Export and the Files

## 7.1 The files

From `pm_approved`, not-yet-`exported` rows in scope:
- **In-House — Old** and **In-House — New** (two files, split by `period`).
- **One file per external contractor** (e.g. `El-Khayal`, `LM+`), all periods.

## 7.2 Layout — daily brief → per-site detail → total

Group rows by trip within each file: a **brief** line (date · route · driver · trip total), the **site** rows under it (site, JC, route, period, cost), and a **file total** at the end. Built with xlsx-js-style so the styling survives the write.

## 7.3 Selection & driver exclusion

Scope is a **week** (default) or a **date range**. Any driver can be excluded, matched by the exact typed string (rule 22). Preview (`export_query`) shows the files and rows; nothing is written until commit.

## 7.4 Dedup and the log

`export_commit` re-selects the predicate and stamps `exported` atomically (rule 23); excluded rows are left `pm_approved` and reappear in the next run. `ExportLog` records each run.

---

# Section 8 — Dashboard (PM)

Totals + per-item cards (Labor / Truck / Hotel / Park) from trip-level figures; a **by-coordinator** and **by-contractor** breakdown; slices by week / date / coordinator / driver. Per rule 24, component figures are **not** offered per contractor or per period — those cut the totals only. State the boundary in the UI (as the prototype does) so it never reads as a missing feature.

---

# Section 9 — i18n, RTL, and Design System

## 9.1 i18n

English only now. Every visible string goes through `t('key')` against `en.js`; `ar.js` is added later with no code change. Data (routes, drivers) is Arabic and rendered verbatim with `dir="auto"` on its cell so it displays correctly inside the English UI.

## 9.2 RTL

The chrome is LTR English for now. Prefer logical CSS properties anyway (`margin-inline-start`, not `margin-left`) so a later Arabic pass can flip the shell without a rewrite.

## 9.3 Design tokens — `css/tokens.css`

Same house look as Settlement Checker (so the family reads as one). ALL colors/radii/shadows live here; reference the variable, never a raw hex.

```
--navy:#0f1942;  --primary:#3d5af1;  --primary-hover:#2d47d4;
--bg:#faf9f5;    --surface:#ffffff;  --border:#e2e4ed;
--text:#1a1d2e;  --text-2:#4a5a72;   --muted:#9095b0;
--old-bg:#fef3c7; --old-fg:#92400e;  /* Old = amber  */
--new-bg:#dbeafe; --new-fg:#1e40af;  /* New = blue   */
--success:#15803d; --warning-strong:#92400e; --danger:#991b1b;
--r-md:8px; --r-lg:12px; --sh-sm:0 1px 2px rgba(16,24,64,.05);
--font:'Segoe UI',system-ui,-apple-system,'Tahoma',sans-serif;
```

## 9.4 Components

`sidebar` (auto-detected coordinators + PM + Trips + Admin lock), `table`/grid, `badge` (period, contractor, status, warn), `modal`, `toast`, `brandMark`.

---

# Section 10 — File Map, Naming, What NOT to Do

## 10.1 File map

```
trucks-tracking/
  CLAUDE.md
  BUILD.md
  index.html
  manifest.json
  service-worker.js
  icons/  icon-192.png  icon-512.png  maskable-512.png  apple-touch-icon.png
  assets/ lmp-logo-white.png  app-background.jpg
  design/
    Trucks_Tracking_Prototype.html   # approved visual reference (read-only)
  css/
    tokens.css        # ALL colors/radii/shadows
    base.css  components.css  grid.css  template.css  print.css
  js/
    main.js           # boot: script url, get_config, route
    router.js
    api.js            # the ONLY file that calls Apps Script
    state.js          # in-memory: cached master, reviewer name, admin pw hash
    updates.js        # service-worker registration + "new version" prompt
    i18n/  en.js  i18n.js          # ar.js added later
    utils/
      hash.js         # SHA-256 (admin password)
      dates.js        # entryDateOf, parseTypedDate, isoWeek
      money.js  dom.js
      resolve.js      # pickCandidate + master index (Section 6.2)
      explode.js      # per-site even split (Section 6.3)
      xlsx.js         # xlsx-js-style wrappers + cell styling
    components/
      sidebar.js  modal.js  toast.js  badge.js  table.js  brandMark.js
    coordinator/
      page.js         # renderCoordinatorPage (name box + grid host)
      grid.js         # renderGrid + bindGridEvents (classification editing)
      autofill.js     # applies resolve.js to lines on open
      approve.js      # per-line + select-all, name stamp
    trips/
      tripsByDay.js   # renderTripsByDay (day picker + cards)
      tripCard.js     # cost fields + add/remove site + re-split preview
    pm/
      approvals.js    # renderApprovals + approve/return
      dashboard.js    # renderDashboard (totals/components/slices)
      export.js       # renderExport + query/commit + driver exclusion
      exportTemplate.js  # daily-brief → per-site → total sheet builder
    admin/
      adminGate.js    # password prompt + hash in memory
      master.js       # upload SiteLookup
      config.js
  apps-script/
    Main.gs           # doPost dispatcher
    Utils.gs          # entryDateOf, re-entrant withScriptLock
    Sheets.gs         # row helpers, ensureColumns
    Config.gs
    Ingest.gs         # onFormSubmit → seed Trips → explode into Lines
    Trips.gs          # save_trip (re-split + revert)
    Lines.gs          # list_lines, save_line_classification, coord approve
    Pm.gs             # pm approve / return / dashboard_query
    Export.gs         # export_query / export_commit + dedup
    Admin.gs          # upload_sitelookup / save_config (+ password check, hash helper)
```

## 10.2 Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Render functions | camelCase + `render` prefix | `renderCoordinatorPage`, `renderExport` |
| Event binders | camelCase + `bind` prefix | `bindGridEvents` |
| Utilities | camelCase | `explodeTrip`, `pickCandidate`, `divideEven` |
| Sheet column keys | snake_case | `job_code`, `split_cost`, `approved_by_coord` |
| Apps Script actions | snake_case | `save_trip`, `export_commit` |
| Error codes | snake_case | `forbidden`, `bad_admin_pw` |
| i18n keys | snake_case | `approve_selected`, `trips_by_day` |
| CSS classes | kebab-case | `.trip-card`, `.badge-old` |
| localStorage keys | `tt_` prefix | `tt_script_url` |

## 10.3 What NOT to Do

- Do **not** add login, sessions, or a user table (rule 4). Admin password only.
- Do **not** edit the Google Form or its response tab (rules 6, 7).
- Do **not** let the coordinator change a trip's site count or money (rule 11).
- Do **not** store or edit `split_cost` from the client — the server derives it (rule 10).
- Do **not** derive `period` for a matched site — the master wins (rule 14).
- Do **not** parse or split the driver string (rule 22).
- Do **not** offer per-contractor or per-period component figures on the dashboard (rule 24).
- Do **not** call Apps Script from anywhere but `js/api.js` (rule 25).
- Do **not** hardcode a hex outside `tokens.css` (rule 29).
