import webpush from 'web-push';

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Tier A teams (for giant killer detection)
const TIER_A = new Set(['Germany','Ecuador','Ivory Coast','Curacao','USA','Panama','Canada',
  'Uruguay','Brazil','Serbia','Australia','Mexico','Spain','Croatia','Morocco','Japan',
  'France','Poland','Belgium','Senegal','Argentina','Chile','Peru','Bolivia',
  'England','Slovakia','Tunisia','Kazakhstan','Portugal','Switzerland','Ghana','Turkey',
  'Netherlands','Colombia','Ecuador','Qatar']);

// Draft pick order matches PARTICIPANTS in app.js
const DRAFT_ROUNDS = {
  1: ['Scott','Kade','Cody (Left)','Brandon','Zach','Konrad','Allan','Cody (Right)'],
  2: ['Cody (Right)','Allan','Konrad','Zach','Brandon','Cody (Left)','Kade','Scott'],
};

const NAME_MAP = {
  'Côte d\'Ivoire': 'Ivory Coast',
  'Cote d\'Ivoire': 'Ivory Coast',
  'IR Iran': 'Iran',
  'Korea Republic': 'South Korea',
  'Curaçao': 'Curacao',
  'Cape Verde Islands': 'Cape Verde',
  'United States': 'USA',
};

function canonicalize(name) {
  return NAME_MAP[name] ?? name;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/subscribe') {
      try {
        const sub = await request.json();
        const raw = await env.TLWC_STORE.get('subscribers');
        const subs = raw ? JSON.parse(raw) : [];
        if (!subs.find(s => s.endpoint === sub.endpoint)) {
          subs.push(sub);
          await env.TLWC_STORE.put('subscribers', JSON.stringify(subs));
        }
        return new Response('OK', { headers: CORS });
      } catch {
        return new Response('Error', { status: 500, headers: CORS });
      }
    }

    if (request.method === 'DELETE' && url.pathname === '/subscribe') {
      try {
        const { endpoint } = await request.json();
        const raw = await env.TLWC_STORE.get('subscribers');
        let subs = raw ? JSON.parse(raw) : [];
        subs = subs.filter(s => s.endpoint !== endpoint);
        await env.TLWC_STORE.put('subscribers', JSON.stringify(subs));
        return new Response('OK', { headers: CORS });
      } catch {
        return new Response('Error', { status: 500, headers: CORS });
      }
    }

    // Debug endpoint — returns subscriber count and last state summary
    if (request.method === 'GET' && url.pathname === '/status') {
      const [subsRaw, stateRaw] = await Promise.all([
        env.TLWC_STORE.get('subscribers'),
        env.TLWC_STORE.get('state'),
      ]);
      const subs = subsRaw ? JSON.parse(subsRaw) : [];
      const state = stateRaw ? JSON.parse(stateRaw) : {};
      return new Response(JSON.stringify({ subscribers: subs.length, matches: Object.keys(state).length }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndNotify(env));
  },
};

async function buildOwnerMap(env) {
  try {
    const url = `${env.FIREBASE_URL}/worldcup2026/draft.json`;
    const resp = await fetch(url);
    const data = await resp.json();
    // Firebase returns { picks: [...], draftOrder: [...], ... }
    const picks = Array.isArray(data) ? data : (data?.picks ?? []);
    const map = {};
    for (const pick of picks) {
      if (pick?.team && pick?.player) map[pick.team] = pick.player;
    }
    return map;
  } catch {
    return {};
  }
}

async function checkAndNotify(env) {
  webpush.setVapidDetails(
    'mailto:scottpeiser@gmail.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );

  const [stateRaw, subsRaw] = await Promise.all([
    env.TLWC_STORE.get('state'),
    env.TLWC_STORE.get('subscribers'),
  ]);

  const prevState = stateRaw ? JSON.parse(stateRaw) : {};
  const subs = subsRaw ? JSON.parse(subsRaw) : [];

  if (!subs.length) return;

  const [espnResp, owners] = await Promise.all([
    fetch(ESPN_URL),
    buildOwnerMap(env),
  ]);

  const data = await espnResp.json();
  const events = data.events || [];

  const nextState = { ...prevState };
  const notifications = [];

  for (const e of events) {
    const comp = e.competitions?.[0];
    if (!comp) continue;

    const home = comp.competitors.find(c => c.homeAway === 'home');
    const away = comp.competitors.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const id = e.id;
    const st = comp.status.type;
    const status = st.name;
    const homeScore = parseInt(home.score) || 0;
    const awayScore = parseInt(away.score) || 0;
    const homeName = canonicalize(home.team.displayName);
    const awayName = canonicalize(away.team.displayName);

    const prev = prevState[id] || {};
    const notified = { ...(prev.notified || {}) };

    const homeOwner = owners[homeName];
    const awayOwner = owners[awayName];

    const ownerLine = [
      homeOwner && `${homeOwner} (${homeName})`,
      awayOwner && `${awayOwner} (${awayName})`,
    ].filter(Boolean).join(' vs ');

    // Match starting
    if (status === 'STATUS_IN_PROGRESS' && prev.status !== 'STATUS_IN_PROGRESS' && !notified.start) {
      notified.start = true;
      notifications.push({
        title: '⚽ Kickoff',
        body: ownerLine
          ? `${homeName} vs ${awayName} · ${ownerLine}`
          : `${homeName} vs ${awayName} has kicked off`,
      });
    }

    // Goals — only fire for matches with an owned team
    if (homeOwner || awayOwner) {
      if (['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_FINAL'].includes(status)) {
        const prevHome = prev.homeScore ?? 0;
        const prevAway = prev.awayScore ?? 0;

        for (let i = prevHome + 1; i <= homeScore; i++) {
          const key = `goal_home_${i}`;
          if (!notified[key]) {
            notified[key] = true;
            notifications.push({
              title: `⚽ GOAL — ${homeName}${homeOwner ? ` (${homeOwner})` : ''}`,
              body: `${homeName} ${homeScore}–${awayScore} ${awayName}`,
            });
          }
        }
        for (let i = prevAway + 1; i <= awayScore; i++) {
          const key = `goal_away_${i}`;
          if (!notified[key]) {
            notified[key] = true;
            notifications.push({
              title: `⚽ GOAL — ${awayName}${awayOwner ? ` (${awayOwner})` : ''}`,
              body: `${homeName} ${homeScore}–${awayScore} ${awayName}`,
            });
          }
        }
      }
    }

    // Halftime — only for owned matches
    if (status === 'STATUS_HALFTIME' && !notified.halftime && (homeOwner || awayOwner)) {
      notified.halftime = true;
      notifications.push({
        title: `⏸ Halftime — ${homeName} ${homeScore}–${awayScore} ${awayName}`,
        body: ownerLine,
      });
    }

    // Final — only for owned matches
    if (status === 'STATUS_FINAL' && !notified.final && (homeOwner || awayOwner)) {
      notified.final = true;
      const result = homeScore > awayScore
        ? `${homeName} wins`
        : awayScore > homeScore
          ? `${awayName} wins`
          : 'Draw';
      notifications.push({
        title: `🏁 Final — ${homeName} ${homeScore}–${awayScore} ${awayName}`,
        body: `${result} · ${ownerLine}`,
      });
    }

    nextState[id] = { status, homeScore, awayScore, notified };
  }

  await env.TLWC_STORE.put('state', JSON.stringify(nextState));

  if (!notifications.length) return;

  const deadSubs = new Set();
  await Promise.all(subs.map(async sub => {
    for (const notif of notifications) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(notif));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          deadSubs.add(sub.endpoint);
        }
      }
    }
  }));

  if (deadSubs.size) {
    const cleaned = subs.filter(s => !deadSubs.has(s.endpoint));
    await env.TLWC_STORE.put('subscribers', JSON.stringify(cleaned));
  }
}
