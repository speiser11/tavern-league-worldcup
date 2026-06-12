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

const NE_DEFAULT_PREFS = {
  goals:              true,
  match_result:       true,
  leaderboard_change: true,
  match_starting:     true,
  elimination:        true,
};

const NE_TYPE_LABELS = {
  goals:              'Goals scored',
  match_result:       'Match results',
  leaderboard_change: 'Standings changes',
  match_starting:     'Match starting soon',
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
          const tier    = scoringFor(teamName);
          const gkBonus = (!TIER_A.has(teamName) && TIER_A.has(opp)) ? (tier.giant_killer ?? 0) : 0;
          const pts     = m.round === 'group'
            ? tier.group_win + gkBonus
            : (tier[ROUND_SCORE_KEY[m.round]] ?? 0);
          const rank    = rankMap[owner];
          events.push({
            key,
            title: `${flag} ${teamName} win ${ts}–${os}`,
            body:  `${owner} +${pts} pts${rank ? ` · now ${rank}${_ordinal(rank)}` : ''}${gkBonus ? ' 🔪 Giant Killer!' : ''}`,
          });
        } else if (ts === os) {
          const tier = scoringFor(teamName);
          events.push({
            key,
            title: `${flag} ${teamName} draw ${ts}–${os}`,
            body:  `${owner} +${tier.group_draw} pts vs ${opp}`,
          });
        } else {
          events.push({
            key,
            title: `${flag} ${teamName} lose ${ts}–${os}`,
            body:  `${owner} earns 0 pts vs ${opp}`,
          });
        }
      }
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
      if (old > newRank) movers.push({ name, newRank, delta: old - newRank });
    }
    if (!movers.length) return [];

    movers.sort((a, b) => b.delta - a.delta);
    const top = movers[0];
    const key = `lb_${top.name}_to_${top.newRank}_${newState.scoreHash}`;
    if (sent.has(key)) return [];

    const icon  = top.newRank === 1 ? '🥇' : top.newRank === 2 ? '🥈' : '📊';
    const extra = movers.length > 1 ? ` (${movers.length - 1} others moved)` : '';
    return [{
      key,
      title: `${icon} ${top.name} moves to ${top.newRank}${_ordinal(top.newRank)}`,
      body:  `Standings update${extra}`,
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
    NotificationEngine._updateBellState();
    return perm === 'granted';
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
      for (const [teamName, isHome] of [[m.homeTeam, true], [m.awayTeam, false]]) {
        if (!TEAM_OWNER[teamName]) continue;
        const ts = isHome ? m.homeScore : m.awayScore;
        const os = isHome ? m.awayScore : m.homeScore;
        if (ts < os) sent.add(`elim_ko_${m.matchId}_${teamName}`);
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
      if (open) NotificationEngine._renderPanel();
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
    document.getElementById('np-unsub')?.addEventListener('click', () => {
      // Can't programmatically revoke — direct to browser settings
      alert('To turn off notifications, use your browser or OS notification settings.');
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
