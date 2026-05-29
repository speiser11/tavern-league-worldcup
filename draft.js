/**
 * draft.js — Snake draft board
 *
 * State lives in a Gist file (CONFIG.DRAFT_GIST_FILENAME).
 * Admin mode: add ?admin to the URL — no password, friends-only app.
 * Non-admins poll every 5 s during an active draft and see the board update live.
 */

// Static fallback odds for all 48 WC 2026 teams
// (used when ODDS_API_KEY is absent or API calls fail)
const STATIC_WC26_ODDS = {
  // Tier A
  'Brazil':        '+450',  'Argentina':    '+500',
  'France':        '+500',  'England':      '+550',
  'Spain':         '+550',  'Germany':      '+650',
  'Portugal':      '+800',  'Netherlands':  '+900',
  // Group A
  'Mexico':        '+2500', 'South Korea':  '+3500',
  'Czechia':       '+5000', 'South Africa': '+8000',
  // Group B
  'Switzerland':   '+3000', 'Canada':       '+4000',
  'Bosnia':        '+8000', 'Qatar':        '+12000',
  // Group C
  'Morocco':       '+2200', 'Haiti':        '+20000',
  'Scotland':      '+6000',
  // Group D
  'USA':           '+1800', 'Paraguay':     '+5000',
  'Australia':     '+5000', 'Turkey':       '+3500',
  // Group E
  'Ecuador':       '+4000', 'Ivory Coast':  '+5500',
  'Curacao':       '+25000',
  // Group F
  'Japan':         '+2000', 'Sweden':       '+4000',
  'Tunisia':       '+7000',
  // Group G
  'Belgium':       '+2800', 'Egypt':        '+7000',
  'Iran':          '+7000', 'New Zealand':  '+15000',
  // Group H
  'Uruguay':       '+2500', 'Saudi Arabia': '+6000',
  'Cape Verde':    '+15000',
  // Group I
  'Senegal':       '+4500', 'Norway':       '+4000',
  'Iraq':          '+20000',
  // Group J
  'Austria':       '+3500', 'Algeria':      '+5500',
  'Jordan':        '+20000',
  // Group K
  'Colombia':      '+2500', 'Congo':        '+15000',
  'Uzbekistan':    '+15000',
  // Group L
  'Croatia':       '+3000', 'Ghana':        '+6000',
  'Panama':        '+10000',
};

const DRAFT_PLAYERS = [
  'Kade', 'Zach', 'Konrad', 'Cody (Left)', 'Cody (Right)', 'Scott', 'Brandon', 'Allan',
];
const DRAFT_N     = DRAFT_PLAYERS.length; // 8
const DRAFT_RNDS  = 6;                    // 48 teams / 8 players
const DRAFT_TOTAL = DRAFT_N * DRAFT_RNDS; // 48

class DraftEngine {
  constructor() {
    this._state     = null;
    this._isAdmin   = new URLSearchParams(window.location.search).has('admin') ||
                      sessionStorage.getItem('draft_admin') === '1';
    this._pollTimer = null;
    this._odds      = {};
  }

  _toggleAdmin() {
    this._isAdmin = !this._isAdmin;
    sessionStorage.setItem('draft_admin', this._isAdmin ? '1' : '0');
    this._render();
  }

  async init() {
    await this._loadState();
    await this._loadOdds();
    applyDraftToParticipants(this._state.picks);
    this._render();
    if (this._state.status === 'active') this._startPolling();
  }

  // ── Gist I/O ────────────────────────────────────────────────────────────────

  _gistHeaders() {
    const h = { Accept: 'application/vnd.github+json' };
    if (CONFIG.GIST_PAT) h.Authorization = `token ${CONFIG.GIST_PAT}`;
    return h;
  }

  async _loadState() {
    try {
      const res  = await fetch(`https://api.github.com/gists/${CONFIG.GIST_ID}`, { headers: this._gistHeaders() });
      if (!res.ok) throw new Error(`Gist ${res.status}`);
      const gist = await res.json();
      const file = gist.files[CONFIG.DRAFT_GIST_FILENAME];
      const remote = file ? JSON.parse(file.content) : null;
      if (remote) {
        // Never let a stale remote state revert progress (e.g. pending → active)
        const rank   = { pending: 0, active: 1, complete: 2 };
        const curRnk = rank[this._state?.status] ?? -1;
        const remRnk = rank[remote.status]       ??  0;
        const curPks = this._state?.picks?.length ?? 0;
        const remPks = remote.picks?.length       ?? 0;
        if (!this._state || remRnk > curRnk || (remRnk === curRnk && remPks >= curPks)) {
          this._state = remote;
          this._lsSave(remote);
        }
      } else if (!this._state) {
        this._state = this._lsLoad() ?? this._blank();
      }
    } catch {
      // Gist unavailable — fall back to localStorage, then blank
      if (!this._state) this._state = this._lsLoad() ?? this._blank();
      // If we already have a live state (e.g. mid-draft), keep it intact
    }
  }

  _lsSave(state) {
    try { localStorage.setItem('wc_draft_v1', JSON.stringify(state)); } catch {}
  }

  _lsLoad() {
    try { return JSON.parse(localStorage.getItem('wc_draft_v1')); } catch { return null; }
  }

  async _saveState() {
    this._lsSave(this._state); // always persist locally
    if (!CONFIG.GIST_ID || !CONFIG.GIST_PAT) return;
    try {
      await fetch(`https://api.github.com/gists/${CONFIG.GIST_ID}`, {
        method:  'PATCH',
        headers: { ...this._gistHeaders(), 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          files: { [CONFIG.DRAFT_GIST_FILENAME]: { content: JSON.stringify(this._state, null, 2) } },
        }),
      });
    } catch { /* Gist unavailable — localStorage already saved above */ }
  }

  _blank() {
    return { status: 'pending', draftOrder: [...DRAFT_PLAYERS], picks: [], odds: {}, oddsUpdatedAt: 0 };
  }

  // ── Odds ─────────────────────────────────────────────────────────────────────

  async _loadOdds() {
    // Use cached odds if they have data and are fresh (or no API key to refresh with)
    const cachedHasData = this._state.odds && Object.keys(this._state.odds).length > 0;
    const cacheAge      = Date.now() - (this._state.oddsUpdatedAt || 0);
    const cacheFresh    = cacheAge < 6 * 3_600_000;
    if (cachedHasData && (!CONFIG.ODDS_API_KEY || cacheFresh)) {
      this._odds = this._state.odds;
      return;
    }
    if (!CONFIG.ODDS_API_KEY) {
      // No API key — use static odds, but keep any cached values that exist
      this._odds = { ...STATIC_WC26_ODDS, ...this._state.odds };
      this._state.odds = this._odds;
      this._state.oddsUpdatedAt = Date.now();
      return;
    }

    const sportKeys = [
      'soccer_fifa_world_cup_winner',
      'soccer_world_cup_winner',
      'soccer_fifa_world_cup',
    ];
    for (const sk of sportKeys) {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${sk}/odds?` +
                    `apiKey=${CONFIG.ODDS_API_KEY}&regions=us&markets=outrights&oddsFormat=american`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) continue;
        this._odds = this._parseOdds(data);
        this._state.odds = this._odds;
        this._state.oddsUpdatedAt = Date.now();
        if (this._isAdmin) await this._saveState(); // cache for non-admins too
        break;
      } catch { /* try next key */ }
    }
    // Fill any gaps with static odds (covers teams the API missed)
    this._odds = { ...STATIC_WC26_ODDS, ...this._odds };
  }

  _parseOdds(events) {
    const odds = {};
    for (const ev of events) {
      for (const bm of ev.bookmakers ?? []) {
        for (const mkt of bm.markets ?? []) {
          if (mkt.key !== 'outrights') continue;
          for (const oc of mkt.outcomes ?? []) {
            const team = canonicalTeam(oc.name);
            if (odds[team] != null) continue; // first bookmaker wins
            odds[team] = oc.price >= 0 ? `+${oc.price}` : `${oc.price}`;
          }
        }
      }
    }
    return odds;
  }

  // ── Snake logic ───────────────────────────────────────────────────────────────

  _playerForOverall(overall) { // 1-indexed
    const i   = overall - 1;
    const rnd = Math.floor(i / DRAFT_N);
    const pos = i % DRAFT_N;
    return this._state.draftOrder[rnd % 2 === 0 ? pos : DRAFT_N - 1 - pos];
  }

  get _nextOverall() { return (this._state.picks?.length ?? 0) + 1; }
  get _onClock()     {
    if (this._state.status !== 'active' || this._nextOverall > DRAFT_TOTAL) return null;
    return this._playerForOverall(this._nextOverall);
  }
  get _pickedSet()   { return new Set(this._state.picks?.map(p => p.team)); }

  // ── Admin actions ─────────────────────────────────────────────────────────────

  async _makePick(team) {
    if (!this._onClock) return;
    const overall = this._nextOverall;
    this._state.picks.push({
      overall,
      round:  Math.ceil(overall / DRAFT_N),
      player: this._onClock,
      team,
    });
    if (this._state.picks.length >= DRAFT_TOTAL) this._state.status = 'complete';
    applyDraftToParticipants(this._state.picks);
    await this._saveState();
    this._render();
  }

  async _undoPick() {
    if (!this._state.picks?.length) return;
    this._state.picks.pop();
    if (this._state.status === 'complete') this._state.status = 'active';
    applyDraftToParticipants(this._state.picks);
    await this._saveState();
    this._render();
  }

  async _startDraft() {
    this._state.status = 'active';
    await this._saveState();
    this._render();
    this._startPolling();
  }

  _shuffleOrder() {
    const a = [...this._state.draftOrder];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    this._state.draftOrder = a;
    this._renderOrderList();
  }

  // ── Polling (non-admin spectator view) ────────────────────────────────────────

  _startPolling() {
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(async () => {
      const before = this._state.picks?.length ?? 0;
      await this._loadState();
      if ((this._state.picks?.length ?? 0) !== before) {
        applyDraftToParticipants(this._state.picks);
        this._render();
      }
      if (this._state.status !== 'active') clearInterval(this._pollTimer);
    }, 5000);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  _render() {
    const el = document.getElementById('draft-container');
    if (!el) return;
    el.innerHTML = '';
    el.appendChild(this._buildBoard());
  }

  _buildBoard() {
    const wrap = document.createElement('div');
    wrap.className = 'draft-wrap';
    wrap.appendChild(this._buildHeader());
    if (this._state.status !== 'pending') {
      wrap.appendChild(this._buildDraftBoard());
      wrap.appendChild(this._buildGrid());
    }

    // Admin toggle — subtle link at bottom
    const toggle = document.createElement('div');
    toggle.className = 'draft-admin-toggle';
    const btn = document.createElement('button');
    btn.className = 'draft-admin-toggle-btn';
    btn.textContent = this._isAdmin ? 'Exit admin mode' : 'Admin';
    btn.onclick = () => this._toggleAdmin();
    toggle.appendChild(btn);
    wrap.appendChild(toggle);

    return wrap;
  }

  // ── Header ────────────────────────────────────────────────────────────────────

  _buildHeader() {
    const hd = document.createElement('div');
    hd.className = 'draft-header';

    if (this._state.status === 'pending') {
      hd.innerHTML = `<p class="draft-pending-msg">Draft not started yet.</p>`;
      if (this._isAdmin) hd.appendChild(this._buildSetup());
      return hd;
    }

    if (this._state.status === 'complete') {
      hd.innerHTML = `<div class="draft-complete-msg">✅ Draft complete — all ${DRAFT_TOTAL} picks made.</div>`;
      return hd;
    }

    // active
    const player  = this._onClock;
    const color   = OWNER_COLORS[player] || '#8090b8';
    const overall = this._nextOverall;
    const rnd     = Math.ceil(overall / DRAFT_N);

    hd.innerHTML = `
      <div class="draft-clock">
        <span class="draft-clock-label">On the clock</span>
        <span class="draft-clock-name" style="color:${color}">${escHtml(player)}</span>
        <span class="draft-clock-meta">Pick ${overall} of ${DRAFT_TOTAL} · Round ${rnd}</span>
      </div>
    `;

    if (this._isAdmin) {
      const undo = document.createElement('button');
      undo.className = 'draft-undo-btn';
      undo.textContent = '↩ Undo';
      undo.onclick = () => this._undoPick();
      hd.appendChild(undo);
    }
    return hd;
  }

  // ── Setup panel (admin, pending state) ───────────────────────────────────────

  _buildSetup() {
    const wrap = document.createElement('div');
    wrap.className = 'draft-setup';

    const orderWrap = document.createElement('div');
    orderWrap.id = 'draft-order-list';
    this._renderOrderList(orderWrap);
    wrap.appendChild(orderWrap);

    const btns = document.createElement('div');
    btns.className = 'draft-setup-btns';

    const rand = document.createElement('button');
    rand.className = 'draft-btn secondary';
    rand.textContent = '🔀 Randomize order';
    rand.onclick = () => this._shuffleOrder();

    const start = document.createElement('button');
    start.className = 'draft-btn primary';
    start.textContent = '▶ Start draft';
    start.onclick = () => this._startDraft();

    btns.appendChild(rand);
    btns.appendChild(start);
    wrap.appendChild(btns);
    return wrap;
  }

  _renderOrderList(el) {
    el = el || document.getElementById('draft-order-list');
    if (!el) return;
    el.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'draft-order-title';
    title.textContent = 'Round 1 order — drag or use arrows to reorder';
    el.appendChild(title);

    const list = document.createElement('ol');
    list.className = 'draft-order-rows';

    this._state.draftOrder.forEach((name, i) => {
      const color = OWNER_COLORS[name] || '#8090b8';
      const row   = document.createElement('li');
      row.className    = 'draft-order-row';
      row.draggable    = true;
      row.dataset.idx  = i;

      const handle = document.createElement('span');
      handle.className  = 'draft-order-handle';
      handle.textContent = '⠿';
      handle.setAttribute('aria-hidden', 'true');

      const num = document.createElement('span');
      num.className   = 'draft-order-num';
      num.textContent = i + 1;
      num.style.color = color;

      const nameEl = document.createElement('span');
      nameEl.className   = 'draft-order-name';
      nameEl.textContent = name;
      nameEl.style.color = color;

      const arrows = document.createElement('span');
      arrows.className = 'draft-order-arrows';

      if (i > 0) {
        const up = document.createElement('button');
        up.className   = 'draft-arrow-btn';
        up.textContent = '↑';
        up.title       = 'Move up';
        up.onclick     = () => this._moveOrder(i, i - 1);
        arrows.appendChild(up);
      }
      if (i < this._state.draftOrder.length - 1) {
        const dn = document.createElement('button');
        dn.className   = 'draft-arrow-btn';
        dn.textContent = '↓';
        dn.title       = 'Move down';
        dn.onclick     = () => this._moveOrder(i, i + 1);
        arrows.appendChild(dn);
      }

      row.append(handle, num, nameEl, arrows);
      list.appendChild(row);
    });

    el.appendChild(list);
    this._setupOrderDrag(list);
  }

  _moveOrder(fromIdx, toIdx) {
    const order = [...this._state.draftOrder];
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    this._state.draftOrder = order;
    this._renderOrderList();
  }

  _setupOrderDrag(list) {
    let dragSrc = null;

    list.addEventListener('dragstart', e => {
      const row = e.target.closest('.draft-order-row');
      if (!row) return;
      dragSrc = parseInt(row.dataset.idx);
      row.classList.add('dor-dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    list.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.querySelectorAll('.dor-over').forEach(r => r.classList.remove('dor-over'));
      const row = e.target.closest('.draft-order-row');
      if (row && parseInt(row.dataset.idx) !== dragSrc) row.classList.add('dor-over');
    });

    list.addEventListener('dragleave', e => {
      if (!list.contains(e.relatedTarget))
        list.querySelectorAll('.dor-over').forEach(r => r.classList.remove('dor-over'));
    });

    list.addEventListener('drop', e => {
      e.preventDefault();
      const row = e.target.closest('.draft-order-row');
      if (!row) return;
      const overIdx = parseInt(row.dataset.idx);
      if (dragSrc === null || dragSrc === overIdx) return;
      this._moveOrder(dragSrc, overIdx);
    });

    list.addEventListener('dragend', () => {
      list.querySelectorAll('.dor-dragging, .dor-over').forEach(r =>
        r.classList.remove('dor-dragging', 'dor-over'));
      dragSrc = null;
    });
  }

  // ── Draft board table ─────────────────────────────────────────────────────────

  _buildDraftBoard() {
    const picks   = this._state.picks ?? [];
    const pickMap = {};
    for (const p of picks) pickMap[p.overall] = p;

    const curOverall = this._nextOverall;
    const isActive   = this._state.status === 'active';

    const wrap = document.createElement('div');
    wrap.className = 'db-wrap';

    const board = document.createElement('div');
    board.className = 'db-board';

    // Header row — player names
    const hdr = document.createElement('div');
    hdr.className = 'db-row db-hdr-row';
    hdr.appendChild(Object.assign(document.createElement('div'), { className: 'db-corner' }));

    for (let i = 0; i < DRAFT_N; i++) {
      const player = this._state.draftOrder[i];
      const color  = OWNER_COLORS[player] || '#8090b8';
      const hd = document.createElement('div');
      hd.className = 'db-phd';
      hd.style.cssText = `color:${color};border-bottom:3px solid ${color};`;
      hd.textContent = _shortName(player);
      hdr.appendChild(hd);
    }
    board.appendChild(hdr);

    // Round rows
    for (let r = 0; r < DRAFT_RNDS; r++) {
      const row = document.createElement('div');
      row.className = 'db-row';

      const rl = document.createElement('div');
      rl.className = 'db-rlbl';
      rl.textContent = `R${r + 1}`;
      row.appendChild(rl);

      for (let pos = 0; pos < DRAFT_N; pos++) {
        const overall = r * DRAFT_N + pos + 1;
        const pIdx    = r % 2 === 0 ? pos : DRAFT_N - 1 - pos;
        const player  = this._state.draftOrder[pIdx];
        const color   = OWNER_COLORS[player] || '#8090b8';
        const pick    = pickMap[overall];
        const onClock = overall === curOverall && isActive;

        const [rv, gv, bv] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));

        const cell = document.createElement('div');
        cell.className = `db-cell${pick ? ' db-picked' : ''}${onClock ? ' db-clock' : ''}`;
        cell.style.cssText = `--r:${rv};--g:${gv};--b:${bv};`;

        if (pick) {
          cell.innerHTML = `
            ${flagImg(pick.team, 'flag-img-sm')}
            <span class="db-team">${escHtml(pick.team)}</span>
            <span class="db-pnum">#${pick.overall}</span>
          `;
        } else if (onClock) {
          cell.innerHTML = `
            <span class="db-clock-dot"></span>
            <span class="db-clock-lbl">Picking…</span>
          `;
        }

        row.appendChild(cell);
      }
      board.appendChild(row);
    }

    wrap.appendChild(board);
    return wrap;
  }

  // ── Team grid ─────────────────────────────────────────────────────────────────

  _buildGrid() {
    const picked = this._pickedSet;
    const wrap   = document.createElement('div');
    wrap.className = 'draft-grid-wrap';

    // Filter bar
    const bar = document.createElement('div');
    bar.className = 'draft-filter-bar';
    bar.innerHTML = `
      <input id="draft-search" class="draft-search" type="search" placeholder="Search teams…" autocomplete="off">
      <div class="draft-filter-btns" role="group" aria-label="Filter teams">
        <button class="dfb active" data-f="all">All</button>
        <button class="dfb" data-f="A">Tier A</button>
        <button class="dfb" data-f="B">Tier B</button>
        <button class="dfb" data-f="open">Available</button>
      </div>
    `;
    wrap.appendChild(bar);

    // Sort: Tier A first, then by odds (favorites first within each tier)
    const allTeams = Object.values(GROUPS).flat().sort((a, b) => {
      const ta = TIER_A.has(a) ? 0 : 1, tb = TIER_A.has(b) ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return this._oddsRank(a) - this._oddsRank(b);
    });

    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    grid.id = 'draft-grid';
    for (const team of allTeams) grid.appendChild(this._buildCard(team, picked));
    wrap.appendChild(grid);

    // Wire up filters
    bar.querySelectorAll('.dfb').forEach(btn => btn.addEventListener('click', () => {
      bar.querySelectorAll('.dfb').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this._applyFilter(grid, bar.querySelector('#draft-search').value, btn.dataset.f);
    }));
    bar.querySelector('#draft-search').addEventListener('input', e => {
      const f = bar.querySelector('.dfb.active').dataset.f;
      this._applyFilter(grid, e.target.value, f);
    });

    return wrap;
  }

  _oddsRank(team) {
    const o = this._odds[team];
    if (!o || o === '—') return 99999;
    const n = parseInt(o);
    return n < 0 ? 10000 / (-n) : n; // favorites (negative odds) sort first
  }

  _buildCard(team, picked) {
    const isPicked = picked.has(team);
    const isTierA  = TIER_A.has(team);
    const odds     = this._odds[team] || '—';
    const flag     = flagImg(team, 'flag-img-sm');

    let pickerName = null, pickerColor = null, pickNum = null;
    if (isPicked) {
      const pk = this._state.picks.find(p => p.team === team);
      if (pk) { pickerName = pk.player; pickerColor = OWNER_COLORS[pk.player]; pickNum = pk.overall; }
    }

    const card = document.createElement('div');
    card.className = `draft-card${isPicked ? ' picked' : ''}${isTierA ? ' tier-a' : ' tier-b'}`;
    card.dataset.team = team.toLowerCase();
    card.dataset.tier = isTierA ? 'A' : 'B';
    card.dataset.open = isPicked ? '0' : '1';

    if (isPicked && pickerColor) {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(pickerColor.slice(i, i + 2), 16));
      card.style.background    = `rgba(${r},${g},${b},0.10)`;
      card.style.borderColor   = `rgba(${r},${g},${b},0.50)`;
      card.style.borderLeftWidth = '4px';
    }

    const showPickBtn = !isPicked && this._isAdmin && this._state.status === 'active';

    // Build the right-column: owner badge if taken, odds + pick button if available
    const rightCol = isPicked && pickerName
      ? `<span class="dc-owner-badge" style="color:${pickerColor};border-color:${pickerColor}55">
           ${escHtml(pickerName)}<span class="dc-owner-pick"> · #${pickNum}</span>
         </span>
         <span class="dc-odds dc-odds-taken">${escHtml(odds)}</span>`
      : `<span class="dc-odds">${escHtml(odds)}</span>
         ${showPickBtn ? `<button class="dc-pick-btn">Pick</button>` : ''}`;

    card.innerHTML = `
      <div class="dc-flag">${flag}</div>
      <div class="dc-mid">
        <span class="dc-name">${escHtml(team)}</span>
        <span class="dc-tier ${isTierA ? 'tier-a-pill' : 'tier-b-pill'}">${isTierA ? 'Tier A' : 'Tier B'}</span>
      </div>
      <div class="dc-right">${rightCol}</div>
    `;

    if (showPickBtn) {
      card.querySelector('.dc-pick-btn').addEventListener('click', () => this._makePick(team));
    }
    return card;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  _applyFilter(grid, search, filter) {
    const q = search.toLowerCase().trim();
    for (const card of grid.querySelectorAll('.draft-card')) {
      const nameMatch   = !q || card.dataset.team.includes(q);
      const filterMatch = filter === 'all' ||
                          (filter === 'A'    && card.dataset.tier === 'A') ||
                          (filter === 'B'    && card.dataset.tier === 'B') ||
                          (filter === 'open' && card.dataset.open === '1');
      card.hidden = !(nameMatch && filterMatch);
    }
  }
}

// "Cody (Left)" → "Cody L", "Cody (Right)" → "Cody R", others unchanged
function _shortName(name) {
  return name.replace(/\s*\((\w)\w*\)/, (_, c) => ` ${c}`);
}
