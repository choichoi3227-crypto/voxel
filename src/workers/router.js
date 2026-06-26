// src/workers/router.js
// ─────────────────────────────────────────────────────────────
// VOXEL STRIKE — Master Router Worker
// Routes: static assets / REST API / WebSocket upgrade
// No Durable Objects — rooms live in isolate memory + KV sync
// ─────────────────────────────────────────────────────────────
import { handleWebSocket } from './ws-handler.js';
import { handleAPI }       from './api.js';
import { RoomRegistry }    from './room-registry.js';

// Module-level singleton registry (lives for the lifetime of this isolate)
export const registry = new RoomRegistry();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age':       '86400',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ── CORS preflight ──────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── WebSocket upgrade  /ws/:serverId ────────────────────
    if (url.pathname.startsWith('/ws/')) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket required', { status: 426 });
      }
      const serverId = url.pathname.slice(4).split('/')[0] || env.SERVER_ID || 'asia-1';
      return handleWebSocket(request, env, ctx, registry, serverId);
    }

    // ── REST API  /api/* ────────────────────────────────────
    if (url.pathname.startsWith('/api/')) {
      const resp = await handleAPI(request, env, ctx, registry, url);
      const headers = new Headers(resp.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
      return new Response(resp.body, { status: resp.status, headers });
    }

    // ── Static assets ───────────────────────────────────────
    // Cloudflare Workers Sites serves ./public via env.ASSETS
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  },
};
