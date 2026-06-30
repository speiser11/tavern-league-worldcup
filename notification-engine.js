/**
 * notification-engine.js
 * Native browser push notifications — no external service required.
 * Works as a PWA on iOS 16.4+ when added to home screen.
 *
 * Depends on globals from app.js:
 *   calculateScores, determineAdvancedTeams, computeGroupStandings,
 *   findTeamGroup, PARTICIPANTS, TEAM_FLAGS, TEAM_OWNER, OWNER_COLORS,
 *   SCORING, ROUND_SCORE_KEY, TIER_A, GROUPS, isFinished, isLive, scoringFor
 * Depends on escHtml from leaderboard.js.
 */

'use strict';

const NE_PREFS_KEY    = 'wc_notif_prefs';
const NE_SENT_KEY     = 'wc_notif_sent';
const NE_STATE_KEY    = 'wc_notif_state';
const NE_PROMPTED_KEY = 'wc_notif_prompted';
const NE_PUSH_SUB_KEY = 'wc_push_sub_endpoint';

const WORKER_URL      = 'https://tlwc-push.scottpeiser.workers.dev';
const VAPID_PUBLIC_KEY = 'BCKL5S_oVqfyChrUP7WXqfSXjyWl5SbGC56pHi8hAhKXJWJ6pb9bcg0QPepNx1esovZT1lh0knKvgPASKKXXh2I';

function _urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

const NE_DEFAULT_PREFS = {
  goals:              true,
  match_result:       true,
  leaderboard_change: true,
  match_starting:     true,
  halftime:           true,
  elimination:        true,
};

const NE_TYPE_LABELS = {
  goals:              'Goals scored',
  match_result:       'Match results',
  leaderboard_change: 'Standings changes',
  match_starting:     'Match starting soon',
  halftime:           'Halftime scores',
  elimination:        'Team eliminated',
};

const NE_ICON = '/tavern-league-worldcup/icon.svg';

class NotificationEngine {

  // ── Init ─────────────────────────────────────────────────────────────────────

  static init() {
    if (!('Notification' in window)) return;

    NotificationEngine._registerSW();
    NotificationEngine._initUI();

    if (!NotificationEngine._wasPrompted() && Notification.permission === 'default') {
      setTimeout(() => NotificationEngine._showOptInPrompt(), 4000);
    }
  }

  static async _registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/tavern-league-worldcup/sw.js');
      // If the user already granted permission but never registered a push sub
      // with the Worker, silently re-register — skipping requestPermission()
      // since we already know it's granted.
      if (Notification.permission === 'granted' && !localStorage.getItem(NE_PUSH_SUB_KEY)) {
        NotificationEngine._registerPushSub().catch(() => {});
      }
    } catch (e) {
      console.warn('[Notifications] SW registration failed:', e.message);
    }
  }

  // ── Called after every data fetch ────────────────────────────────────────────

  static checkAndNotify(matches) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const prevState = NotificationEngine._loadState();
    const newState  = NotificationEngine._buildState(matches);
    const sent      = NotificationEngine._loadSent();
    const prefs     = NotificationEngine._loadPrefs();

    if (!prevState.initialised) {
      NotificationEngine._seedSent(matches, sent);
      NotificationEngine._saveState({ ...newState, initialised: true });
      NotificationEngine._saveSent(sent);
      return;
    }

    const toSend = [];

    if (prefs.goals)
      toSend.push(...NotificationEngine._detectGoals(matches, prevState, sent));

    if (prefs.match_result)
      toSend.push(...NotificationEngine._detectResults(matches, prevState, sent));

    if (prefs.elimination)
      toSend.push(...NotificationEngine._detectEliminations(matches, prevState, sent));

    if (prefs.leaderboard_change)
      toSend.push(...NotificationEngine._detectLeaderboardChanges(newState, prevState, sent));

    if (prefs.match_starting)
      toSend.push(...NotificationEngine._detectStartingSoon(matches, sent));

    if (prefs.halftime)
      toSend.push(...NotificationEngine._detectHalftime(matches, prevState, sent));

    for (const n of toSend) {
      sent.add(n.key);
      NotificationEngine._send(n.title, n.body, n.key);
    }

    NotificationEngine._saveState({ ...newState, initialised: true });
    NotificationEngine._saveSent(sent);
  }

  // ── Detectors ─────────────────────────────────────────────────────────────────

  static _detectGoals(matches, prevState, sent) {
    const events = [];
    for (const m of matches) {
      if (!isLive(m.status) && !isFinished(m.status)) continue;
      if (!m.goals?.length) continue;

      const prevGoalCount = prevState.goalCounts?.[m.matchId] ?? 0;
      if (m.goals.length <= prevGoalCount) continue;

      // Only fire for newly detected goals
      const newGoals = m.goals.slice(prevGoalCount);
      let h = 0, a = 0;
      for (const g of m.goals) { g.side === 'home' ? h++ : a++; }
      // Re-count from scratch for score context
      let rh = 0, ra = 0;
      for (let i = 0; i < m.goals.length; i++) {
        const g = m.goals[i];
        g.side === 'home' ? rh++ : ra++;
        if (i < prevGoalCount) continue;

        const team  = g.side === 'home' ? m.homeTeam : m.awayTeam;
        const opp   = g.side === 'home' ? m.awayTeam : m.homeTeam;
        const owner = TEAM_OWNER[team];
        const flag  = TEAM_FLAGS[team] || '';
        const key   = `goal_${m.matchId}_${i}`;
        if (sent.has(key)) continue;

        const scorer = g.scorer ? g.scorer.split(' ').pop() : 'Goal';
        const tags   = [g.penalty && 'pen', g.ownGoal && 'OG'].filter(Boolean).join(', ');
        const score  = `${rh}–${ra}`;

        events.push({
          key,
          title: `${flag} GOAL — ${team} ${score}`,
          body:  `${g.minute} ${scorer}${tags ? ` (${tags})` : ''}${owner ? ` · ${owner}'s team` : ''} vs ${opp}`,
        });
      }
    }
    return events;
  }

  static _detectResults(matches, prevState, sent) {
    const events = [];
    const scores  = calculateScores(matches);
    const rankMap = Object.fromEntries(scores.map(s => [s.name, s.rank]));

    for (const m of matches) {
      if (!isFinished(m.status) || m.homeScore === null) continue;
      const prevM = prevState.matches?.[m.matchId];
      if (prevM && isFinished(prevM.status)) continue;

      const homeOwner = TEAM_OWNER[m.homeTeam];
      const awayOwner = TEAM_OWNER[m.awayTeam];
      if (!homeOwner && !awayOwner) continue;

      // One notification per match regardless of how many owners are involved
      const key = `result_${m.matchId}`;
      if (sent.has(key)) continue;

      const hs = m.homeScore, as_ = m.awayScore;
      const hf = TEAM_FLAGS[m.homeTeam] || '';
      const af = TEAM_FLAGS[m.awayTeam] || '';

      const _pts = (teamName, won, drew) => {
        const tier    = scoringFor(teamName);
        const opp     = teamName === m.homeTeam ? m.awayTeam : m.homeTeam;
        const gkBonus = won && !TIER_A.has(teamName) && TIER_A.has(opp) ? (tier.giant_killer ?? 0) : 0;
        if (won)  return (m.round === 'group' ? tier.group_win : (tier[ROUND_SCORE_KEY[m.round]] ?? 0)) + gkBonus;
        if (drew) return tier.group_draw ?? 0;
        return 0;
      };

      const { won: homeWon, drew: isDraw } = teamMatchResult(m, m.homeTeam);

      // Build owner impact lines
      const lines = [];
      if (homeOwner) {
        const won = homeWon, drew = isDraw;
        const pts = _pts(m.homeTeam, won, drew);
        const gk  = won && !TIER_A.has(m.homeTeam) && TIER_A.has(m.awayTeam);
        lines.push(`${homeOwner} (${m.homeTeam}) ${pts > 0 ? `+${pts} pts` : '0 pts'}${gk ? ' 🔪' : ''}`);
      }
      if (awayOwner) {
        const won = !homeWon && !isDraw, drew = isDraw;
        const pts = _pts(m.awayTeam, won, drew);
        const gk  = won && !TIER_A.has(m.awayTeam) && TIER_A.has(m.homeTeam);
        lines.push(`${awayOwner} (${m.awayTeam}) ${pts > 0 ? `+${pts} pts` : '0 pts'}${gk ? ' 🔪' : ''}`);
      }

      const pensTag = m.status === 'PEN' ? ' (pens)' : '';
      const result = isDraw ? 'Draw' : homeWon ? `${m.homeTeam} win` : `${m.awayTeam} win`;
      events.push({
        key,
        title: `🏁 ${hf} ${m.homeTeam} ${hs}–${as_}${pensTag} ${m.awayTeam} ${af}`,
        body:  `${result} · ${lines.join(' / ')}`,
      });
    }
    return events;
  }

  static _detectEliminations(matches, prevState, sent) {
    const events = [];

    const standings = computeGroupStandings(matches);
    for (const [g, rows] of Object.entries(standings)) {
      const done = matches.filter(m =>
        m.round === 'group' && isFinished(m.status) &&
        (findTeamGroup(m.homeTeam) === g || findTeamGroup(m.awayTeam) === g)
      ).length;
      if (done < 6) continue;

      const last = rows[3];
      if (!last) continue;
      const owner = TEAM_OWNER[last.team];
      if (!owner) continue;

      const key = `elim_group_${last.team}`;
      if (sent.has(key) || prevState.eliminated?.includes(last.team)) continue;

      const flag    = TEAM_FLAGS[last.team] || '';
      const partner = (PARTICIPANTS[owner] || []).find(t => t !== last.team);
      events.push({
        key,
        title: `${flag} ${last.team} eliminated`,
        body:  partner ? `${owner}'s hopes rest on ${partner}.` : `${owner} is out of the running.`,
      });
    }

    for (const m of matches) {
      if (m.round === 'group' || !isFinished(m.status) || m.homeScore === null) continue;
      const prevM = prevState.matches?.[m.matchId];
      if (prevM && isFinished(prevM.status)) continue;

      for (const teamName of [m.homeTeam, m.awayTeam]) {
        const owner = TEAM_OWNER[teamName];
        if (!owner) continue;
        const { won, drew } = teamMatchResult(m, teamName);
        if (won || drew) continue;

        const key = `elim_ko_${m.matchId}_${teamName}`;
        if (sent.has(key)) continue;

        const flag    = TEAM_FLAGS[teamName] || '';
        const round   = { round_of_32: 'Round of 32', round_of_16: 'Round of 16',
                          quarterfinal: 'Quarterfinal', semifinal: 'Semifinal',
                          final: 'the final' }[m.round] || m.round;
        const partner = (PARTICIPANTS[owner] || []).find(t => t !== teamName);
        events.push({
          key,
          title: `${flag} ${teamName} eliminated`,
          body:  partner
            ? `Out in ${round}. ${owner}'s hopes rest on ${partner}.`
            : `${owner} is eliminated in ${round}.`,
        });
      }
    }
    return events;
  }

  static _detectLeaderboardChanges(newState, prevState, sent) {
    if (!prevState.ranks || !Object.keys(prevState.ranks).length) return [];

    const movers = [];
    for (const [name, newRank] of Object.entries(newState.ranks)) {
      const old = prevState.ranks[name];
      if (old == null || old === newRank) continue;
      movers.push({ name, newRank, oldRank: old, up: old > newRank });
    }
    if (!movers.length) return [];

    const key = `lb_${newState.scoreHash}`;
    if (sent.has(key)) return [];

    // Sort: biggest climbers first
    movers.sort((a, b) => (b.oldRank - b.newRank) - (a.oldRank - a.newRank));

    // Build a compact summary of who moved
    const summary = movers
      .slice(0, 3)
      .map(m => `${m.name} → ${m.newRank}${_ordinal(m.newRank)}`)
      .join(', ');
    const extra = movers.length > 3 ? ` +${movers.length - 3} more` : '';

    return [{
      key,
      title: '📊 Standings change',
      body:  summary + extra,
    }];
  }

  static _detectStartingSoon(matches, sent) {
    const events = [];
    const now    = Date.now();

    for (const m of matches) {
      if (m.status !== 'NS') continue;
      if (!TEAM_OWNER[m.homeTeam] && !TEAM_OWNER[m.awayTeam]) continue;

      const kickoff = new Date(m.date).getTime();
      const minsOut = (kickoff - now) / 60000;
      if (minsOut < 5 || minsOut > 20) continue;

      const key = `starting_${m.matchId}`;
      if (sent.has(key)) continue;

      const hf   = TEAM_FLAGS[m.homeTeam] || '';
      const af   = TEAM_FLAGS[m.awayTeam] || '';
      const mins = Math.round(minsOut);
      const owners = [TEAM_OWNER[m.homeTeam], TEAM_OWNER[m.awayTeam]].filter(Boolean);
      events.push({
        key,
        title: `⚽ ${hf} ${m.homeTeam} vs ${m.awayTeam} ${af}`,
        body:  `Kicks off in ${mins}min${owners.length ? ` · ${owners.join(' & ')}` : ''}`,
      });
    }
    return events;
  }

  static _detectHalftime(matches, prevState, sent) {
    const events = [];
    for (const m of matches) {
      if (m.status !== 'HT') continue;
      if (!TEAM_OWNER[m.homeTeam] && !TEAM_OWNER[m.awayTeam]) continue;

      const key = `halftime_${m.matchId}`;
      if (sent.has(key)) continue;
      if (prevState.matches?.[m.matchId]?.status === 'HT') continue;

      const hf    = TEAM_FLAGS[m.homeTeam] || '';
      const af    = TEAM_FLAGS[m.awayTeam] || '';
      const owners = [TEAM_OWNER[m.homeTeam], TEAM_OWNER[m.awayTeam]].filter(Boolean);
      events.push({
        key,
        title: `⏸ HT — ${hf} ${m.homeTeam} ${m.homeScore}–${m.awayScore} ${m.awayTeam} ${af}`,
        body:  owners.length ? `${owners.join(' & ')} — halftime` : 'Halftime',
      });
    }
    return events;
  }

  // ── Send ──────────────────────────────────────────────────────────────────────

  static async _send(title, body, tag) {
    if (Notification.permission !== 'granted') return;
    const opts = { body, icon: NE_ICON, badge: NE_ICON, tag };
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg?.showNotification) {
        await reg.showNotification(title, opts);
      } else {
        new Notification(title, opts);
      }
    } catch (e) {
      console.warn('[Notifications] Send failed:', e.message);
    }
  }

  // ── Subscription ──────────────────────────────────────────────────────────────

  static _isSubscribed() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  static async _subscribe() {
    if (!('Notification' in window)) return false;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      NotificationEngine._updateBellState();
      return false;
    }
    await NotificationEngine._registerPushSub();
    NotificationEngine._updateBellState();
    return true;
  }

  // Register push sub with Worker — can be called without a user gesture
  // since it doesn't call requestPermission().
  static async _registerPushSub() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlB64ToUint8(VAPID_PUBLIC_KEY),
      });
      await fetch(`${WORKER_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub),
      });
      localStorage.setItem(NE_PUSH_SUB_KEY, sub.endpoint);
    } catch (e) {
      console.warn('[Notifications] Push subscription failed:', e.message);
    }
  }

  static async _unsubscribePush() {
    try {
      const endpoint = localStorage.getItem(NE_PUSH_SUB_KEY);
      if (endpoint) {
        fetch(`${WORKER_URL}/subscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
        localStorage.removeItem(NE_PUSH_SUB_KEY);
      }
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
    } catch (e) {
      console.warn('[Notifications] Unsubscribe failed:', e.message);
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  static _buildState(matches) {
    const ms = {}, goalCounts = {};
    for (const m of matches) {
      ms[m.matchId] = { status: m.status, homeScore: m.homeScore, awayScore: m.awayScore };
      goalCounts[m.matchId] = m.goals?.length ?? 0;
    }
    const scores    = calculateScores(matches);
    const ranks     = Object.fromEntries(scores.map(s => [s.name, s.rank]));
    const scoreHash = scores.map(s => `${s.name}:${s.totalScore}`).join('|');
    const eliminated = [];
    const standings  = computeGroupStandings(matches);
    for (const [g, rows] of Object.entries(standings)) {
      const done = matches.filter(m =>
        m.round === 'group' && isFinished(m.status) &&
        (findTeamGroup(m.homeTeam) === g || findTeamGroup(m.awayTeam) === g)
      ).length;
      if (done >= 6 && rows[3]) eliminated.push(rows[3].team);
    }
    return { matches: ms, ranks, scoreHash, eliminated, goalCounts };
  }

  static _seedSent(matches, sent) {
    for (const m of matches) {
      if (!isFinished(m.status)) continue;
      for (const [teamName] of [[m.homeTeam], [m.awayTeam]]) {
        if (TEAM_OWNER[teamName]) sent.add(`result_${m.matchId}_${teamName}`);
      }
      if (m.goals?.length) {
        for (let i = 0; i < m.goals.length; i++) sent.add(`goal_${m.matchId}_${i}`);
      }
    }
    const standings = computeGroupStandings(matches);
    for (const [g, rows] of Object.entries(standings)) {
      const done = matches.filter(m =>
        m.round === 'group' && isFinished(m.status) &&
        (findTeamGroup(m.homeTeam) === g || findTeamGroup(m.awayTeam) === g)
      ).length;
      if (done >= 6 && rows[3] && TEAM_OWNER[rows[3].team])
        sent.add(`elim_group_${rows[3].team}`);
    }
    for (const m of matches) {
      if (m.round === 'group' || !isFinished(m.status) || m.homeScore === null) continue;
      for (const teamName of [m.homeTeam, m.awayTeam]) {
        if (!TEAM_OWNER[teamName]) continue;
        const { won, drew } = teamMatchResult(m, teamName);
        if (!won && !drew) sent.add(`elim_ko_${m.matchId}_${teamName}`);
      }
    }
  }

  static _loadState()     { try { return JSON.parse(localStorage.getItem(NE_STATE_KEY) || '{}'); } catch { return {}; } }
  static _saveState(s)    { try { localStorage.setItem(NE_STATE_KEY, JSON.stringify(s)); } catch {} }
  static _loadSent()      { try { return new Set(JSON.parse(localStorage.getItem(NE_SENT_KEY) || '[]')); } catch { return new Set(); } }
  static _saveSent(s)     { try { localStorage.setItem(NE_SENT_KEY, JSON.stringify([...s].slice(-500))); } catch {} }
  static _loadPrefs()     { try { const r = localStorage.getItem(NE_PREFS_KEY); return r ? { ...NE_DEFAULT_PREFS, ...JSON.parse(r) } : { ...NE_DEFAULT_PREFS }; } catch { return { ...NE_DEFAULT_PREFS }; } }
  static _savePrefs(p)    { try { localStorage.setItem(NE_PREFS_KEY, JSON.stringify(p)); } catch {} }
  static _wasPrompted()   { return localStorage.getItem(NE_PROMPTED_KEY) === '1'; }
  static _markPrompted()  { try { localStorage.setItem(NE_PROMPTED_KEY, '1'); } catch {} }

  // ── UI ────────────────────────────────────────────────────────────────────────

  static _initUI() {
    const bell  = document.getElementById('notif-bell');
    const panel = document.getElementById('notif-panel');
    if (!bell || !panel) return;

    NotificationEngine._updateBellState();

    bell.addEventListener('click', e => {
      e.stopPropagation();
      const open = panel.classList.toggle('is-open');
      bell.setAttribute('aria-expanded', String(open));
      if (open) {
        // Position below header, accounting for mobile header height
        const headerH = document.querySelector('.site-header')?.getBoundingClientRect().height ?? 56;
        panel.style.top = (headerH + 6) + 'px';
        NotificationEngine._renderPanel();
      }
    });

    document.addEventListener('click', e => {
      if (!panel.classList.contains('is-open')) return;
      if (!panel.contains(e.target) && e.target !== bell) {
        panel.classList.remove('is-open');
        bell.setAttribute('aria-expanded', 'false');
      }
    });
  }

  static _renderPanel() {
    const panel      = document.getElementById('notif-panel');
    if (!panel) return;
    const subscribed = NotificationEngine._isSubscribed();
    const prefs      = NotificationEngine._loadPrefs();
    const supported  = 'Notification' in window;

    const typeRowsHtml = Object.entries(NE_TYPE_LABELS).map(([type, label]) => `
      <label class="np-pref-row">
        <span class="np-pref-label">${label}</span>
        <span class="np-toggle-wrap">
          <input class="np-toggle-input" type="checkbox" data-type="${type}"
            ${prefs[type] ? 'checked' : ''} ${!subscribed ? 'disabled' : ''}>
          <span class="np-toggle-track" aria-hidden="true"></span>
        </span>
      </label>`).join('');

    panel.innerHTML = !supported ? `
      <div class="np-header"><span class="np-title">Notifications</span></div>
      <div class="np-body">
        <p class="np-desc">Your browser doesn't support notifications. On iOS, add this site to your Home Screen first.</p>
      </div>
    ` : subscribed ? `
      <div class="np-header">
        <span class="np-title">Notifications</span>
        <button class="np-close" id="np-close" aria-label="Close">✕</button>
      </div>
      <div class="np-body">
        <p class="np-status np-status-on"><span class="np-status-dot"></span> Notifications <strong>on</strong></p>
        <div class="np-prefs">${typeRowsHtml}</div>
        <button class="np-action np-unsub" id="np-unsub">Turn off</button>
      </div>
    ` : `
      <div class="np-header">
        <span class="np-title">Notifications</span>
        <button class="np-close" id="np-close" aria-label="Close">✕</button>
      </div>
      <div class="np-body">
        <p class="np-status np-status-off">Notifications are <strong>off</strong></p>
        <p class="np-desc">Goals, match results, standings changes — even when the tab is in the background.</p>
        <button class="np-action np-sub" id="np-sub">Enable notifications</button>
      </div>
    `;

    document.getElementById('np-close')?.addEventListener('click', () => {
      panel.classList.remove('is-open');
      document.getElementById('notif-bell')?.setAttribute('aria-expanded', 'false');
    });
    document.getElementById('np-sub')?.addEventListener('click', async () => {
      const granted = await NotificationEngine._subscribe();
      if (granted) NotificationEngine._markPrompted();
      NotificationEngine._renderPanel();
    });
    document.getElementById('np-unsub')?.addEventListener('click', async () => {
      await NotificationEngine._unsubscribePush();
      alert('Unsubscribed from push notifications. To fully block them, also check your browser or OS notification settings.');
      NotificationEngine._renderPanel();
    });
    panel.querySelectorAll('.np-toggle-input').forEach(cb => {
      cb.addEventListener('change', () => {
        const p = NotificationEngine._loadPrefs();
        p[cb.dataset.type] = cb.checked;
        NotificationEngine._savePrefs(p);
      });
    });
  }

  static _updateBellState() {
    const bell = document.getElementById('notif-bell');
    if (!bell) return;
    const on = NotificationEngine._isSubscribed();
    bell.classList.toggle('notif-bell-on', on);
    bell.title = on ? 'Notification settings' : 'Enable notifications';
    bell.setAttribute('aria-label', bell.title);
  }

  static _showOptInPrompt() {
    if (NotificationEngine._isSubscribed() || document.getElementById('notif-optin')) return;

    const el = document.createElement('div');
    el.id = 'notif-optin';
    el.className = 'notif-optin';
    el.innerHTML = `
      <span class="notif-optin-icon">🔔</span>
      <div class="notif-optin-text">
        <strong>Stay in the loop</strong>
        <span>Goals, results &amp; standings — even in the background.</span>
      </div>
      <div class="notif-optin-btns">
        <button class="notif-optin-allow" id="notif-optin-allow">Allow</button>
        <button class="notif-optin-later" id="notif-optin-later">Not now</button>
      </div>
    `;
    document.body.appendChild(el);

    document.getElementById('notif-optin-allow')?.addEventListener('click', async () => {
      el.remove();
      NotificationEngine._markPrompted();
      await NotificationEngine._subscribe();
    });
    document.getElementById('notif-optin-later')?.addEventListener('click', () => {
      el.remove();
      NotificationEngine._markPrompted();
    });
  }
}

function _ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ['th','st','nd','rd'][(n % 10)] || 'th';
}
