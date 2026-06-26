// src/workers/api.js
// ─────────────────────────────────────────────────────────────
// REST API endpoints
//   GET  /api/servers            → list all servers + live counts
//   GET  /api/room/:id           → single room status
//   GET  /api/leaderboard        → top 50 by kills (KV)
//   POST /api/leaderboard        → submit score (JWT-lite, game-signed)
//   GET  /api/health             → liveness
// ─────────────────────────────────────────────────────────────

const SERVER_META = [
  { id: 'asia-1',  name: 'Asia #1',   region: 'Seoul',      flag: '🇰🇷', workerUrl: 'https://voxel-strike-asia-1.YOUR_ACCOUNT.workers.dev'  },
  { id: 'asia-2',  name: 'Asia #2',   region: 'Tokyo',      flag: '🇯🇵', workerUrl: 'https://voxel-strike-asia-2.YOUR_ACCOUNT.workers.dev'  },
  { id: 'asia-3',  name: 'Asia #3',   region: 'Singapore',  flag: '🇸🇬', workerUrl: 'https://voxel-strike-asia-3.YOUR_ACCOUNT.workers.dev'  },
  { id: 'eu-1',    name: 'EU #1',     region: 'Frankfurt',  flag: '🇩🇪', workerUrl: 'https://voxel-strike-eu-1.YOUR_ACCOUNT.workers.dev'    },
  { id: 'us-west', name: 'US West',   region: 'Los Angeles',flag: '🇺🇸', workerUrl: 'https://voxel-strike-us-west.YOUR_ACCOUNT.workers.dev' },
  { id: 'us-east', name: 'US East',   region: 'New York',   flag: '🇺🇸', workerUrl: 'https://voxel-strike-us-east.YOUR_ACCOUNT.workers.dev' },
];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handleAPI(request, env, ctx, registry, url) {
  const path   = url.pathname.replace('/api', '');
  const method = request.method;

  // GET /api/health
  if (path === '/health') {
    return json({ status: 'ok', version: env.GAME_VERSION || '1.0.0', ts: Date.now() });
  }

  // GET /api/servers — merge static meta with live KV counts
  if (path === '/servers' && method === 'GET') {
    const counts = await fetchRoomCounts(env, SERVER_META.map(s => s.id));
    const list = SERVER_META.map(s => ({
      id:         s.id,
      name:       s.name,
      region:     s.region,
      flag:       s.flag,
      players:    counts[s.id] ?? 0,
      maxPlayers: 20,
    }));
    return json(list);
  }

  // GET /api/room/:id
  const roomMatch = path.match(/^\/room\/([a-z0-9-]+)$/);
  if (roomMatch && method === 'GET') {
    const id   = roomMatch[1];
    const room = registry.get(id);
    if (!room) {
      // Also try KV
      const count = await kvGet(env.KV_ROOMS, `room:${id}:count`);
      return json({ id, players: parseInt(count || '0', 10), score: { red: 0, blue: 0 } });
    }
    return json(room.summary());
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
      kd:          body.deaths > 0 ? (body.kills / body.deaths).toFixed(2) : body.kills.toFixed(2),
      ts:          Date.now(),
    };

    ctx.waitUntil(upsertLeaderboard(env, entry));
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

// ── KV helpers ─────────────────────────────────────────────────

async function kvGet(kv, key) {
  if (!kv) return null;
  try { return await kv.get(key); } catch { return null; }
}

async function fetchRoomCounts(env, ids) {
  const counts = {};
  if (!env.KV_ROOMS) return counts;
  await Promise.all(ids.map(async id => {
    try {
      const v = await env.KV_ROOMS.get(`room:${id}:count`);
      counts[id] = parseInt(v || '0', 10);
    } catch { counts[id] = 0; }
  }));
  return counts;
}

async function fetchLeaderboard(env, limit) {
  if (!env.KV_LEADERBOARD) return [];
  try {
    const raw = await env.KV_LEADERBOARD.get('global:top', { type: 'json' });
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, limit);
  } catch { return []; }
}

async function upsertLeaderboard(env, entry) {
  if (!env.KV_LEADERBOARD) return;
  try {
    const existing = (await env.KV_LEADERBOARD.get('global:top', { type: 'json' })) || [];
    // Merge — keep best kills per name
    const map = new Map(existing.map(e => [e.name, e]));
    const prev = map.get(entry.name);
    if (!prev || entry.kills > prev.kills) map.set(entry.name, entry);
    const sorted = [...map.values()].sort((a, b) => b.kills - a.kills).slice(0, 100);
    await env.KV_LEADERBOARD.put('global:top', JSON.stringify(sorted), { expirationTtl: 604800 });
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
