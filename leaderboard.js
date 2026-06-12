/**
 * leaderboard.js — Leaderboard rendering, right rail, rank-delta tracking,
 *                  countdown timer, tab navigation.
 *
 * VA4 redesign: broadcast-flavored scoreboard aesthetic.
 * Pitch-green leader accent · Anton/JetBrains Mono type · 0 border-radius
 *
 * Public API:
 *   renderLeaderboard(scores, matches)  — called by ScoringEngine after each fetch
 *   startCountdown(nextRefreshAt)        — called by ScoringEngine
 *   initCountdown()                      — called on DOMContentLoaded
 *   initTabs()                           — called on DOMContentLoaded
 */

// ── Module state ───────────────────────────────────────────────────────────────
let _prevRanks         = {};
let _countdownInterval = null;
let _currentMatches    = [];
let _lbFilter          = 'Overall'; // persists across ESPN re-fetches
let _rawScores         = [];        // unfiltered scores from last render
let _rawMatches        = [];

// ── Player monograms ───────────────────────────────────────────────────────────
const PLAYER_MONOS = {
  'Kade':         'KD',
  'Zach':         'ZH',
  'Konrad':       'KN',
  'Cody (Left)':  'CL',
  'Cody (Right)': 'CR',
  'Scott':        'ST',
  'Brandon':      'BN',
  'Allan':        'AL',
};

// ── Team 3-letter codes ────────────────────────────────────────────────────────
const TEAM_CODES = {
  Mexico:          'MEX', 'South Korea':  'KOR', Czechia:       'CZE', 'South Africa': 'RSA',
  Switzerland:     'SUI', Canada:         'CAN', Bosnia:        'BOS', Qatar:          'QAT',
  Brazil:          'BRA', Morocco:        'MAR', Haiti:         'HAI', Scotland:       'SCO',
  USA:             'USA', Paraguay:       'PAR', Australia:     'AUS', Turkey:         'TUR',
  Germany:         'GER', Ecuador:        'ECU', 'Ivory Coast': 'CIV', Curacao:        'CUR',
  Netherlands:     'NED', Japan:          'JPN', Sweden:        'SWE', Tunisia:        'TUN',
  Belgium:         'BEL', Egypt:          'EGY', Iran:          'IRN', 'New Zealand':  'NZL',
  Spain:           'ESP', Uruguay:        'URU', 'Saudi Arabia':'KSA', 'Cape Verde':   'CPV',
  France:          'FRA', Senegal:        'SEN', Norway:        'NOR', Iraq:           'IRQ',
  Argentina:       'ARG', Austria:        'AUT', Algeria:       'ALG', Jordan:         'JOR',
  Portugal:        'POR', Colombia:       'COL', Congo:         'CGO', Uzbekistan:     'UZB',
  England:         'ENG', Croatia:        'CRO', Ghana:         'GHA', Panama:         'PAN',
};

function _teamCode(name) {
  return TEAM_CODES[name] || name.slice(0, 3).toUpperCase();
}

// ── Main render ────────────────────────────────────────────────────────────────

/**
 * @param {object[]} scores  — output of calculateScores()
 * @param {object[]} matches — parsed match array
 */
function renderLeaderboard(scores, matches) {
  _currentMatches = matches || [];
  _prevRanks      = _loadPrevRanks();
  _rawScores      = scores;
  _rawMatches     = matches || [];

  // Update header status
  _updateHeaderStatus(matches);

  const container = document.getElementById('leaderboard-container');
  container.innerHTML = '';

  if (!scores.length) {
    container.innerHTML = '<p class="state-msg">No standings yet.</p>';
    return;
  }

  const frag = document.createDocumentFragment();
  frag.appendChild(_buildTableTopbar());
  frag.appendChild(_buildLbTable(_filterScores(scores, _lbFilter)));
  frag.appendChild(_buildLegend());
  container.appendChild(frag);

  _renderRightRail(matches);
  _savePrevRanks(scores); // always persist unfiltered ranks
}

// ── Header status ──────────────────────────────────────────────────────────────

function _updateHeaderStatus(matches) {
  if (!matches?.length) return;
  const info  = getCurrentRound(matches);
  const badge = document.getElementById('current-round');
  const dot   = document.getElementById('header-status-dot');
  if (badge) {
    badge.textContent = info.label;
    badge.classList.toggle('is-live', info.isLive);
  }
  if (dot) {
    dot.classList.toggle('is-live', info.isLive);
  }
}

// ── Table topbar ───────────────────────────────────────────────────────────────

function _buildTableTopbar() {
  const div = document.createElement('div');
  div.className = 'lb-topbar';
  div.innerHTML = `
    <div>
      <div class="lb-eyebrow">The League · Standings</div>
      <div class="lb-big-title">THE TABLE</div>
    </div>
    <div class="lb-view-filters">
      ${['Overall','Today'].map(f =>
        `<span class="lb-vf${f === _lbFilter ? ' active' : ''}">${f}</span>`
      ).join('')}
    </div>
  `;

  div.querySelectorAll('.lb-vf').forEach(chip => {
    chip.addEventListener('click', () => {
      _lbFilter = chip.textContent.trim();
      const container = document.getElementById('leaderboard-container');
      // Swap just the table, leave topbar + legend in place
      const old = container?.querySelector('.lb-table');
      if (old && _rawScores.length) {
        old.replaceWith(_buildLbTable(_filterScores(_rawScores, _lbFilter)));
      }
      // Update active chip
      container?.querySelectorAll('.lb-vf').forEach(c =>
        c.classList.toggle('active', c.textContent.trim() === _lbFilter)
      );
    });
  });

  return div;
}

// ── Leaderboard table builder ──────────────────────────────────────────────────

function _buildLbTable(scores) {
  const table = document.createElement('div');
  table.className = 'lb-table';
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Fantasy standings');
  table.appendChild(_buildColHeader());
  for (const entry of scores) table.appendChild(_buildEntry(entry));
  return table;
}

// ── Filter scores by time period ───────────────────────────────────────────────

function _filterScores(scores, label) {
  if (label === 'Overall') return scores;

  const today      = new Date().toDateString();
  const GRP_EVENTS = new Set(['group_win','group_draw','giant_killer','group_advance','group_1st']);
  const KO_EVENTS  = new Set(['round_of_32','round_of_16','quarterfinal','semifinal','champion']);

  const keep = label === 'Today'       ? e => new Date(e.date).toDateString() === today
             : label === 'Group Stage' ? e => GRP_EVENTS.has(e.event)
             : label === 'Knockouts'   ? e => KO_EVENTS.has(e.event)
             : null;
  if (!keep) return scores;

  const filtered = scores.map(entry => {
    const hist  = (entry.scoreHistory ?? []).filter(keep);
    const total = hist.reduce((s, e) => s + e.pts, 0);

    // Per-team totals for deck chip display
    const teamTotals = {};
    for (const ev of hist) teamTotals[ev.team] = (teamTotals[ev.team] ?? 0) + ev.pts;

    const breakdown = {};
    for (const [t, td] of Object.entries(entry.teamBreakdown ?? {})) {
      breakdown[t] = { ...td, total: teamTotals[t] ?? 0 };
    }

    return { ...entry, totalScore: total, teamBreakdown: breakdown, scoreHistory: hist };
  });

  // Re-sort by filtered total, re-rank (ties share rank)
  filtered.sort((a, b) => b.totalScore - a.totalScore);
  let nextRank = 1;
  for (let i = 0; i < filtered.length; i++) {
    const prev = filtered[i - 1];
    filtered[i] = {
      ...filtered[i],
      rank: (prev && prev.totalScore === filtered[i].totalScore) ? prev.rank : nextRank,
    };
    nextRank++;
  }
  return filtered;
}

// ── Column header ──────────────────────────────────────────────────────────────

function _buildColHeader() {
  const div = document.createElement('div');
  div.className = 'lb-col-header';
  div.setAttribute('aria-hidden', 'true');
  div.innerHTML = `
    <span class="lbch-pos">Pos</span>
    <span class="lbch-player">Player</span>
    <span class="lbch-deck">The Deck &middot; pts per team</span>
    <span class="lbch-form">Form L5</span>
    <span class="lbch-pts">Pts</span>
    <span class="lbch-delta">±</span>
  `;
  return div;
}

// ── Entry row ──────────────────────────────────────────────────────────────────

function _buildEntry(entry) {
  const prev      = _prevRanks[entry.name];
  const rankDelta = prev ? prev.rank - entry.rank : 0;
  const prevScore = prev?.score ?? null;

  const color    = (typeof OWNER_COLORS !== 'undefined' && OWNER_COLORS[entry.name]) || '#9A9A93';
  const mono     = PLAYER_MONOS[entry.name] || entry.name.slice(0, 2).toUpperCase();
  const form     = _buildPlayerForm(entry, _currentMatches);
  const isLeader = entry.rank === 1;

  // Rank number: leader gets 01 crown treatment
  const rankStr = String(entry.rank).padStart(2, '0');

  // Delta HTML
  let deltaHtml;
  if      (rankDelta > 0) deltaHtml = `<span class="rank-delta delta-up">▲${rankDelta}</span>`;
  else if (rankDelta < 0) deltaHtml = `<span class="rank-delta delta-down">▼${Math.abs(rankDelta)}</span>`;
  else                    deltaHtml = `<span class="rank-delta delta-same">—</span>`;

  // Conflict warning
  const conflictHtml = entry.flags?.length
    ? ` <span class="conflict-icon" title="${escHtml(entry.flags[0])}">⚠</span>`
    : '';

  const wrap = document.createElement('div');
  wrap.className = `lb-entry lb-rank-${Math.min(entry.rank, 4)}`;
  wrap.dataset.name = entry.name;

  wrap.innerHTML = `
    <div class="lb-main" role="button" tabindex="0"
         aria-expanded="false"
         aria-label="Score breakdown for ${escHtml(entry.name)}">
      <div class="lb-rank-cell">
        <span class="rank-num">${rankStr}</span>
        ${isLeader ? '<span class="leader-crown" aria-label="Leader">👑</span>' : ''}
      </div>
      <div class="lb-player-cell">
        <span class="lb-player-mono" style="background:${color}">${escHtml(mono)}</span>
        <span class="lb-name">${escHtml(entry.name)}${conflictHtml}</span>
      </div>
      <div class="lb-deck-cell">
        ${_buildDeckChips(entry.teams, entry.teamBreakdown)}
      </div>
      <div class="lb-form-cell">
        ${_buildFormDots(form)}
      </div>
      <div class="lb-score-cell">
        <span class="lb-score" data-score="${entry.totalScore}">${entry.totalScore}</span>
      </div>
      <div class="lb-delta-cell">
        ${deltaHtml}
      </div>
    </div>
    <div class="lb-breakdown" aria-hidden="true">
      ${_buildBreakdownHTML(entry)}
    </div>
  `;

  // Score flash animation when score changed
  if (prevScore !== null && prevScore !== entry.totalScore) {
    const scoreEl = wrap.querySelector('.lb-score');
    requestAnimationFrame(() => {
      scoreEl.classList.remove('score-flash');
      void scoreEl.offsetWidth;
      scoreEl.classList.add('score-flash');
      scoreEl.addEventListener('animationend', () => scoreEl.classList.remove('score-flash'), { once: true });
    });
  }

  // Click to expand/collapse breakdown
  wrap.querySelector('.lb-main').addEventListener('click', () => _toggleEntry(wrap, entry));

  return wrap;
}

// ── Deck chips ─────────────────────────────────────────────────────────────────

function _buildDeckChips(teams, breakdown) {
  return teams.map(teamName => {
    const td      = breakdown[teamName] ?? {};
    const pts     = td.total ?? 0;
    const isTierA = typeof TIER_A !== 'undefined' && TIER_A.has(teamName);
    const code    = _teamCode(teamName);
    const ptsText = pts > 0 ? `+${pts}` : '—';

    return `<div class="deck-chip${isTierA ? ' dc-tier-a' : ''}" title="${escHtml(teamName)}: ${pts} pts">
      <span class="dc-flag">${flagImg(teamName, 'flag-img-sm')}</span>
      <div class="dc-bottom">
        <span class="dc-code">${code}</span>
        <span class="dc-pts${pts > 0 ? ' has-pts' : ''}">${ptsText}</span>
      </div>
      ${isTierA ? '<span class="dc-tier-badge">A</span>' : ''}
    </div>`;
  }).join('');
}

// ── Form dots ──────────────────────────────────────────────────────────────────

function _buildFormDots(form) {
  if (!form.length) return '<span class="form-dot-empty">—</span>';
  return form.map(f => {
    const cls = f === 'W' ? 'form-dot-w' : f === 'D' ? 'form-dot-d' : 'form-dot-l';
    return `<span class="form-dot ${cls}">${f}</span>`;
  }).join('');
}

// ── Player form (W/D/L last 5) ─────────────────────────────────────────────────

function _buildPlayerForm(entry, matches) {
  const teamSet = new Set(entry.teams);
  const played  = [];

  for (const m of matches) {
    if (!isFinished(m.status)) continue;
    if (m.homeScore === null || m.awayScore === null) continue;

    const teamName = teamSet.has(m.homeTeam) ? m.homeTeam
                   : teamSet.has(m.awayTeam) ? m.awayTeam
                   : null;
    if (!teamName) continue;

    const isHome = m.homeTeam === teamName;
    const ts = isHome ? m.homeScore : m.awayScore;
    const os = isHome ? m.awayScore : m.homeScore;
    const result = ts > os ? 'W' : ts < os ? 'L' : 'D';
    played.push({ date: new Date(m.date), result });
  }

  played.sort((a, b) => a.date - b.date);
  return played.slice(-5).map(p => p.result);
}

// ── Legend ─────────────────────────────────────────────────────────────────────

function _buildLegend() {
  const div = document.createElement('div');
  div.className = 'lb-legend';
  div.textContent = '▲ = Tier A team  ·  Deck chip = that team\'s pts contribution  ·  Form = last 5 results across all 6 teams';
  return div;
}

// ── Expand / collapse ──────────────────────────────────────────────────────────

function _toggleEntry(wrap, entry) {
  const isExpanding = !wrap.classList.contains('is-expanded');
  const bd  = wrap.querySelector('.lb-breakdown');
  const btn = wrap.querySelector('.lb-main');

  wrap.classList.toggle('is-expanded', isExpanding);
  btn.setAttribute('aria-expanded', String(isExpanding));
  bd.setAttribute('aria-hidden', String(!isExpanding));
}

// ── Breakdown HTML ─────────────────────────────────────────────────────────────

function _buildBreakdownHTML(entry) {
  const teamBlocks = entry.teams.map(teamName => {
    const td   = entry.teamBreakdown[teamName] ?? {};
    const flag = flagImg(teamName);
    const tier = typeof TIER_A !== 'undefined' && TIER_A.has(teamName) ? 'Tier A' : 'Tier B';

    const chips = [];
    if ((td.wins ?? 0) > 0)
      chips.push(`<span class="bd-stat-chip chip-win">${td.wins}W</span>`);
    if ((td.draws ?? 0) > 0)
      chips.push(`<span class="bd-stat-chip chip-draw">${td.draws}D</span>`);
    if ((td.bonuses ?? 0) > 0)
      chips.push(`<span class="bd-stat-chip chip-bonus">+${td.bonuses} bonus</span>`);
    if ((td.knockoutPts ?? 0) > 0)
      chips.push(`<span class="bd-stat-chip chip-ko">+${td.knockoutPts} KO</span>`);
    if ((td.giantKillerPts ?? 0) > 0)
      chips.push(`<span class="bd-stat-chip chip-bonus">+${td.giantKillerPts} Giant Killer</span>`);
    if (!chips.length)
      chips.push(`<span class="bd-stat-chip chip-none">No matches yet</span>`);

    // Upcoming + live matches
    const liveAndUpcoming = _currentMatches
      .filter(m => (m.status === 'NS' || isLive(m.status)) && (m.homeTeam === teamName || m.awayTeam === teamName))
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 3);

    let upcomingHtml = '';
    if (liveAndUpcoming.length) {
      const rows = liveAndUpcoming.map(m => {
        const opp     = m.homeTeam === teamName ? m.awayTeam : m.homeTeam;
        const oppFlag = flagImg(opp);
        const isHome  = m.homeTeam === teamName;
        const isLiveM = isLive(m.status);
        const oppLabel = opp.startsWith('Group') || opp.includes('Winner') || opp.includes('Loser')
          ? `<span class="bd-up-tbd">${escHtml(opp)}</span>`
          : `${oppFlag} ${escHtml(opp)}`;

        let rightHtml;
        if (isLiveM) {
          const hs = m.homeScore ?? 0, as = m.awayScore ?? 0;
          const myScore  = isHome ? hs : as;
          const oppScore = isHome ? as : hs;
          const min = m.elapsed ? `${m.elapsed}′` : m.status;
          rightHtml = `<span class="bd-up-live"><span class="bd-up-live-dot"></span>${myScore}–${oppScore} · ${escHtml(min)}</span>`;
        } else {
          const dateStr = new Date(m.date).toLocaleDateString([], { month: 'short', day: 'numeric' });
          const timeStr = new Date(m.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          rightHtml = `<span class="bd-up-date">${dateStr} · ${timeStr}</span>`;
        }

        return `<div class="bd-up-match${isLiveM ? ' is-live' : ''}">
          <span class="bd-up-ha">${isHome ? 'vs' : '@'}</span>
          <span class="bd-up-opp">${oppLabel}</span>
          ${rightHtml}
        </div>`;
      }).join('');
      upcomingHtml = `<div class="bd-upcoming"><div class="bd-upcoming-label">Upcoming</div>${rows}</div>`;
    }

    return `
      <div class="bd-team">
        <div class="bd-top">
          <span class="bd-flag">${flag}</span>
          <div class="bd-team-info">
            <span class="bd-team-name">${escHtml(teamName)}</span>
            <span class="bd-tier-label">${tier}</span>
          </div>
          <span class="bd-team-pts">${td.total ?? 0}</span>
        </div>
        <div class="bd-stats">${chips.join('')}</div>
        ${upcomingHtml}
      </div>
    `;
  }).join('');

  return `<div class="bd-inner">${teamBlocks}</div>`;
}

// ── Right rail ─────────────────────────────────────────────────────────────────

function _renderRightRail(matches) {
  const slateEl = document.getElementById('rail-slate');
  const wireEl  = document.getElementById('rail-wire');
  if (slateEl) slateEl.innerHTML = _buildSlateHTML(matches);
  if (wireEl)  wireEl.innerHTML  = _buildWireHTML(matches);
}

// ── Slate (today's matches) ────────────────────────────────────────────────────

function _getSlateMatches(matches) {
  const now      = new Date();
  const todayStr = now.toDateString();

  const todayM = matches.filter(m => new Date(m.date).toDateString() === todayStr);
  if (todayM.length) return todayM.slice(0, 8);

  // Next upcoming day
  const upcoming = matches
    .filter(m => m.status === 'NS' && new Date(m.date) > now)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (upcoming.length) {
    const nd = new Date(upcoming[0].date).toDateString();
    return upcoming.filter(m => new Date(m.date).toDateString() === nd).slice(0, 8);
  }

  // Most recently finished day
  const recent = matches
    .filter(m => isFinished(m.status))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (recent.length) {
    const rd = new Date(recent[0].date).toDateString();
    return recent.filter(m => new Date(m.date).toDateString() === rd).slice(0, 8);
  }

  return [];
}

function _slateTitle(matches) {
  const anyDone   = matches.some(m => isFinished(m.status));
  const anyLive   = matches.some(m => isLive(m.status));
  const anyFuture = matches.some(m => m.status === 'NS');

  // Are these matches actually on today's calendar date?
  const todayStr   = new Date().toDateString();
  const matchDay   = matches.length ? new Date(matches[0].date).toDateString() : todayStr;
  const isToday    = matchDay === todayStr;

  if (anyLive || (anyDone && anyFuture)) return "TODAY'S SLATE";
  if (anyFuture && !anyDone) {
    if (isToday) return 'UPCOMING TODAY';
    // Future day — show the actual date
    const d = new Date(matches[0].date);
    const label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `NEXT UP · ${label.toUpperCase()}`;
  }
  if (anyDone && !anyFuture) return isToday ? "TODAY'S RESULTS" : 'RECENT RESULTS';
  return 'MATCH SLATE';
}

function _buildSlateHTML(matches) {
  const slateMatches = _getSlateMatches(matches);
  if (!slateMatches.length) return '';

  const title = _slateTitle(slateMatches);

  const rows = slateMatches.map(m => {
    const isLiveM = isLive(m.status);
    const isFT    = isFinished(m.status);

    const timeStr    = new Date(m.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const statusText = isFT    ? 'FT'
                     : isLiveM ? (m.elapsed ? `${m.elapsed}′` : 'LIVE')
                     : timeStr;

    const scoreStr = (m.homeScore !== null && m.awayScore !== null)
      ? `${m.homeScore}–${m.awayScore}`
      : '—';

    const homeOwner = typeof TEAM_OWNER !== 'undefined' ? TEAM_OWNER[m.homeTeam] : null;
    const awayOwner = typeof TEAM_OWNER !== 'undefined' ? TEAM_OWNER[m.awayTeam] : null;
    const homeColor = homeOwner && typeof OWNER_COLORS !== 'undefined' ? OWNER_COLORS[homeOwner] : null;
    const awayColor = awayOwner && typeof OWNER_COLORS !== 'undefined' ? OWNER_COLORS[awayOwner] : null;

    const ownerBits = [];
    if (homeOwner) ownerBits.push(`<span class="rail-owner-dot" style="background:${homeColor}" title="${escHtml(homeOwner)}"></span>`);
    if (awayOwner) ownerBits.push(`<span class="rail-owner-dot" style="background:${awayColor}" title="${escHtml(awayOwner)}"></span>`);

    return `<div class="rail-match${isLiveM ? ' is-live' : ''}">
      <div class="rail-match-main">
        <span class="rail-match-status${isLiveM ? ' is-live' : ''}">${statusText}</span>
        <div class="rail-match-teams">
          ${flagImg(m.homeTeam, 'flag-img-sm')}
          <span class="rail-team-code">${_teamCode(m.homeTeam)}</span>
          <span class="rail-dotted-line"></span>
          <span class="rail-team-code">${_teamCode(m.awayTeam)}</span>
          ${flagImg(m.awayTeam, 'flag-img-sm')}
        </div>
        <span class="rail-match-score${isLiveM ? ' is-live' : ''}">${scoreStr}</span>
      </div>
      ${ownerBits.length ? `<div class="rail-owners">${ownerBits.join('')}</div>` : ''}
    </div>`;
  }).join('');

  return `<div class="rail-card">
    <div class="rail-card-header">
      <span class="rail-card-title">${title}</span>
      <span class="rail-card-meta">${slateMatches.length} matches · ET</span>
    </div>
    ${rows}
  </div>`;
}

// ── Wire (activity feed) ───────────────────────────────────────────────────────

function _buildWireHTML(matches) {
  if (typeof buildWireFeed === 'undefined') return '';
  const feed = buildWireFeed(matches).slice(0, 7);
  if (!feed.length) return '';

  const rows = feed.map(item => {
    const meta = (typeof WIRE_KIND_META !== 'undefined' && WIRE_KIND_META[item.kind])
      || { label: item.kind.toUpperCase(), color: '#0A0A0A' };
    const ago = _wireRelTime(item.date);

    return `<div class="rail-wire-item">
      <div class="rail-wire-left">
        <span class="rail-wire-kind" style="background:${meta.color}">${meta.label}</span>
        <span class="rail-wire-ago">${ago}</span>
      </div>
      <div class="rail-wire-text">${item.text}</div>
    </div>`;
  }).join('');

  return `<div class="rail-card">
    <div class="rail-card-header">
      <span class="rail-card-title">THE WIRE</span>
      <span class="rail-card-meta">Auto · Newest first</span>
    </div>
    ${rows}
  </div>`;
}

// ── Current round detection ────────────────────────────────────────────────────

const ROUND_LABELS = {
  group:        'Group Stage',
  round_of_32:  'Round of 32',
  round_of_16:  'Round of 16',
  quarterfinal: 'Quarterfinals',
  semifinal:    'Semifinals',
  final:        'Final',
};

function getCurrentRound(matches) {
  const live = matches.find(m => isLive(m.status));
  if (live) return { label: ROUND_LABELS[live.round] ?? live.round, isLive: true };

  const finished = matches
    .filter(m => isFinished(m.status))
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!finished.length) return { label: 'Pre-Tournament', isLive: false };
  return { label: ROUND_LABELS[finished[0].round] ?? finished[0].round, isLive: false };
}

// ── Countdown timer ────────────────────────────────────────────────────────────

function startCountdown(nextRefreshAt) {
  clearInterval(_countdownInterval);
  const el = document.getElementById('refresh-countdown');
  if (!el) return;

  function tick() {
    const ms   = Math.max(0, nextRefreshAt - Date.now());
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    el.textContent = `Refreshes in ${mins}:${String(secs).padStart(2, '0')}`;
    if (ms === 0) clearInterval(_countdownInterval);
  }

  tick();
  _countdownInterval = setInterval(tick, 1000);
}

// ── Tournament countdown banner ────────────────────────────────────────────────

function initCountdown() {
  const TARGET = new Date('2026-06-11T20:00:00-05:00');
  const banner = document.getElementById('tournament-countdown');
  if (!banner || Date.now() >= TARGET) return;

  banner.innerHTML = `
    <div class="tcd-wrap">
      <div class="tcd-eyebrow">⚽ Kickoff in</div>
      <div class="tcd-blocks">
        <div class="tcd-block tcd-days">
          <span class="tcd-num" id="tcd-d">--</span>
          <span class="tcd-lbl">Days</span>
        </div>
        <span class="tcd-sep">:</span>
        <div class="tcd-block tcd-hours">
          <span class="tcd-num" id="tcd-h">--</span>
          <span class="tcd-lbl">Hours</span>
        </div>
        <span class="tcd-sep">:</span>
        <div class="tcd-block tcd-mins">
          <span class="tcd-num" id="tcd-m">--</span>
          <span class="tcd-lbl">Min</span>
        </div>
        <span class="tcd-sep">:</span>
        <div class="tcd-block tcd-secs">
          <span class="tcd-num" id="tcd-s">--</span>
          <span class="tcd-lbl">Sec</span>
        </div>
      </div>
      <div class="tcd-sub">June 11, 2026 · Los Angeles, CA</div>
    </div>
  `;
  banner.hidden = false;

  const dEl = document.getElementById('tcd-d');
  const hEl = document.getElementById('tcd-h');
  const mEl = document.getElementById('tcd-m');
  const sEl = document.getElementById('tcd-s');

  let timer;
  function tick() {
    const ms = TARGET - Date.now();
    if (ms <= 0) { banner.hidden = true; clearInterval(timer); return; }
    dEl.textContent = Math.floor(ms / 86400000);
    hEl.textContent = String(Math.floor((ms % 86400000) / 3600000)).padStart(2, '0');
    mEl.textContent = String(Math.floor((ms % 3600000)  / 60000)).padStart(2, '0');
    sEl.textContent = String(Math.floor((ms % 60000)    / 1000)).padStart(2, '0');
  }
  tick();
  timer = setInterval(tick, 1000);
}

// ── Tab navigation ─────────────────────────────────────────────────────────────

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels  = document.querySelectorAll('.tab-panel');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      buttons.forEach(b => {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });

      panels.forEach(p => {
        const isTarget = p.id === `panel-${target}`;
        p.classList.toggle('hidden', !isTarget);
      });
    });
  });

  _initChipFilters();
}

// ── Chip filters (Wire + Schedule) ─────────────────────────────────────────────

function _initChipFilters() {
  // Wire filter chips
  const wireChips = document.querySelectorAll('#panel-wire .va4-chip');
  wireChips.forEach(chip => chip.addEventListener('click', () => {
    wireChips.forEach(c => c.classList.remove('va4-chip-active'));
    chip.classList.add('va4-chip-active');
    _applyWireFilter(chip.textContent.trim());
  }));

  // Schedule filter chips
  const schedChips = document.querySelectorAll('#panel-schedule .va4-chip');
  schedChips.forEach(chip => chip.addEventListener('click', () => {
    schedChips.forEach(c => c.classList.remove('va4-chip-active'));
    chip.classList.add('va4-chip-active');
    _applyScheduleFilter(chip.textContent.trim());
  }));
}

function _applyWireFilter(label) {
  const KIND_FOR_LABEL = {
    'Goals':         'goal',
    'Finals':        'final',
    'Rank':          'rank',
    'Giant Killers': 'giant',
    'Side Bets':     'bet',
  };
  const want = KIND_FOR_LABEL[label] ?? null; // null = All

  const container = document.getElementById('feed-container');
  if (!container) return;

  for (const row of container.querySelectorAll('.wire-row')) {
    row.style.display = (!want || row.dataset.kind === want) ? '' : 'none';
  }
  // Hide day headers whose section has no visible rows
  for (const hdr of container.querySelectorAll('.wire-day-header')) {
    let el = hdr.nextElementSibling, any = false;
    while (el && !el.classList.contains('wire-day-header')) {
      if (el.style.display !== 'none') { any = true; break; }
      el = el.nextElementSibling;
    }
    hdr.style.display = any ? '' : 'none';
  }
}

function _applyScheduleFilter(label) {
  const container = document.getElementById('schedule-container');
  if (!container) return;

  for (const section of container.querySelectorAll('.sched-section')) {
    const rows = section.querySelectorAll('.sched-match');
    let anyVisible = false;

    for (const row of rows) {
      const rt         = row.dataset.roundType || '';
      const isLiveRow  = row.classList.contains('is-live');
      const isDoneRow  = row.classList.contains('is-final');

      let show = true;
      if (label === 'Group stage'    && rt !== 'group')    show = false;
      if (label === 'Knockouts'      && rt !== 'knockout') show = false;
      if (label === 'Live + upcoming' && isDoneRow && !isLiveRow) show = false;

      row.style.display = show ? '' : 'none';
      if (show) anyVisible = true;
    }

    // Hide entire day section if nothing is visible in it
    section.style.display = anyVisible ? '' : 'none';
  }
}

// ── Rank persistence ───────────────────────────────────────────────────────────

function _loadPrevRanks() {
  try { return JSON.parse(localStorage.getItem('wc_prev_ranks') || '{}'); }
  catch { return {}; }
}

function _savePrevRanks(scores) {
  const map = {};
  for (const e of scores) map[e.name] = { rank: e.rank, score: e.totalScore };
  try { localStorage.setItem('wc_prev_ranks', JSON.stringify(map)); }
  catch { /* quota / private mode */ }
}

// ── Utility ────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
