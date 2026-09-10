/**
 * en.js — English strings. Every visible string in the app comes from here via t().
 * Keys are snake_case; {name} placeholders are filled by t(key, vars).
 */

export default {
  // Brand
  app_name: 'Trucks Tracking',
  brand_sub: 'LMP · Telecom',

  // Sidebar
  nav_label: 'Main navigation',
  nav_coordinators: 'Coordinators',
  nav_auto_detected: '· auto-detected',
  nav_no_coordinators: 'None yet — a coordinator appears after their first Form submission',
  nav_project_manager: 'Project Manager',
  nav_approvals: 'Approvals',
  nav_dashboard: 'Dashboard',
  nav_export: 'Export',
  nav_tools: 'Tools',
  nav_trips_by_day: 'Trips by day',
  nav_restricted: 'Restricted',
  nav_admin: 'Admin',
  sidebar_foot: 'No login — trips are entered on the Google Form',

  // Page heads
  page_coordinator_sub: 'Trips routed to {name}, split per site',
  page_trips_title: 'Trips by day',
  page_trips_sub: 'Fix a trip amount — the per-site split recalculates on save',
  page_approvals_title: 'Approvals',
  page_approvals_sub: 'Every coordinator-approved line, consolidated',
  page_dashboard_title: 'Dashboard',
  page_dashboard_sub: 'Totals and per-item spend',
  page_export_title: 'Export',
  page_export_sub: 'Generate the finance files',
  page_admin_title: 'Admin',
  page_admin_sub: 'Master upload and settings',
  page_placeholder: 'This page is not built yet.',

  // Boot & first-launch setup
  boot_connecting_title: 'Connecting',
  boot_connecting: 'Connecting to the database…',
  boot_error_title: 'Connection problem',
  boot_error_heading: 'Could not load Trucks Tracking',
  boot_retry: 'Retry',
  boot_change_url: 'Change Web App URL',
  setup_title: 'Setup',
  setup_sub: 'One-time connection for this device',
  setup_heading: 'Connect this device',
  setup_body: 'Paste the Trucks Tracking Apps Script Web App URL. It is saved on this device only.',
  setup_placeholder: 'https://script.google.com/macros/s/…/exec',
  setup_connect: 'Connect',
  setup_hint: 'Ask the project owner for the URL.',
  setup_invalid_url: 'That is not an Apps Script Web App URL. It should start with https://script.google.com/ and end with /exec.',

  // Errors (error_<code>)
  error_no_script_url: 'This device has no Web App URL yet.',
  error_network_error: 'Could not reach the server. Check your connection and the Web App URL.',
  error_timeout: 'The server took too long to answer. Try again.',
  error_http_error: 'The server returned an error ({detail}).',
  error_bad_response: 'The server did not answer like the Trucks Tracking API. Check the URL, and that the deployment is shared with "Anyone".',
  error_unknown_action: 'The server does not support this yet — deploy a new version of the Apps Script.',
  error_not_configured: 'The Apps Script is missing its SPREADSHEET_ID setting.',
  error_missing_sheet: 'The database workbook is missing a tab ({detail}).',
  error_busy: 'Another save is in progress. Try again in a moment.',
  error_bad_request: 'The server rejected the request.',
  error_server_error: 'Unexpected server error.',
  error_generic: 'Something went wrong ({code}).',
};
