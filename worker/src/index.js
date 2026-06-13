const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260719&limit=200';

// ESPN status name sets — ESPN uses STATUS_FIRST_HALF / STATUS_SECOND_HALF during
// normal play, NOT STATUS_IN_PROGRESS. All must be covered for goal/kickoff detection.
const LIVE_STATUS_NAMES = new Set([
  'STATUS_IN_PROGRESS', 'STATUS_FIRST_HALF', 'STATUS_SECOND_HALF',
  'STATUS_HALFTIME', 'STATUS_OVERTIME', 'STATUS_SHOOTOUT',
]);
const FINAL_STATUS_NAMES = new Set([
  'STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_FINAL_AET', 'STATUS_FINAL_PEN',
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const NAME_MAP = {
  'Côte d\'Ivoire': 'Ivory Coast',
  'Cote d\'Ivoire': 'Ivory Coast',
  'IR Iran': 'Iran',
  'Korea Republic': 'South Korea',
  'Curaçao': 'Curacao',
  'Cape Verde Islands': 'Cape Verde',
  'United States': 'USA',
  'Bosnia-Herzegovina': 'Bosnia',
  'Bosnia And Herzegovina': 'Bosnia',
};

function canonicalize(name) {
  return NAME_MAP[name] ?? name;
}

// ── Web Push via native fetch + WebCrypto ────────────────────────────────────

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlDecode(str) {
  const pad = '='.repeat((4 - str.length % 4) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function buildVapidJWT(audience, subject, privateKeyB64, publicKeyB64) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    aud: audience, exp: now + 43200, sub: subject,
  })));
  const sigInput = `${header}.${payload}`;

  // Import private key (raw EC scalar, 32 bytes)
  const rawPriv = b64urlDecode(privateKeyB64);
  const rawPub  = b64urlDecode(publicKeyB64);

  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256', key_ops: ['sign'],
      d: b64url(rawPriv),
      x: b64url(rawPub.slice(1, 33)),
      y: b64url(rawPub.slice(33, 65)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(sigInput),
  );

  return `${sigInput}.${b64url(sig)}`;
}

async function sendPush(sub, payload, vapidPublic, vapidPrivate, subject) {
  const endpoint = sub.endpoint;
  const audience = new URL(endpoint).origin;

  const jwt = await buildVapidJWT(audience, subject, vapidPrivate, vapidPublic);
  const authHeader = `vapid t=${jwt},k=${vapidPublic}`;

  // Encrypt the payload using the subscription's keys
  const encrypted = await encryptPayload(sub, payload);

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Content-Length': String(encrypted.byteLength),
    },
    body: encrypted,
  });

  if (!resp.ok && resp.status !== 201) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`Push failed: ${resp.status} ${text}`);
    err.statusCode = resp.status;
    throw err;
  }
}

async function encryptPayload(sub, payloadStr) {
  // RFC 8291 aes128gcm content encryption
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(payloadStr);

  // Generate salt and local ECDH key pair
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const localKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
  const localPubRaw = await crypto.subtle.exportKey('raw', localKeys.publicKey);

  // Import receiver's public key
  const receiverPub = await crypto.subtle.importKey(
    'raw', b64urlDecode(sub.keys.p256dh),
    { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );

  // ECDH shared secret
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: receiverPub }, localKeys.privateKey, 256,
  );

  // Auth secret
  const authSecret = b64urlDecode(sub.keys.auth);

  // HKDF to derive PRK and then IKM
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits']);

  // PRK from auth secret
  const prkInfo = concat(
    encoder.encode('WebPush: info\0'),
    b64urlDecode(sub.keys.p256dh),
    new Uint8Array(localPubRaw),
  );
  const prk = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: prkInfo }, hkdfKey, 256,
  );

  // Content encryption key + nonce
  const prkKey = await crypto.subtle.importKey('raw', prk, 'HKDF', false, ['deriveBits']);
  const cekInfo = encoder.encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = encoder.encode('Content-Encoding: nonce\0');

  const cek = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo }, prkKey, 128);
  const nonce = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, prkKey, 96);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);

  // Pad the plaintext (record size header + content + delimiter)
  const rs = 4096;
  const paddedLen = Math.min(plaintext.length + 1, rs - 18);
  const padded = new Uint8Array(paddedLen);
  padded.set(plaintext);
  padded[plaintext.length] = 2; // end-of-record delimiter

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, padded,
  );

  // aes128gcm record: salt (16) + record size (4) + key id len (1) + key id + ciphertext
  const header = new Uint8Array(21 + localPubRaw.byteLength);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = localPubRaw.byteLength;
  header.set(new Uint8Array(localPubRaw), 21);

  return concat(header, new Uint8Array(encrypted));
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.byteLength; }
  return out;
}

// ── Routing ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

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
      } catch { return new Response('Error', { status: 500, headers: CORS }); }
    }

    if (request.method === 'DELETE' && url.pathname === '/subscribe') {
      try {
        const { endpoint } = await request.json();
        const raw = await env.TLWC_STORE.get('subscribers');
        let subs = raw ? JSON.parse(raw) : [];
        subs = subs.filter(s => s.endpoint !== endpoint);
        await env.TLWC_STORE.put('subscribers', JSON.stringify(subs));
        return new Response('OK', { headers: CORS });
      } catch { return new Response('Error', { status: 500, headers: CORS }); }
    }

    if (request.method === 'POST' && url.pathname === '/test-push') {
      const subsRaw = await env.TLWC_STORE.get('subscribers');
      const subs = subsRaw ? JSON.parse(subsRaw) : [];
      const results = [];
      for (const sub of subs) {
        try {
          await sendPush(sub, JSON.stringify({ title: '🧪 Test notification', body: 'Worker push is working!' }),
            env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, 'mailto:scottpeiser@gmail.com');
          results.push({ endpoint: sub.endpoint.slice(-20), ok: true });
        } catch (err) {
          results.push({ endpoint: sub.endpoint.slice(-20), ok: false, error: err.message });
        }
      }
      return new Response(JSON.stringify({ sent: results }, null, 2), { headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    if (request.method === 'GET' && url.pathname === '/status') {
      const [subsRaw, stateRaw, lastLogRaw, lastErrRaw] = await Promise.all([
        env.TLWC_STORE.get('subscribers'), env.TLWC_STORE.get('state'),
        env.TLWC_STORE.get('lastLog'), env.TLWC_STORE.get('lastError'),
      ]);
      const subs  = subsRaw  ? JSON.parse(subsRaw)  : [];
      const state = stateRaw ? JSON.parse(stateRaw) : {};
      return new Response(JSON.stringify({
        subscribers: subs.length,
        matches: Object.keys(state).length,
        lastLog:   lastLogRaw  ? JSON.parse(lastLogRaw)  : null,
        lastError: lastErrRaw  ? JSON.parse(lastErrRaw)  : null,
      }, null, 2), { headers: { 'Content-Type': 'application/json', ...CORS } });
    }

    if (request.method === 'GET' && url.pathname === '/debug') {
      try {
        const owners = await buildOwnerMap(env);
        const data   = await (await fetch(ESPN_URL)).json();
        const events = (data.events || []).map(e => {
          const comp = e.competitions?.[0];
          const home = comp?.competitors?.find(c => c.homeAway === 'home');
          const away = comp?.competitors?.find(c => c.homeAway === 'away');
          const hn = canonicalize(home?.team?.displayName);
          const an = canonicalize(away?.team?.displayName);
          return { id: e.id, home: hn, away: an, status: comp?.status?.type?.name,
            homeScore: home?.score, awayScore: away?.score,
            homeOwner: owners[hn] || null, awayOwner: owners[an] || null };
        });
        const state = JSON.parse(await env.TLWC_STORE.get('state') || '{}');
        return new Response(JSON.stringify({ ownerCount: Object.keys(owners).length, events, stateKeys: Object.keys(state) }, null, 2),
          { headers: { 'Content-Type': 'application/json', ...CORS } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
      }
    }

    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAndNotify(env));
  },
};

// ── Owner map ─────────────────────────────────────────────────────────────────

async function buildOwnerMap(env) {
  try {
    const data = await (await fetch(`${env.FIREBASE_URL}/worldcup2026/draft.json`)).json();
    const picks = Array.isArray(data) ? data : (data?.picks ?? []);
    const map = {};
    for (const pick of picks) {
      if (pick?.team && pick?.player) map[pick.team] = pick.player;
    }
    return map;
  } catch { return {}; }
}

// ── Cron: check ESPN and push notifications ───────────────────────────────────

async function checkAndNotify(env) {
  try {
    await _checkAndNotify(env);
  } catch (err) {
    await env.TLWC_STORE.put('lastError', JSON.stringify({
      ts: new Date().toISOString(), error: err.message, stack: err.stack?.slice(0, 500),
    }));
  }
}

async function _checkAndNotify(env) {
  const [stateRaw, subsRaw] = await Promise.all([
    env.TLWC_STORE.get('state'),
    env.TLWC_STORE.get('subscribers'),
  ]);

  const prevState = stateRaw ? JSON.parse(stateRaw) : {};
  const subs      = subsRaw  ? JSON.parse(subsRaw)  : [];
  if (!subs.length) return;

  const [espnResp, owners] = await Promise.all([fetch(ESPN_URL), buildOwnerMap(env)]);
  const events = (await espnResp.json()).events || [];

  const nextState     = { ...prevState };
  const notifications = [];

  for (const e of events) {
    const comp = e.competitions?.[0];
    if (!comp) continue;
    const home = comp.competitors.find(c => c.homeAway === 'home');
    const away = comp.competitors.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const id        = e.id;
    const status    = comp.status.type.name;
    const homeScore = parseInt(home.score) || 0;
    const awayScore = parseInt(away.score) || 0;
    const homeName  = canonicalize(home.team.displayName);
    const awayName  = canonicalize(away.team.displayName);

    const prev     = prevState[id] || {};
    const notified = { ...(prev.notified || {}) };

    if (FINAL_STATUS_NAMES.has(prev.status)) { notified.final = true; notified.halftime = true; }

    const homeOwner = owners[homeName];
    const awayOwner = owners[awayName];
    const ownerLine = [homeOwner && `${homeOwner} (${homeName})`, awayOwner && `${awayOwner} (${awayName})`]
      .filter(Boolean).join(' vs ');

    // Kickoff: any live status when the previous state wasn't live or final
    if (LIVE_STATUS_NAMES.has(status) && !LIVE_STATUS_NAMES.has(prev.status) && !FINAL_STATUS_NAMES.has(prev.status) && !notified.start) {
      notified.start = true;
      notifications.push({ title: '⚽ Kickoff', body: ownerLine || `${homeName} vs ${awayName} has kicked off` });
    }

    // Goals: ESPN sends STATUS_FIRST_HALF / STATUS_SECOND_HALF during play, not STATUS_IN_PROGRESS
    if ((homeOwner || awayOwner) && (LIVE_STATUS_NAMES.has(status) || FINAL_STATUS_NAMES.has(status))) {
      for (let i = (prev.homeScore ?? 0) + 1; i <= homeScore; i++) {
        const key = `goal_home_${i}`;
        if (!notified[key]) { notified[key] = true; notifications.push({ title: `⚽ GOAL — ${homeName}${homeOwner ? ` (${homeOwner})` : ''}`, body: `${homeName} ${homeScore}–${awayScore} ${awayName}` }); }
      }
      for (let i = (prev.awayScore ?? 0) + 1; i <= awayScore; i++) {
        const key = `goal_away_${i}`;
        if (!notified[key]) { notified[key] = true; notifications.push({ title: `⚽ GOAL — ${awayName}${awayOwner ? ` (${awayOwner})` : ''}`, body: `${homeName} ${homeScore}–${awayScore} ${awayName}` }); }
      }
    }

    if (status === 'STATUS_HALFTIME' && !notified.halftime && (homeOwner || awayOwner)) {
      notified.halftime = true;
      notifications.push({ title: `⏸ Halftime — ${homeName} ${homeScore}–${awayScore} ${awayName}`, body: ownerLine });
    }

    // Final: ESPN uses STATUS_FULL_TIME (and AET/PEN variants), not just STATUS_FINAL
    if (FINAL_STATUS_NAMES.has(status) && !notified.final && (homeOwner || awayOwner)) {
      notified.final = true;
      const result = homeScore > awayScore ? `${homeName} wins` : awayScore > homeScore ? `${awayName} wins` : 'Draw';
      notifications.push({ title: `🏁 Final — ${homeName} ${homeScore}–${awayScore} ${awayName}`, body: `${result} · ${ownerLine}` });
    }

    nextState[id] = { status, homeScore, awayScore, notified };
  }

  // Only write state when something actually changed (saves KV writes)
  const nextStateStr = JSON.stringify(nextState);
  if (nextStateStr !== stateRaw) {
    await env.TLWC_STORE.put('state', nextStateStr);
  }

  if (!notifications.length) return;

  await env.TLWC_STORE.put('lastLog', JSON.stringify({ ts: new Date().toISOString(), matches: events.length, notifications }));

  const deadSubs = new Set();
  await Promise.all(subs.map(async sub => {
    for (const notif of notifications) {
      try {
        await sendPush(sub, JSON.stringify(notif), env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, 'mailto:scottpeiser@gmail.com');
      } catch (err) {
        await env.TLWC_STORE.put('lastError', JSON.stringify({ ts: new Date().toISOString(), error: err.message }));
        if (err.statusCode === 410 || err.statusCode === 404) deadSubs.add(sub.endpoint);
      }
    }
  }));

  if (deadSubs.size) {
    await env.TLWC_STORE.put('subscribers', JSON.stringify(subs.filter(s => !deadSubs.has(s.endpoint))));
  }
}
