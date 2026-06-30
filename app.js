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
  'Kade':         [],
  'Zach':         [],
  'Konrad':       [],
  'Cody (Left)':  [],
  'Cody (Right)': [],
  'Scott':        [],
  'Brandon':      [],
  'Allan':        [],
};

// ── Owner → color map ─────────────────────────────────────────────────────────

const OWNER_COLORS = {
  'Kade':         '#e11d48',
  'Zach':         '#2563eb',
  'Konrad':       '#16a34a',
  'Cody (Left)':  '#f97316',
  'Cody (Right)': '#9333ea',
  'Scott':        '#0891b2',
  'Brandon':      '#ca8a04',
  'Allan':        '#14b8a6',
};

// Reverse map: team → participant name (populated below, updated by applyDraftToParticipants)
const TEAM_OWNER = {};
for (const [name, teams] of Object.entries(PARTICIPANTS)) {
  for (const t of teams) TEAM_OWNER[t] = name;
}

/**
 * Apply draft picks to PARTICIPANTS and rebuild TEAM_OWNER.
 * Called by DraftEngine whenever picks change.
 */
function applyDraftToParticipants(picks) {
  for (const name of Object.keys(PARTICIPANTS)) PARTICIPANTS[name] = [];
  for (const pick of picks) {
    if (pick.player in PARTICIPANTS) PARTICIPANTS[pick.player].push(pick.team);
  }
  for (const key of Object.keys(TEAM_OWNER)) delete TEAM_OWNER[key];
  for (const [name, teams] of Object.entries(PARTICIPANTS)) {
    for (const t of teams) TEAM_OWNER[t] = name;
  }
}

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
// Tier A: top favourites. Tier B: everyone else.

const TIER_A = new Set([
  'Spain', 'France', 'England', 'Brazil',
  'Argentina', 'Portugal', 'Germany', 'Netherlands',
]);

// ── Scoring ────────────────────────────────────────────────────────────────────
// Knockout pts and bonuses differ by tier.

const SCORING = {
  tierA: {
    group_win:       2,
    group_draw:      1,
    group_1st_bonus: 1,   // finishing/clinching 1st in group
    group_advance:   2,   // advancing from group stage (all groups must complete)
    round_of_32:     4,
    round_of_16:     6,
    quarterfinal:    9,
    semifinal:       12,
    champion:        20,
  },
  tierB: {
    group_win:       4,
    group_draw:      2,
    group_1st_bonus: 3,   // finishing/clinching 1st in group
    group_advance:   3,   // advancing from group stage (all groups must complete)
    round_of_32:     6,
    round_of_16:     9,
    quarterfinal:    12,
    semifinal:       16,
    champion:        20,
    giant_killer:    5,   // bonus for beating a Tier A team
  },
};

/** Returns the scoring table for a given team based on its tier. */
function scoringFor(teamName) {
  return TIER_A.has(teamName) ? SCORING.tierA : SCORING.tierB;
}

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

// ── Flag image URLs (flagcdn.com) ─────────────────────────────────────────────
// Windows Chrome/Edge do not render regional-indicator emoji flags.
// We use flagcdn.com images instead. TEAM_FLAGS kept for plain-text contexts
// (push notification bodies, etc.).

const FLAG_URLS = {
  // Group A
  Mexico:         'https://flagcdn.com/w40/mx.png',
  'South Korea':  'https://flagcdn.com/w40/kr.png',
  Czechia:        'https://flagcdn.com/w40/cz.png',
  'South Africa': 'https://flagcdn.com/w40/za.png',
  // Group B
  Switzerland:    'https://flagcdn.com/w40/ch.png',
  Canada:         'https://flagcdn.com/w40/ca.png',
  Bosnia:         'https://flagcdn.com/w40/ba.png',
  Qatar:          'https://flagcdn.com/w40/qa.png',
  // Group C
  Brazil:         'https://flagcdn.com/w40/br.png',
  Morocco:        'https://flagcdn.com/w40/ma.png',
  Haiti:          'https://flagcdn.com/w40/ht.png',
  Scotland:       'https://flagcdn.com/w40/gb-sct.png',
  // Group D
  USA:            'https://flagcdn.com/w40/us.png',
  Paraguay:       'https://flagcdn.com/w40/py.png',
  Australia:      'https://flagcdn.com/w40/au.png',
  Turkey:         'https://flagcdn.com/w40/tr.png',
  // Group E
  Germany:        'https://flagcdn.com/w40/de.png',
  Ecuador:        'https://flagcdn.com/w40/ec.png',
  'Ivory Coast':  'https://flagcdn.com/w40/ci.png',
  Curacao:        'https://flagcdn.com/w40/cw.png',
  // Group F
  Netherlands:    'https://flagcdn.com/w40/nl.png',
  Japan:          'https://flagcdn.com/w40/jp.png',
  Sweden:         'https://flagcdn.com/w40/se.png',
  Tunisia:        'https://flagcdn.com/w40/tn.png',
  // Group G
  Belgium:        'https://flagcdn.com/w40/be.png',
  Egypt:          'https://flagcdn.com/w40/eg.png',
  Iran:           'https://flagcdn.com/w40/ir.png',
  'New Zealand':  'https://flagcdn.com/w40/nz.png',
  // Group H
  Spain:          'https://flagcdn.com/w40/es.png',
  Uruguay:        'https://flagcdn.com/w40/uy.png',
  'Saudi Arabia': 'https://flagcdn.com/w40/sa.png',
  'Cape Verde':   'https://flagcdn.com/w40/cv.png',
  // Group I
  France:         'https://flagcdn.com/w40/fr.png',
  Senegal:        'https://flagcdn.com/w40/sn.png',
  Norway:         'https://flagcdn.com/w40/no.png',
  Iraq:           'https://flagcdn.com/w40/iq.png',
  // Group J
  Argentina:      'https://flagcdn.com/w40/ar.png',
  Austria:        'https://flagcdn.com/w40/at.png',
  Algeria:        'https://flagcdn.com/w40/dz.png',
  Jordan:         'https://flagcdn.com/w40/jo.png',
  // Group K
  Portugal:       'https://flagcdn.com/w40/pt.png',
  Colombia:       'https://flagcdn.com/w40/co.png',
  Congo:          'https://flagcdn.com/w40/cg.png',
  Uzbekistan:     'https://flagcdn.com/w40/uz.png',
  // Group L
  England:        'https://flagcdn.com/w40/gb-eng.png',
  Croatia:        'https://flagcdn.com/w40/hr.png',
  Ghana:          'https://flagcdn.com/w40/gh.png',
  Panama:         'https://flagcdn.com/w40/pa.png',
};

/**
 * Returns an <img> tag for a team's flag.
 * sizeClass: optional extra CSS class ('flag-img-sm' | 'flag-img-lg')
 * Falls back to emoji string for unknown teams (bracket placeholders etc.)
 */
function flagImg(team, sizeClass) {
  const url = FLAG_URLS[team];
  if (!url) return TEAM_FLAGS[team] || '';
  const cls = sizeClass ? `flag-img ${sizeClass}` : 'flag-img';
  return `<img src="${url}" alt="${team}" class="${cls}" loading="lazy">`;
}

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
  // Curaçao — ESPN uses the ç character, our data uses plain c
  'Curaçao':                  'Curacao',
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

/**
 * Returns 'home', 'away', or null (draw) for a finished match.
 * Accounts for penalty shootouts, where homeScore === awayScore
 * but m.shootoutWinner records the actual winner.
 */
function matchWinnerSide(m) {
  if (m.shootoutWinner) return m.shootoutWinner;
  if (m.homeScore > m.awayScore) return 'home';
  if (m.awayScore > m.homeScore) return 'away';
  return null;
}

/** Returns {won, drew} for `teamName` in match `m`. Accounts for penalty shootouts. */
function teamMatchResult(m, teamName) {
  const side   = m.homeTeam === teamName ? 'home' : 'away';
  const winner = matchWinnerSide(m);
  return { won: winner === side, drew: winner === null };
}

// ── ESPN status → internal status ─────────────────────────────────────────────

function mapEspnStatus(espnName, state) {
  switch (espnName) {
    case 'STATUS_SCHEDULED':   return 'NS';
    case 'STATUS_IN_PROGRESS': return 'LIVE';
    case 'STATUS_FIRST_HALF':  return '1H';
    case 'STATUS_SECOND_HALF': return '2H';
    case 'STATUS_HALFTIME':    return 'HT';
    case 'STATUS_OVERTIME':    return 'ET';
    case 'STATUS_SHOOTOUT':    return 'P';
    case 'STATUS_FINAL':       return 'FT';
    case 'STATUS_FULL_TIME':   return 'FT';
    case 'STATUS_FINAL_AET':   return 'AET';
    case 'STATUS_FINAL_PEN':   return 'PEN';
    case 'STATUS_POSTPONED':   return 'PST';
    case 'STATUS_SUSPENDED':   return 'SUSP';
    case 'STATUS_CANCELED':    return 'CANC';
    default:
      // Unknown status name — fall back to ESPN's state field, which is
      // always one of 'pre' | 'in' | 'post' regardless of the name.
      if (state === 'in')   return 'LIVE';
      if (state === 'post') return 'FT';
      if (state === 'pre')  return 'NS';
      return espnName;
  }
}

// ── Data layer ─────────────────────────────────────────────────────────────────

const LS_MATCHES_KEY = 'wc_espn_v3'; // v3: cached parses now include per-goal details

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
      const now = Date.now();
      const ttl = local.data.some(m => isLive(m.status))
        ? CONFIG.CACHE_TTL_LIVE_MS
        : CONFIG.CACHE_TTL_IDLE_MS;
      // Bypass cache if any NS match's kickoff has already passed — it may be live now
      const hasUndetectedLive = local.data.some(
        m => m.status === 'NS' && m.date && new Date(m.date).getTime() <= now
      );
      if (!this._isStale(local.fetchedAt, ttl) && !hasUndetectedLive) {
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
      const status = mapEspnStatus(st.name, st.state);

      // Parse elapsed minutes from displayClock (e.g. "45'" → 45)
      const clockStr = comp.status.displayClock || '';
      const elapsed  = isPre ? null : (parseInt(clockStr) || null);

      // Goal-by-goal detail (scorer, minute, side) from ESPN's details array.
      // Excludes shootout kicks — those would spam the wire.
      const goals = [];
      for (const d of comp.details ?? []) {
        if (!d.scoringPlay || d.shootout) continue;
        const side    = String(d.team?.id) === String(home.team.id) ? 'home' : 'away';
        const scorer  = d.athletesInvolved?.[0]?.shortName
                     || d.athletesInvolved?.[0]?.displayName || '';
        goals.push({
          minute:   d.clock?.displayValue || '',
          clockSec: d.clock?.value ?? 0,
          side,
          scorer,
          ownGoal:  !!d.ownGoal,
          penalty:  !!d.penaltyKick,
        });
      }
      goals.sort((a, b) => a.clockSec - b.clockSec);

      // Penalty shootouts leave homeScore === awayScore (regulation/ET score).
      // ESPN flags the actual winner via competitor.winner — use it to break the tie.
      let shootoutWinner = null;
      if (status === 'PEN') {
        if (home.winner === true) shootoutWinner = 'home';
        else if (away.winner === true) shootoutWinner = 'away';
      }

      parsed.push({
        matchId:    parseInt(e.id),
        homeTeam,
        awayTeam,
        homeScore:  isPre ? null : parseInt(home.score),
        awayScore:  isPre ? null : parseInt(away.score),
        shootoutWinner, // 'home' | 'away' | null
        status,
        statusLong: st.description || st.name,
        elapsed,
        round:      parseRound(e.season?.slug),
        date:       e.date,
        goals,
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

// ── Shared match list (read by sidebets.js for game picker) ───────────────────
// Set by ScoringEngine each time it fetches; safe to read from other modules.
let _loadedMatches = [];

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
  const advanced = new Set();

  // Teams in completed knockout fixtures have advanced
  for (const m of matches) {
    if (m.round !== 'group' && isFinished(m.status)) {
      advanced.add(m.homeTeam);
      advanced.add(m.awayTeam);
    }
  }

  // Group-based advancement only awarded when ALL 12 groups are complete
  const standings = computeGroupStandings(matches);
  let completedGroups = 0;
  for (const rows of Object.values(standings)) {
    if (rows.length && rows[0].played >= 3) completedGroups++;
  }

  if (completedGroups === 12) {
    const thirdPlace = [];
    for (const rows of Object.values(standings)) {
      if (rows[0]) advanced.add(rows[0].team);
      if (rows[1]) advanced.add(rows[1].team);
      if (rows[2]) thirdPlace.push(rows[2]);
    }
    thirdPlace.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd  !== a.gd)  return b.gd  - a.gd;
      return b.gf - a.gf;
    });
    for (const t of thirdPlace.slice(0, 8)) {
      advanced.add(t.team);
    }
  }

  return advanced;
}

/**
 * Returns a Set of teams that have won (or mathematically clinched 1st in)
 * their group. A team clinches when no rival can finish above them:
 *   - rival's max pts < leader's current pts (can't catch up), OR
 *   - rival's max pts == leader's pts AND leader beat them head-to-head
 */
function determineGroupWinners(matches) {
  const standings = computeGroupStandings(matches);
  const h2h      = _buildH2HResults(matches);
  const winners   = new Set();
  for (const rows of Object.values(standings)) {
    if (!rows.length) continue;

    if (rows[0].played >= 3) {
      winners.add(rows[0].team);
      continue;
    }

    const leader = rows[0];
    let clinched = leader.played > 0;
    for (let i = 1; i < rows.length; i++) {
      const rival = rows[i];
      const rivalMaxPts = rival.pts + 3 * (3 - rival.played);
      if (rivalMaxPts > leader.pts) {
        clinched = false;
        break;
      }
      if (rivalMaxPts === leader.pts && !h2h.get(`${leader.team}>${rival.team}`)) {
        clinched = false;
        break;
      }
    }
    if (clinched) winners.add(leader.team);
  }
  return winners;
}

/** Builds a Map of head-to-head wins: key "A>B" = true means A beat B. */
function _buildH2HResults(matches) {
  const results = new Map();
  for (const m of matches) {
    if (m.round !== 'group' || !isFinished(m.status)) continue;
    if (m.homeScore > m.awayScore) results.set(`${m.homeTeam}>${m.awayTeam}`, true);
    else if (m.awayScore > m.homeScore) results.set(`${m.awayTeam}>${m.homeTeam}`, true);
  }
  return results;
}

/** Returns a Set of teams that have been eliminated from the tournament. */
function _computeEliminatedTeams(matches, advancedTeams) {
  const eliminated = new Set();
  const groupStandings = computeGroupStandings(matches);

  // Group stage: teams whose group is complete and who didn't advance
  for (const rows of Object.values(groupStandings)) {
    if (!rows.length || rows[0].played < 3) continue;
    for (const row of rows) {
      if (!advancedTeams.has(row.team)) eliminated.add(row.team);
    }
  }

  // Knockout: teams that lost a finished knockout match
  for (const m of matches) {
    if (m.round === 'group' || !isFinished(m.status)) continue;
    if (m.homeScore === null || m.awayScore === null) continue;
    const winner = matchWinnerSide(m);
    if (winner === 'home') eliminated.add(m.awayTeam);
    else if (winner === 'away') eliminated.add(m.homeTeam);
  }

  return eliminated;
}

// ── Per-team scorer ────────────────────────────────────────────────────────────

/**
 * Score a single team across all finished matches.
 *
 * @returns {{
 *   wins:        number,
 *   draws:       number,
 *   bonuses:     number,  — group_advance + group_1st_bonus
 *   knockoutPts: number,
 *   total:       number,
 * }}
 */
function _scoreTeam(teamName, matches, advancedTeams, groupWinners) {
  const tier = scoringFor(teamName);
  let wins = 0, draws = 0, bonuses = 0, knockoutPts = 0, giantKillerPts = 0, played = 0;

  for (const m of matches) {
    if (!isFinished(m.status)) continue;
    if (m.homeTeam !== teamName && m.awayTeam !== teamName) continue;

    played++;
    const oppTeam = m.homeTeam === teamName ? m.awayTeam : m.homeTeam;
    const { won, drew } = teamMatchResult(m, teamName);

    if (m.round === 'group') {
      if (won)       wins++;
      else if (drew) draws++;
    } else if (won) {
      const key = ROUND_SCORE_KEY[m.round];
      if (key) knockoutPts += tier[key];
    }

    // Giant Killer: Tier B team beats a Tier A team in the group stage
    if (m.round === 'group' && won && tier.giant_killer && TIER_A.has(oppTeam)) {
      giantKillerPts += tier.giant_killer;
    }
  }

  let advanceBonus = 0, firstBonus = 0;
  if (advancedTeams.has(teamName)) advanceBonus = tier.group_advance;
  if (groupWinners.has(teamName))  firstBonus   = tier.group_1st_bonus;
  bonuses = advanceBonus + firstBonus;

  const total = wins * tier.group_win + draws * tier.group_draw + bonuses + knockoutPts + giantKillerPts;
  return { wins, draws, bonuses, advanceBonus, firstBonus, knockoutPts, giantKillerPts, total, played };
}

// ── Score history builder ──────────────────────────────────────────────────────

/**
 * Build a chronological list of scoring events for one participant.
 * Each entry: { date, matchId, team, event, pts, runningTotal }
 */
function _buildScoreHistory(teamNames, matches, advancedTeams, groupWinners) {
  const events = [];
  const advanceBonusAwarded = new Set();
  const firstBonusAwarded   = new Set();
  let running = 0;

  const finished = matches
    .filter(m => isFinished(m.status))
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  for (const m of finished) {
    for (const teamName of teamNames) {
      if (m.homeTeam !== teamName && m.awayTeam !== teamName) continue;

      const { won, drew } = teamMatchResult(m, teamName);
      const tier = scoringFor(teamName);

      // Advance bonus — only fires on first knockout appearance (held until all groups done)
      if (m.round !== 'group') {
        if (!advanceBonusAwarded.has(teamName) && advancedTeams.has(teamName)) {
          advanceBonusAwarded.add(teamName);
          running += tier.group_advance;
          events.push({ date: m.date, matchId: null, team: teamName,
            event: 'group_advance', pts: tier.group_advance, runningTotal: running });
        }
      }

      let pts = 0, event = '';

      if (m.round === 'group') {
        if (won) {
          pts   = tier.group_win;
          event = 'group_win';
        } else if (drew) {
          pts   = tier.group_draw;
          event = 'group_draw';
        }
      } else if (won) {
        const key = ROUND_SCORE_KEY[m.round];
        if (key) { pts = tier[key]; event = key; }
      }

      if (pts > 0) {
        running += pts;
        events.push({ date: m.date, matchId: m.matchId, team: teamName, event, pts, runningTotal: running });
      }

      // Giant Killer bonus (group stage only)
      const oppTeam = m.homeTeam === teamName ? m.awayTeam : m.homeTeam;
      if (m.round === 'group' && won && tier.giant_killer && TIER_A.has(oppTeam)) {
        running += tier.giant_killer;
        events.push({ date: m.date, matchId: m.matchId, team: teamName,
          event: 'giant_killer', pts: tier.giant_killer, runningTotal: running });
      }

      // Group 1st bonus — award as soon as team clinches (can happen during group play)
      if (!firstBonusAwarded.has(teamName) && groupWinners.has(teamName)) {
        firstBonusAwarded.add(teamName);
        running += tier.group_1st_bonus;
        events.push({ date: m.date, matchId: null, team: teamName,
          event: 'group_1st', pts: tier.group_1st_bonus, runningTotal: running });
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
  const groupWinners  = determineGroupWinners(matches);
  const eliminated    = _computeEliminatedTeams(matches, advancedTeams);

  const results = Object.entries(PARTICIPANTS).map(([name, teamNames]) => {
    const teamBreakdown = {};
    let totalWins = 0;

    for (const teamName of teamNames) {
      const td = _scoreTeam(teamName, matches, advancedTeams, groupWinners);
      td.eliminated = eliminated.has(teamName);
      teamBreakdown[teamName] = td;
      totalWins += td.wins;
    }

    const totalScore = Object.values(teamBreakdown).reduce((s, t) => s + t.total, 0);
    const totalGP    = Object.values(teamBreakdown).reduce((s, t) => s + (t.played ?? 0), 0);
    const scoreHistory = _buildScoreHistory(teamNames, matches, advancedTeams, groupWinners);

    // Same-group conflict flag (currently only possible for Logan: USA + Switzerland)
    const flags = [];
    const [t1, t2] = teamNames;
    const g1 = findTeamGroup(t1);
    const g2 = findTeamGroup(t2);
    if (g1 && g2 && g1 === g2) {
      flags.push(`same-group conflict: ${t1} and ${t2} are both in Group ${g1}`);
    }

    return { name, teams: teamNames, totalScore, totalGP, teamBreakdown, scoreHistory, flags, _wins: totalWins };
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

  async _fetchAndRender(forceFresh = false) {
    // When polling live matches, bypass localStorage cache so we always get fresh data
    if (forceFresh) {
      try { localStorage.removeItem(LS_MATCHES_KEY); } catch {}
    }

    try {
      this._matches  = await this._data.fetchMatches();
      this._standings = null;
    } catch (err) {
      console.warn('fetchMatches failed, rendering with empty data:', err.message);
      this._matches   = [];
      this._standings = null;
      this._data.source = 'error';
    }
    _loadedMatches = this._matches; // expose for sidebets game picker

    this._updateHeader();
    // Tournament underway — kill the kickoff countdown regardless of its target time
    if (this._matches.some(m => isLive(m.status) || isFinished(m.status))) {
      const cd = document.getElementById('tournament-countdown');
      if (cd) cd.hidden = true;
    }
    // Let sidebets.js refresh the wire when bets load/change between polls
    window.__rerenderWire = () => {
      this._renderFeed();
      if (typeof _renderRightRail === 'function') _renderRightRail(this._matches);
    };
    this._renderLiveBanner();
    this._renderSchedule();
    this._renderGroups();
    this._renderFeed();
    this._renderLeaderboard();

    // Fire push notifications for any new scoring events
    if (typeof NotificationEngine !== 'undefined') {
      NotificationEngine.checkAndNotify(this._matches);
    }
  }

  /**
   * Schedule the next auto-refresh.
   * When a live match is in progress: poll every 60 s and bypass cache.
   * Otherwise: poll on CACHE_TTL_IDLE_MS (60 min).
   */
  _scheduleRefresh() {
    clearTimeout(this._refreshTimer);
    const now     = Date.now();
    const anyLive = this._matches.some(m => isLive(m.status));

    let ttl;
    if (anyLive) {
      ttl = 60 * 1000;
    } else {
      // Schedule refresh at the next NS match kickoff (+ 30s buffer), capped at idle TTL
      const nextKickoff = this._matches
        .filter(m => m.status === 'NS' && m.date)
        .map(m => new Date(m.date).getTime())
        .filter(t => t > now)
        .sort((a, b) => a - b)[0];
      const msUntilNext = nextKickoff != null ? nextKickoff - now + 30_000 : Infinity;
      ttl = Math.min(msUntilNext, CONFIG.CACHE_TTL_IDLE_MS);
    }

    this._nextRefreshAt = now + ttl;
    this._refreshTimer  = setTimeout(async () => {
      await this._fetchAndRender(anyLive); // force-fresh only when live
      this._scheduleRefresh();
    }, ttl);
    startCountdown(this._nextRefreshAt);
  }

  // ── Rendering helpers ──────────────────────────────────────────────────────

  _renderLiveBanner() {
    const container = document.getElementById('live-banner');
    if (!container) return;

    const live = getLiveMatches(this._matches);
    container.innerHTML = '';

    if (!live.length) {
      container.hidden = true;
      return;
    }

    container.hidden = false;
    for (const m of live) {
      container.appendChild(_buildLiveBannerCard(m));
    }
  }

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

    const ROUND_LABELS = {
      group:             'Group Stage',
      round_of_32:       'R32',
      round_of_16:       'R16',
      quarterfinal:      'QF',
      semifinal:         'SF',
      '3rd-place-match': '3rd Place',
      final:             'Final',
    };

    // Group matches by calendar date, sorted chronologically
    const byDay = {};
    const sorted = [...this._matches].sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const m of sorted) {
      const key = new Date(m.date).toDateString();
      (byDay[key] = byDay[key] || []).push(m);
    }

    const frag = document.createDocumentFragment();
    const todayStr = new Date().toDateString();

    for (const [dayKey, dayMatches] of Object.entries(byDay)) {
      const section = document.createElement('div');
      section.className = 'sched-section';
      // Mark section round-type for filter chips (use majority round in the day)
      const hasGroup   = dayMatches.some(m => m.round === 'group');
      const hasKnockout = dayMatches.some(m => m.round !== 'group');
      section.dataset.roundType = hasGroup && !hasKnockout ? 'group'
                                 : !hasGroup && hasKnockout ? 'knockout'
                                 : 'mixed';

      const d = new Date(dayMatches[0].date);
      const isToday = dayKey === todayStr;
      const dateLabel = isToday
        ? 'TODAY'
        : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

      // Round tags for days with multiple rounds
      const rounds = [...new Set(dayMatches.map(m => ROUND_LABELS[m.round] || m.round))];
      const roundTag = rounds.length === 1 && rounds[0] === 'Group Stage' ? '' : rounds.join(' · ');

      const rh = document.createElement('div');
      rh.className = `sched-round-header${isToday ? ' is-today' : ''}`;
      rh.innerHTML = `<span>${dateLabel}</span>${roundTag ? `<span class="sched-day-rounds">${roundTag}</span>` : ''}`;
      section.appendChild(rh);

      for (const m of dayMatches) {
        const row = _buildMatchRow(m);
        row.dataset.roundType = m.round === 'group' ? 'group' : 'knockout';
        section.appendChild(row);
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
        const owner      = TEAM_OWNER[entry.team];
        const color      = owner ? OWNER_COLORS[owner] : null;
        const flag       = flagImg(entry.team);
        const complete   = groupComplete[groupLetter];
        // After groups finish: use official advancement from knockout bracket.
        // During group stage: top 2 in current standings are "on track".
        const isAdv      = complete ? advanced.has(entry.team) : (i < 2);
        const isElim     = complete && !advanced.has(entry.team) && i >= 2;
        const badge      = (complete && advanced.has(entry.team)) ? ' ✅'
                         : (complete && isElim)                   ? ' ❌'
                         : '';

        const tr = document.createElement('tr');
        tr.className = 'group-row';
        if (isAdv) tr.dataset.advancing = '1';
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

  _renderFeed() {
    const container = document.getElementById('feed-container');
    if (!container) return;

    const feed = buildWireFeed(this._matches);
    if (!feed.length) {
      container.innerHTML = `
        <div class="feed-empty">
          <span class="feed-empty-icon">⚽</span>
          <p>The tournament begins June 11.</p>
          <p class="feed-empty-sub">Check back here for live scoring updates.</p>
        </div>`;
      return;
    }

    // Volume line in the page head
    const sup = document.querySelector('#panel-wire .va4-sup');
    if (sup) {
      const today = feed.filter(i => new Date(i.date).toDateString() === new Date().toDateString());
      const byKind = {};
      for (const i of today) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
      const plur = (n, w) => `${n} ${w}${n !== 1 ? 's' : ''}`;
      const parts = [
        byKind.goal  && plur(byKind.goal, 'goal'),
        byKind.final && plur(byKind.final, 'final'),
        byKind.rank  && plur(byKind.rank, 'rank move'),
        byKind.bet   && plur(byKind.bet, 'bet'),
      ].filter(Boolean).join(' · ');
      sup.textContent = today.length
        ? `League events · ${today.length} today${parts ? ` · ${parts}` : ''}`
        : 'League events · newest first';
    }

    const frag = document.createDocumentFragment();
    const wrap = document.createElement('div');
    wrap.className = 'wire-list';
    let lastDay = null;
    const todayStr = new Date().toDateString();
    for (const item of feed) {
      const day = new Date(item.date).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        const hdr = document.createElement('div');
        hdr.className = 'wire-day-header';
        const d = new Date(item.date);
        const lbl = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
        hdr.textContent = day === todayStr ? `${lbl} · TODAY` : lbl;
        wrap.appendChild(hdr);
      }
      wrap.appendChild(_buildWireRow(item));
    }
    frag.appendChild(wrap);
    container.innerHTML = '';
    container.appendChild(frag);

    // Re-apply the active chip filter after re-render
    const active = document.querySelector('#panel-wire .va4-chip-active');
    if (active && typeof _applyWireFilter === 'function') _applyWireFilter(active.textContent.trim());
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
  const homeFlag = flagImg(m.homeTeam);
  const awayFlag = flagImg(m.awayTeam);

  const d       = new Date(m.date);
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  let centerHtml;
  if (finished) {
    const pensTag = m.status === 'PEN' ? `<span class="sched-pens-tag">PK</span>` : '';
    centerHtml = `<span class="sched-score is-final">${m.homeScore}–${m.awayScore}${pensTag}</span>`;
  } else if (live) {
    const elapsed = m.elapsed != null ? `${m.elapsed}'` : 'LIVE';
    centerHtml = `<span class="sched-score is-live">${m.homeScore ?? 0}–${m.awayScore ?? 0}<span class="sched-live-dot"> ●</span></span>`;
  } else {
    centerHtml = `<span class="sched-vs">vs</span>`;
  }

  const statusLabel = finished ? 'FT' : live ? (m.elapsed != null ? `${m.elapsed}'` : '●') : timeStr;

  const homeOwner = TEAM_OWNER[m.homeTeam];
  const awayOwner = TEAM_OWNER[m.awayTeam];
  const homeColor = homeOwner ? (OWNER_COLORS[homeOwner] || '#9A9A93') : null;
  const awayColor = awayOwner ? (OWNER_COLORS[awayOwner] || '#9A9A93') : null;

  function _matchPts(teamName, isHome) {
    if (!finished || m.homeScore === null) return null;
    const opp = isHome ? m.awayTeam  : m.homeTeam;
    const tier = scoringFor(teamName);
    const { won, drew } = teamMatchResult(m, teamName);
    if (won) {
      const gk = (!TIER_A.has(teamName) && TIER_A.has(opp)) ? (tier.giant_killer ?? 0) : 0;
      const base = m.round === 'group' ? tier.group_win : (tier[ROUND_SCORE_KEY[m.round]] ?? 0);
      return base + gk;
    }
    if (drew && m.round === 'group') return tier.group_draw ?? 0;
    return 0;
  }

  function _ownerTag(owner, color, pts) {
    if (!owner) return '';
    const ptsHtml = pts !== null
      ? `<span class="sched-owner-pts${pts > 0 ? ' has-pts' : ''}">${pts > 0 ? `+${pts}` : '0'}</span>`
      : '';
    return `<span class="sched-owner-name" style="color:${color}">${escHtml(owner)}${ptsHtml}</span>`;
  }

  const homePts = homeOwner ? _matchPts(m.homeTeam, true)  : null;
  const awayPts = awayOwner ? _matchPts(m.awayTeam, false) : null;

  const row = document.createElement('div');
  row.className = `sched-match${live ? ' is-live' : ''}${finished ? ' is-final' : ''}${(homeOwner || awayOwner) ? ' has-owner' : ''}`;
  row.innerHTML = `
    <span class="sched-date">${dateStr}</span>
    <span class="sched-team sched-home">
      <span class="sched-team-inner"><span class="sched-flag">${homeFlag}</span><span class="sched-tname">${m.homeTeam}</span></span>
      ${_ownerTag(homeOwner, homeColor, homePts)}
    </span>
    <span class="sched-center">${centerHtml}</span>
    <span class="sched-team sched-away">
      <span class="sched-team-inner"><span class="sched-flag">${awayFlag}</span><span class="sched-tname">${m.awayTeam}</span></span>
      ${_ownerTag(awayOwner, awayColor, awayPts)}
    </span>
    <span class="sched-status">${statusLabel}</span>
  `;
  return row;
}

// ── Live match banner ──────────────────────────────────────────────────────────

/**
 * Returns all currently live matches that involve at least one owned team.
 */
function getLiveMatches(matches) {
  return matches.filter(m =>
    isLive(m.status) && (TEAM_OWNER[m.homeTeam] || TEAM_OWNER[m.awayTeam])
  );
}

/**
 * Points the given team would earn if the current score holds at full time.
 * Does not include the group-advance bonus (depends on other matches).
 */
function _potentialMatchPts(match, teamName) {
  const isHome    = match.homeTeam === teamName;
  const teamScore = isHome ? match.homeScore : match.awayScore;
  const oppScore  = isHome ? match.awayScore : match.homeScore;

  if (teamScore === null || oppScore === null) return 0;

  const { won: winning, drew: drawing } = teamMatchResult(match, teamName);
  const tier    = scoringFor(teamName);

  const oppTeam = match.homeTeam === teamName ? match.awayTeam : match.homeTeam;
  const gkBonus = (match.round === 'group' && winning && tier.giant_killer && TIER_A.has(oppTeam)) ? tier.giant_killer : 0;

  if (match.round === 'group') {
    if (winning) return tier.group_win + gkBonus;
    if (drawing) return tier.group_draw;
    return 0;
  }

  if (winning) {
    const key = ROUND_SCORE_KEY[match.round];
    return (key ? tier[key] : 0) + gkBonus;
  }
  return 0;
}

const LIVE_ROUND_LABELS = {
  group:        'Group Stage',
  round_of_32:  'Round of 32',
  round_of_16:  'Round of 16',
  quarterfinal: 'Quarterfinal',
  semifinal:    'Semifinal',
  final:        'Final',
};

function _buildLiveBannerCard(m) {
  const homeFlag = flagImg(m.homeTeam);
  const awayFlag = flagImg(m.awayTeam);

  const elapsed = m.status === 'HT' ? 'HT'
                : m.elapsed != null  ? `${m.elapsed}'`
                : 'LIVE';

  const roundLabel = LIVE_ROUND_LABELS[m.round] || m.round || '';

  // Build one row per participant with an owned team in this match
  const ownerEntries = [];
  for (const [teamName, side] of [[m.homeTeam, 'home'], [m.awayTeam, 'away']]) {
    const owner = TEAM_OWNER[teamName];
    if (!owner) continue;

    const isHome    = side === 'home';
    const teamScore = isHome ? m.homeScore : m.awayScore;
    const oppScore  = isHome ? m.awayScore : m.homeScore;
    const pts       = _potentialMatchPts(m, teamName);
    const { won: teamWon, drew: teamDrew } = teamMatchResult(m, teamName);
    const situation = teamWon ? 'winning'
                    : teamDrew ? 'drawing'
                    : 'losing';

    ownerEntries.push({ owner, teamName, pts, situation, color: OWNER_COLORS[owner] || '#8090b8' });
  }

  const ownerRowsHtml = ownerEntries.map(({ owner, teamName, pts, situation, color }) => {
    const flag      = flagImg(teamName);
    const ptsTxt    = pts > 0 ? `+${pts} pts if ${situation === 'winning' ? 'lead holds' : 'score holds'}`
                              : 'no pts if score holds';
    const situClass = situation === 'winning' ? 'lbs-win' : situation === 'losing' ? 'lbs-lose' : 'lbs-draw';
    const situIcon  = situation === 'winning' ? '▲' : situation === 'losing' ? '▼' : '=';
    return `
      <div class="lbanner-owner-row">
        <span class="lbanner-owner-dot" style="background:${color}"></span>
        <span class="lbanner-owner-name" style="color:${color}">${escHtml(owner)}</span>
        <span class="lbanner-owner-team">${flag}\u202f${escHtml(teamName)}</span>
        <span class="lbanner-situ ${situClass}">${situIcon}</span>
        <span class="lbanner-pts ${pts > 0 ? 'lbp-pos' : 'lbp-zero'}">${escHtml(ptsTxt)}</span>
      </div>`;
  }).join('');

  // Side bets tagged to this specific match (provided by sidebets.js if loaded)
  const matchBets = (typeof getSideBetsForMatch === 'function')
    ? getSideBetsForMatch(m.homeTeam, m.awayTeam)
    : [];

  const sideBetsHtml = matchBets.length ? `
    <div class="lbanner-bets-wrap">
      <button class="lbanner-bets-toggle" aria-expanded="false">
        💰 ${matchBets.length} side bet${matchBets.length !== 1 ? 's' : ''}
      </button>
      <div class="lbanner-bets-panel" hidden>
        ${matchBets.map(b => {
          const p1c   = OWNER_COLORS[b.party1] || '#6b7280';
          const p2c   = OWNER_COLORS[b.party2] || '#6b7280';
          const isOpen = b.status === 'open';
          return `
            <div class="lbanner-bet-row">
              <span class="lbanner-bet-parties">
                <span style="color:${p1c};font-weight:700">${escHtml(b.party1)}</span>
                <span class="lbanner-bet-vs"> vs </span>
                <span style="color:${p2c};font-weight:700">${escHtml(b.party2)}</span>
              </span>
              <span class="lbanner-bet-desc">${escHtml(b.description)}</span>
              <span class="lbanner-bet-meta">${escHtml(b.stake)} ·
                <span class="${isOpen ? 'lbb-open' : 'lbb-done'}">
                  ${isOpen ? 'open' : `✓ ${escHtml(b.winner)}`}
                </span>
              </span>
            </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const el = document.createElement('div');
  el.className = 'live-banner-card';
  el.innerHTML = `
    <div class="lbanner-top">
      <span class="lbanner-live-pill"><span class="live-pulse-dot"></span>LIVE</span>
      <span class="lbanner-elapsed">${escHtml(elapsed)}</span>
      <span class="lbanner-round">${escHtml(roundLabel)}</span>
    </div>
    <div class="lbanner-match">
      <span class="lbanner-team lbanner-home">
        <span class="lbanner-flag">${homeFlag}</span>
        <span class="lbanner-tname">${escHtml(m.homeTeam)}</span>
      </span>
      <span class="lbanner-score">${m.homeScore ?? 0}–${m.awayScore ?? 0}</span>
      <span class="lbanner-team lbanner-away">
        <span class="lbanner-tname">${escHtml(m.awayTeam)}</span>
        <span class="lbanner-flag">${awayFlag}</span>
      </span>
    </div>
    <div class="lbanner-owners">${ownerRowsHtml}</div>
    ${sideBetsHtml}
  `;

  // Wire up the expand toggle
  if (matchBets.length) {
    const toggleBtn = el.querySelector('.lbanner-bets-toggle');
    const panel     = el.querySelector('.lbanner-bets-panel');
    const countTxt  = `💰 ${matchBets.length} side bet${matchBets.length !== 1 ? 's' : ''}`;
    toggleBtn.addEventListener('click', () => {
      const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
      toggleBtn.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
      toggleBtn.textContent = expanded ? countTxt : '▲ Hide bets';
    });
  }

  return el;
}

// ── Activity feed ──────────────────────────────────────────────────────────────

const FEED_EVENT_LABELS = {
  group_win:    'Group stage win',
  group_draw:   'Group stage draw',
  group_advance:'Advanced from group',
  group_1st:    'Won group (1st place)',
  giant_killer: 'Giant Killer bonus',
  round_of_32:  'Round of 32 win',
  round_of_16:  'Round of 16 win',
  quarterfinal: 'Quarterfinal win',
  semifinal:    'Semifinal win',
  champion:     'Won the World Cup',
};

/**
 * Build an activity feed from all completed scoring events across all participants.
 * Returns array of feed items sorted newest-first.
 *
 * Each item: { date, owner, team, event, pts, matchResult, homeTeam, awayTeam,
 *              homeScore, awayScore, matchId }
 */
function buildActivityFeed(matches) {
  const advancedTeams = determineAdvancedTeams(matches, null);
  const groupWinners  = determineGroupWinners(matches);
  const feed = [];

  // Track per-team bonuses so we emit each exactly once
  const advanceBonusEmitted = new Set();
  const firstBonusEmitted   = new Set();

  const finished = matches
    .filter(m => isFinished(m.status))
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  for (const m of finished) {
    // Check both sides for owned teams
    for (const teamName of [m.homeTeam, m.awayTeam]) {
      const owner = TEAM_OWNER[teamName];
      if (!owner) continue;

      const { won, drew } = teamMatchResult(m, teamName);
      const tier = scoringFor(teamName);

      // Advance bonus — first knockout appearance (held until all groups done)
      if (m.round !== 'group') {
        if (!advanceBonusEmitted.has(teamName) && advancedTeams.has(teamName)) {
          advanceBonusEmitted.add(teamName);
          feed.push({
            date: m.date, owner, team: teamName,
            event: 'group_advance', pts: tier.group_advance,
            homeTeam: m.homeTeam, awayTeam: m.awayTeam,
            homeScore: m.homeScore, awayScore: m.awayScore, matchId: null,
          });
        }
      }

      let pts = 0, event = '';
      if (m.round === 'group') {
        if (won) {
          pts   = tier.group_win;
          event = 'group_win';
        } else if (drew) {
          pts   = tier.group_draw;
          event = 'group_draw';
        }
      } else if (won) {
        const key = ROUND_SCORE_KEY[m.round];
        if (key) { pts = tier[key]; event = key; }
      }

      if (pts > 0) {
        feed.push({
          date: m.date, owner, team: teamName, event, pts,
          homeTeam: m.homeTeam, awayTeam: m.awayTeam,
          homeScore: m.homeScore, awayScore: m.awayScore, matchId: m.matchId,
        });
      }

      // Giant Killer bonus (group stage only)
      const oppTeam = m.homeTeam === teamName ? m.awayTeam : m.homeTeam;
      if (m.round === 'group' && won && tier.giant_killer && TIER_A.has(oppTeam)) {
        feed.push({
          date: m.date, owner, team: teamName, event: 'giant_killer', pts: tier.giant_killer,
          homeTeam: m.homeTeam, awayTeam: m.awayTeam,
          homeScore: m.homeScore, awayScore: m.awayScore, matchId: m.matchId,
        });
      }

      // Group 1st bonus — award as soon as team clinches
      if (!firstBonusEmitted.has(teamName) && groupWinners.has(teamName)) {
        firstBonusEmitted.add(teamName);
        feed.push({
          date: m.date, owner, team: teamName,
          event: 'group_1st', pts: tier.group_1st_bonus,
          homeTeam: m.homeTeam, awayTeam: m.awayTeam,
          homeScore: m.homeScore, awayScore: m.awayScore, matchId: null,
        });
      }
    }
  }

  // Newest first
  feed.sort((a, b) => new Date(b.date) - new Date(a.date));
  return feed;
}

function _buildFeedItem(item) {
  const color     = OWNER_COLORS[item.owner] || '#8090b8';
  const flag      = flagImg(item.team);
  const label     = FEED_EVENT_LABELS[item.event] || item.event;
  const isAdvance = item.event === 'group_advance' || item.event === 'group_1st';
  const isChamp   = item.event === 'champion';

  const d       = new Date(item.date);
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // Match result line — not shown for advance bonus (no specific match)
  let resultHtml = '';
  if (!isAdvance && item.homeScore !== null) {
    const homeFlag = flagImg(item.homeTeam);
    const awayFlag = flagImg(item.awayTeam);
    resultHtml = `
      <div class="feed-result">
        <span class="feed-result-team">${homeFlag}\u202f${escHtml(item.homeTeam)}</span>
        <span class="feed-result-score">${item.homeScore}–${item.awayScore}</span>
        <span class="feed-result-team">${awayFlag}\u202f${escHtml(item.awayTeam)}</span>
      </div>`;
  }

  const el = document.createElement('div');
  el.className = `feed-item${isChamp ? ' feed-item-champion' : ''}`;
  el.dataset.event = item.event;

  const r = parseInt(color.slice(1,3), 16);
  const g = parseInt(color.slice(3,5), 16);
  const b = parseInt(color.slice(5,7), 16);
  el.style.borderLeftColor = color;
  el.style.background = `rgba(${r},${g},${b},0.06)`;

  el.innerHTML = `
    <div class="feed-top">
      <span class="feed-flag">${flag}</span>
      <div class="feed-center">
        <div class="feed-event-row">
          <span class="feed-team-name">${escHtml(item.team)}</span>
          <span class="feed-event-label">${escHtml(label)}</span>
        </div>
        ${resultHtml}
      </div>
      <div class="feed-right">
        <span class="feed-pts">+${item.pts}</span>
        <span class="feed-owner" style="color:${color}">${escHtml(item.owner)}</span>
        <span class="feed-date">${dateStr} · ${timeStr}</span>
      </div>
    </div>
  `;
  return el;
}

// ── Wire feed (rule-generated event ticker) ────────────────────────────────────
// Richer than buildActivityFeed (which feeds notifications and stays as-is).
// Every entry is derived from data already on hand — ESPN matches, goal details,
// computed standings, and the Firebase side-bet list. No persistence needed.
//
// Item: { kind: 'goal'|'final'|'rank'|'giant'|'bet', date, text, owner?, color? }

function _wireRelTime(date) {
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 90_000)      return 'now';
  if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000)  return `${Math.floor(ms / 3_600_000)}h`;
  return new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function _ownerSpan(owner) {
  if (!owner) return '';
  const color = OWNER_COLORS[owner] || '#8090b8';
  return `<span class="wire-owner" style="color:${color}">${escHtml(owner)}</span>`;
}

/** One FINAL entry per finished match, with pts for both owners. */
function _wireFinalText(m) {
  const bits = [];
  for (const [team, opp] of [
    [m.homeTeam, m.awayTeam],
    [m.awayTeam, m.homeTeam],
  ]) {
    const owner = TEAM_OWNER[team];
    if (!owner) continue;
    const tier = scoringFor(team);
    const { won, drew } = teamMatchResult(m, team);
    let pts = 0;
    if (m.round === 'group') {
      if (won) {
        pts = tier.group_win;
        if (tier.giant_killer && TIER_A.has(opp)) pts += tier.giant_killer;
      } else if (drew) pts = tier.group_draw;
    } else if (won) {
      pts = tier[ROUND_SCORE_KEY[m.round]] ?? 0;
    }
    bits.push(pts > 0
      ? `${_ownerSpan(owner)} +${pts} pts`
      : (owner ? `${_ownerSpan(owner)} 0 pts` : ''));
  }
  const pensTag = m.status === 'PEN' ? ' (pens)' : '';
  return `FT — ${escHtml(m.homeTeam)} ${m.homeScore}–${m.awayScore}${pensTag} ${escHtml(m.awayTeam)}.` +
         (bits.length ? ` ${bits.join(' · ')}.` : '');
}

/** Replay finished matches chronologically; emit an item per rank move. */
function _wireRankEvents(matches) {
  const finished = matches
    .filter(m => isFinished(m.status))
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const out = [];
  let prev = null;
  for (let i = 0; i < finished.length; i++) {
    const ranks = {};
    for (const s of calculateScores(finished.slice(0, i + 1), null)) ranks[s.name] = s.rank;
    if (prev) {
      for (const name of Object.keys(ranks)) {
        if (ranks[name] === prev[name]) continue;
        const up  = ranks[name] < prev[name];
        const ord = n => `${n}${['th','st','nd','rd'][(n%100>10&&n%100<14)?0:Math.min(n%10,4)%4] || 'th'}`;
        out.push({
          kind:  'rank',
          date:  new Date(new Date(finished[i].date).getTime() + 96 * 60 * 1000).toISOString(),
          owner: name,
          text:  `${_ownerSpan(name)} ${up ? 'climbs' : 'drops'} to ${ord(ranks[name])} (was ${ord(prev[name])}) after ${escHtml(finished[i].homeTeam)}–${escHtml(finished[i].awayTeam)}.`,
        });
      }
    }
    prev = ranks;
  }
  return out;
}

function buildWireFeed(matches) {
  const items = [];

  // GOAL — every goal in live + finished matches (all 48 teams are owned)
  for (const m of matches) {
    if (!m.goals?.length) continue;
    if (!isLive(m.status) && !isFinished(m.status)) continue;
    let h = 0, a = 0;
    for (const g of m.goals) {
      g.side === 'home' ? h++ : a++;
      const team  = g.side === 'home' ? m.homeTeam : m.awayTeam;
      const owner = TEAM_OWNER[team];
      const tags  = [g.penalty && 'pen', g.ownGoal && 'OG'].filter(Boolean).join(', ');
      const when  = new Date(new Date(m.date).getTime() + g.clockSec * 1000);
      items.push({
        kind:  'goal',
        date:  when.toISOString(),
        owner,
        text:  `${escHtml(g.minute)} — ${escHtml(g.scorer || 'Goal')}${tags ? ` (${tags})` : ''} for ${escHtml(team)} (${h}–${a}).` +
               (owner ? ` ${_ownerSpan(owner)}` : ''),
      });
    }
  }

  // FINAL — one per finished match; timestamp at kickoff+95min so it sorts after goals
  for (const m of matches) {
    if (!isFinished(m.status)) continue;
    const ftDate = new Date(new Date(m.date).getTime() + 95 * 60 * 1000).toISOString();
    items.push({ kind: 'final', date: ftDate, text: _wireFinalText(m) });
  }

  // GIANT / ADVANCE — reuse the scoring feed for bonus-type events
  for (const ev of buildActivityFeed(matches)) {
    if (ev.event === 'giant_killer') {
      items.push({
        kind: 'giant', date: ev.date, owner: ev.owner,
        text: `Giant Killer — ${escHtml(ev.team)} took down a Tier A side. ${_ownerSpan(ev.owner)} +${ev.pts}.`,
      });
    } else if (ev.event === 'group_advance' || ev.event === 'group_1st') {
      const label = ev.event === 'group_1st' ? 'wins the group' : 'advances from the group';
      items.push({
        kind: 'final', date: ev.date, owner: ev.owner,
        text: `${escHtml(ev.team)} ${label}. ${_ownerSpan(ev.owner)} +${ev.pts}.`,
      });
    }
  }

  // RANK — standings movement after each final
  items.push(..._wireRankEvents(matches));

  // BET — side bets logged / settled (Firebase list exposed by sidebets.js)
  for (const b of (window._sideBets || [])) {
    items.push({
      kind: 'bet', date: new Date(b.createdAt).toISOString(),
      text: `Side bet logged · ${_ownerSpan(b.party1)} vs ${_ownerSpan(b.party2)}: ${escHtml(b.description)}. Stakes: ${escHtml(b.stake)}.`,
    });
    if (b.status === 'settled') {
      items.push({
        kind: 'bet', date: new Date(b.settledAt ?? b.createdAt).toISOString(),
        text: `Side bet settled · ${_ownerSpan(b.winner)} wins: ${escHtml(b.description)}. Stakes: ${escHtml(b.stake)}.`,
      });
    }
  }

  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  return items;
}

const WIRE_KIND_META = {
  goal:  { label: 'GOAL',  color: '#E0301E' },
  final: { label: 'FINAL', color: '#1A1A1A' },
  rank:  { label: 'RANK',  color: '#1F49E8' },
  giant: { label: 'GIANT', color: '#15803D' },
  bet:   { label: 'BET',   color: '#0891B2' },
};

function _buildWireRow(item) {
  const meta = WIRE_KIND_META[item.kind] || WIRE_KIND_META.final;
  const d    = new Date(item.date);
  const abs  = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const el = document.createElement('div');
  el.className = 'wire-row';
  el.dataset.kind = item.kind;
  el.innerHTML = `
    <span class="wire-pill" style="background:${meta.color}">${meta.label}</span>
    <span class="wire-text">${item.text}</span>
    <span class="wire-time">
      <span class="wire-ago">${_wireRelTime(item.date)}</span>
      <span class="wire-abs">${abs}</span>
    </span>
  `;
  return el;
}
