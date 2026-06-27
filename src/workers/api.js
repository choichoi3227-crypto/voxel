// src/workers/api.js
// ─────────────────────────────────────────────────────────────
// REST API endpoints (per-game-server worker)
//   GET  /api/servers                     → own/KV server list for quick play
//   POST /api/matchmake                   → lowest-load placement
//   GET  /api/admin/overview              → admin summary
//   POST /api/servers/custom              → create user-owned KV server record
//   DELETE /api/servers/:id               → delete server record immediately
//   GET  /api/health                      → liveness + load (for control-plane polling)
//   GET  /api/rooms                       → live rooms held in THIS isolate
//   GET  /api/room/:serverId/:mode/:inst  → single room status
//   GET  /api/leaderboard                 → top 100 by kills (KV)
//   POST /api/leaderboard                 → submit score (lightweight signed token)
//   POST /api/training/create             → spin up a personal training room on THIS worker
//   GET  /api/shop/catalog                → skins/currency catalog
//   POST /api/rewards/grant               → grant tokens for kills/wins/play
//   POST /api/shop/purchase               → buy skins with earned tokens/gems
//   POST /api/payments/paypal/create      → create PayPal purchase intent placeholder
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

const SHOP_CATALOG = {
  currencies: [
    { id: 'tokens', label: '토큰', earnable: true, exchange: 'kills/wins/playtime' },
    { id: 'gems', label: '젬', earnable: false, provider: 'paypal' },
  ],
  paypalGemPacks: [
    { id: 'gems_100', gems: 100, priceUsd: 0.99 },
    { id: 'gems_550', gems: 550, priceUsd: 4.99 },
    { id: 'gems_1200', gems: 1200, priceUsd: 9.99 },
  ],
  items: [
    { id: 'skin_ak_redline', type: 'weapon_skin', weapon: 'ak47', name: 'AK Redline', price: { tokens: 900 } },
    { id: 'skin_m4_glacier', type: 'weapon_skin', weapon: 'm4a1', name: 'M4 Glacier', price: { tokens: 1200 } },
    { id: 'skin_kar_gold', type: 'weapon_skin', weapon: 'kar98', name: 'Kar98k Gold', price: { gems: 250 } },
    { id: 'profile_phoenix', type: 'profile_skin', name: 'Phoenix Profile', price: { tokens: 700 } },
    { id: 'profile_neon', type: 'profile_skin', name: 'Neon Profile', price: { gems: 180 } },
  ],
};

const GAME_MODES = [
  { id: 'battle_royale', name: 'Battle Royale', squadSize: 1, maxPlayers: 100, hasPlaneDrop: true, hasSafeZone: true },
  { id: 'solo', name: 'Solo Royale', squadSize: 1, maxPlayers: 100, hasPlaneDrop: true, hasSafeZone: true },
  { id: 'duo', name: 'Duo Royale', squadSize: 2, maxPlayers: 100, hasPlaneDrop: true, hasSafeZone: true },
  { id: 'squad', name: 'Squad Royale', squadSize: 4, maxPlayers: 100, hasPlaneDrop: true, hasSafeZone: true },
  { id: 'multiplayer', name: 'Team Deathmatch', squadSize: 5, maxPlayers: 20, hasPlaneDrop: false, hasSafeZone: false },
  { id: 'training', name: 'Training Island', squadSize: 1, maxPlayers: 1, hasPlaneDrop: false, hasSafeZone: false },
];

const MAP_CATALOG = [
  { id: 'voxel_royale_island', name: 'Voxel Royale Island', size: '192x192', terrain: 'mixed', lootTier: 'high', vehicles: ['buggy', 'jeep'] },
  { id: 'desert_strike', name: 'Desert Strike', size: '192x192', terrain: 'desert', lootTier: 'medium', vehicles: ['buggy', 'pickup'] },
  { id: 'jungle_rush', name: 'Jungle Rush', size: '128x128', terrain: 'jungle', lootTier: 'medium', vehicles: ['bike', 'buggy'] },
  { id: 'training_island', name: 'Training Island', size: '64x64', terrain: 'range', lootTier: 'sandbox', vehicles: ['buggy'] },
];

const DEFAULT_LOADOUTS = [
  { id: 'assault', name: 'Assault', primary: 'ak47', secondary: 'deagle', throwables: ['frag'], armor: 1 },
  { id: 'marksman', name: 'Marksman', primary: 'kar98', secondary: 'mp5', throwables: ['smoke'], armor: 1 },
  { id: 'support', name: 'Support', primary: 'm249', secondary: 'deagle', throwables: ['flash'], armor: 2 },
  { id: 'balanced', name: 'Balanced', primary: 'm4a1', secondary: 'ump45', throwables: ['frag', 'smoke'], armor: 1 },
];

const DEFAULT_MISSIONS = [
  { id: 'first_drop', title: '첫 강하', goal: '낙하산으로 1회 착지', reward: { tokens: 100 } },
  { id: 'top10', title: '상위 10위', goal: '배틀로얄 상위 10위 달성', reward: { tokens: 250 } },
  { id: 'vehicle_run', title: '로드 트립', goal: '차량으로 500m 이동', reward: { tokens: 150 } },
  { id: 'chicken', title: '치킨 디너', goal: '1회 승리', reward: { tokens: 500, gems: 10 } },
];

const REWARD_RULES = {
  kill: 10,
  assist: 4,
  win: 80,
  top10: 25,
  playMinute: 2,
};

export async function handleAPI(request, env, ctx, registry, url) {
  const path   = url.pathname.replace('/api', '');
  const method = request.method;


  // GET /api/servers — local fallback/control-plane-compatible list.
  if (path === '/servers' && method === 'GET') {
    const rooms = registry.list();
    const totalPlayers = registry.totalPlayers();
    return json([{ id: env.SERVER_ID || 'asia-1', name: env.SERVER_NAME || env.SERVER_ID || 'Asia #1', region: env.SERVER_REGION || 'Seoul', flag: env.SERVER_FLAG || '🇰🇷', kind: env.SERVER_KIND || 'region', status: 'active', players: totalPlayers, maxPlayers: Math.max(parseInt(env.MAX_PLAYERS_PER_ROOM || '20', 10), rooms.reduce((n, r) => Math.max(n, r.maxPlayers || 20), 20)), endpoint: null }]);
  }

  // GET /api/bootstrap — one-call startup payload for web/mobile clients.
  if (path === '/bootstrap' && method === 'GET') {
    const rooms = registry.list();
    return json({
      ok: true,
      version: env.GAME_VERSION || '1.0.0',
      modes: GAME_MODES,
      maps: MAP_CATALOG,
      loadouts: DEFAULT_LOADOUTS,
      missions: DEFAULT_MISSIONS,
      shop: SHOP_CATALOG,
      physics: physicsConfig(),
      install: installManifest(url),
      server: {
        id: env.SERVER_ID || 'edge',
        name: env.SERVER_NAME || env.SERVER_ID || 'Voxel Edge',
        region: env.SERVER_REGION || 'global',
        players: registry.totalPlayers(),
        rooms,
      },
    });
  }

  if (path === '/modes' && method === 'GET') return json({ ok: true, modes: GAME_MODES });
  if (path === '/maps' && method === 'GET') return json({ ok: true, maps: MAP_CATALOG });
  if (path === '/loadouts' && method === 'GET') return json({ ok: true, loadouts: DEFAULT_LOADOUTS });
  if (path === '/missions' && method === 'GET') return json({ ok: true, missions: DEFAULT_MISSIONS });
  if (path === '/install' && method === 'GET') return json({ ok: true, install: installManifest(url) });
  if (path === '/unity/config' && method === 'GET') {
    return json({
      ok: true,
      note: 'Unity WebGL-compatible launch/config endpoint. The current client remains a lightweight browser renderer until Unity build artifacts are uploaded.',
      streamingAssetsUrl: `${url.origin}/unity/StreamingAssets`,
      dataUrl: `${url.origin}/unity/Build/voxel.data`,
      frameworkUrl: `${url.origin}/unity/Build/voxel.framework.js`,
      codeUrl: `${url.origin}/unity/Build/voxel.wasm`,
      companyName: 'Voxel Strike',
      productName: 'Voxel Strike Royale',
      productVersion: env.GAME_VERSION || '1.0.0',
    });
  }


  // POST /api/servers/custom — user-created server; metadata goes to custom KV, never GitHub.
  if (path === '/servers/custom' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const ownerName = sanitizeText(body.ownerName || 'Player', 24);
    const modeId = sanitizeText(body.modeId || 'battle_royale', 32);
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const ttlSec = clampInt(body.ttlSec, 900, 86400, 7200);
    const maxPlayers = clampInt(body.maxPlayers, 2, 100, 64);
    const server = {
      id, name: `${ownerName} 서버`, region: env.SERVER_REGION || 'edge-local', flag: '🎮',
      kind: 'custom', status: 'active', players: 0, maxPlayers, ownerName, modeId,
      createdAt: Date.now(), ttlSec, endpoint: null,
      wsPath: `/ws/${env.SERVER_ID || 'edge'}/${modeId}/${id}?owner=${encodeURIComponent(ownerName)}&instance=${id}&ttl=${ttlSec}&max=${maxPlayers}`,
    };
    await putKVJson(env.SERVER_KV || env.ROOMS, `server:${id}`, server, ttlSec + 60);
    await putKVJson(env.ROOMS, `custom:${id}`, server, ttlSec + 60);
    return json({ ok: true, server });
  }

  // DELETE /api/servers/:id — remove KV server metadata immediately.
  const deleteServerMatch = path.match(/^\/servers\/([a-z0-9_-]+)$/i);
  if (deleteServerMatch && method === 'DELETE') {
    const id = deleteServerMatch[1];
    await deleteKV(env.SERVER_KV || env.ROOMS, `server:${id}`);
    await deleteKV(env.ROOMS, `custom:${id}`);
    await deleteKV(env.ROOMS, `room:${id}:count`);
    return json({ ok: true, deleted: true, id });
  }

  // POST /api/matchmake — auto load-balancing endpoint for the "Play now" button.
  if (path === '/matchmake' && method === 'POST') {
    const rooms = registry.list();
    const server = { id: env.SERVER_ID || 'asia-1', name: env.SERVER_NAME || env.SERVER_ID || 'Asia #1', region: env.SERVER_REGION || 'Seoul', flag: env.SERVER_FLAG || '🇰🇷', players: registry.totalPlayers(), maxPlayers: parseInt(env.MAX_PLAYERS_PER_ROOM || '20', 10), status: 'active' };
    return json({ ok: true, server, wsPath: `/ws/${server.id}/battle_royale`, rooms });
  }

  // GET /api/admin/overview — single-worker admin readout.
  if (path === '/admin/overview' && method === 'GET') {
    return json({ serverId: env.SERVER_ID || 'unknown', region: env.SERVER_REGION || '', rooms: registry.list(), servers: await listStoredServers(env), load: registry.totalPlayers(), adsenseConfigured: !!env.ADSENSE_CLIENT_ID, durableObjects: false, botGuard: 'enabled' });
  }

  if (path === '/admin/cheats' && method === 'GET') {
    return json(await listKVJson(env.SERVER_KV || env.ROOMS, 'cheat:'));
  }

  if (path === '/admin/clans' && method === 'GET') {
    return json(await listKVJson(env.SERVER_KV || env.ROOMS, 'clan:'));
  }

  if (path === '/admin/events' && method === 'GET') {
    return json(await listKVJson(env.SERVER_KV || env.ROOMS, 'event:'));
  }

  if (path === '/admin/events' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const event = {
      id: sanitizeText(body.id || `event-${Date.now().toString(36)}`, 64),
      title: sanitizeText(body.title || 'Limited Event', 80),
      startsAt: clampInt(body.startsAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
      endsAt: clampInt(body.endsAt, 0, Number.MAX_SAFE_INTEGER, Date.now() + 86400000),
      reward: body.reward || { tokens: 100 },
      updatedAt: Date.now(),
    };
    await putKVJson(env.SERVER_KV || env.ROOMS, `event:${event.id}`, event, 0);
    return json({ ok: true, event });
  }

  if (path === '/admin/settings' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const settings = {
      adsenseClientId: sanitizeText(body.adsenseClientId || env.ADSENSE_CLIENT_ID || '', 80),
      cloudflareApiEnabled: !!body.cloudflareApiEnabled,
      gcpClientConfigured: !!body.gcpClientConfigured,
      kvStrategy: 'custom_kv_only',
      updatedAt: Date.now(),
    };
    await putKVJson(env.SERVER_KV || env.ROOMS, 'settings:global', settings, 0);
    return json({ ok: true, settings });
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
  const roomMatch = path.match(/^\/room\/([a-z0-9-]+)(?:\/([a-z_]+)\/?([a-z0-9_-]*))?$/i);
  if (roomMatch && method === 'GET') {
    const [, serverId, maybeModeId, instanceId] = roomMatch;
    const modeId = maybeModeId || 'battle_royale';
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


  // GET /api/users/me?userId=... — D1 profile + KV wallet/inventory view.
  if (path === '/users/me' && method === 'GET') {
    const userId = sanitizeText(url.searchParams.get('userId') || '', 80);
    if (!userId) return json({ error: 'Missing userId' }, 400);
    await ensureUsersTable(env);
    const profile = await getUserProfile(env, userId);
    const wallet = await getWallet(env, userId);
    const inventory = await getInventory(env, userId);
    return json({ ok: true, profile, wallet, inventory });
  }

  if (path === '/users/login' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const username = sanitizeText(body.username || body.name || 'Player', 32);
    const emailHash = sanitizeText(body.emailHash || '', 128);
    await ensureUsersTable(env);
    let profile = null;
    if (env.USERS_DB && emailHash) {
      profile = await env.USERS_DB.prepare('SELECT id, username, email_hash, created_at, last_seen_at FROM users WHERE email_hash = ?').bind(emailHash).first().catch(() => null);
    }
    if (!profile) {
      const userId = `u_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
      profile = { id: userId, username, email_hash: emailHash, created_at: Date.now(), last_seen_at: Date.now() };
      if (env.USERS_DB) await env.USERS_DB.prepare('INSERT INTO users (id, username, email_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').bind(profile.id, username, emailHash, profile.created_at, profile.last_seen_at).run().catch(() => {});
    }
    await putKVJson(env.SERVER_KV || env.ROOMS, `session:${profile.id}`, { userId: profile.id, ts: Date.now() }, 86400);
    return json({ ok: true, userId: profile.id, username: profile.username || username, profile });
  }

  const inventoryMatch = path.match(/^\/users\/([^/]+)\/inventory$/);
  if (inventoryMatch && method === 'GET') {
    const userId = sanitizeText(inventoryMatch[1], 80);
    return json({ ok: true, inventory: await getInventory(env, userId), wallet: await getWallet(env, userId) });
  }

  if (path === '/clans' && method === 'GET') {
    return json({ ok: true, clans: await listKVJson(env.SERVER_KV || env.ROOMS, 'clan:') });
  }

  if (path === '/clans' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const clan = {
      id: `clan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: sanitizeText(body.name || 'New Clan', 32),
      ownerId: sanitizeText(body.ownerId || 'guest', 80),
      tag: sanitizeText(body.tag || 'VS', 6).toUpperCase(),
      members: [sanitizeText(body.ownerId || 'guest', 80)],
      createdAt: Date.now(),
    };
    await putKVJson(env.SERVER_KV || env.ROOMS, `clan:${clan.id}`, clan, 0);
    return json({ ok: true, clan });
  }

  if (path === '/telemetry' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const event = { id: `telemetry:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, ts: Date.now(), type: sanitizeText(body.type || 'client', 40), payload: body.payload || {} };
    await putKVJson(env.SERVER_KV || env.ROOMS, event.id, event, 604800);
    return json({ ok: true });
  }

  // GET /api/shop/catalog — item, token and PayPal gem-pack catalog.
  if (path === '/shop/catalog' && method === 'GET') {
    return json({ ok: true, catalog: SHOP_CATALOG, rewardRules: REWARD_RULES });
  }

  // POST /api/rewards/grant — grant earnable tokens for play events.
  if (path === '/rewards/grant' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const userId = sanitizeText(body.userId || '', 80);
    if (!userId) return json({ error: 'Missing userId' }, 400);
    const kills = clampInt(body.kills, 0, 200, 0);
    const assists = clampInt(body.assists, 0, 200, 0);
    const playMinutes = clampInt(body.playMinutes, 0, 360, 0);
    const won = !!body.win;
    const top10 = !!body.top10;
    const earned = kills * REWARD_RULES.kill + assists * REWARD_RULES.assist + playMinutes * REWARD_RULES.playMinute + (won ? REWARD_RULES.win : 0) + (top10 ? REWARD_RULES.top10 : 0);
    const wallet = await addWallet(env, userId, { tokens: earned, gems: 0 });
    await putKVJson(env.SERVER_KV || env.ROOMS, `reward:${userId}:${Date.now()}`, { userId, kills, assists, playMinutes, won, top10, earned, ts: Date.now() }, 604800);
    return json({ ok: true, earned, wallet });
  }

  // POST /api/shop/purchase — buy weapon/profile skins with tokens or gems.
  if (path === '/shop/purchase' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const userId = sanitizeText(body.userId || '', 80);
    const itemId = sanitizeText(body.itemId || '', 80);
    if (!userId || !itemId) return json({ error: 'Missing userId or itemId' }, 400);
    const item = SHOP_CATALOG.items.find(i => i.id === itemId);
    if (!item) return json({ error: 'Unknown item' }, 404);
    const wallet = await getWallet(env, userId);
    const costTokens = item.price.tokens || 0;
    const costGems = item.price.gems || 0;
    if (wallet.tokens < costTokens || wallet.gems < costGems) return json({ error: 'Insufficient balance', wallet }, 402);
    const nextWallet = await addWallet(env, userId, { tokens: -costTokens, gems: -costGems });
    const inventory = await addInventoryItem(env, userId, item);
    return json({ ok: true, item, wallet: nextWallet, inventory });
  }

  // POST /api/payments/paypal/create — server-side order placeholder for PayPal checkout.
  if (path === '/payments/paypal/create' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const userId = sanitizeText(body.userId || '', 80);
    const packId = sanitizeText(body.packId || '', 40);
    const pack = SHOP_CATALOG.paypalGemPacks.find(p => p.id === packId);
    if (!userId || !pack) return json({ error: 'Invalid userId or packId' }, 400);
    const order = { id: `paypal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, provider: 'paypal', status: 'created', userId, packId, gems: pack.gems, priceUsd: pack.priceUsd, createdAt: Date.now() };
    await putKVJson(env.SERVER_KV || env.ROOMS, `payment:${order.id}`, order, 86400);
    return json({ ok: true, order, paypalClientIdConfigured: !!env.PAYPAL_CLIENT_ID });
  }

  // POST /api/payments/paypal/capture — capture placeholder and credit gems.
  if (path === '/payments/paypal/capture' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const orderId = sanitizeText(body.orderId || '', 80);
    const order = await getKVJson(env.SERVER_KV || env.ROOMS, `payment:${orderId}`);
    if (!order) return json({ error: 'Unknown order' }, 404);
    order.status = 'captured';
    order.capturedAt = Date.now();
    await putKVJson(env.SERVER_KV || env.ROOMS, `payment:${order.id}`, order, 86400);
    const wallet = await addWallet(env, order.userId, { tokens: 0, gems: order.gems });
    return json({ ok: true, order, wallet });
  }

  // GET /api/physics/config — exposes server-side physics/science tuning to clients/tools.
  if (path === '/physics/config' && method === 'GET') {
    return json({ ok: true, physics: physicsConfig() });
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




async function getKVJson(kv, key) {
  if (!kv) return null;
  try { return await kv.get(key, { type: 'json' }); } catch { return null; }
}

async function getUserProfile(env, userId) {
  if (!env.USERS_DB) return { id: userId, username: 'Guest', d1: false };
  try {
    const row = await env.USERS_DB.prepare('SELECT id, username, email_hash, created_at, last_seen_at FROM users WHERE id = ?').bind(userId).first();
    return row || { id: userId, username: 'Unknown', d1: true };
  } catch { return { id: userId, username: 'Unknown', d1: true }; }
}

async function getWallet(env, userId) {
  return (await getKVJson(env.SERVER_KV || env.ROOMS, `wallet:${userId}`)) || { userId, tokens: 0, gems: 0, updatedAt: Date.now() };
}

async function addWallet(env, userId, delta) {
  const wallet = await getWallet(env, userId);
  wallet.tokens = Math.max(0, (wallet.tokens || 0) + (delta.tokens || 0));
  wallet.gems = Math.max(0, (wallet.gems || 0) + (delta.gems || 0));
  wallet.updatedAt = Date.now();
  await putKVJson(env.SERVER_KV || env.ROOMS, `wallet:${userId}`, wallet, 0);
  return wallet;
}

async function getInventory(env, userId) {
  return (await getKVJson(env.SERVER_KV || env.ROOMS, `inventory:${userId}`)) || { userId, items: [], updatedAt: Date.now() };
}

async function addInventoryItem(env, userId, item) {
  const inventory = await getInventory(env, userId);
  if (!inventory.items.some(i => i.id === item.id)) inventory.items.push({ ...item, purchasedAt: Date.now() });
  inventory.updatedAt = Date.now();
  await putKVJson(env.SERVER_KV || env.ROOMS, `inventory:${userId}`, inventory, 0);
  return inventory;
}

function physicsConfig() {
  return {
    realtimeTickHz: 20,
    gravity: 22,
    airDensity: 1.225,
    dragModel: 'quadratic-lite',
    serverAuthoritativeDamage: true,
    clientPrediction: true,
    lagCompensation: { interpolationMs: 100, maxRewindMs: 250 },
    ballistics: { projectileTravel: true, bulletDrop: true, penetration: true, distanceFalloff: true, armorAbsorption: 0.5 },
    movement: { jumpVelocity: 8.5, sprintMultiplier: 1.65, crouchMultiplier: 0.5, airControl: 0.35, stepHeight: 0.45 },
  };
}

function installManifest(url) {
  return {
    type: 'pwa',
    manifestUrl: `${url.origin}/manifest.webmanifest`,
    serviceWorkerUrl: `${url.origin}/sw.js`,
    startUrl: `${url.origin}/`,
    display: 'fullscreen',
    instructions: {
      chromeAndroid: '주소창 또는 브라우저 메뉴에서 “앱 설치”를 선택하세요.',
      safariIOS: '공유 버튼 → 홈 화면에 추가를 선택하세요.',
      desktop: '주소창의 설치 아이콘 또는 앱 설치 버튼을 누르세요.',
    },
    nativeWrapper: null,
  };
}

async function listStoredServers(env) {
  return listKVJson(env.SERVER_KV || env.ROOMS, 'server:');
}

async function listKVJson(kv, prefix) {
  if (!kv) return [];
  try {
    const listed = await kv.list({ prefix });
    const out = [];
    for (const key of listed.keys) {
      const v = await kv.get(key.name, { type: 'json' }).catch(() => null);
      if (v) out.push(v);
    }
    return out;
  } catch { return []; }
}

async function putKVJson(kv, key, value, ttlSec = 0) {
  if (!kv) return;
  const opts = ttlSec > 0 ? { expirationTtl: ttlSec } : undefined;
  try { await kv.put(key, JSON.stringify(value), opts); } catch (_) {}
}

async function deleteKV(kv, key) {
  try { await kv?.delete(key); } catch (_) {}
}

function sanitizeText(value, max = 32) {
  return String(value || '').replace(/[<>&"']/g, '').slice(0, max);
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

async function ensureUsersTable(env) {
  if (!env.USERS_DB) return;
  try {
    await env.USERS_DB.prepare('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL, email_hash TEXT, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)').run();
  } catch (_) {}
}
