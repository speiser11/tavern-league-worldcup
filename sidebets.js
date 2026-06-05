/**
 * sidebets.js — Side Bets tracking
 *
 * Bets stored in Firebase at worldcup2026/sidebets.
 * Admin (same PIN as draft): add bets, settle, delete.
 * Everyone else: read-only. Polls every 30 s.
 *
 * Public:
 *   new SideBetsEngine().init()       — call on DOMContentLoaded
 *   renderSideBetsRail(bets)          — called internally; safe to call externally
 *   getSideBetsForMatch(home, away)   — called by _buildLiveBannerCard in app.js
 *
 * Bet schema:
 *   { id, description, party1, party2, stake, status, winner, createdAt,
 *     gameTeams: [homeTeam, awayTeam] | null }   ← null = tournament-wide
 */

class SideBetsEngine {
  constructor() {
    this._bets      = [];
    this._isAdmin   = sessionStorage.getItem('draft_admin') === '1';
    this._showForm  = false;
    this._pollTimer = null;
    this._fbUrl     = CONFIG.FIREBASE_CONFIG?.databaseURL
      ? `${CONFIG.FIREBASE_CONFIG.databaseURL}/worldcup2026/sidebets.json`
      : null;
  }

  async init() {
    await this._load();
    this._render();
    this._startPolling();
  }

  // ── Firebase ────────────────────────────────────────────────────────────────

  async _load() {
    if (!this._fbUrl) return;
    try {
      const res = await Promise.race([
        fetch(this._fbUrl),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000)),
      ]);
      if (!res.ok) throw new Error(`Firebase ${res.status}`);
      const data = await res.json();
      this._bets = data
        ? Object.values(data).sort((a, b) => b.createdAt - a.createdAt)
        : [];
    } catch (e) {
      console.warn('SideBets load:', e.message);
    }
    window._sideBets = this._bets; // expose for live banner in app.js
  }

  async _save() {
    if (!this._fbUrl) return;
    const obj = {};
    for (const b of this._bets) obj[b.id] = b;
    try {
      await Promise.race([
        fetch(this._fbUrl, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(obj),
        }),
        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5000)),
      ]);
    } catch (e) {
      console.warn('SideBets save:', e.message);
    }
    window._sideBets = this._bets; // keep live banner in sync after writes
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  _render() {
    const container = document.getElementById('side-bets-container');
    if (!container) return;

    const page = document.createElement('div');
    page.className = 'va4-page-inner sb-page';

    // Header
    page.appendChild(this._buildHead());

    // Add-bet form
    if (this._isAdmin && this._showForm) {
      page.appendChild(this._buildForm());
    }

    // Bet cards
    const open    = this._bets.filter(b => b.status === 'open');
    const settled = this._bets.filter(b => b.status === 'settled');

    if (!this._bets.length) {
      const msg = document.createElement('p');
      msg.className = 'state-msg sb-empty';
      msg.textContent = this._isAdmin
        ? 'No bets yet — hit "+ Log Bet" above to record one.'
        : 'No bets logged yet.';
      page.appendChild(msg);
    } else {
      if (open.length)    page.appendChild(this._buildSection('OPEN', open));
      if (settled.length) page.appendChild(this._buildSection('SETTLED', settled));
    }

    // Admin toggle at the bottom
    page.appendChild(this._buildAdminToggle());

    container.innerHTML = '';
    container.appendChild(page);

    // Keep the leaderboard rail in sync
    renderSideBetsRail(this._bets);
  }

  _buildHead() {
    const div = document.createElement('div');
    div.className = 'va4-page-head';
    div.innerHTML = `
      <div>
        <div class="va4-sup">Logged wagers · honor system · off-book</div>
        <div class="va4-heading">SIDE BETS</div>
      </div>
      ${this._isAdmin
        ? `<button class="sb-add-btn" id="sb-add-btn">${this._showForm ? '✕ Cancel' : '+ Log Bet'}</button>`
        : ''}
    `;
    div.querySelector('#sb-add-btn')?.addEventListener('click', () => {
      this._showForm = !this._showForm;
      this._render();
    });
    return div;
  }

  _buildForm() {
    const div = document.createElement('div');
    div.className = 'sb-form';

    // Datalist for player name autocomplete
    const nameOpts = (typeof PARTICIPANTS !== 'undefined')
      ? Object.keys(PARTICIPANTS).map(n => `<option value="${escHtml(n)}">`).join('')
      : '';

    div.innerHTML = `
      <div class="sb-form-title">LOG A BET</div>
      <div class="sb-field">
        <label class="sb-label">What's the bet?</label>
        <input class="sb-input" id="sb-desc" type="text"
               placeholder="e.g. Scotland beats France in group stage" autocomplete="off">
      </div>
      <div class="sb-field-row">
        <div class="sb-field">
          <label class="sb-label">Party 1</label>
          <input class="sb-input" id="sb-p1" type="text" placeholder="Name" list="sb-names">
        </div>
        <div class="sb-vs-badge">VS</div>
        <div class="sb-field">
          <label class="sb-label">Party 2</label>
          <input class="sb-input" id="sb-p2" type="text" placeholder="Name" list="sb-names">
        </div>
      </div>
      <datalist id="sb-names">${nameOpts}</datalist>
      <div class="sb-field">
        <label class="sb-label">Stakes</label>
        <input class="sb-input" id="sb-stake" type="text"
               placeholder="e.g. 6-pack, $20, dishes, a dare">
      </div>
      <div class="sb-field">
        <label class="sb-label">Game (optional — leave blank for tournament-wide bets)</label>
        <select class="sb-input sb-game-select" id="sb-game">
          ${_buildMatchSelectOptions()}
        </select>
      </div>
      <div class="sb-form-actions">
        <button class="sb-submit-btn" id="sb-submit">Log Bet</button>
      </div>
    `;

    div.querySelector('#sb-submit').addEventListener('click', async () => {
      const desc  = div.querySelector('#sb-desc').value.trim();
      const p1    = div.querySelector('#sb-p1').value.trim();
      const p2    = div.querySelector('#sb-p2').value.trim();
      const stake = div.querySelector('#sb-stake').value.trim();
      if (!desc || !p1 || !p2 || !stake) { alert('Fill in all fields.'); return; }

      const gameVal   = div.querySelector('#sb-game').value;
      const gameTeams = gameVal ? JSON.parse(gameVal) : null;

      const bet = {
        id:          `bet_${Date.now()}`,
        description: desc,
        party1:      p1,
        party2:      p2,
        stake,
        status:      'open',
        winner:      null,
        createdAt:   Date.now(),
        gameTeams,   // [homeTeam, awayTeam] or null
      };
      this._bets.unshift(bet);
      this._showForm = false;
      await this._save();
      this._render();
    });

    return div;
  }

  _buildSection(label, bets) {
    const sec = document.createElement('div');
    sec.className = 'sb-section';

    const lbl = document.createElement('div');
    lbl.className = `sb-section-label${label === 'SETTLED' ? ' sb-label-settled' : ''}`;
    lbl.textContent = `${label} (${bets.length})`;
    sec.appendChild(lbl);

    const list = document.createElement('div');
    list.className = 'sb-list';
    for (const bet of bets) list.appendChild(this._buildCard(bet));
    sec.appendChild(list);
    return sec;
  }

  _buildCard(bet) {
    const isOpen = bet.status === 'open';
    const p1c    = (typeof OWNER_COLORS !== 'undefined' && OWNER_COLORS[bet.party1]) || '#6b7280';
    const p2c    = (typeof OWNER_COLORS !== 'undefined' && OWNER_COLORS[bet.party2]) || '#6b7280';

    const card = document.createElement('div');
    card.className = `sb-card${isOpen ? ' sb-card-open' : ' sb-card-settled'}`;

    card.innerHTML = `
      <div class="sb-card-top">
        <div class="sb-card-parties">
          <span class="sb-party" style="color:${p1c}">${escHtml(bet.party1)}</span>
          <span class="sb-vs-sm">vs</span>
          <span class="sb-party" style="color:${p2c}">${escHtml(bet.party2)}</span>
        </div>
        <div class="sb-card-badge ${isOpen ? 'sb-badge-open' : 'sb-badge-settled'}">
          ${isOpen ? 'OPEN' : `✓ ${escHtml(bet.winner)} won`}
        </div>
      </div>
      <div class="sb-card-desc">"${escHtml(bet.description)}"</div>
      ${bet.gameTeams ? `
        <div class="sb-card-game">⚽ ${escHtml(bet.gameTeams[0])} vs ${escHtml(bet.gameTeams[1])}</div>
      ` : ''}
      <div class="sb-card-footer">
        <span class="sb-stake-lbl">Stakes:</span>
        <span class="sb-stake-val">${escHtml(bet.stake)}</span>
        ${this._isAdmin ? `
          <div class="sb-card-actions">
            ${isOpen ? `<button class="sb-settle-btn" data-id="${bet.id}">Settle ▾</button>` : ''}
            <button class="sb-delete-btn" data-id="${bet.id}" title="Delete bet">✕</button>
          </div>` : ''}
      </div>
    `;

    if (this._isAdmin) {
      card.querySelector('.sb-settle-btn')?.addEventListener('click', () => this._settleBet(bet));
      card.querySelector('.sb-delete-btn')?.addEventListener('click', () => this._deleteBet(bet.id));
    }

    return card;
  }

  _buildAdminToggle() {
    const div = document.createElement('div');
    div.className = 'sb-admin-toggle';
    const btn = document.createElement('button');
    btn.className = 'sb-admin-btn';
    btn.textContent = this._isAdmin ? '⚙ Admin mode on' : '⚙ Admin';
    btn.addEventListener('click', () => {
      if (!this._isAdmin) {
        if (CONFIG.ADMIN_PASSWORD) {
          const pin = prompt('Admin PIN:');
          if (pin !== String(CONFIG.ADMIN_PASSWORD)) return;
        }
        this._isAdmin = true;
        sessionStorage.setItem('draft_admin', '1');
      } else {
        this._isAdmin = false;
        this._showForm = false;
        sessionStorage.setItem('draft_admin', '0');
      }
      this._render();
    });
    div.appendChild(btn);
    return div;
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  async _settleBet(bet) {
    const raw = prompt(
      `Who won?\n\n1 = ${bet.party1}\n2 = ${bet.party2}\n\nType 1, 2, or a name:`
    );
    if (!raw) return;
    const r = raw.trim();
    if      (r === '1' || r.toLowerCase() === bet.party1.toLowerCase()) bet.winner = bet.party1;
    else if (r === '2' || r.toLowerCase() === bet.party2.toLowerCase()) bet.winner = bet.party2;
    else    bet.winner = r;
    bet.status = 'settled';
    await this._save();
    this._render();
  }

  async _deleteBet(id) {
    if (!confirm('Delete this bet?')) return;
    this._bets = this._bets.filter(b => b.id !== id);
    await this._save();
    this._render();
  }

  // ── Polling ─────────────────────────────────────────────────────────────────

  _startPolling() {
    this._pollTimer = setInterval(async () => {
      const snap = JSON.stringify(this._bets);
      await this._load();
      if (JSON.stringify(this._bets) !== snap) this._render();
    }, 30_000);
  }
}

// ── Global helpers (called by app.js) ─────────────────────────────────────────

/**
 * Return all bets tagged to a specific match.
 * Called by _buildLiveBannerCard in app.js — safe if no bets exist.
 */
function getSideBetsForMatch(homeTeam, awayTeam) {
  return (window._sideBets || []).filter(b =>
    Array.isArray(b.gameTeams) &&
    b.gameTeams.includes(homeTeam) &&
    b.gameTeams.includes(awayTeam)
  );
}

/**
 * Build <option> / <optgroup> HTML for the game picker select.
 * Uses _loadedMatches from app.js (may be empty before first fetch).
 */
function _buildMatchSelectOptions() {
  const matches = (typeof _loadedMatches !== 'undefined' ? _loadedMatches : []);

  let html = '<option value="">— Tournament-wide (no specific game) —</option>';
  if (!matches.length) return html;

  const ROUND_ORDER  = ['group','round_of_32','round_of_16','quarterfinal','semifinal','final'];
  const ROUND_LABELS = {
    group:        'Group Stage',
    round_of_32:  'Round of 32',
    round_of_16:  'Round of 16',
    quarterfinal: 'Quarterfinals',
    semifinal:    'Semifinals',
    final:        'Final',
  };

  const byRound = {};
  for (const m of matches) {
    (byRound[m.round] = byRound[m.round] || []).push(m);
  }

  for (const round of ROUND_ORDER) {
    if (!byRound[round]?.length) continue;
    const label = ROUND_LABELS[round] || round;
    html += `<optgroup label="${escHtml(label)}">`;
    for (const m of byRound[round]) {
      const d       = new Date(m.date);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const val     = escHtml(JSON.stringify([m.homeTeam, m.awayTeam]));
      html += `<option value="${val}">${dateStr} · ${escHtml(m.homeTeam)} vs ${escHtml(m.awayTeam)}</option>`;
    }
    html += '</optgroup>';
  }
  return html;
}

// ── Right Rail ─────────────────────────────────────────────────────────────────

/**
 * Render a compact side-bets summary in #rail-sidebets on the leaderboard page.
 * Called automatically by SideBetsEngine._render().
 */
function renderSideBetsRail(bets) {
  const rail = document.getElementById('rail-sidebets');
  if (!rail) return;

  if (!bets || !bets.length) { rail.innerHTML = ''; return; }

  const show = bets.slice(0, 5);
  let html = `
    <div class="rail-card" style="margin-top:10px">
      <div class="rail-card-header">
        <span class="rail-card-title">SIDE BETS</span>
        <span class="rail-card-meta">${bets.length} bet${bets.length !== 1 ? 's' : ''}</span>
      </div>
  `;

  for (const bet of show) {
    const isOpen = bet.status === 'open';
    const p1c    = (typeof OWNER_COLORS !== 'undefined' && OWNER_COLORS[bet.party1]) || '#6b7280';
    const p2c    = (typeof OWNER_COLORS !== 'undefined' && OWNER_COLORS[bet.party2]) || '#6b7280';
    html += `
      <div class="sb-rail-row${isOpen ? '' : ' sb-rail-row-done'}">
        <div class="sb-rail-parties">
          <span class="sb-rail-name" style="color:${p1c}">${escHtml(bet.party1)}</span>
          <span class="sb-rail-vs"> vs </span>
          <span class="sb-rail-name" style="color:${p2c}">${escHtml(bet.party2)}</span>
          <span class="sb-rail-pill ${isOpen ? 'sb-pill-open' : 'sb-pill-done'}">
            ${isOpen ? 'open' : `✓ ${escHtml(bet.winner)}`}
          </span>
        </div>
        <div class="sb-rail-desc">${escHtml(bet.description)}</div>
        <div class="sb-rail-stake">${escHtml(bet.stake)}</div>
      </div>
    `;
  }

  if (bets.length > 5) {
    html += `<div class="sb-rail-overflow">+${bets.length - 5} more</div>`;
  }

  html += `</div>`;
  rail.innerHTML = html;
}
