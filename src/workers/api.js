// src/workers/api.js
// ─────────────────────────────────────────────────────────────
// REST API endpoints (per-game-server worker)
//   GET  /api/servers                     → own/KV server list for quick play
//   POST /api/matchmake                   → lowest-load placement
//   GET  /api/admin/overview              → admin summary
//   GET  /api/health                      → liveness + load (for control-plane polling)
//   GET  /api/rooms                       → live rooms held in THIS isolate
//   GET  /api/room/:serverId/:mode/:inst  → single room status
//   GET  /api/leaderboard                 → top 100 by kills (KV)
//   POST /api/leaderboard                 → submit score (lightweight signed token)
//   POST /api/training/create             → spin up a personal training room on THIS worker
//
// NOTE: The full multi-server list (/api/servers from the client's point
// of view) is served by the control-plane worker, not here — this worker
// only knows about itself. See src/workers/control-plane.js.
// ─────────────────────────────────────────────────────────────

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handleAPI(request, env, ctx, registry, url) {
  const path   = url.pathname.replace('/api', '');
  const method = request.method;


  // GET /api/servers — local fallback/control-plane-compatible list.
  if (path === '/servers' && method === 'GET') {
    const rooms = registry.list();
    const totalPlayers = registry.totalPlayers();
    return json([{ id: env.SERVER_ID || 'asia-1', name: env.SERVER_NAME || env.SERVER_ID || 'Asia #1', region: env.SERVER_REGION || 'Seoul', flag: env.SERVER_FLAG || '🇰🇷', kind: env.SERVER_KIND || 'region', status: 'active', players: totalPlayers, maxPlayers: Math.max(parseInt(env.MAX_PLAYERS_PER_ROOM || '20', 10), rooms.reduce((n, r) => Math.max(n, r.maxPlayers || 20), 20)), endpoint: null }]);
  }

  // POST /api/matchmake — auto load-balancing endpoint for the "Play now" button.
  if (path === '/matchmake' && method === 'POST') {
    const rooms = registry.list();
    const server = { id: env.SERVER_ID || 'asia-1', name: env.SERVER_NAME || env.SERVER_ID || 'Asia #1', region: env.SERVER_REGION || 'Seoul', flag: env.SERVER_FLAG || '🇰🇷', players: registry.totalPlayers(), maxPlayers: parseInt(env.MAX_PLAYERS_PER_ROOM || '20', 10), status: 'active' };
    return json({ ok: true, server, wsPath: `/ws/${server.id}/battle_royale`, rooms });
  }

  // GET /api/admin/overview — single-worker admin readout.
  if (path === '/admin/overview' && method === 'GET') {
    return json({ serverId: env.SERVER_ID || 'unknown', region: env.SERVER_REGION || '', rooms: registry.list(), load: registry.totalPlayers(), adsenseConfigured: !!env.ADSENSE_CLIENT_ID, durableObjects: false });
  }

  // GET /api/health — liveness + current load, polled by the control-plane
  if (path === '/health' && method === 'GET') {
    const totalPlayers = registry.totalPlayers();
    const rooms = registry.list();
    const maxCapacity = rooms.reduce((sum, r) => sum + (r.maxPlayers || 20), 0) || 20;
    return json({
      status:      'ok',
      version:     env.GAME_VERSION || '1.0.0',
      serverId:    env.SERVER_ID || 'unknown',
      region:      env.SERVER_REGION || '',
      ts:          Date.now(),
      totalPlayers,
      roomCount:   rooms.length,
      fillRatio:   rooms.length ? Math.min(1, totalPlayers / Math.max(1, maxCapacity)) : 0,
    });
  }

  // GET /api/rooms — every room this isolate currently holds in memory
  if (path === '/rooms' && method === 'GET') {
    return json(registry.list());
  }

  // GET /api/room/:serverId/:modeId/:instanceId
  const roomMatch = path.match(/^\/room\/([a-z0-9-]+)\/([a-z_]+)\/?([a-z0-9_-]*)$/i);
  if (roomMatch && method === 'GET') {
    const [, serverId, modeId, instanceId] = roomMatch;
    const roomKey = `${serverId}:${modeId}:${instanceId || 'main'}`;
    const room = registry.get(roomKey);
    if (!room) {
      const count = await kvGet(env.ROOMS, `room:${roomKey}:count`);
      return json({ id: roomKey, players: parseInt(count || '0', 10), score: null, exists: false });
    }
    return json({ ...room.summary(), exists: true });
  }


  // POST /api/users/register — D1 is used only for user membership/profile rows.
  if (path === '/users/register' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const username = String(body.username || body.name || 'Player').replace(/[<>&"']/g, '').slice(0, 32);
    const emailHash = String(body.emailHash || '').replace(/[^a-f0-9]/gi, '').slice(0, 128);
    const userId = `u_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    await ensureUsersTable(env);
    if (env.USERS_DB) {
      await env.USERS_DB.prepare('INSERT INTO users (id, username, email_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').bind(userId, username, emailHash, Date.now(), Date.now()).run();
    }
    return json({ ok: true, userId, username });
  }

  // GET /api/leaderboard?limit=50
  if (path === '/leaderboard' && method === 'GET') {
    const limit  = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10));
    const entries = await fetchLeaderboard(env, limit);
    return json(entries);
  }

  // POST /api/leaderboard  { name, kills, deaths, playtime_sec, token }
  if (path === '/leaderboard' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

    if (!validateLeaderboardToken(body)) {
      return json({ error: 'Invalid token' }, 403);
    }

    const entry = {
      name:        String(body.name || 'Unknown').replace(/[<>]/g, '').slice(0, 20),
      kills:       Math.min(9999, Math.max(0, parseInt(body.kills, 10) || 0)),
      deaths:      Math.min(9999, Math.max(0, parseInt(body.deaths, 10) || 0)),
      playtime:    Math.min(86400, Math.max(0, parseInt(body.playtime_sec, 10) || 0)),
      kd:          body.deaths > 0 ? (body.kills / body.deaths).toFixed(2) : Number(body.kills || 0).toFixed(2),
      ts:          Date.now(),
    };

    ctx.waitUntil(upsertLeaderboard(env, entry));
    return json({ ok: true });
  }

  // POST /api/training/create  { ownerName }
  // Registers a personal training room on THIS worker and returns the
  // connect info. The room itself is created lazily on first WS connect;
  // this just reserves the slot in the cross-isolate KV registry so the
  // control-plane (and other isolates checking capacity) can see it.
  if (path === '/training/create' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const ownerName = String(body.ownerName || 'Player').replace(/[<>&"']/g, '').slice(0, 20);
    const instanceId = `${ownerName.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;
    const ttlSec = 3600;

    ctx.waitUntil(registerTrainingRoom(env, instanceId, ownerName, ttlSec));

    return json({
      ok: true,
      serverId:   env.SERVER_ID || 'unknown',
      modeId:     'training',
      instanceId,
      ttlSec,
      wsPath:     `/ws/${env.SERVER_ID || 'unknown'}/training/${instanceId}?owner=${encodeURIComponent(ownerName)}&instance=${instanceId}`,
    });
  }

  return json({ error: 'Not found' }, 404);
}

// ── KV helpers ─────────────────────────────────────────────────

async function kvGet(kv, key) {
  if (!kv) return null;
  try { return await kv.get(key); } catch { return null; }
}

async function fetchLeaderboard(env, limit) {
  if (!env.LEADERBOARD) return [];
  try {
    const raw = await env.LEADERBOARD.get('global:top', { type: 'json' });
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, limit);
  } catch { return []; }
}

async function upsertLeaderboard(env, entry) {
  if (!env.LEADERBOARD) return;
  try {
    const existing = (await env.LEADERBOARD.get('global:top', { type: 'json' })) || [];
    const map = new Map(existing.map(e => [e.name, e]));
    const prev = map.get(entry.name);
    if (!prev || entry.kills > prev.kills) map.set(entry.name, entry);
    const sorted = [...map.values()].sort((a, b) => b.kills - a.kills).slice(0, 100);
    await env.LEADERBOARD.put('global:top', JSON.stringify(sorted), { expirationTtl: 604800 });
  } catch (_) {}
}

async function registerTrainingRoom(env, instanceId, ownerName, ttlSec) {
  if (!env.ROOMS) return;
  try {
    await env.ROOMS.put(
      `training:${env.SERVER_ID || 'unknown'}:${instanceId}`,
      JSON.stringify({ ownerName, createdAt: Date.now(), serverId: env.SERVER_ID }),
      { expirationTtl: ttlSec + 60 },
    );
  } catch (_) {}
}

/** Simple game-side token: base64(name+kills+salt) — not crypto-secure, just spam prevention */
function validateLeaderboardToken(body) {
  if (!body || !body.token) return false;
  try {
    const decoded = atob(body.token);
    return decoded.startsWith(`${body.name}:${body.kills}:`);
  } catch { return false; }
}


async function ensureUsersTable(env) {
  if (!env.USERS_DB) return;
  try {
    await env.USERS_DB.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, email_hash TEXT, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)').run();
  } catch (_) {}
}
