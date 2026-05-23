// Copy this file to config.js and fill in your values.
// config.js is gitignored — never commit real credentials.

const CONFIG = {
  // RapidAPI key from https://rapidapi.com/api-sports/api/api-football
  RAPIDAPI_KEY: '',

  // GitHub Personal Access Token with the 'gist' scope
  // Used to read/write the cache Gist
  GITHUB_TOKEN: '',

  // ID of the Gist used as a cache (create one manually first)
  // e.g. 'a1b2c3d4e5f6...'
  GIST_ID: '',

  // Filename inside the Gist where match data is stored
  GIST_FILENAME: 'worldcup-matches.json',

  // API-Football league ID for the FIFA World Cup
  // 2026 World Cup USA/Canada/Mexico — update if needed
  LEAGUE_ID: 1,

  // Season year
  SEASON: 2026,

  // How long (ms) before the Gist cache is considered stale
  // Default: 5 minutes
  CACHE_TTL_MS: 5 * 60 * 1000,
};
