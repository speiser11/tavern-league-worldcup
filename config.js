// !! This file is gitignored. Fill in real values here. !!
// See config.example.js for documentation on each key.

const CONFIG = {

  GIST_ID:               '935c07fbd48d4adff60dec07ba2f3218',
  GIST_PAT:              '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',
  GIST_FILENAME:         'worldcup-matches.json',
  DRAFT_GIST_FILENAME:   'wc-draft-state.json',

  CACHE_TTL_LIVE_MS:     5  * 60 * 1000,
  CACHE_TTL_IDLE_MS:     60 * 60 * 1000,
  CACHE_TTL_STANDINGS:   10 * 60 * 1000,

  ADMIN_PASSWORD:        '',
  APP_TITLE:             '2026 World Cup Fantasy',
  SITE_URL:              'https://loganthein.github.io/worldcup-elite-fantasy/',
};

if (typeof module !== 'undefined') module.exports = CONFIG;
