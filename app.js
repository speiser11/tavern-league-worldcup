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

// Populate TEAM_OWNER reverse map
for (const [name, teams] of Object.entries(PARTICIPANTS)) {
  for (const t of teams) TEAM_OWNER[t] = name;
}

// ── Owner → color map ─────────────────────────────────────────────────────────

const OWNER_COLORS = {
  'Ashleigh':  '#ec4899',
  'Baker':     '#0d9488',
  'Chad':      '#f97316',
  'Jackie':    '#a855f7',
  'Jake':      '#2563eb',
  'Joren':     '#16a34a',
  'Keillor':   '#ef4444',
  'Kyle':      '#0891b2',
  'Logan':     '#d97706',
  'Patrick':   '#4f46e5',
  'Sara':      '#e11d48',
  'TJ':        '#059669',
  'Tom Moran': '#84cc16',
  'Goon':      '#7c3aed',
};

// Reverse map: team → participant name
const TEAM_OWNER = {};
// (populated after PARTICIPANTS is defined — see below)

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
  'Bosnia-Herzegovina':       'Bosnia',   // ESPN
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
// Maps ESPN season.slug strings → internal round keys.

function parseRound(slug) {
  switch ((slug || '').toLowerCase()) {
    case 'group-stage':   return 'group';
    case 'round-of-32':   return 'round_of_32';
    case 'round-of-16':   return 'round_of_16';
    case 'quarterfinals': return 'quarterfinal';
    case 'semifinals':    return 'semifinal';
    case 'final':         return 'final';
    default:              return slug;
  }
}

// ── Live status helpers ────────────────────────────────────────────────────────

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);
const LIVE_STATUSES     = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'STATUS_IN_PROGRESS', 'STATUS_HALFTIME']);

function isFinished(status) { return FINISHED_STATUSES.has(status); }
function isLive(status)     { return LIVE_STATUSES.has(status); }

// ── ESPN status → internal status ─────────────────────────────────────────────

function mapEspnStatus(espnName) {
  switch (espnName) {
    case 'STATUS_SCHEDULED':   return 'NS';
    case 'STATUS_IN_PROGRESS': return 'LIVE';
    case 'STATUS_HALFTIME':    return 'HT';
    case 'STATUS_FINAL':       return 'FT';
    case 'STATUS_FINAL_AET':   return 'AET';
    case 'STATUS_FINAL_PEN':   return 'PEN';
    case 'STATUS_POSTPONED':   return 'PST';
    case 'STATUS_SUSPENDED':   return 'SUSP';
    case 'STATUS_CANCELED':    return 'CANC';
    default:                   return espnName;
  }
}

// ── Data layer ─────────────────────────────────────────────────────────────────

const LS_MATCHES_KEY = 'wc_espn_v1'; // renamed from wc_matches_cache to bust stale API-Football cache

// All 104 WC matches fall between these dates
const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200';

class DataLayer {
  constructor() {
    this._gistApiBase = 'https://api.github.com/gists';
    this.source       = null; // 'live' | 'local-cache' | 'gist-cache' | 'error'
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Fetch all WC fixtures from ESPN (free, no auth).
   * Cache strategy:
   *   1. localStorage — fresh if under TTL_LIVE (live match) or TTL_IDLE
   *   2. ESPN API — on cache miss
   *   3. Gist — silent fallback if ESPN fails
   */
  async fetchMatches() {
    const local = this._lsRead(LS_MATCHES_KEY);

    if (local) {
      const ttl = local.data.some(m => isLive(m.status))
        ? CONFIG.CACHE_TTL_LIVE_MS
        : CONFIG.CACHE_TTL_IDLE_MS;
      if (!this._isStale(local.fetchedAt, ttl)) {
        this.source = 'local-cache';
        return local.data;
      }
    }

    // Try ESPN
    try {
      const res = await fetch(ESPN_URL);
      if (!res.ok) throw new Error(`ESPN ${res.status}`);
      const json   = await res.json();
      const parsed = this.parseResults(json.events || []);
      this.source  = 'live';
      this._lsWrite(LS_MATCHES_KEY, parsed);
      // Only write to Gist when we have real data (keeps it as a fallback for other devices)
      if (parsed.length) this._writeGistCache(parsed).catch(() => {});
      return parsed;
    } catch (err) {
      console.warn('fetchMatches ESPN error:', err.message);
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
    throw new Error('No match data available.');
  }

  /**
   * Convert ESPN event objects into our internal match format:
   * { matchId, homeTeam, awayTeam, homeScore, awayScore,
   *   status, statusLong, elapsed, round, date }
   *
   * Skips placeholder entries ("Group A Winner", etc.) that appear
   * in knockout brackets before those teams are determined.
   */
  parseResults(events) {
    const parsed = [];

    for (const e of events) {
      const comp = e.competitions?.[0];
      if (!comp) continue;

      const home = comp.competitors.find(c => c.homeAway === 'home');
      const away = comp.competitors.find(c => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeTeam = canonicalTeam(home.team.displayName);
      const awayTeam = canonicalTeam(away.team.displayName);


      const st     = comp.status.type;
      const isPre  = st.state === 'pre';
      const status = mapEspnStatus(st.name);

      // Parse elapsed minutes from displayClock (e.g. "45'" → 45)
      const clockStr = comp.status.displayClock || '';
      const elapsed  = isPre ? null : (parseInt(clockStr) || null);

      parsed.push({
        matchId:    parseInt(e.id),
        homeTeam,
        awayTeam,
        homeScore:  isPre ? null : parseInt(home.score),
        awayScore:  isPre ? null : parseInt(away.score),
        status,
        statusLong: st.description || st.name,
        elapsed,
        round:      parseRound(e.season?.slug),
        date:       e.date,
      });
    }

    return parsed;
  }

  // ── Private: localStorage cache ────────────────────────────────────────────

  _lsRead(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  _lsWrite(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data }));
    } catch { /* quota / private mode */ }
  }

  // ── Private: Gist cache ────────────────────────────────────────────────────

  async _readGistCache() {
    if (!CONFIG.GIST_ID) return null;
    try {
      const res  = await fetch(`${this._gistApiBase}/${CONFIG.GIST_ID}`, { headers: this._gistHeaders() });
      if (!res.ok) return null;
      const gist = await res.json();
      const file = gist.files[CONFIG.GIST_FILENAME];
      if (!file) return null;
      return JSON.parse(file.content).matches ?? null;
    } catch { return null; }
  }

  async _writeGistCache(parsedMatches) {
    if (!CONFIG.GIST_ID || !CONFIG.GIST_PAT) return;
    const payload = { fetchedAt: Date.now(), matches: parsedMatches };
    await fetch(`${this._gistApiBase}/${CONFIG.GIST_ID}`, {
      method:  'PATCH',
      headers: { ...this._gistHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify({ files: { [CONFIG.GIST_FILENAME]: { content: JSON.stringify(payload, null, 2) } } }),
    });
  }

  _gistHeaders() {
    const h = { Accept: 'application/vnd.github+json' };
    if (CONFIG.GIST_PAT) h['Authorization'] = `token ${CONFIG.GIST_PAT}`;
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

// ── Group standings computation ────────────────────────────────────────────────

/**
 * Compute group stage standings from match data.
 * Returns { A: [{team, played, won, drawn, lost, gf, ga, gd, pts}, …], B: …, … }
 * Sorted by pts → gd → gf (standard FIFA tiebreaker).
 */
function computeGroupStandings(matches) {
  const standings = {};
  for (const [g, teams] of Object.entries(GROUPS)) {
    standings[g] = teams.map(team => ({
      team, played: 0, won: 0, drawn: 0, lost: 0,
      gf: 0, ga: 0, gd: 0, pts: 0,
    }));
  }

  for (const m of matches) {
    if (m.round !== 'group' || !isFinished(m.status)) continue;
    if (m.homeScore === null || m.awayScore === null) continue;
    const g = findTeamGroup(m.homeTeam);
    if (!g) continue;

    const home = standings[g]?.find(e => e.team === m.homeTeam);
    const away = standings[g]?.find(e => e.team === m.awayTeam);
    if (!home || !away) continue;

    home.played++; away.played++;
    home.gf += m.homeScore; home.ga += m.awayScore;
    away.gf += m.awayScore; away.ga += m.homeScore;

    if (m.homeScore > m.awayScore) {
      home.won++; home.pts += 3; away.lost++;
    } else if (m.homeScore < m.awayScore) {
      away.won++; away.pts += 3; home.lost++;
    } else {
      home.drawn++; home.pts++; away.drawn++; away.pts++;
    }
  }

  for (const g of Object.keys(standings)) {
    for (const e of standings[g]) e.gd = e.gf - e.ga;
    standings[g].sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  }
  return standings;
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
      this._matches  = await this._data.fetchMatches();
      this._standings = null; // inferred from knockout matches
    } catch (err) {
      console.warn('fetchMatches failed, rendering with empty data:', err.message);
      this._matches   = [];
      this._standings = null;
      this._data.source = 'error';
    }

    this._updateHeader();
    this._renderSchedule();
    this._renderGroups();
    this._renderLeaderboard();
  }

  /**
   * Schedule the next auto-refresh.
   * TTL is 5 min if any match is currently live, 60 min otherwise.
   */
  _scheduleRefresh() {
    clearTimeout(this._refreshTimer);
    const anyLive = this._matches.some(m => isLive(m.status));
    const ttl     = anyLive ? CONFIG.CACHE_TTL_LIVE_MS : CONFIG.CACHE_TTL_IDLE_MS;
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

  _renderSchedule() {
    const container = document.getElementById('schedule-container');
    if (!container) return;

    if (!this._matches.length) {
      container.innerHTML = '<p class="state-msg">No schedule data yet.</p>';
      return;
    }

    const ROUND_ORDER = ['group', 'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'final'];
    const ROUND_LABELS = {
      group:        'Group Stage',
      round_of_32:  'Round of 32',
      round_of_16:  'Round of 16',
      quarterfinal: 'Quarterfinals',
      semifinal:    'Semifinals',
      final:        'Final',
    };

    const frag = document.createDocumentFragment();

    for (const round of ROUND_ORDER) {
      const roundMatches = this._matches
        .filter(m => m.round === round)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      if (!roundMatches.length) continue;

      const section = document.createElement('div');
      section.className = 'sched-section';

      const rh = document.createElement('div');
      rh.className = 'sched-round-header';
      rh.textContent = ROUND_LABELS[round] || round;
      section.appendChild(rh);

      if (round === 'group') {
        // Sub-group by group letter
        const byGroup = {};
        for (const m of roundMatches) {
          const g = findTeamGroup(m.homeTeam) || findTeamGroup(m.awayTeam) || '?';
          (byGroup[g] = byGroup[g] || []).push(m);
        }
        for (const groupLetter of Object.keys(byGroup).sort()) {
          const gs = document.createElement('div');
          gs.className = 'sched-group-section';
          const gh = document.createElement('div');
          gh.className = 'sched-group-header';
          gh.textContent = `Group ${groupLetter}`;
          gs.appendChild(gh);
          for (const m of byGroup[groupLetter]) gs.appendChild(_buildMatchRow(m));
          section.appendChild(gs);
        }
      } else {
        for (const m of roundMatches) section.appendChild(_buildMatchRow(m));
      }

      frag.appendChild(section);
    }

    container.innerHTML = '';
    container.appendChild(frag);
  }

  _renderGroups() {
    const container = document.getElementById('groups-container');
    if (!container) return;

    const standings = computeGroupStandings(this._matches);
    const advanced  = determineAdvancedTeams(this._matches, null);

    // A group is complete when all 6 of its matches are finished
    const groupComplete = {};
    for (const g of Object.keys(GROUPS)) {
      const done = this._matches.filter(m =>
        m.round === 'group' && isFinished(m.status) &&
        (findTeamGroup(m.homeTeam) === g || findTeamGroup(m.awayTeam) === g)
      ).length;
      groupComplete[g] = done >= 6;
    }

    const grid = document.createElement('div');
    grid.className = 'groups-grid';

    for (const groupLetter of Object.keys(GROUPS).sort()) {
      const card = document.createElement('div');
      card.className = 'group-card';

      const hdr = document.createElement('div');
      hdr.className = 'group-card-header';
      hdr.textContent = `Group ${groupLetter}`;
      card.appendChild(hdr);

      const tbl = document.createElement('table');
      tbl.className = 'group-table';
      tbl.innerHTML = `<thead><tr>
        <th class="gt-pos">#</th>
        <th class="gt-team">Team</th>
        <th class="gt-stat">P</th>
        <th class="gt-stat">W</th>
        <th class="gt-stat">D</th>
        <th class="gt-stat">L</th>
        <th class="gt-stat gt-pts">Pts</th>
      </tr></thead>`;
      const tbody = document.createElement('tbody');

      standings[groupLetter].forEach((entry, i) => {
        const owner = TEAM_OWNER[entry.team];
        const color = owner ? OWNER_COLORS[owner] : null;
        const flag  = TEAM_FLAGS[entry.team] || '';
        const isAdv  = advanced.has(entry.team);
        const isElim = groupComplete[groupLetter] && !isAdv && i === 3;
        const badge  = isAdv ? ' ✅' : isElim ? ' ❌' : '';

        const tr = document.createElement('tr');
        tr.className = 'group-row';
        if (color) {
          const r = parseInt(color.slice(1,3), 16);
          const g = parseInt(color.slice(3,5), 16);
          const b = parseInt(color.slice(5,7), 16);
          tr.style.borderLeft = `3px solid ${color}`;
          tr.style.background = `rgba(${r},${g},${b},0.07)`;
        }

        const ownerHtml = owner
          ? `<span class="owner-badge" style="color:${color}">${owner}</span>`
          : '';

        tr.innerHTML = `
          <td class="gt-pos">${i + 1}</td>
          <td class="gt-team">
            <div class="gt-team-inner">
              <span class="gt-flag">${flag}</span>
              <span class="gt-tname">${entry.team}${badge}</span>
              ${ownerHtml}
            </div>
          </td>
          <td class="gt-stat">${entry.played}</td>
          <td class="gt-stat">${entry.won}</td>
          <td class="gt-stat">${entry.drawn}</td>
          <td class="gt-stat">${entry.lost}</td>
          <td class="gt-stat gt-pts">${entry.pts}</td>
        `;
        tbody.appendChild(tr);
      });

      tbl.appendChild(tbody);
      card.appendChild(tbl);
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
    document.getElementById('schedule-container').innerHTML =
      `<p class="error-msg">${msg}</p>`;
  }
}

// ── Match row builder (used by schedule tab) ───────────────────────────────────

function _buildMatchRow(m) {
  const live     = isLive(m.status);
  const finished = isFinished(m.status);
  const homeFlag = TEAM_FLAGS[m.homeTeam] || '';
  const awayFlag = TEAM_FLAGS[m.awayTeam] || '';

  const d       = new Date(m.date);
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  let centerHtml;
  if (finished) {
    centerHtml = `<span class="sched-score is-final">${m.homeScore}–${m.awayScore}</span>`;
  } else if (live) {
    const elapsed = m.elapsed != null ? `${m.elapsed}'` : 'LIVE';
    centerHtml = `<span class="sched-score is-live">${m.homeScore ?? 0}–${m.awayScore ?? 0}<span class="sched-live-dot"> ●</span></span>`;
  } else {
    centerHtml = `<span class="sched-vs">vs</span>`;
  }

  const statusLabel = finished ? 'FT' : live ? (m.elapsed != null ? `${m.elapsed}'` : '●') : timeStr;

  const row = document.createElement('div');
  row.className = `sched-match${live ? ' is-live' : ''}${finished ? ' is-final' : ''}`;
  row.innerHTML = `
    <span class="sched-date">${dateStr}</span>
    <span class="sched-team sched-home">${homeFlag ? `<span class="sched-flag">${homeFlag}</span>` : ''}<span class="sched-tname">${m.homeTeam}</span></span>
    <span class="sched-center">${centerHtml}</span>
    <span class="sched-team sched-away"><span class="sched-tname">${m.awayTeam}</span>${awayFlag ? `<span class="sched-flag">${awayFlag}</span>` : ''}</span>
    <span class="sched-status">${statusLabel}</span>
  `;
  return row;
}
