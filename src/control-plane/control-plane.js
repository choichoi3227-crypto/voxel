// src/control-plane/control-plane.js
// Control plane for user-created servers, automatic placement, and admin APIs.
// Uses Cloudflare KV only; Durable Objects are intentionally not used.
import { REGIONS, SCALING, SERVER_KIND, SERVER_STATUS } from '../workers/constants.js';
import { pickBestServer, botVerdict } from '../workers/protocol.js';
import { deployWorkerScript, enableWorkersDevRoute, deleteWorkerScript, workerUrlFor } from './cf-api.js';
import { buildGameWorkerModules } from './bundle-game-worker.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json', ...cors() } });
const cors = () => ({ 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type,Authorization,X-Admin-Token' });

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    const verdict = botVerdict(request);
    if (!verdict.allow) return new Response('Forbidden', { status:403, headers:{ 'X-Bot-Guard': verdict.reason } });

    const url = new URL(request.url);
    if (url.pathname === '/api/servers') return json(await listServers(env));
    if (url.pathname === '/api/matchmake' && request.method === 'POST') return matchmake(request, env, ctx);
    if (url.pathname === '/api/servers/custom' && request.method === 'POST') return createCustomServer(request, env, ctx);
    if (url.pathname.startsWith('/api/servers/') && request.method === 'DELETE') return deleteServer(url.pathname.split('/').pop(), env, ctx);
    if (url.pathname.startsWith('/api/admin/')) return adminApi(request, env, ctx, url);
    if (url.pathname === '/admin' || url.pathname === '/admin/') return adminPage();
    return json({ error:'not_found' }, 404);
  },
};

async function listServers(env) {
  const seeded = REGIONS.map(r => ({ ...r, kind:SERVER_KIND.REGION, status:SERVER_STATUS.ACTIVE, players:0, maxPlayers:20, endpoint:null }));
  const kv = await listKV(env.SERVER_KV, 'server:');
  const byId = new Map(seeded.map(s => [s.id, s]));
  for (const s of kv) byId.set(s.id, { ...byId.get(s.id), ...s });
  return [...byId.values()].filter(s => s.status !== SERVER_STATUS.DEAD);
}

async function matchmake(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const servers = await listServers(env);
  const picked = pickBestServer(servers, { coloHint: request.cf?.colo, modeId: body.modeId });
  if (!picked) return json({ error:'no_capacity' }, 503);
  ctx.waitUntil(notePlacement(env, picked.id));
  return json({ ok:true, server:picked, wsPath:`/ws/${picked.id}/${body.modeId || 'battle_royale'}` });
}

async function createCustomServer(request, env, ctx) {
  const body = await request.json().catch(() => ({}));
  const ownerName = clean(body.ownerName || 'Player');
  const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const server = { id, name:`${ownerName} 서버`, region:'user-created', flag:'🎮', kind:SERVER_KIND.CUSTOM, status:SERVER_STATUS.PROVISIONING, players:0, maxPlayers:clampInt(body.maxPlayers, 2, 100, 64), ownerName, createdAt:Date.now(), ttlSec:clampInt(body.ttlSec, 900, 86400, 7200), endpoint:null };
  await putKV(env.SERVER_KV, `server:${id}`, server, server.ttlSec + 60);
  ctx.waitUntil(provisionServer(env, server));
  return json({ ok:true, server });
}

async function provisionServer(env, server) {
  if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID && env.CF_WORKERS_DEV_SUBDOMAIN) {
    const scriptName = `voxel-${server.id}`;
    await deployWorkerScript(env, { scriptName, moduleParts: buildGameWorkerModules(), mainModule:'router.js', kvBindings: bindings(env), vars:{ SERVER_ID:server.id, SERVER_REGION:server.region, SERVER_KIND:server.kind, GAME_VERSION:env.GAME_VERSION || '1.0.0' } });
    await enableWorkersDevRoute(env, scriptName);
    server.endpoint = workerUrlFor(env, scriptName);
  }
  server.status = SERVER_STATUS.ACTIVE;
  await putKV(env.SERVER_KV, `server:${server.id}`, server, server.ttlSec || 86400);
}

async function deleteServer(id, env, ctx) {
  const server = await getKV(env.SERVER_KV, `server:${id}`);
  if (!server) return json({ ok:true, deleted:false });
  await env.SERVER_KV?.delete(`server:${id}`);
  await env.SERVER_KV?.delete(`load:${id}`);
  if (server.kind === SERVER_KIND.CUSTOM) ctx.waitUntil(deleteWorkerScript(env, `voxel-${id}`).catch(() => {}));
  return json({ ok:true, deleted:true });
}

async function adminApi(request, env, ctx, url) {
  if (!authorized(request, env)) return json({ error:'unauthorized' }, 401);
  if (url.pathname === '/api/admin/overview') return json({ servers: await listServers(env), scaling: SCALING, adsenseConfigured: !!env.ADSENSE_CLIENT_ID });
  if (url.pathname === '/api/admin/settings' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    await putKV(env.SERVER_KV, 'settings:global', body, 0);
    return json({ ok:true });
  }
  return json({ error:'not_found' }, 404);
}

function adminPage() { return new Response(`<!doctype html><meta charset="utf-8"><title>Voxel Admin</title><style>body{font-family:system-ui;background:#081018;color:#eee;margin:24px}.card{border:1px solid #29445e;border-radius:12px;padding:16px;margin:12px 0;background:#101a24}button{padding:10px 14px}</style><h1>VOXEL Admin</h1><p>전체 서버 관리 · 치팅 관리 · 클랜 관리 · 사용자 관리 · 애드센스 · 설정 · 이벤트</p><div class="card"><button onclick="load()">Overview 불러오기</button><pre id="out"></pre></div><script>async function load(){const t=prompt('Admin token');const r=await fetch('/api/admin/overview',{headers:{'X-Admin-Token':t||''}});out.textContent=JSON.stringify(await r.json(),null,2)}</script>`, { headers:{ 'Content-Type':'text/html; charset=utf-8' } }); }

async function listKV(kv, prefix) { if (!kv) return []; const out=[]; const listed=await kv.list({ prefix }); for (const k of listed.keys) { const v=await getKV(kv,k.name); if (v) out.push(v); } return out; }
async function getKV(kv, key) { try { return await kv?.get(key, { type:'json' }); } catch { return null; } }
async function putKV(kv, key, val, ttl) { if (!kv) return; const opts = ttl ? { expirationTtl: ttl } : undefined; await kv.put(key, JSON.stringify(val), opts); }
async function notePlacement(env, id) { const key=`load:${id}`; const cur = await getKV(env.SERVER_KV, key) || { placements:0 }; cur.placements++; cur.ts=Date.now(); await putKV(env.SERVER_KV, key, cur, 300); }
function bindings(env) { return ['ROOMS','LEADERBOARD','SESSIONS','SERVER_KV','USERS'].map(binding => ({ binding, id: env[`${binding}_ID`] })).filter(b => b.id); }
function clean(s) { return String(s).replace(/[<>&"']/g, '').slice(0, 24); }
function clampInt(v, min, max, d) { const n=parseInt(v,10); return Math.max(min, Math.min(max, Number.isFinite(n) ? n : d)); }
function authorized(request, env) { const token = request.headers.get('X-Admin-Token') || request.headers.get('Authorization')?.replace(/^Bearer\s+/i, ''); return !!env.ADMIN_TOKEN && token === env.ADMIN_TOKEN; }
