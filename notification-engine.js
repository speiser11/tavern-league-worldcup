/**
 * notification-engine.js
 * Push notification integration via OneSignal (free tier).
 *
 * Requires in config.js:
 *   CONFIG.ONESIGNAL_APP_ID      — from onesignal.com dashboard
 *   CONFIG.ONESIGNAL_REST_API_KEY — Settings > Keys & IDs > REST API Key
 *     NOTE: This key is visible in page source. Acceptable for a private
 *     friend-group app — it can only send notifications to your own app's
 *     subscribers and cannot read data or access other apps.
 *
 * Depends on globals from app.js (loaded before this script):
 *   calculateScores, determineAdvancedTeams, computeGroupStandings,
 *   findTeamGroup, PARTICIPANTS, TEAM_FLAGS, TEAM_OWNER, OWNER_COLORS,
 *   SCORING, ROUND_SCORE_KEY, TIER_A, GROUPS, isFinished, isLive
 *
 * Depends on escHtml from leaderboard.js (loaded before this script).
 */

'use strict';

// ── Storage keys ───────────────────────────────────────────────────────────────
const NE_PREFS_KEY    = 'wc_notif_prefs';
const NE_SENT_KEY     = 'wc_notif_sent';
const NE_STATE_KEY    = 'wc_notif_state';
const NE_PROMPTED_KEY = 'wc_notif_prompted';

// ── Defaults ───────────────────────────────────────────────────────────────────
const NE_DEFAULT_PREFS = {
  match_result:        true,
  elimination:         true,
  leaderboard_change:  true,
  match_starting:      true,
};

const NE_TYPE_LABELS = {
  match_result:        'Match results',
  elimination:         'Team eliminated',
  leaderboard_change:  'Leaderboard changes',
  match_starting:      'Match starting soon',
};

// ── Module state ───────────────────────────────────────────────────────────────
let _osReady = false;   // OneSignal SDK initialized

// ── Main class ─────────────────────────────────────────────────────────────────

class NotificationEngine {

  // ── Initialization ───────────────────────────────────────────────────────────

  static init() {
    if (!CONFIG?.ONESIGNAL_APP_ID) return;  // no-op if not configured

    // OneSignal v16 deferred init pattern
    window.OneSignalDeferred = window.OneSignalDeferred || [];
    OneSignalDeferred.push(async function (OneSignal) {
      try {
        await OneSignal.init({
          appId:        CONFIG.ONESIGNAL_APP_ID,
          notifyButton: { enable: false },  // using our own bell icon
        });
        _osReady = true;
        NotificationEngine._updateBellState();
      } catch (e) {
        console.warn('[Notifications] OneSignal init failed:', e.message);
      }
    });

    NotificationEngine._initUI();

    // Polite first-visit opt-in prompt — never auto-requests permission
    if (!NotificationEngine._wasPrompted()) {
      setTimeout(() => NotificationEngine._showOptInPrompt(), 3500);
    }
  }

  // ── Called after every data fetch ────────────────────────────────────────────

  static checkAndNotify(matches) {
    if (!CONFIG?.ONESIGNAL_APP_ID || !CONFIG?.ONESIGNAL_REST_API_KEY) return;

    const prevState = NotificationEngine._loadState();
    const newState  = NotificationEngine._buildState(matches);
    const sent      = NotificationEngine._loadSent();
    const prefs     = NotificationEngine._loadPrefs();

    // First-ever load: pre-populate sent set so we don't flood historical events
    if (!prevState.initialised) {
      NotificationEngine._seedSentFromHistory(matches, sent);
      NotificationEngine._saveState({ ...newState, initialised: true });
      NotificationEngine._saveSent(sent);
      return;
    }

    const toSend = [];

    if (prefs.match_result)
      toSend.push(...NotificationEngine._detectResults(matches, prevState, sent));

    if (prefs.elimination)
      toSend.push(...NotificationEngine._detectEliminations(matches, prevState, sent));

    if (prefs.leaderboard_change)
      toSend.push(...NotificationEngine._detectLeaderboardChanges(newState, prevState, sent));

    if (prefs.match_starting)
      toSend.push(...NotificationEngine._detectStartingSoon(matches, sent));

    for (const n of toSend) {
      sent.add(n.key);
      NotificationEngine._send(n.title, n.body, n.key);
    }

    NotificationEngine._saveState({ ...newState, initialised: true });
    NotificationEngine._saveSent(sent);
  }

  // ── Event detectors ───────────────────────────────────────────────────────────

  static _detectResults(matches, prevState, sent) {
    const events = [];
    const scores  = calculateScores(matches);
    const rankMap = Object.fromEntries(scores.map(s => [s.name, s.rank]));

    for (const m of matches) {
      if (!isFinished(m.status) || m.homeScore === null) continue;

      const prevM = prevState.matches?.[m.matchId];
      if (prevM && isFinished(prevM.status)) continue;  // already was finished

      for (const [teamName, isHome] of [[m.homeTeam, true], [m.awayTeam, false]]) {
        const owner = TEAM_OWNER[teamName];
        if (!owner) continue;

        const key = `result_${m.matchId}_${teamName}`;
        if (sent.has(key)) continue;

        const ts  = isHome ? m.homeScore : m.awayScore;
        const os  = isHome ? m.awayScore : m.homeScore;
        const opp = isHome ? m.awayTeam  : m.homeTeam;
        const flag = TEAM_FLAGS[teamName] || '';

        if (ts > os) {
          const tier   = scoringFor(teamName);
          const opp    = isHome ? m.awayTeam : m.homeTeam;
          const gkBonus = (tier.giant_killer && TIER_A.has(opp)) ? tier.giant_killer : 0;
          const pts = m.round === 'group'
            ? tier.group_win + gkBonus
            : (tier[ROUND_SCORE_KEY[m.round]] ?? 0) + gkBonus;
          const rank = rankMap[owner];
          const rankStr = rank ? ` (now ${rank}${_ordinal(rank)})` : '';
          events.push({
            key,
            title: `✅ ${flag} ${teamName} win!`,
            body:  `${owner} +${pts} pts${rankStr} · ${ts}–${os} vs ${opp}`,
          });
        } else if (ts === os) {
          events.push({
            key,
            title: `➖ ${flag} ${teamName} draw`,
            body:  `${owner} +1 pt · ${ts}–${os} vs ${opp}`,
          });
        } else {
          events.push({
            key,
            title: `❌ ${flag} ${teamName} lose`,
            body:  `${owner} earns no pts · ${ts}–${os} vs ${opp}`,
          });
        }
      }
    }
    return events;
  }

  static _detectEliminations(matches, prevState, sent) {
    const events = [];
    const advanced = determineAdvancedTeams(matches, null);

    // Group stage: owned team ranked 4th in a completed group
    const standings = computeGroupStandings(matches);
    for (const [g, rows] of Object.entries(standings)) {
      const doneCount = matches.filter(m =>
        m.round === 'group' && isFinished(m.status) &&
        (findTeamGroup(m.homeTeam) === g || findTeamGroup(m.awayTeam) === g)
      ).length;
      if (doneCount < 6) continue;

      const last = rows[3];
      if (!last) continue;
      const owner = TEAM_OWNER[last.team];
      if (!owner) continue;

      const key = `elim_group_${last.team}`;
      if (sent.has(key)) continue;
      if (prevState.eliminated?.includes(last.team)) continue;

      const flag    = TEAM_FLAGS[last.team] || '';
      const partner = (PARTICIPANTS[owner] || []).find(t => t !== last.team);
      events.push({
        key,
        title: `💀 ${flag} ${last.team} eliminated`,
        body:  partner
          ? `${owner}'s hopes rest on ${partner}.`
          : `${owner} is out of the running.`,
      });
    }

    // Knockout: owned team just lost
    for (const m of matches) {
      if (m.round === 'group' || !isFinished(m.status) || m.homeScore === null) continue;
      const prevM = prevState.matches?.[m.matchId];
      if (prevM && isFinished(prevM.status)) continue;

      for (const [teamName, isHome] of [[m.homeTeam, true], [m.awayTeam, false]]) {
        const owner = TEAM_OWNER[teamName];
        if (!owner) continue;
        const ts = isHome ? m.homeScore : m.awayScore;
        const os = isHome ? m.awayScore : m.homeScore;
        if (ts >= os) continue;

        const key = `elim_ko_${m.matchId}_${teamName}`;
        if (sent.has(key)) continue;

        const flag    = TEAM_FLAGS[teamName] || '';
        const round   = { round_of_32: 'Round of 32', round_of_16: 'Round of 16',
                          quarterfinal: 'Quarterfinal', semifinal: 'Semifinal',
                          final: 'the final' }[m.round] || m.round;
        const partner = (PARTICIPANTS[owner] || []).find(t => t !== teamName);
        events.push({
          key,
          title: `💀 ${flag} ${teamName} eliminated`,
          body:  partner
            ? `Out in the ${round}. ${owner}'s hopes rest on ${partner}.`
            : `${owner} is eliminated in the ${round}.`,
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
      if (old > newRank) movers.push({ name, newRank, delta: old - newRank });
    }
    if (!movers.length) return [];

    movers.sort((a, b) => b.delta - a.delta);
    const top = movers[0];
    const key = `lb_${top.name}_to_${top.newRank}_${newState.scoreHash}`;
    if (sent.has(key)) return [];

    const icon  = top.newRank === 1 ? '🥇' : top.newRank === 2 ? '🥈' : '📊';
    const extra = movers.length > 1 ? ` (${movers.length - 1} more moved)` : '';
    return [{
      key,
      title: `${icon} Standings update`,
      body:  `${top.name} moves to ${top.newRank}${_ordinal(top.newRank)}!${extra}`,
    }];
  }

  static _detectStartingSoon(matches, sent) {
    const events = [];
    const now    = Date.now();

    for (const m of matches) {
      if (m.status !== 'NS') continue;
      if (!TEAM_OWNER[m.homeTeam] && !TEAM_OWNER[m.awayTeam]) continue;

      const kickoff  = new Date(m.date).getTime();
      const minsOut  = (kickoff - now) / 60000;
      if (minsOut < 5 || minsOut > 20) continue;   // only fire in 5–20 min window

      const key = `starting_${m.matchId}`;
      if (sent.has(key)) continue;

      const hf   = TEAM_FLAGS[m.homeTeam] || '';
      const af   = TEAM_FLAGS[m.awayTeam] || '';
      const mins = Math.round(minsOut);
      events.push({
        key,
        title: `⚽ ${hf} ${m.homeTeam} vs ${m.awayTeam} ${af}`,
        body:  `Kicks off in ${mins} minute${mins !== 1 ? 's' : ''}`,
      });
    }
    return events;
  }

  // ── OneSignal REST API ────────────────────────────────────────────────────────

  static async _send(title, body, idempotencyKey) {
    if (!CONFIG.ONESIGNAL_REST_API_KEY) return;
    try {
      const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Basic ${CONFIG.ONESIGNAL_REST_API_KEY}`,
        },
        body: JSON.stringify({
          app_id:            CONFIG.ONESIGNAL_APP_ID,
          included_segments: ['All'],
          headings:          { en: title },
          contents:          { en: body },
          idempotency_key:   idempotencyKey,
          url:               CONFIG.SITE_URL || '',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn('[Notifications] Send failed:', err.errors || res.status);
      }
    } catch (e) {
      console.warn('[Notifications] Send error:', e.message);
    }
  }

  // ── First-load seeding (prevent historical flood) ─────────────────────────────

  static _seedSentFromHistory(matches, sent) {
    const advanced = determineAdvancedTeams(matches, null);
    for (const m of matches) {
      if (!isFinished(m.status)) continue;
      for (const [teamName] of [[m.homeTeam], [m.awayTeam]]) {
        if (TEAM_OWNER[teamName]) sent.add(`result_${m.matchId}_${teamName}`);
      }
    }
    // Seed group eliminations
    const standings = computeGroupStandings(matches);
    for (const [g, rows] of Object.entries(standings)) {
      const doneCount = matches.filter(m =>
        m.round === 'group' && isFinished(m.status) &&
        (findTeamGroup(m.homeTeam) === g || findTeamGroup(m.awayTeam) === g)
      ).length;
      if (doneCount >= 6 && rows[3] && TEAM_OWNER[rows[3].team]) {
        sent.add(`elim_group_${rows[3].team}`);
      }
    }
    // Seed KO eliminations
    for (const m of matches) {
      if (m.round === 'group' || !isFinished(m.status) || m.homeScore === null) continue;
      for (const [teamName, isHome] of [[m.homeTeam, true], [m.awayTeam, false]]) {
        if (!TEAM_OWNER[teamName]) continue;
        const ts = isHome ? m.homeScore : m.awayScore;
        const os = isHome ? m.awayScore : m.homeScore;
        if (ts < os) sent.add(`elim_ko_${m.matchId}_${teamName}`);
      }
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  static _buildState(matches) {
    const ms = {};
    for (const m of matches) {
      ms[m.matchId] = { status: m.status, homeScore: m.homeScore, awayScore: m.awayScore };
    }
    const scores = calculateScores(matches);
    const ranks  = Object.fromEntries(scores.map(s => [s.name, s.rank]));
    const scoreHash = scores.map(s => `${s.name}:${s.totalScore}`).join('|');
    // Track eliminated teams for dedup
    const eliminated = [];
    const standings  = computeGroupStandings(matches);
    for (const [g, rows] of Object.entries(standings)) {
      const done = matches.filter(m =>
        m.round === 'group' && isFinished(m.status) &&
        (findTeamGroup(m.homeTeam) === g || findTeamGroup(m.awayTeam) === g)
      ).length;
      if (done >= 6 && rows[3]) eliminated.push(rows[3].team);
    }
    return { matches: ms, ranks, scoreHash, eliminated };
  }

  static _loadState() {
    try {
      const raw = localStorage.getItem(NE_STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  static _saveState(s) {
    try { localStorage.setItem(NE_STATE_KEY, JSON.stringify(s)); } catch {}
  }

  static _loadSent() {
    try { return new Set(JSON.parse(localStorage.getItem(NE_SENT_KEY) || '[]')); }
    catch { return new Set(); }
  }

  static _saveSent(s) {
    // Trim to last 500 entries to keep localStorage lean
    const arr = [...s].slice(-500);
    try { localStorage.setItem(NE_SENT_KEY, JSON.stringify(arr)); } catch {}
  }

  static _loadPrefs() {
    try {
      const raw = localStorage.getItem(NE_PREFS_KEY);
      return raw ? { ...NE_DEFAULT_PREFS, ...JSON.parse(raw) } : { ...NE_DEFAULT_PREFS };
    } catch { return { ...NE_DEFAULT_PREFS }; }
  }

  static _savePrefs(p) {
    try { localStorage.setItem(NE_PREFS_KEY, JSON.stringify(p)); } catch {}
  }

  static _wasPrompted() {
    return localStorage.getItem(NE_PROMPTED_KEY) === '1';
  }

  static _markPrompted() {
    try { localStorage.setItem(NE_PROMPTED_KEY, '1'); } catch {}
  }

  // ── Subscription helpers ──────────────────────────────────────────────────────

  static _isSubscribed() {
    if (!_osReady || typeof OneSignal === 'undefined') return false;
    try { return OneSignal.User?.PushSubscription?.optedIn === true; } catch { return false; }
  }

  static async _subscribe() {
    if (!_osReady) return;
    try {
      await OneSignal.User.PushSubscription.optIn();
      NotificationEngine._updateBellState();
    } catch (e) { console.warn('[Notifications] Subscribe error:', e.message); }
  }

  static async _unsubscribe() {
    if (!_osReady) return;
    try {
      await OneSignal.User.PushSubscription.optOut();
      NotificationEngine._updateBellState();
    } catch (e) { console.warn('[Notifications] Unsubscribe error:', e.message); }
  }

  // ── UI ────────────────────────────────────────────────────────────────────────

  static _initUI() {
    const bell  = document.getElementById('notif-bell');
    const panel = document.getElementById('notif-panel');
    if (!bell || !panel) return;

    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.classList.toggle('is-open');
      bell.setAttribute('aria-expanded', String(open));
      if (open) NotificationEngine._renderPanel();
    });

    document.addEventListener('click', (e) => {
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

    const typeRowsHtml = Object.entries(NE_TYPE_LABELS).map(([type, label]) => `
      <label class="np-pref-row">
        <span class="np-pref-label">${label}</span>
        <span class="np-toggle-wrap">
          <input class="np-toggle-input" type="checkbox" data-type="${type}"
            ${prefs[type] ? 'checked' : ''} ${!subscribed ? 'disabled' : ''}>
          <span class="np-toggle-track" aria-hidden="true"></span>
        </span>
      </label>`).join('');

    panel.innerHTML = `
      <div class="np-header">
        <span class="np-title">Notifications</span>
        <button class="np-close" id="np-close" aria-label="Close panel">✕</button>
      </div>
      <div class="np-body">
        ${subscribed ? `
          <p class="np-status np-status-on">
            <span class="np-status-dot"></span> Push notifications <strong>on</strong>
          </p>
          <div class="np-prefs">${typeRowsHtml}</div>
          <button class="np-action np-unsub" id="np-unsub">Turn off notifications</button>
        ` : `
          <p class="np-status np-status-off">Push notifications are <strong>off</strong></p>
          <p class="np-desc">
            Get notified for match results, score changes, and leaderboard shifts —
            even when you're not on the site.
          </p>
          <button class="np-action np-sub" id="np-sub">Enable notifications</button>
        `}
      </div>
    `;

    document.getElementById('np-close')?.addEventListener('click', () => {
      panel.classList.remove('is-open');
      document.getElementById('notif-bell')?.setAttribute('aria-expanded', 'false');
    });

    document.getElementById('np-sub')?.addEventListener('click', async () => {
      await NotificationEngine._subscribe();
      NotificationEngine._renderPanel();
    });

    document.getElementById('np-unsub')?.addEventListener('click', async () => {
      await NotificationEngine._unsubscribe();
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
    bell.setAttribute('aria-label', on ? 'Notification settings' : 'Enable push notifications');
    bell.title = on ? 'Notification settings' : 'Enable push notifications';
  }

  static _showOptInPrompt() {
    if (NotificationEngine._isSubscribed() || !_osReady) {
      NotificationEngine._markPrompted();
      return;
    }

    if (document.getElementById('notif-optin')) return;

    const el = document.createElement('div');
    el.id        = 'notif-optin';
    el.className = 'notif-optin';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Notification opt-in');
    el.innerHTML = `
      <span class="notif-optin-icon">🔔</span>
      <div class="notif-optin-text">
        <strong>Stay in the loop</strong>
        <span>Match results, score updates &amp; leaderboard changes — even when you're away.</span>
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

// ── Helpers ────────────────────────────────────────────────────────────────────

function _ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][(n % 10)] || 'th';
}
