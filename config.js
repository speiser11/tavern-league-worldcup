// !! This file is gitignored. Fill in real values here. !!
// See config.example.js for documentation on each key.

const CONFIG = {

  GIST_ID:               '935c07fbd48d4adff60dec07ba2f3218',
  GIST_PAT:              '', // !! Do NOT commit a real token — store locally only !!
  GIST_FILENAME:         'worldcup-matches.json',
  DRAFT_GIST_FILENAME:   'wc-draft-state.json',

  CACHE_TTL_LIVE_MS:     5  * 60 * 1000,
  CACHE_TTL_IDLE_MS:     60 * 60 * 1000,
  CACHE_TTL_STANDINGS:   10 * 60 * 1000,

  // Firebase Realtime Database — safe to commit, these keys are public-by-design
  FIREBASE_CONFIG: {
    apiKey:            'AIzaSyCf4aJ41-2KWbA1KF_8-Un7XoNvPPU1wL0',
    authDomain:        'dt-bet-ladder.firebaseapp.com',
    databaseURL:       'https://dt-bet-ladder-default-rtdb.firebaseio.com',
    projectId:         'dt-bet-ladder',
    storageBucket:     'dt-bet-ladder.firebasestorage.app',
    messagingSenderId: '1052306163287',
    appId:             '1:1052306163287:web:6f401637891dcf79560512',
  },

  ADMIN_PASSWORD:        '3261',
  APP_TITLE:             '2026 World Cup Fantasy',
  SITE_URL:              'https://loganthein.github.io/worldcup-elite-fantasy/',
};

if (typeof module !== 'undefined') module.exports = CONFIG;
