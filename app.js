/**
 * app.js — Scoring engine + data layer
 *
 * Data flow:
 *   1. Try GitHub Gist cache (fast, no quota cost).
 *   2. If cache is stale or missing, fetch from API-Football.
 *   3. On a successful API fetch, write result back to Gist.
 *
 * Expects CONFIG to be defined by config.js loaded before this script.
 */

// ── Scoring rules ──────────────────────────────────────────────────────────────
// Adjust point values here to match your league's rules.
const SCORING_RULES = {
  // Outfield goals
  goal_forward:    6,
  goal_midfielder: 5,
  goal_defender:   6,
  goal_goalkeeper: 10,

  // Assists
  assist:          3,

  // Clean sheets (GK / DEF who plays full 90)
  clean_sheet_gk:  6,
  clean_sheet_def: 4,
  clean_sheet_mid: 1,

  // Saves (per 3 saves)
  saves_per_3:     1,

  // Cards
  yellow_card:    -1,
  red_card:       -3,

  // Bonus / penalty
  penalty_saved:   5,
  penalty_missed: -2,
  own_goal:       -2,

  // Appearance (played at all)
  appearance:      1,
  // Appearance bonus for full 60+ minutes
  full_game:       1,
};

// Position string → scoring category
const POSITION_MAP = {
  G: 'goalkeeper',
  D: 'defender',
  M: 'midfielder',
  F: 'forward',
};

// ── Data layer ─────────────────────────────────────────────────────────────────

class DataLayer {
  constructor() {
    this._apiBase = 'https://api-football-v1.p.rapidapi.com/v3';
    this._gistApiBase = 'https://api.github.com/gists';
    this._source = null; // 'live' | 'cached' | 'error'
  }

  /** Fetch match fixtures and player stats for the configured league/season. */
  async getMatches() {
    // 1. Try Gist cache
    const cached = await this._readGistCache();
    if (cached && !this._isCacheStale(cached.fetchedAt)) {
      this._source = 'cached';
      return cached.matches;
    }

    // 2. Try API-Football
    try {
      const matches = await this._fetchFromAPI();
      this._source = 'live';
      // 3. Update cache (fire-and-forget — don't block render)
      this._writeGistCache(matches).catch(console.warn);
      return matches;
    } catch (apiErr) {
      console.warn('API-Football fetch failed:', apiErr.message);

      // Fall back to stale cache if we have one
      if (cached) {
        this._source = 'cached';
        return cached.matches;
      }

      this._source = 'error';
      throw new Error('No data available: API failed and no cache found.');
    }
  }

  get source() { return this._source; }

  // ── Private: API-Football ──────────────────────────────────────────────────

  async _fetchFromAPI() {
    const fixtures = await this._apiFetch(
      `/fixtures?league=${CONFIG.LEAGUE_ID}&season=${CONFIG.SEASON}`
    );

    // Enrich finished/live fixtures with player stats (rate-limit friendly:
    // fetch stats only for matches that are relevant — last 48 h or live)
    const relevant = fixtures.response.filter(f => {
      const status = f.fixture.status.short;
      return ['FT', 'AET', 'PEN', '1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'].includes(status);
    });

    const enriched = await Promise.allSettled(
      relevant.map(f => this._fetchPlayerStats(f))
    );

    // Merge stats back; keep fixtures without stats as-is
    enriched.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        relevant[i].players = result.value;
      }
    });

    return fixtures.response.map(f => {
      const enrichedMatch = relevant.find(r => r.fixture.id === f.fixture.id);
      return enrichedMatch || f;
    });
  }

  async _fetchPlayerStats(fixture) {
    const res = await this._apiFetch(`/fixtures/players?fixture=${fixture.fixture.id}`);
    return res.response; // array of team player stats
  }

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

  // ── Private: GitHub Gist cache ─────────────────────────────────────────────

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
      return JSON.parse(file.content);
    } catch {
      return null;
    }
  }

  async _writeGistCache(matches) {
    if (!CONFIG.GIST_ID || !CONFIG.GITHUB_TOKEN) return;
    const payload = { fetchedAt: Date.now(), matches };
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

  _isCacheStale(fetchedAt) {
    return Date.now() - fetchedAt > CONFIG.CACHE_TTL_MS;
  }
}

// ── Scoring engine ─────────────────────────────────────────────────────────────

class ScoringEngine {
  constructor() {
    this._data = new DataLayer();
    this._matches = [];
  }

  async init() {
    try {
      this._matches = await this._data.getMatches();
    } catch (err) {
      this._renderError(err.message);
      return;
    }

    this._updateStatusBar();
    this._renderMatches();
    this._renderLeaderboard();
  }

  /**
   * Calculate fantasy points for a single player across all matches.
   *
   * @param {object} playerEntry  — { name, position, team }
   * @returns {object}  { total, breakdown }
   */
  scorePlayer(playerEntry) {
    const { name, position } = playerEntry;
    const pos = POSITION_MAP[position] || 'midfielder';
    const breakdown = {};
    let total = 0;

    const add = (key, pts) => {
      if (!pts) return;
      total += pts;
      breakdown[key] = (breakdown[key] || 0) + pts;
    };

    for (const match of this._matches) {
      if (!match.players) continue;

      for (const team of match.players) {
        const playerData = team.players.find(
          p => p.player.name.toLowerCase() === name.toLowerCase()
        );
        if (!playerData) continue;

        const s = playerData.statistics[0];
        if (!s) continue;

        const minutesPlayed = s.games.minutes || 0;
        if (minutesPlayed === 0) continue;

        add('appearance', SCORING_RULES.appearance);
        if (minutesPlayed >= 60) add('full_game', SCORING_RULES.full_game);

        const goals = s.goals.total || 0;
        const goalKey = `goal_${pos}`;
        add(goalKey, goals * (SCORING_RULES[goalKey] || SCORING_RULES.goal_midfielder));

        const assists = s.goals.assists || 0;
        add('assist', assists * SCORING_RULES.assist);

        const ownGoals = s.goals.owngoals || 0;
        add('own_goal', ownGoals * SCORING_RULES.own_goal);

        if (s.goals.conceded === 0 && minutesPlayed >= 60) {
          const csKey = `clean_sheet_${pos}`;
          add(csKey, SCORING_RULES[csKey] || 0);
        }

        const saves = s.goalkeeper?.saves || 0;
        add('saves_per_3', Math.floor(saves / 3) * SCORING_RULES.saves_per_3);

        const penSaved  = s.penalty?.saved   || 0;
        const penMissed = s.penalty?.missed  || 0;
        add('penalty_saved',  penSaved  * SCORING_RULES.penalty_saved);
        add('penalty_missed', penMissed * SCORING_RULES.penalty_missed);

        if (s.cards.yellow) add('yellow_card', SCORING_RULES.yellow_card);
        if (s.cards.red)    add('red_card',    SCORING_RULES.red_card);
      }
    }

    return { total, breakdown };
  }

  // ── Rendering helpers ──────────────────────────────────────────────────────

  _updateStatusBar() {
    const badge = document.getElementById('data-source');
    const ts    = document.getElementById('last-updated');

    badge.textContent = this._data.source === 'live' ? 'Live' : 'Cached';
    badge.className   = `badge ${this._data.source}`;
    ts.textContent    = `Updated ${new Date().toLocaleTimeString()}`;
  }

  _renderMatches() {
    const container = document.getElementById('matches-container');
    if (!this._matches.length) {
      container.innerHTML = '<p class="loading">No matches yet.</p>';
      return;
    }

    // Show most recent 12 matches (finished or live)
    const relevant = this._matches
      .filter(m => ['FT','AET','PEN','1H','2H','HT','ET','BT','P','LIVE'].includes(
        m.fixture.status.short
      ))
      .slice(-12)
      .reverse();

    if (!relevant.length) {
      container.innerHTML = '<p class="loading">No completed matches yet.</p>';
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'matches-grid';

    for (const m of relevant) {
      const isLive = !['FT','AET','PEN'].includes(m.fixture.status.short);
      const card = document.createElement('div');
      card.className = `match-card${isLive ? ' live' : ''}`;

      const homeGoals = m.goals.home ?? '–';
      const awayGoals = m.goals.away ?? '–';
      const dateStr   = new Date(m.fixture.date).toLocaleDateString();
      const statusStr = isLive
        ? `<span class="status-live">${m.fixture.status.elapsed}'</span>`
        : m.fixture.status.long;

      card.innerHTML = `
        <div class="teams">
          <span>${m.teams.home.name}</span>
          <span class="score-line">${homeGoals} – ${awayGoals}</span>
          <span>${m.teams.away.name}</span>
        </div>
        <div class="meta">
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
    // ROSTER: define your league participants here.
    // Each entry: { name, teamName, picks: [{ name, position }] }
    // position: G = goalkeeper, D = defender, M = midfielder, F = forward
    const roster = window.ROSTER || [];

    const container = document.getElementById('leaderboard-container');

    if (!roster.length) {
      container.innerHTML = `
        <p class="error-msg">
          No roster defined. Add a <code>ROSTER</code> array to <code>config.js</code>.
        </p>`;
      return;
    }

    const standings = roster.map(participant => {
      let total = 0;
      const playerBreakdowns = participant.picks.map(pick => {
        const result = this.scorePlayer(pick);
        total += result.total;
        return { ...pick, ...result };
      });
      return { ...participant, total, playerBreakdowns };
    }).sort((a, b) => b.total - a.total);

    renderLeaderboard(standings);
  }

  _renderError(msg) {
    const badge = document.getElementById('data-source');
    badge.textContent = 'Error';
    badge.className = 'badge error';
    document.getElementById('leaderboard-container').innerHTML =
      `<p class="error-msg">${msg}</p>`;
    document.getElementById('matches-container').innerHTML =
      `<p class="error-msg">${msg}</p>`;
  }
}
