/**
 * leaderboard.js — Leaderboard rendering, rank-delta tracking, countdown timer.
 *
 * Public API:
 *   renderLeaderboard(scores, matches)  — called by ScoringEngine after each fetch
 *   startCountdown(nextRefreshAt)        — called by ScoringEngine after scheduling refresh
 */

// ── Module state ───────────────────────────────────────────────────────────────
let _prevRanks          = {};   // { [name]: { rank, score } }
let _countdownInterval  = null;
let _currentMatches     = [];   // latest match array, used in breakdown

// ── Main render ────────────────────────────────────────────────────────────────

/**
 * @param {object[]} scores  — output of calculateScores()
 * @param {object[]} matches — parsed match array (for current-round detection)
 */
function renderLeaderboard(scores, matches) {
  _currentMatches = matches || [];
  _prevRanks = _loadPrevRanks();

  const container = document.getElementById('leaderboard-container');
  container.innerHTML = '';

  if (!scores.length) {
    container.innerHTML = '<p class="state-msg">No standings yet.</p>';
    return;
  }

  // Update round badge in header
  if (matches?.length) {
    const info = getCurrentRound(matches);
    const badge = document.getElementById('current-round');
    if (badge) {
      badge.textContent = info.label;
      badge.classList.toggle('is-live', info.isLive);
    }
  }

  // Compute biggest mover
  let biggestMover = null, maxDelta = 0;
  for (const entry of scores) {
    const prev = _prevRanks[entry.name];
    if (!prev) continue;
    const rankDelta  = prev.rank - entry.rank;   // positive = moved up
    const scoreDelta = entry.totalScore - prev.score;
    if (rankDelta > maxDelta || (rankDelta === maxDelta && rankDelta > 0 && scoreDelta > (biggestMover?._scoreDelta ?? 0))) {
      maxDelta = rankDelta;
      biggestMover = { ...entry, _rankDelta: rankDelta, _scoreDelta: scoreDelta };
    }
  }

  const frag = document.createDocumentFragment();

  if (biggestMover && maxDelta > 0) {
    frag.appendChild(_buildBiggestMoverCard(biggestMover));
  }

  for (const entry of scores) {
    frag.appendChild(_buildEntry(entry));
  }
  container.appendChild(frag);

  _savePrevRanks(scores);
}

// ── Biggest Mover card ─────────────────────────────────────────────────────────

function _buildBiggestMoverCard(entry) {
  const color = (typeof OWNER_COLORS !== 'undefined' && OWNER_COLORS[entry.name]) || '#1a8a40';
  const r = parseInt(color.slice(1,3), 16);
  const g = parseInt(color.slice(3,5), 16);
  const b = parseInt(color.slice(5,7), 16);

  const teamsHtml = entry.teams
    .map(t => `${flagImg(t)}\u202f${escHtml(t)}`)
    .join('  ·  ');

  const scoreLine = entry._scoreDelta > 0
    ? `<span class="bm-score">+${entry._scoreDelta} pts</span>`
    : '';

  const el = document.createElement('div');
  el.className = 'bm-card';
  el.style.borderLeftColor = color;
  el.style.background = `rgba(${r},${g},${b},0.06)`;

  el.innerHTML = `
    <span class="bm-label">Biggest Mover</span>
    <span class="bm-delta">▲${entry._rankDelta}</span>
    <span class="bm-name">${escHtml(entry.name)}</span>
    <span class="bm-teams">${teamsHtml}</span>
    ${scoreLine}
  `;
  return el;
}

// ── Entry builder ──────────────────────────────────────────────────────────────

function _buildEntry(entry) {
  const prev       = _prevRanks[entry.name];
  const rankDelta  = prev ? prev.rank - entry.rank : 0;  // positive = improved
  const prevScore  = prev?.score ?? null;
  const rankClass  = `lb-rank-${Math.min(entry.rank, 4)}`;  // 4+ gets no special colour

  const wrap = document.createElement('div');
  wrap.className = `lb-entry ${rankClass}`;
  wrap.dataset.name = entry.name;

  // Rank delta
  let deltaHtml;
  if      (rankDelta > 0)  deltaHtml = `<span class="rank-delta delta-up">▲${rankDelta}</span>`;
  else if (rankDelta < 0)  deltaHtml = `<span class="rank-delta delta-down">▼${Math.abs(rankDelta)}</span>`;
  else                     deltaHtml = `<span class="rank-delta delta-same">—</span>`;

  // Teams line
  const teamsHtml = entry.teams
    .map(t => `${flagImg(t)}\u202f${escHtml(t)}`)
    .join('  ·  ');

  // Conflict warning icon
  const conflictHtml = entry.flags?.length
    ? ` <span class="conflict-icon" title="${escHtml(entry.flags[0])}">⚠</span>`
    : '';

  // Pre-render breakdown so it's available immediately on desktop
  const breakdownHtml = _buildBreakdownHTML(entry);

  wrap.innerHTML = `
    <div class="lb-main">
      <div class="lb-rank-cell">
        <span class="rank-num">${entry.rank}</span>
        ${deltaHtml}
      </div>
      <div class="lb-player-cell">
        <span class="lb-name">${escHtml(entry.name)}${conflictHtml}</span>
      </div>
      <div class="lb-teams-cell">
        <span class="lb-teams-text">${teamsHtml}</span>
      </div>
      <div class="lb-score-cell">
        <span class="lb-score" data-score="${entry.totalScore}">${entry.totalScore}</span>
      </div>
      <button class="lb-toggle" aria-expanded="false"
              aria-label="Show score breakdown for ${escHtml(entry.name)}">›</button>
      <span class="lb-expand-hint" aria-hidden="true">▼ details</span>
    </div>
    <div class="lb-breakdown" aria-hidden="true">${breakdownHtml}</div>
  `;

  // Animate score if it changed since last render
  if (prevScore !== null && prevScore !== entry.totalScore) {
    const scoreEl = wrap.querySelector('.lb-score');
    requestAnimationFrame(() => {
      scoreEl.classList.remove('score-flash');
      void scoreEl.offsetWidth; // force reflow so animation re-triggers
      scoreEl.classList.add('score-flash');
      scoreEl.addEventListener('animationend', () => scoreEl.classList.remove('score-flash'), { once: true });
    });
  }

  // Toggle expand on click anywhere in the main row
  wrap.querySelector('.lb-main').addEventListener('click', () => _toggleEntry(wrap, entry));

  return wrap;
}

// ── Expand / collapse ──────────────────────────────────────────────────────────

function _toggleEntry(wrap, entry) {
  const isExpanding = !wrap.classList.contains('is-expanded');
  const bd   = wrap.querySelector('.lb-breakdown');
  const btn  = wrap.querySelector('.lb-toggle');
  const hint = wrap.querySelector('.lb-expand-hint');

  wrap.classList.toggle('is-expanded', isExpanding);
  btn.setAttribute('aria-expanded', String(isExpanding));
  bd.setAttribute('aria-hidden', String(!isExpanding));
  if (hint) hint.textContent = isExpanding ? '▲ details' : '▼ details';
}

// ── Breakdown HTML ─────────────────────────────────────────────────────────────

function _buildBreakdownHTML(entry) {
  const teamBlocks = entry.teams.map(teamName => {
    const td   = entry.teamBreakdown[teamName] ?? {};
    const flag = flagImg(teamName);
    const tier = TIER_A.has(teamName) ? 'Tier A' : 'Tier B';

    // Stat chips
    const chips = [];
    if ((td.wins ?? 0) > 0)
      chips.push(`<span class="bd-stat-chip chip-win">${td.wins}W</span>`);
    if ((td.draws ?? 0) > 0)
      chips.push(`<span class="bd-stat-chip chip-draw">${td.draws}D</span>`);
    if ((td.bonuses ?? 0) > 0)
      chips.push(`<span class="bd-stat-chip chip-bonus">+${td.bonuses} bonus</span>`);
    if ((td.knockoutPts ?? 0) > 0)
      chips.push(`<span class="bd-stat-chip chip-ko">+${td.knockoutPts} KO</span>`);
    if (!chips.length)
      chips.push(`<span class="bd-stat-chip chip-none">No matches yet</span>`);

    // Upcoming matches
    const upcoming = _currentMatches
      .filter(m => m.status === 'NS' && (m.homeTeam === teamName || m.awayTeam === teamName))
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 3);

    let upcomingHtml = '';
    if (upcoming.length) {
      const rows = upcoming.map(m => {
        const opp      = m.homeTeam === teamName ? m.awayTeam : m.homeTeam;
        const oppFlag  = flagImg(opp);
        const dateStr  = new Date(m.date).toLocaleDateString([], { month: 'short', day: 'numeric' });
        const timeStr  = new Date(m.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const isHome   = m.homeTeam === teamName;
        const oppLabel = opp.startsWith('Group') || opp.includes('Winner') || opp.includes('Loser')
          ? `<span class="bd-up-tbd">${escHtml(opp)}</span>`
          : `${oppFlag} ${escHtml(opp)}`;
        return `<div class="bd-up-match">
          <span class="bd-up-ha">${isHome ? 'vs' : '@'}</span>
          <span class="bd-up-opp">${oppLabel}</span>
          <span class="bd-up-date">${dateStr} · ${timeStr}</span>
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
  // Any live match → use that round
  const live = matches.find(m => isLive(m.status));
  if (live) return { label: ROUND_LABELS[live.round] ?? live.round, isLive: true };

  // Most recently completed match
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

// ── Rank persistence ───────────────────────────────────────────────────────────

function _loadPrevRanks() {
  try { return JSON.parse(localStorage.getItem('wc_prev_ranks') || '{}'); }
  catch { return {}; }
}

function _savePrevRanks(scores) {
  const map = {};
  for (const e of scores) map[e.name] = { rank: e.rank, score: e.totalScore };
  try { localStorage.setItem('wc_prev_ranks', JSON.stringify(map)); }
  catch { /* quota, private mode — ignore */ }
}

// ── Tournament countdown ───────────────────────────────────────────────────────

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
        <div class="tcd-block tcd-hours">
          <span class="tcd-num" id="tcd-h">--</span>
          <span class="tcd-lbl">Hours</span>
        </div>
        <div class="tcd-block tcd-mins">
          <span class="tcd-num" id="tcd-m">--</span>
          <span class="tcd-lbl">Min</span>
        </div>
        <div class="tcd-block tcd-secs">
          <span class="tcd-num" id="tcd-s">--</span>
          <span class="tcd-lbl">Sec</span>
        </div>
      </div>
      <div class="tcd-sub">June 11, 2026 · Los Angeles, CA</div>
    </div>
  `;
  banner.hidden = false;

  const wrap      = banner.querySelector('.tcd-wrap');
  const secsBlock = banner.querySelector('.tcd-secs');
  const dEl       = document.getElementById('tcd-d');
  const hEl       = document.getElementById('tcd-h');
  const mEl       = document.getElementById('tcd-m');
  const sEl       = document.getElementById('tcd-s');

  let timer;

  function tick() {
    const ms = TARGET - Date.now();
    if (ms <= 0) {
      banner.hidden = true;
      clearInterval(timer);
      return;
    }

    dEl.textContent = Math.floor(ms / 86400000);
    hEl.textContent = String(Math.floor((ms % 86400000) / 3600000)).padStart(2, '0');
    mEl.textContent = String(Math.floor((ms % 3600000)  / 60000)).padStart(2, '0');
    sEl.textContent = String(Math.floor((ms % 60000)    / 1000)).padStart(2, '0');

    // Toggle urgency state (under 24 hours)
    wrap.classList.toggle('tcd-urgent', ms < 86400000);

    // Restart glow animation on seconds block each tick
    secsBlock.classList.remove('tcd-tick');
    void secsBlock.offsetWidth; // force reflow so animation replays
    secsBlock.classList.add('tcd-tick');
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
}

// ── Utility ────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
