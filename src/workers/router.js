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
import { blockBadBots } from './bot-guard.js';

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
    const botBlock = blockBadBots(request);
    if (botBlock) return botBlock;

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
    if (url.pathname === '/admin' || url.pathname === '/admin/') return adminPage(env);

    if (url.pathname.startsWith('/api/')) {
      const resp = await handleAPI(request, env, ctx, registry, url);
      const headers = new Headers(resp.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
      return new Response(resp.body, { status: resp.status, headers });
    }

    // ── Static assets ───────────────────────────────────────
    if (env.ASSETS) {
      const assetResp = await env.ASSETS.fetch(request);
      if (assetResp.status !== 404 || request.method !== 'GET') return assetResp;
      // SPA/page fallback: unknown human-facing paths should show the game shell,
      // not a raw Worker Not Found page. API and WS paths are handled above.
      const indexUrl = new URL('/index.html', url.origin);
      return env.ASSETS.fetch(new Request(indexUrl, request));
    }

    return new Response('Not Found', { status: 404 });
  },
};

function parseCustomConfig(params, modeId) {
  const owner = params.get('owner');
  const instance = params.get('instance');
  if (!owner && !instance && modeId !== 'training') return null;
  const maxDefault = modeId === 'training' ? 1 : 64;
  return {
    ownerName:  String(owner || 'Player').slice(0, 20),
    instanceId: instance || String(owner || 'custom').slice(0, 12),
    maxPlayers: clampInt(params.get('max'), 1, 100, maxDefault),
    ttlSec:     clampInt(params.get('ttl'), 300, 86400, modeId === 'training' ? 3600 : 7200),
  };
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
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


function adminPage(env) {
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voxel Admin</title><style>body{margin:0;background:#071019;color:#e8f1ff;font-family:system-ui;padding:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.card{background:#101b28;border:1px solid #29425c;border-radius:14px;padding:16px}input,button{padding:10px;border-radius:8px;border:1px solid #446;background:#0a1220;color:#fff}button{cursor:pointer;background:#c62828}</style><h1>VOXEL Admin</h1><p>서버 · 치팅 · 클랜 · 사용자 · 애드센스 · Cloudflare/GCP/KV 설정 · 이벤트 관리 콘솔</p><div class="grid"><div class="card"><h3>Server Overview</h3><button onclick="load()">새로고침</button><pre id="out"></pre></div><div class="card"><h3>Bot/Cheat Policy</h3><p>악성 자동화 UA 차단, 신뢰 검색 봇 허용, 서버 검증 탄도/데미지 적용.</p></div><div class="card"><h3>AdSense</h3><p>client=${env.ADSENSE_CLIENT_ID ? 'configured' : 'not configured'}</p></div></div><script>async function load(){const r=await fetch('/api/admin/overview');out.textContent=JSON.stringify(await r.json(),null,2)}</script></html>`, { headers:{ 'Content-Type':'text/html; charset=utf-8' } });
}
