// ============================================================
//  worldcup-fantasy — config.example.js
//  Copy this file to config.js and fill in your values.
//  IMPORTANT: config.js is gitignored. Never commit it.
// ============================================================

const CONFIG = {

  // Live match data comes from ESPN's public API — no key needed.

  // ----------------------------------------------------------
  //  GITHUB GIST (score cache + fallback data)
  //  1. Go to https://gist.github.com
  //  2. Create a new secret Gist, filename: wc-fantasy-data.json
  //     Paste in {} as the initial content and save.
  //  3. Copy the Gist ID from the URL:
  //     gist.github.com/{username}/{GIST_ID}
  //  4. Go to https://github.com/settings/tokens
  //     Generate a classic token with the "gist" scope only.
  // ----------------------------------------------------------
  GIST_ID: "YOUR_GIST_ID_HERE",
  GIST_PAT: "YOUR_GITHUB_PERSONAL_ACCESS_TOKEN_HERE",
  GIST_FILENAME: "wc-fantasy-data.json",


  // ----------------------------------------------------------
  //  CACHE SETTINGS
  //  How often to re-fetch from API-Football.
  //  Kept conservative to protect the 100 req/day free quota.
  //  During a live match the app polls more frequently.
  // ----------------------------------------------------------
  CACHE_TTL_LIVE_MS:    5 * 60 * 1000,   //  5 minutes  (match in progress)
  CACHE_TTL_IDLE_MS:   60 * 60 * 1000,   // 60 minutes  (no live match)
  CACHE_TTL_STANDINGS: 10 * 60 * 1000,   // 10 minutes  (group standings)


  // ----------------------------------------------------------
  //  APP SETTINGS
  // ----------------------------------------------------------

  // Password for the admin result-entry panel (admin.html).
  // This is client-side only — fine for a private friend group.
  ADMIN_PASSWORD: "YOUR_ADMIN_PASSWORD_HERE",

  // Display name shown in the leaderboard header
  APP_TITLE: "Joner Games Presents: 2026 #ELITE World Cup Draft Competition",

  // Your GitHub Pages URL once deployed, e.g.:
  // "https://loganthein.github.io/worldcup-fantasy"
  SITE_URL: "YOUR_GITHUB_PAGES_URL_HERE",


  // ----------------------------------------------------------
  //  PUSH NOTIFICATIONS (OneSignal — free tier)
  //  1. Go to https://onesignal.com and create a free account.
  //  2. Create a new app → Web → select "Typical Site".
  //  3. Set your Site URL (your GitHub Pages URL above).
  //  4. Copy the App ID from Settings > Keys & IDs.
  //  5. Copy the REST API Key from the same page.
  //
  //  SECURITY NOTE: Both keys will be visible in page source.
  //  This is acceptable for a private friend-group app —
  //  the REST key can only send notifications to YOUR app's
  //  subscribers; it cannot read data or access other apps.
  //
  //  Leave both as empty strings "" to disable notifications.
  // ----------------------------------------------------------
  ONESIGNAL_APP_ID:       "YOUR_ONESIGNAL_APP_ID_HERE",
  ONESIGNAL_REST_API_KEY: "YOUR_ONESIGNAL_REST_API_KEY_HERE",

};

// Make available globally (loaded before app.js in HTML)
if (typeof module !== "undefined") module.exports = CONFIG;
