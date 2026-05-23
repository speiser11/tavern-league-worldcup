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

// ── Main render ────────────────────────────────────────────────────────────────

/**
 * @param {object[]} scores  — output of calculateScores()
 * @param {object[]} matches — parsed match array (for current-round detection)
 */
function renderLeaderboard(scores, matches) {
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

  const frag = document.createDocumentFragment();
  for (const entry of scores) {
    frag.appendChild(_buildEntry(entry));
  }
  container.appendChild(frag);

  _savePrevRanks(scores);
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
  const teamsText = entry.teams
    .map(t => `${TEAM_FLAGS[t] || ''}\u202f${t}`)
    .join('  ·  ');

  // Conflict warning icon
  const conflictHtml = entry.flags?.length
    ? ` <span class="conflict-icon" title="${escHtml(entry.flags[0])}">⚠</span>`
    : '';

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
        <span class="lb-teams-text">${escHtml(teamsText)}</span>
      </div>
      <div class="lb-score-cell">
        <span class="lb-score" data-score="${entry.totalScore}">${entry.totalScore}</span>
      </div>
      <button class="lb-toggle" aria-expanded="false"
              aria-label="Show score breakdown for ${escHtml(entry.name)}">›</button>
    </div>
    <div class="lb-breakdown" aria-hidden="true"></div>
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
  const bd  = wrap.querySelector('.lb-breakdown');
  const btn = wrap.querySelector('.lb-toggle');

  wrap.classList.toggle('is-expanded', isExpanding);
  btn.setAttribute('aria-expanded', String(isExpanding));
  bd.setAttribute('aria-hidden', String(!isExpanding));

  // Lazy-render breakdown content on first expand
  if (isExpanding && !bd.innerHTML.trim()) {
    bd.innerHTML = _buildBreakdownHTML(entry);
  }
}

// ── Breakdown HTML ─────────────────────────────────────────────────────────────

function _buildBreakdownHTML(entry) {
  const teamBlocks = entry.teams.map(teamName => {
    const td   = entry.teamBreakdown[teamName] ?? {};
    const flag = TEAM_FLAGS[teamName] || '';
    const tier = TIER_A.has(teamName) ? 'Tier A' : 'Tier B';

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

    return `
      <div class="bd-team">
        <div class="bd-top">
          <span class="bd-team-name">${flag} ${escHtml(teamName)}</span>
          <span class="bd-tier-label">${tier}</span>
          <span class="bd-team-pts">${td.total ?? 0}</span>
        </div>
        <div class="bd-stats">${chips.join('')}</div>
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

// ── Utility ────────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
