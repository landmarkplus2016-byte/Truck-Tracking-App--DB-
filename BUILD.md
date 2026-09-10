# BUILD.md — Trucks Tracking
> Your step-by-step manual for building the app from zero to live.
> Work through this top to bottom. Check off every item as you go.
> Never skip a test. Never move to the next stage if a test fails.
> **No npm. No build step. Ever.** Every file is loaded directly by the browser.

---

## Before You Write a Single Line of Code

### One-time setup checklist
- [ ] Create a GitHub repository — name it `trucks-tracking` (private is fine)
- [ ] Enable GitHub Pages: Settings → Pages → Deploy from `main`, root folder
- [ ] Create the workbook Google Sheet — name it `Trucks Tracking DB` — save its URL
- [ ] Keep the existing **Google Form**. Point its responses at `Trucks Tracking DB` (Form → Responses → link to the workbook) so the `Form Responses 1` tab lands there. **Do not change the Form's questions.**
- [ ] Create a new Apps Script project **standalone** (script.google.com → New project) — it opens the workbook by ID, so it is not bound to it
- [ ] Create your project folder locally: `trucks-tracking`
- [ ] Drop `CLAUDE.md` and `BUILD.md` into the root
- [ ] Create a `design/` folder and drop `Trucks_Tracking_Prototype.html` into it (the approved visual reference)
- [ ] Create an `apps-script/` folder (empty — Stage 2 fills it)
- [ ] Open the folder in VS Code and connect it to the GitHub repo
- [ ] **Do not run `npm init`, `npm install`, or any npm command at any point**

### How to preview while building
- VS Code **Live Server** (right-click `index.html` → Open with Live Server), or
- `python -m http.server 8000` from the project root → `http://localhost:8000`

### First message to Claude Code — copy and paste this exactly:
```
Read CLAUDE.md first and confirm you understand the project before writing any code.
Confirm this is a plain HTML/CSS/JS project — no npm, no build tools, no React, no
Tailwind, ever. Confirm the backend is Google Sheets reached only through a single
Apps Script Web App, and that js/api.js is the only frontend file that talks to it.

Open the visual reference in a browser: design/Trucks_Tracking_Prototype.html
Confirm you understand it defines the look (indigo #3d5af1 accent, deep navy #0f1942
structure, warm off-white #faf9f5 background, Old = amber, New = blue).

Describe in your own words:
  - what this app does, and why the warehouse rep never opens it (he stays on the Form)
  - why there is NO login and NO user table — coordinators are identified by a typed
    name, and the ONE password guards only the Admin area, checked server-side
  - a "trip" vs a "line": money and the site list live on the trip; each line is one
    site with the trip total split EVENLY across its sites
  - who owns what: Trips by day owns structure (which sites, how much money); the
    coordinator owns classification (site_id, job_code, contractor, period)
  - why any structure or money change on a trip reverts that trip's approvals to pending
  - how period/contractor auto-fill from the Site-JC master, and why — UNLIKE Settlement
    Checker — the master's Old/New WINS for a matched site (derive only for unknown sites)
  - the status machine: pending → coord_approved → pm_approved → exported, plus returned
  - the outputs: two in-house files (Old, New) + one file per contractor, each laid out
    as a daily brief then per-site detail then a total
  - why an exported row can never be exported again, and how driver exclusion is a filter

Then create the empty folder and file structure exactly as in Section 10.1 of CLAUDE.md.
Empty files only, no code yet. Do not write any logic until I confirm the structure.
```

### After structure is created — verify:
- [ ] All folders exist per CLAUDE.md 10.1: `css/`, `js/i18n/`, `js/utils/`, `js/components/`, `js/coordinator/`, `js/trips/`, `js/pm/`, `js/admin/`, `design/`, `apps-script/`, `icons/`, `assets/`
- [ ] Every file listed in 10.1 exists and is empty
- [ ] `CLAUDE.md`, `BUILD.md` in root; `Trucks_Tracking_Prototype.html` in `design/`
- [ ] No `package.json`, no `node_modules`, no bundler config anywhere
- [ ] No code written yet

---

# Stage 1 — The Google Sheets

**Goal:** `Trucks Tracking DB` has the exact tabs and headers from CLAUDE.md Section 2, the Form is linked, and `SiteLookup` + `Config` are seeded.

**Prompt:**
```
Read CLAUDE.md Section 2. We are on Stage 1.

I have one workbook, 'Trucks Tracking DB', with the Google Form already writing to its
'Form Responses 1' tab. Give me the exact tab list and the exact row-1 headers to paste
into each, in order:
  Trips, Lines, SiteLookup, Config, ExportLog.
(Leave 'Form Responses 1' exactly as the Form made it.)

For SiteLookup, the columns match the uploaded master file:
  site_jc, task_date, old_new, contractor, conflict
and paste a few seed rows so I can test the resolver, including:
  - a site with TWO job codes on different dates (to exercise the date-based picker),
  - one row whose old_new is 'Old' and one 'New' for the same site (a conflict),
  - one contractor row that is NOT In-House (e.g. El-Khayal).

For Config, the initial key/value rows:
  app_name=Trucks Tracking, company_name=Landmark Plus,
  fiscal_new_from_year=2026, export_default=weekly,
  contractors=In-House/El-Khayal/LM+,
  admin_password_hash=  (leave blank; I'll paste a SHA-256 hex in Stage 5)

Do not write any app code. This stage is Sheets setup only.
```

**Tests for Stage 1:**
- [ ] Workbook has `Form Responses 1` (untouched) + `Trips`, `Lines`, `SiteLookup`, `Config`, `ExportLog`
- [ ] Headers match Section 2 exactly
- [ ] `SiteLookup` seeded with a multi-JC site and a conflict site
- [ ] `Config` seeded; `admin_password_hash` blank for now
- [ ] A test Form submission lands a row in `Form Responses 1`

---

# Stage 2 — Apps Script Skeleton + Ingestion

**Goal:** the dispatcher answers, `get_config` works, and a Form submission explodes into `Lines`.

**Prompt:**
```
Read CLAUDE.md Sections 3 and 6.3. We are on Stage 2.

Create in apps-script/:
- Main.gs: doPost {action, payload} → {ok, data} / {ok:false, error}. No session token.
- Utils.gs: entryDateOf, a re-entrant withScriptLock.
- Sheets.gs: row read/write helpers, ensureColumns.
- Config.gs: get_config (never return admin_password_hash).
- Ingest.gs: an onFormSubmit trigger that copies the new response into Trips (assign a
  stable trip_id), then explodes the trip into Lines — one row per site, split_cost by
  EVEN split with the remainder on the last site, classification fields blank, warn/status
  set, coordinator copied from the trip. Mirror explode.js exactly.

Deploy as a Web App (execute as me, anyone with the link). Give me the install steps for
the onFormSubmit trigger.
```

**Tests for Stage 2:**
- [ ] `get_config` returns config and **not** the password hash
- [ ] A new Form submission creates one `Trips` row and N `Lines` rows
- [ ] `split_cost` across a trip's lines re-sums to the trip total exactly
- [ ] A single-site and a multi-site trip both explode correctly

---

# Stage 3 — Frontend Shell (no login)

**Goal:** the app loads straight into the sidebar — auto-detected coordinators, PM pages, Trips by day, Admin — with the reference look.

**Prompt:**
```
Read CLAUDE.md Sections 5, 9, 10. We are on Stage 3. Match design/Trucks_Tracking_Prototype.html.

Build: index.html (pin xlsx-js-style CDN), css/tokens.css (the token block from 9.3),
base.css, components.css. js/main.js (read tt_script_url from localStorage, prompt for it
once if missing, get_config, route). js/api.js (the ONLY caller of Apps Script). js/router.js
(hash routes from 5.2). js/state.js. js/i18n/en.js + i18n.js (t()). components/sidebar.js
building the sidebar from list_coordinators (auto-detected), plus PM pages, Trips by day,
and a lock-badged Admin. NO login screen.
```

**Tests for Stage 3:**
- [ ] App loads to the first coordinator's page, no login
- [ ] Sidebar lists coordinators pulled from the data
- [ ] All hash routes resolve to a stub page
- [ ] Only `api.js` references the script URL; it is not in code

---

# Stage 4 — The Resolver + Master Cache

**Goal:** `resolve.js` reproduces `pickCandidate`, fed by a cached master.

**Prompt:**
```
Read CLAUDE.md Section 6.2. We are on Stage 4.

Build js/utils/resolve.js: fetch get_sitelookup once (shared in-flight promise); build the
index (parse 'SITE-JC' on the hyphen, uppercase site_id, group, sort candidates newest
task_date first). pickCandidate(candidates, entryDate) using the row's own trip date:
first task_date <= entryDate, else last dated, else newest. On match, fill job_code +
contractor + period FROM the master (master's Old/New wins). On no match, warn=unknown_site
and derive period from fiscal_new_from_year. Flag conflict when candidates span both periods
or the picked row's conflict is set. Respect sticky *_manual flags; resolve on blur, not per
keystroke. Add js/utils/dates.js and explode.js (mirror of the server split).
```

**Tests for Stage 4:**
- [ ] Multi-JC site picks the right code for a given trip date; a later date picks a later task
- [ ] Master's Old/New is used verbatim on a match; unknown site derives from fiscal year
- [ ] Conflict site flags `conflict`; unknown site flags `unknown_site`; neither blocks
- [ ] A manual override is not overwritten on re-resolve; changing site_id clears it

---

# Stage 5 — Admin (password-gated): Master upload + Config

**Goal:** upload the Site-JC master and edit config, behind the one password.

**Prompt:**
```
Read CLAUDE.md Sections 3.7 and 4. We are on Stage 5.

Apps Script: Admin.gs with upload_sitelookup {rows[], admin_pw_hash} (replace SiteLookup)
and save_config {config, admin_pw_hash}; both verify admin_pw_hash against Config first.
Include a one-off helper to hash a plaintext so I can paste admin_password_hash into Config.

Frontend: admin/adminGate.js (prompt, SHA-256 via utils/hash.js, hold hash in memory),
admin/master.js (xlsx-js-style read of the uploaded .xlsx → rows → upload_sitelookup, then
invalidate the resolver cache), admin/config.js (fiscal year, contractors, export default,
change admin password). Show the coordinator list as auto-detected with the Form-dropdown note.
```

**Tests for Stage 5:**
- [ ] Wrong password → `forbidden`; correct → upload succeeds
- [ ] Uploading `SiteID_JC_New.xlsx` replaces `SiteLookup`; resolver picks up new values on next grid open
- [ ] Config edits persist; password hash never leaves the server via `get_config`

---

# Stage 6 — The Coordinator Page (the core)

**Goal:** a coordinator sees his trips exploded per site, auto-filled, editable on the four classification fields, and approves per line with his name.

**Prompt:**
```
Read CLAUDE.md Sections 6.5 and rules 11, 13–14, 16–18. We are on Stage 6.

Apps Script: Lines.gs — list_lines {coordinator}, save_line_classification (revert to pending
if the line was approved), approve_lines_coord {keys[], reviewer_name}.

Frontend: coordinator/page.js (the 'Reviewing as' name box + grid host), coordinator/grid.js
(trips grouped as brief head + per-site rows; editable site_id/job_code/contractor/period ONLY;
cost read-only), coordinator/autofill.js (apply resolve.js on open, respecting *_manual),
coordinator/approve.js (per-line + select-all, stamp the name). Amber for unknown_site/conflict.
```

**Tests for Stage 6:**
- [ ] Lines are grouped by trip; cost is read-only; the four fields edit
- [ ] Opening the grid auto-fills JC/contractor/period from the master
- [ ] Editing a field on an approved line reverts it to pending
- [ ] Approve (single + select-all) stamps the typed name and timestamp

---

# Stage 7 — Trips by Day (structure + money)

**Goal:** fix a trip's money or site list; the split recalculates and approvals revert.

**Prompt:**
```
Read CLAUDE.md Sections 6.4 and rules 9–12. We are on Stage 7.

Apps Script: Trips.gs — save_trip {trip_id, labor, park, truck, hotel, sites[]} re-splits the
lines server-side and reverts that trip's coord/pm approvals; returns refreshed lines.

Frontend: trips/tripsByDay.js (day picker → trip cards) and trips/tripCard.js (four cost
fields with a live total; the site list with add/remove; a live re-split preview; 'Save money
change' for costs; add/remove applies immediately). A new site starts unclassified
(warn=unknown_site). Both paths warn that approvals on the trip revert.
```

**Tests for Stage 7:**
- [ ] Changing a cost re-splits the lines and the coordinator page reflects it
- [ ] Removing a site raises each remaining line's cost; adding one lowers them; totals stay exact
- [ ] Any change reverts that trip's approved lines to pending
- [ ] A coordinator still cannot change site count from his own page

---

# Stage 8 — PM Approvals

**Goal:** the PM approves coordinator-approved lines line by line, or returns them.

**Prompt:**
```
Read CLAUDE.md Sections 3.5 and rules 16–17. We are on Stage 8.

Apps Script: Pm.gs — approve_lines_pm {keys[]} (coord_approved → pm_approved),
return_lines {keys[], note} (→ returned, note visible to the coordinator).

Frontend: pm/approvals.js — the consolidated per-line view (date, coordinator, site, JC,
driver, cost, period, contractor), filters (week / coordinator / period), per-line approve +
select-all, and a return-with-note action.
```

**Tests for Stage 8:**
- [ ] Only `coord_approved` lines appear; approving moves them to `pm_approved`
- [ ] Return sends a line back with a note the coordinator can see
- [ ] Select-all approves the filtered set

---

# Stage 9 — PM Dashboard

**Goal:** totals + per-item spend with the correct slice boundary.

**Prompt:**
```
Read CLAUDE.md Section 8 and rule 24. We are on Stage 9.

Apps Script: dashboard_query {scope} — totals, components (Labor/Truck/Hotel/Park from trips),
by-coordinator and by-contractor totals. Frontend: pm/dashboard.js — stat cards + breakdown
bars + slices (week/date/coordinator/driver). Component figures must NOT be offered per
contractor or per period; label that boundary in the UI as the prototype does.
```

**Tests for Stage 9:**
- [ ] Totals reconcile with the sum of line costs
- [ ] Components come from trip-level figures and slice by coordinator/week/date/driver
- [ ] No per-contractor or per-period component breakdown is shown

---

# Stage 10 — Export

**Goal:** two in-house files (Old, New) + one per contractor, each a daily brief then per-site detail, with driver exclusion and dedup.

**Prompt:**
```
Read CLAUDE.md Section 7 and rules 20–23. We are on Stage 10.

Apps Script: Export.gs — export_query {scope, excluded_drivers[]} (preview, no writes) and
export_commit (claim-then-build: stamp pm_approved rows exported atomically, write ExportLog).
Scope is a week or a date range. Excluded drivers (exact typed string) are left pm_approved.

Frontend: pm/export.js (week/date filter, driver-exclusion chips, generate + confirm) and
pm/exportTemplate.js (per file: group by trip → brief line, per-site rows, file total; build
with xlsx-js-style so styling survives). Produce InHouse_OLD, InHouse_NEW, and one per contractor.
```

**Tests for Stage 10:**
- [ ] Generate yields exactly: In-House Old, In-House New, and one file per contractor present in scope
- [ ] Each file reads brief → per-site detail → total; styling survives the write
- [ ] Excluding a driver drops his rows and leaves them available for a later run
- [ ] Commit stamps rows `exported`; a second run never re-includes them
- [ ] Two commits of the same scope cannot double-settle a row

---

# Stage 11 — English Polish, PWA, Deploy

**Prompt:**
```
Read CLAUDE.md Section 9 and Deployment. We are on Stage 11.

Confirm every visible string goes through t() against en.js (ar.js stubbed for later), and
data cells use dir="auto". Add manifest.json, service-worker.js (cache the app shell; bump
APP_VERSION on every push), js/updates.js (offer Reload on a new version), and the icons.
Verify no hardcoded hex outside tokens.css and no backend call outside api.js.
```

**Tests for Stage 11:**
- [ ] No raw English strings bypass `t()`; Arabic data renders correctly
- [ ] App installs as a PWA; bumping `APP_VERSION` prompts a reload
- [ ] `grep` finds no hex outside `tokens.css`, no `fetch` outside `api.js`

---

# Stage 12 — Full QA Checklist

- [ ] Form submission → trip in `Trips`, lines in `Lines`, routed to the right coordinator
- [ ] Resolver: multi-JC pick by date; master Old/New wins; unknown derives; conflict flagged
- [ ] Coordinator edits the four fields only; cost read-only; edit reverts approval
- [ ] Trips by day: money + add/remove site re-split; approvals revert; coordinator can't change count
- [ ] PM approve/return per line + select-all
- [ ] Dashboard totals reconcile; component boundary respected
- [ ] Export: 2 in-house + per-contractor, brief→detail→total, exclusion, atomic dedup
- [ ] Admin password gate works; hash never exposed
- [ ] No login anywhere; sidebar auto-detects coordinators
- [ ] PWA installs; version bump prompts reload

---

# Stage 13 — Cutover

## Step 13.1 — Run in parallel
- [ ] Keep the old Form + Sheet workflow running
- [ ] For one week, process the same trips in the app and reconcile the export files against the old sheet's numbers

## Step 13.2 — Go live
- [ ] Confirm each coordinator's name is in the Form dropdown so his page auto-appears
- [ ] Hand coordinators their page URL; hand the PM the approvals/dashboard/export URLs
- [ ] Retire the old array-formula sheet once a full week reconciles cleanly
- [ ] The Google Form stays — it is the front door, forever
