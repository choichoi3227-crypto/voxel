// src/workers/router.js
// ─────────────────────────────────────────────────────────────
// VOXEL STRIKE — Per-server-instance Game Worker
// Routes: static assets / REST API / WebSocket upgrade
// No Durable Objects, no external services — rooms live in isolate
// memory, with best-effort KV sync for cross-isolate visibility.
//
// One deployment of this worker == one "server" in the server list.
// The control-plane worker (src/workers/control-plane.js) is the one
// that decides WHEN to deploy new copies of this script under new
// names/subdomains; this file itself has no idea how many siblings
// exist.
// ─────────────────────────────────────────────────────────────
import { handleWebSocket } from './ws-handler.js';
import { handleAPI }       from './api.js';
import { RoomRegistry }    from './room-registry.js';
import { GAME_MODE_IDS }   from './constants.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age':       '86400',
};

// ── Lazy singleton ──────────────────────────────────────────────
// NEVER instantiate RoomRegistry at module scope. It is created on the
// first request this isolate handles, inside the fetch handler below.
// RoomRegistry's constructor has zero side effects (no timers, no I/O),
// so even this lazy creation is safe regardless of when it happens.
let _registry = null;
function getRegistry() {
  if (!_registry) _registry = new RoomRegistry();
  return _registry;
}

/** Build the in-memory room key for a (serverId, modeId, instanceId) tuple. */
function roomKeyFor(serverId, modeId, instanceId) {
  return `${serverId}:${modeId}:${instanceId || 'main'}`;
}

export default {
  async fetch(request, env, ctx) {
    const registry = getRegistry();
    const url = new URL(request.url);
    const now = Date.now();

    // Opportunistic maintenance — cheap, throttled internally, runs inside
    // a real request so it never violates the global-scope rule.
    registry.maybeCleanup(now);
    if (registry.maybeSnapshotDue(now)) {
      ctx.waitUntil(snapshotToKV(env, registry));
    }

    // ── CORS preflight ──────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── WebSocket upgrade  /ws/:serverId/:modeId?/:instanceId? ──
    if (url.pathname.startsWith('/ws/')) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket required', { status: 426 });
      }
      const parts = url.pathname.slice(4).split('/').filter(Boolean);
      const serverId   = parts[0] || env.SERVER_ID || 'asia-1';
      let   modeId      = parts[1] || 'multiplayer';
      const instanceId = parts[2] || null;

      if (!GAME_MODE_IDS.includes(modeId)) modeId = 'multiplayer';

      // Custom room config can be passed via query string for user-created
      // (training) servers: ?owner=NAME&ttl=3600&max=1
      const customConfig = parseCustomConfig(url.searchParams, modeId);

      const roomKey = roomKeyFor(serverId, modeId, instanceId || (customConfig?.instanceId ?? null));
      return handleWebSocket(request, env, ctx, registry, roomKey, modeId, customConfig);
    }

    // ── REST API  /api/* ────────────────────────────────────
    if (url.pathname.startsWith('/api/')) {
      const resp = await handleAPI(request, env, ctx, registry, url);
      const headers = new Headers(resp.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
      return new Response(resp.body, { status: resp.status, headers });
    }

    // ── Static assets ───────────────────────────────────────
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};

function parseCustomConfig(params, modeId) {
  if (modeId !== 'training') return null;
  const owner = params.get('owner');
  if (!owner) return null;
  return {
    ownerName:  String(owner).slice(0, 20),
    instanceId: params.get('instance') || owner.slice(0, 12),
    maxPlayers: 1,
    ttlSec:     3600,
  };
}

async function snapshotToKV(env, registry) {
  try {
    if (!env.ROOMS) return;
    const meta = registry.snapshotMeta();
    await env.ROOMS.put(
      `isolate:rooms:${env.SERVER_ID || 'unknown'}`,
      JSON.stringify({ ts: Date.now(), rooms: meta, totalPlayers: registry.totalPlayers() }),
      { expirationTtl: 120 },
    );
  } catch (_) {}
}
