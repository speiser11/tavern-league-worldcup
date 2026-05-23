/**
 * app.js — Core data structures, scoring engine, and data layer
 *
 * Data flow:
 *   1. Try GitHub Gist cache (fast, no quota cost).
 *   2. If cache is stale or missing, fetch from API-Football.
 *   3. On a successful API fetch, write result back to Gist.
 *
 * Expects CONFIG to be defined by config.js loaded before this script.
 */

// ── Participants ───────────────────────────────────────────────────────────────
// name → [team1, team2]

const PARTICIPANTS = {
  Ashleigh: ['Brazil',      'Canada'],
  Baker:    ['Germany',     'Croatia'],
  Chad:     ['Japan',       'Paraguay'],
  Jackie:   ['Morocco',     'Sweden'],
  Jake:     ['Argentina',   'Australia'],
  Joren:    ['Norway',      'Scotland'],
  Keillor:  ['France',      'Uruguay'],
  Kyle:     ['England',     'Senegal'],
  Logan:    ['USA',         'Switzerland'],
  Patrick:  ['Portugal',    'Austria'],
  Sara:     ['Spain',       'Mexico'],
  TJ:       ['Colombia',    'Turkey'],
  'Tom Moran': ['Belgium',  'South Korea'],
  Goon:     ['Netherlands', 'Ecuador'],
};

// ── Groups ─────────────────────────────────────────────────────────────────────

const GROUPS = {
  A: ['Mexico',      'South Korea', 'Czechia',    'South Africa'],
  B: ['Switzerland', 'Canada',      'Bosnia',     'Qatar'],
  C: ['Brazil',      'Morocco',     'Haiti',      'Scotland'],
  D: ['USA',         'Paraguay',    'Australia',  'Turkey'],
  E: ['Germany',     'Ecuador',     'Ivory Coast','Curacao'],
  F: ['Netherlands', 'Japan',       'Sweden',     'Tunisia'],
  G: ['Belgium',     'Egypt',       'Iran',       'New Zealand'],
  H: ['Spain',       'Uruguay',     'Saudi Arabia','Cape Verde'],
  I: ['France',      'Senegal',     'Norway',     'Iraq'],
  J: ['Argentina',   'Austria',     'Algeria',    'Jordan'],
  K: ['Portugal',    'Colombia',    'Congo',      'Uzbekistan'],
  L: ['England',     'Croatia',     'Ghana',      'Panama'],
};

// ── Tiers ──────────────────────────────────────────────────────────────────────
// Tier A: no win bonus. Tier B: +2 per group-stage win.

const TIER_A = new Set([
  'Spain', 'France', 'England', 'Brazil',
  'Argentina', 'Portugal', 'Germany', 'Netherlands',
]);

// ── Scoring ────────────────────────────────────────────────────────────────────

const SCORING = {
  group_win:       2,   // + tier bonus if Tier B
  group_win_bonus: 2,   // added for Tier B teams only
  group_draw:      1,
  group_advance:   3,   // advancing from group stage (any method)
  round_of_32:     4,
  round_of_16:     6,
  quarterfinal:    8,
  semifinal:       10,
  champion:        15,
};

// ── Team flags ─────────────────────────────────────────────────────────────────

const TEAM_FLAGS = {
  // Group A
  Mexico:         '🇲🇽',
  'South Korea':  '🇰🇷',
  Czechia:        '🇨🇿',
  'South Africa': '🇿🇦',
  // Group B
  Switzerland:    '🇨🇭',
  Canada:         '🇨🇦',
  Bosnia:         '🇧🇦',
  Qatar:          '🇶🇦',
  // Group C
  Brazil:         '🇧🇷',
  Morocco:        '🇲🇦',
  Haiti:          '🇭🇹',
  Scotland:       '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  // Group D
  USA:            '🇺🇸',
  Paraguay:       '🇵🇾',
  Australia:      '🇦🇺',
  Turkey:         '🇹🇷',
  // Group E
  Germany:        '🇩🇪',
  Ecuador:        '🇪🇨',
  'Ivory Coast':  '🇨🇮',
  Curacao:        '🇨🇼',
  // Group F
  Netherlands:    '🇳🇱',
  Japan:          '🇯🇵',
  Sweden:         '🇸🇪',
  Tunisia:        '🇹🇳',
  // Group G
  Belgium:        '🇧🇪',
  Egypt:          '🇪🇬',
  Iran:           '🇮🇷',
  'New Zealand':  '🇳🇿',
  // Group H
  Spain:          '🇪🇸',
  Uruguay:        '🇺🇾',
  'Saudi Arabia': '🇸🇦',
  'Cape Verde':   '🇨🇻',
  // Group I
  France:         '🇫🇷',
  Senegal:        '🇸🇳',
  Norway:         '🇳🇴',
  Iraq:           '🇮🇶',
  // Group J
  Argentina:      '🇦🇷',
  Austria:        '🇦🇹',
  Algeria:        '🇩🇿',
  Jordan:         '🇯🇴',
  // Group K
  Portugal:       '🇵🇹',
  Colombia:       '🇨🇴',
  Congo:          '🇨🇬',
  Uzbekistan:     '🇺🇿',
  // Group L
  England:        '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  Croatia:        '🇭🇷',
  Ghana:          '🇬🇭',
  Panama:         '🇵🇦',
};

// ── Team name map ──────────────────────────────────────────────────────────────
// API-Football name → our canonical name.
// Only entries that differ need to be listed.

const NAME_MAP = {
  // USA
  'United States':            'USA',
  'United States of America': 'USA',
  // South Korea
  'Korea Republic':           'South Korea',
  'Republic of Korea':        'South Korea',
  // Ivory Coast
  "Côte d'Ivoire":            'Ivory Coast',
  "Cote d'Ivoire":            'Ivory Coast',
  'Côte D\'Ivoire':           'Ivory Coast',
  // Bosnia
  'Bosnia and Herzegovina':   'Bosnia',
  'Bosnia & Herzegovina':     'Bosnia',
  // Congo
  'DR Congo':                 'Congo',
  'Congo DR':                 'Congo',
  'Republic of Congo':        'Congo',
  'Congo Republic':           'Congo',
  // Turkey
  'Türkiye':                  'Turkey',
  // Czechia
  'Czech Republic':           'Czechia',
  // Scotland / England (sometimes returned as full GB names)
  'Scotland (GB-SCT)':        'Scotland',
  'England (GB-ENG)':         'England',
  // Cape Verde
  'Cape Verde Islands':       'Cape Verde',
  // New Zealand
  'New-Zealand':              'New Zealand',
  // Saudi Arabia
  'Saudi-Arabia':             'Saudi Arabia',
  // South Africa
  'South-Africa':             'South Africa',
  // South Korea (alternate hyphenated form)
  'South-Korea':              'South Korea',
};

/** Normalize an API-Football team name to our canonical name. */
function canonicalTeam(apiName) {
  return NAME_MAP[apiName] ?? apiName;
}

// ── Round parser ───────────────────────────────────────────────────────────────
// Maps API-Football league.round strings → internal round keys.

function parseRound(apiRound) {
  const r = (apiRound || '').toLowerCase().trim();
  if (r.startsWith('group'))   return 'group';
  if (r === 'round of 32')     return 'round_of_32';
  if (r === 'round of 16')     return 'round_of_16';
  if (r === 'quarter-finals' || r === 'quarterfinals') return 'quarterfinal';
  if (r === 'semi-finals'    || r === 'semifinals')    return 'semifinal';
  if (r === 'final')           return 'final';
  return r; // pass-through for anything unexpected
}

// ── Live status helpers ────────────────────────────────────────────────────────

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const LIVE_STATUSES     = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE']);

function isFinished(status) { return FINISHED_STATUSES.has(status); }
function isLive(status)     { return LIVE_STATUSES.has(status); }

// ── Data layer ─────────────────────────────────────────────────────────────────

const LS_MATCHES_KEY   = 'wc_matches_cache';
const LS_STANDINGS_KEY = 'wc_standings_cache';

// Cache TTLs in ms
const TTL_LIVE    = 5  * 60 * 1000;  //  5 min — when a match is in progress
const TTL_IDLE    = 60 * 60 * 1000;  // 60 min — between matches
const TTL_STANDINGS = 10 * 60 * 1000; // 10 min

class DataLayer {
  constructor() {
    this._apiBase     = 'https://api-football-v1.p.rapidapi.com/v3';
    this._gistApiBase = 'https://api.github.com/gists';
    this.source       = null; // 'live' | 'local-cache' | 'gist-cache' | 'error'
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Fetch all fixtures for the configured league/season.
   * Returns an array of parsed match objects (see parseResults).
   *
   * Cache strategy:
   *   1. localStorage — fresh if under TTL_LIVE (any live match) or TTL_IDLE
   *   2. API-Football — on cache miss
   *   3. Gist — silent fallback if API fails
   */
  async fetchMatches() {
    const local = this._lsRead(LS_MATCHES_KEY);

    if (local) {
      const ttl = local.data.some(m => isLive(m.status)) ? TTL_LIVE : TTL_IDLE;
      if (!this._isStale(local.fetchedAt, ttl)) {
        this.source = 'local-cache';
        return local.data;
      }
    }

    // Try API
    try {
      const raw     = await this._apiFetch(`/fixtures?league=${CONFIG.LEAGUE_ID}&season=${CONFIG.SEASON}`);
      const parsed  = this.parseResults(raw.response);
      this.source   = 'live';
      this._lsWrite(LS_MATCHES_KEY, parsed);
      this._writeGistCache(parsed).catch(console.warn); // fire-and-forget
      return parsed;
    } catch (err) {
      console.warn('fetchMatches API error:', err.message);
    }

    // Fallback: stale localStorage
    if (local) {
      this.source = 'local-cache';
      return local.data;
    }

    // Fallback: Gist
    const gist = await this._readGistCache();
    if (gist) {
      this.source = 'gist-cache';
      return gist;
    }

    this.source = 'error';
    throw new Error('No match data available — API failed and no cache found.');
  }

  /**
   * Fetch group standings for the configured league/season.
   * Returns the raw API-Football standings response array.
   * Cached in localStorage for TTL_STANDINGS.
   */
  async fetchStandings() {
    const local = this._lsRead(LS_STANDINGS_KEY);
    if (local && !this._isStale(local.fetchedAt, TTL_STANDINGS)) {
      return local.data;
    }

    try {
      const res  = await this._apiFetch(`/standings?league=${CONFIG.LEAGUE_ID}&season=${CONFIG.SEASON}`);
      const data = res.response;
      this._lsWrite(LS_STANDINGS_KEY, data);
      return data;
    } catch (err) {
      console.warn('fetchStandings API error:', err.message);
      return local ? local.data : null;
    }
  }

  /**
   * Convert raw API-Football fixture objects into our internal format:
   *
   * {
   *   matchId:    number,
   *   homeTeam:   string,   — canonical team name
   *   awayTeam:   string,
   *   homeScore:  number | null,
   *   awayScore:  number | null,
   *   status:     string,   — 'NS' | '1H' | 'HT' | '2H' | 'FT' | 'AET' | 'PEN' | …
   *   statusLong: string,   — "Match Finished" | "First Half" | …
   *   elapsed:    number | null,
   *   round:      string,   — 'group' | 'round_of_32' | 'round_of_16' | 'quarterfinal' | 'semifinal' | 'final'
   *   date:       string,   — ISO 8601
   * }
   */
  parseResults(fixtures) {
    return fixtures.map(f => ({
      matchId:    f.fixture.id,
      homeTeam:   canonicalTeam(f.teams.home.name),
      awayTeam:   canonicalTeam(f.teams.away.name),
      homeScore:  f.goals.home  ?? null,
      awayScore:  f.goals.away  ?? null,
      status:     f.fixture.status.short,
      statusLong: f.fixture.status.long,
      elapsed:    f.fixture.status.elapsed ?? null,
      round:      parseRound(f.league.round),
      date:       f.fixture.date,
    }));
  }

  // ── Private: HTTP ──────────────────────────────────────────────────────────

  async _apiFetch(path) {
    const res = await fetch(`${this._apiBase}${path}`, {
      headers: {
        'X-RapidAPI-Key':  CONFIG.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API-Football ${res.status}: ${body}`);
    }
    return res.json();
  }

  // ── Private: localStorage cache ────────────────────────────────────────────

  _lsRead(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  _lsWrite(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data }));
    } catch {
      // Ignore storage errors (private browsing quota, etc.)
    }
  }

  // ── Private: Gist cache (cross-device fallback) ────────────────────────────

  async _readGistCache() {
    if (!CONFIG.GIST_ID) return null;
    try {
      const res = await fetch(`${this._gistApiBase}/${CONFIG.GIST_ID}`, {
        headers: this._gistHeaders(),
      });
      if (!res.ok) return null;
      const gist = await res.json();
      const file = gist.files[CONFIG.GIST_FILENAME];
      if (!file) return null;
      const payload = JSON.parse(file.content);
      // Gist stores already-parsed matches
      return payload.matches ?? null;
    } catch {
      return null;
    }
  }

  async _writeGistCache(parsedMatches) {
    if (!CONFIG.GIST_ID || !CONFIG.GITHUB_TOKEN) return;
    const payload = { fetchedAt: Date.now(), matches: parsedMatches };
    await fetch(`${this._gistApiBase}/${CONFIG.GIST_ID}`, {
      method: 'PATCH',
      headers: { ...this._gistHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: {
          [CONFIG.GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) },
        },
      }),
    });
  }

  _gistHeaders() {
    const h = { Accept: 'application/vnd.github+json' };
    if (CONFIG.GITHUB_TOKEN) h['Authorization'] = `Bearer ${CONFIG.GITHUB_TOKEN}`;
    return h;
  }

  _isStale(fetchedAt, ttl) {
    return Date.now() - fetchedAt > ttl;
  }
}

// ── Knockout round → scoring key ───────────────────────────────────────────────

const ROUND_SCORE_KEY = {
  round_of_32:  'round_of_32',
  round_of_16:  'round_of_16',
  quarterfinal: 'quarterfinal',
  semifinal:    'semifinal',
  final:        'champion',
};

// ── Group lookup helper ────────────────────────────────────────────────────────

function findTeamGroup(teamName) {
  const entry = Object.entries(GROUPS).find(([, teams]) => teams.includes(teamName));
  return entry ? entry[0] : null;
}

// ── Advancement determination ──────────────────────────────────────────────────

/**
 * Returns a Set of canonical team names that advanced from the group stage.
 * Prefers the standings API (authoritative); falls back to inferring from
 * knockout matches if standings are unavailable.
 *
 * Format (2026 WC): top 2 from each of 12 groups = 24 teams,
 * plus best 8 third-place teams by points > goalsDiff > goalsFor = 32 total.
 */
function determineAdvancedTeams(matches, standings) {
  if (standings) {
    try {
      return _advancedFromStandings(standings);
    } catch (e) {
      console.warn('standings parse error, falling back to match inference:', e);
    }
  }
  return _advancedFromMatches(matches);
}

function _advancedFromStandings(standings) {
  // API-Football standings shape: standings[0].league.standings = [[groupA], [groupB], ...]
  // or sometimes just an array of groups directly.
  const raw = standings[0]?.league?.standings ?? standings;
  if (!Array.isArray(raw)) throw new Error('unexpected standings shape');

  const advanced   = new Set();
  const thirdPlace = [];

  for (const group of raw) {
    const sorted = [...group].sort((a, b) => a.rank - b.rank);

    if (sorted[0]) advanced.add(canonicalTeam(sorted[0].team.name));
    if (sorted[1]) advanced.add(canonicalTeam(sorted[1].team.name));
    if (sorted[2]) thirdPlace.push(sorted[2]);
  }

  // Best 8 third-place: points → goalsDiff → goalsFor
  thirdPlace.sort((a, b) => {
    if (b.points      !== a.points)      return b.points      - a.points;
    if (b.goalsDiff   !== a.goalsDiff)   return b.goalsDiff   - a.goalsDiff;
    return (b.all?.goals?.for ?? 0) - (a.all?.goals?.for ?? 0);
  });

  for (const t of thirdPlace.slice(0, 8)) {
    advanced.add(canonicalTeam(t.team.name));
  }

  return advanced;
}

function _advancedFromMatches(matches) {
  // Any team that appears in a knockout fixture advanced from groups
  const advanced = new Set();
  for (const m of matches) {
    if (m.round !== 'group') {
      advanced.add(m.homeTeam);
      advanced.add(m.awayTeam);
    }
  }
  return advanced;
}

// ── Per-team scorer ────────────────────────────────────────────────────────────

/**
 * Score a single team across all finished matches.
 *
 * @returns {{
 *   wins:        number,
 *   draws:       number,
 *   bonuses:     number,  — tier-B win bonus + advance bonus
 *   knockoutPts: number,
 *   total:       number,
 * }}
 */
function _scoreTeam(teamName, matches, advancedTeams) {
  const isTierB = !TIER_A.has(teamName);
  let wins = 0, draws = 0, tierBonus = 0, knockoutPts = 0;

  for (const m of matches) {
    if (!isFinished(m.status)) continue;
    if (m.homeTeam !== teamName && m.awayTeam !== teamName) continue;

    const teamScore = m.homeTeam === teamName ? m.homeScore : m.awayScore;
    const oppScore  = m.homeTeam === teamName ? m.awayScore : m.homeScore;
    const won  = teamScore > oppScore;
    const drew = teamScore === oppScore;

    if (m.round === 'group') {
      if (won) {
        wins++;
        if (isTierB) tierBonus += SCORING.group_win_bonus;
      } else if (drew) {
        draws++;
      }
    } else if (won) {
      const key = ROUND_SCORE_KEY[m.round];
      if (key) knockoutPts += SCORING[key];
    }
  }

  const advanceBonus = advancedTeams.has(teamName) ? SCORING.group_advance : 0;
  const bonuses = tierBonus + advanceBonus;
  const total   = wins * SCORING.group_win + draws * SCORING.group_draw + bonuses + knockoutPts;

  return { wins, draws, bonuses, knockoutPts, total };
}

// ── Score history builder ──────────────────────────────────────────────────────

/**
 * Build a chronological list of scoring events for one participant.
 * Each entry: { date, matchId, team, event, pts, runningTotal }
 */
function _buildScoreHistory(teamNames, matches, advancedTeams) {
  const events = [];
  const advanceBonusAwarded = new Set();
  let running = 0;

  const finished = matches
    .filter(m => isFinished(m.status))
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  for (const m of finished) {
    for (const teamName of teamNames) {
      if (m.homeTeam !== teamName && m.awayTeam !== teamName) continue;

      const teamScore = m.homeTeam === teamName ? m.homeScore : m.awayScore;
      const oppScore  = m.homeTeam === teamName ? m.awayScore : m.homeScore;
      const won  = teamScore > oppScore;
      const drew = teamScore === oppScore;
      const isTierB = !TIER_A.has(teamName);

      // Advance bonus fires on the team's first knockout appearance
      if (m.round !== 'group' && !advanceBonusAwarded.has(teamName) && advancedTeams.has(teamName)) {
        advanceBonusAwarded.add(teamName);
        running += SCORING.group_advance;
        events.push({ date: m.date, matchId: null, team: teamName,
          event: 'group_advance', pts: SCORING.group_advance, runningTotal: running });
      }

      let pts = 0, event = '';

      if (m.round === 'group') {
        if (won) {
          pts   = SCORING.group_win + (isTierB ? SCORING.group_win_bonus : 0);
          event = 'group_win';
        } else if (drew) {
          pts   = SCORING.group_draw;
          event = 'group_draw';
        }
      } else if (won) {
        const key = ROUND_SCORE_KEY[m.round];
        if (key) { pts = SCORING[key]; event = key; }
      }

      if (pts > 0) {
        running += pts;
        events.push({ date: m.date, matchId: m.matchId, team: teamName, event, pts, runningTotal: running });
      }
    }
  }

  return events;
}

// ── calculateScores ────────────────────────────────────────────────────────────

/**
 * Main scoring function. Pure — no side effects.
 *
 * @param {object[]} matches   — parsed results from DataLayer.parseResults()
 * @param {object[]|null} standings — raw API-Football standings (may be null)
 *
 * @returns {Array<{
 *   rank:          number,
 *   name:          string,
 *   teams:         string[],
 *   totalScore:    number,
 *   teamBreakdown: { [teamName]: { wins, draws, bonuses, knockoutPts, total } },
 *   scoreHistory:  { date, matchId, team, event, pts, runningTotal }[],
 *   flags:         string[],
 * }>} Sorted by totalScore desc; tiebreak: total wins desc. Tied entries share a rank.
 */
function calculateScores(matches, standings = null) {
  const advancedTeams = determineAdvancedTeams(matches, standings);

  const results = Object.entries(PARTICIPANTS).map(([name, teamNames]) => {
    const teamBreakdown = {};
    let totalWins = 0;

    for (const teamName of teamNames) {
      const td = _scoreTeam(teamName, matches, advancedTeams);
      teamBreakdown[teamName] = td;
      totalWins += td.wins;
    }

    const totalScore = Object.values(teamBreakdown).reduce((s, t) => s + t.total, 0);
    const scoreHistory = _buildScoreHistory(teamNames, matches, advancedTeams);

    // Same-group conflict flag (currently only possible for Logan: USA + Switzerland)
    const flags = [];
    const [t1, t2] = teamNames;
    const g1 = findTeamGroup(t1);
    const g2 = findTeamGroup(t2);
    if (g1 && g2 && g1 === g2) {
      flags.push(`same-group conflict: ${t1} and ${t2} are both in Group ${g1}`);
    }

    return { name, teams: teamNames, totalScore, teamBreakdown, scoreHistory, flags, _wins: totalWins };
  });

  // Primary sort: totalScore desc. Tiebreak: total wins desc.
  results.sort((a, b) => b.totalScore - a.totalScore || b._wins - a._wins);

  // Assign ranks — tied entries share a rank; next rank skips accordingly
  let nextRank = 1;
  for (let i = 0; i < results.length; i++) {
    const prev = results[i - 1];
    const tied = prev && prev.totalScore === results[i].totalScore && prev._wins === results[i]._wins;
    results[i].rank = tied ? prev.rank : nextRank;
    nextRank++;
    delete results[i]._wins; // remove internal sort field from output
  }

  return results;
}

// ── Scoring engine (orchestrator) ─────────────────────────────────────────────

class ScoringEngine {
  constructor() {
    this._data          = new DataLayer();
    this._matches       = [];
    this._standings     = null;
    this._nextRefreshAt = 0;
    this._refreshTimer  = null;
  }

  /** Entry point — fetches data, renders, then schedules recurring refresh. */
  async init() {
    await this._fetchAndRender();
    this._scheduleRefresh();
  }

  async _fetchAndRender() {
    try {
      [this._matches, this._standings] = await Promise.all([
        this._data.fetchMatches(),
        this._data.fetchStandings().catch(err => {
          console.warn('standings fetch failed, inferring from matches:', err.message);
          return null;
        }),
      ]);
    } catch (err) {
      this._renderError(err.message);
      return;
    }

    this._updateHeader();
    this._renderMatches();
    this._renderLeaderboard();
  }

  /**
   * Schedule the next auto-refresh.
   * TTL is 5 min if any match is currently live, 60 min otherwise.
   */
  _scheduleRefresh() {
    clearTimeout(this._refreshTimer);
    const anyLive = this._matches.some(m => isLive(m.status));
    const ttl     = anyLive ? TTL_LIVE : TTL_IDLE;
    this._nextRefreshAt = Date.now() + ttl;
    this._refreshTimer  = setTimeout(async () => {
      await this._fetchAndRender();
      this._scheduleRefresh();
    }, ttl);
    startCountdown(this._nextRefreshAt);
  }

  // ── Rendering helpers ──────────────────────────────────────────────────────

  _updateHeader() {
    const badge = document.getElementById('data-source');
    const ts    = document.getElementById('last-updated');
    const labels = { live: 'Live', 'local-cache': 'Cached', 'gist-cache': 'Gist' };
    badge.textContent = labels[this._data.source] ?? this._data.source;
    badge.className   = `source-badge ${this._data.source === 'live' ? 'live' : 'cached'}`;
    ts.textContent    = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  _renderMatches() {
    const container = document.getElementById('matches-container');

    const relevant = this._matches
      .filter(m => isFinished(m.status) || isLive(m.status))
      .slice(-12)
      .reverse();

    if (!relevant.length) {
      container.innerHTML = '<p class="state-msg">No completed matches yet.</p>';
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'matches-grid';

    for (const m of relevant) {
      const live      = isLive(m.status);
      const homeFlag  = TEAM_FLAGS[m.homeTeam] || '';
      const awayFlag  = TEAM_FLAGS[m.awayTeam] || '';
      const homeGoals = m.homeScore ?? '–';
      const awayGoals = m.awayScore ?? '–';
      const dateStr   = new Date(m.date).toLocaleDateString();
      const statusStr = live
        ? `<span class="mc-live-indicator">${m.elapsed}'</span>`
        : m.statusLong;

      const card = document.createElement('div');
      card.className = `match-card${live ? ' is-live' : ''}`;
      card.innerHTML = `
        <div class="mc-teams">
          <span class="mc-home">${homeFlag} ${m.homeTeam}</span>
          <span class="mc-score">${homeGoals}–${awayGoals}</span>
          <span class="mc-away">${m.awayTeam} ${awayFlag}</span>
        </div>
        <div class="mc-meta">
          <span>${dateStr}</span>
          <span>${statusStr}</span>
        </div>
      `;
      grid.appendChild(card);
    }

    container.innerHTML = '';
    container.appendChild(grid);
  }

  _renderLeaderboard() {
    renderLeaderboard(calculateScores(this._matches, this._standings), this._matches);
  }

  _renderError(msg) {
    document.getElementById('data-source').textContent = 'Error';
    document.getElementById('data-source').className   = 'source-badge error';
    document.getElementById('leaderboard-container').innerHTML =
      `<p class="error-msg">${msg}</p>`;
    document.getElementById('matches-container').innerHTML =
      `<p class="error-msg">${msg}</p>`;
  }
}
