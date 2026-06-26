// src/workers/ws-handler.js
// ─────────────────────────────────────────────────────────────
// WebSocket upgrade + message dispatch for one player session.
// One handler instance per connected client.
//
// All gameplay-affecting numbers reported by the client (damage, hit
// distance, penetration count) are re-validated server-side via
// ballistics.js before being applied — the client is only trusted for
// "this aim direction at this time", never for "this much damage".
// ─────────────────────────────────────────────────────────────
import { MAX_PLAYERS } from './room-registry.js';
import { WEAPON_DAMAGE, WEAPON_BALLISTICS } from './constants.js';
import { clampReportedDamage } from './ballistics.js';

const RESPAWN_DELAY_MS = 4000;
const MOVE_THROTTLE_MS = 50;   // ignore duplicate moves faster than 50ms
const MAX_MSG_LEN      = 512;

export function handleWebSocket(request, env, ctx, registry, roomKey, modeId, customConfig) {
  const { 0: client, 1: server } = new WebSocketPair();

  // Hibernatable API where available (paid/standard Workers runtime) —
  // falls back silently to a normal accept() on runtimes without it.
  if (typeof server.accept === 'function') server.accept();

  const room     = registry.getOrCreate(roomKey, { modeId, customConfig });
  const playerId = uid();
  let   joined   = false;
  let   lastMove = 0;

  room.touch();

  // ── Message handler ────────────────────────────────────────
  server.addEventListener('message', evt => {
    const now = Date.now();
    room.touch(now);

    // Sanity check size
    if (typeof evt.data !== 'string' || evt.data.length > MAX_MSG_LEN) return;

    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    // Gate all non-join messages until player has joined
    if (!joined && msg.type !== 'join') return;

    switch (msg.type) {

      // ── JOIN ────────────────────────────────────────────────
      case 'join': {
        if (joined) return; // prevent double-join
        if (room.isFull()) {
          server.send(JSON.stringify({ type: 'error', code: 'ROOM_FULL', message: '방이 가득 찼습니다.' }));
          server.close(1008, 'Room full');
          return;
        }

        const player = room.addPlayer(playerId, server, { name: msg.name });
        if (!player) {
          server.send(JSON.stringify({ type: 'error', code: 'JOIN_FAILED' }));
          server.close(1011, 'Join failed');
          return;
        }
        joined = true;

        server.send(JSON.stringify({
          type:     'welcome',
          playerId: player.id,
          name:     player.name,
          team:     player.team,
          modeId:   room.modeId,
          spawn:    { x: player.x, y: player.y, z: player.z },
          score:    room.mode.teams ? room.score : null,
          roundEnd: room.roundEnd,
          zone:     room.zone ? { cx: room.zone.cx, cz: room.zone.cz, radius: room.zone.radius } : null,
          players:  room.playersSnapshot(playerId),
          ttlRemaining: room.ttlRemainingSec(now),
          roomKey,
        }));

        room.broadcast({
          type:   'player_join',
          player: {
            id: player.id, name: player.name, team: player.team,
            x: player.x, y: player.y, z: player.z,
            health: player.health, weapon: player.weapon,
          },
        }, playerId);

        ctx.waitUntil(syncRoomCountToKV(env, roomKey, room.players.size));
        break;
      }

      // ── MOVE ───────────────────────────────────────────────
      case 'move': {
        if (now - lastMove < MOVE_THROTTLE_MS) return;
        lastMove = now;

        const x = clamp(+msg.x, 0, 64);
        const y = clamp(+msg.y, 0, 20);
        const z = clamp(+msg.z, 0, 64);
        const yaw   = +msg.yaw   || 0;
        const pitch = clamp(+msg.pitch, -1.5, 1.5);

        const wasAlive = room.getPlayer(playerId)?.alive;
        room.movePlayer(playerId, x, y, z, yaw, pitch);
        room.broadcast({ type: 'move', id: playerId, x, y, z, yaw, pitch }, playerId);

        // Zone damage may have just killed this player (battle royale)
        const p = room.getPlayer(playerId);
        if (p && wasAlive && !p.alive) {
          room.sendTo(playerId, { type: 'damage', fromId: null, fromName: '안전구역', damage: 0, health: 0, armor: 0 });
          room._checkBattleRoyaleWin?.();
          scheduleRespawnOrEnd(ctx, room, playerId);
        }
        break;
      }

      // ── SHOOT ──────────────────────────────────────────────
      case 'shoot': {
        const player = room.getPlayer(playerId);
        if (!player || !player.alive) return;

        const weaponId = validateWeapon(msg.weapon) ? msg.weapon : player.weapon;
        player.weapon = weaponId;

        room.broadcast({
          type:   'shoot',
          id:     playerId,
          weapon: weaponId,
          x: +msg.x || player.x,
          y: +msg.y || player.y,
          z: +msg.z || player.z,
          dx: +msg.dx || 0,
          dy: +msg.dy || 0,
          dz: +msg.dz || 0,
        }, playerId);
        break;
      }

      // ── HIT (client-side hit detection → server validates) ─
      case 'hit': {
        const shooter = room.getPlayer(playerId);
        if (!shooter || !shooter.alive) return;

        const victimId = msg.victimId;
        if (typeof victimId !== 'string') return;
        const victim = room.getPlayer(victimId);
        if (!victim) return;

        const weapon = validateWeapon(msg.weapon) ? msg.weapon : shooter.weapon;
        const distance = Math.hypot(
          (+msg.x || shooter.x) - victim.x,
          (+msg.y || shooter.y) - victim.y,
          (+msg.z || shooter.z) - victim.z,
        ) || Math.hypot(shooter.x - victim.x, shooter.y - victim.y, shooter.z - victim.z);

        const penetrationsClaimed = clamp(parseInt(msg.penetrations, 10) || 0, 0, 4);
        const isHeadshot = !!msg.headshot;

        // Server recomputes the ceiling for this shot — client's number is
        // clamped, never trusted outright.
        const validatedDamage = clampReportedDamage(weapon, msg.damage, distance, { penetrationsClaimed, isHeadshot });
        if (validatedDamage <= 0) return; // out of range / over-penetrated / non-positive — drop silently

        const result = room.applyHit(playerId, victimId, validatedDamage);
        if (!result.victim) return;

        room.sendTo(victimId, {
          type:   'damage',
          fromId: playerId,
          fromName: shooter.name,
          damage: result.damage,
          health: result.victim.health,
          armor:  result.victim.armor,
        });

        room.sendTo(playerId, { type: 'hit_confirm', victimId, damage: result.damage, killed: result.killed, headshot: isHeadshot });

        if (result.killed) {
          room.broadcast({
            type:       'kill',
            killerId:   playerId,
            killerName: shooter.name,
            victimId,
            victimName: result.victim.name,
            weapon,
            headshot:   isHeadshot,
            score:      room.mode.teams ? { ...room.score } : null,
          });

          room._checkBattleRoyaleWin?.();
          scheduleRespawnOrEnd(ctx, room, victimId);
          ctx.waitUntil(syncRoomCountToKV(env, roomKey, room.players.size));
        }
        break;
      }

      // ── WEAPON SWITCH ──────────────────────────────────────
      case 'weapon_switch': {
        if (!validateWeapon(msg.weapon)) return;
        const p = room.getPlayer(playerId);
        if (p) p.weapon = msg.weapon;
        room.broadcast({ type: 'weapon_switch', id: playerId, weapon: msg.weapon }, playerId);
        break;
      }

      // ── CHAT ───────────────────────────────────────────────
      case 'chat': {
        const p = room.getPlayer(playerId);
        if (!p) return;
        const text = String(msg.text || '').replace(/[<>]/g, '').slice(0, 120);
        if (!text) return;

        const isTeam = !!msg.team_only && room.mode.teams;
        const chatMsg = {
          type: 'chat',
          from: p.name,
          team: p.team,
          text,
          teamOnly: isTeam,
          ts: now,
        };

        if (isTeam) room.broadcastTeam(p.team, chatMsg);
        else        room.broadcast(chatMsg);
        break;
      }

      // ── PING ───────────────────────────────────────────────
      case 'ping': {
        const pingTs = +msg.t || now;
        server.send(JSON.stringify({ type: 'pong', t: pingTs, serverTime: now }));
        const p = room.getPlayer(playerId);
        if (p) p.ping = now - pingTs;
        break;
      }

      // ── EMOTE ──────────────────────────────────────────────
      case 'emote': {
        const VALID_EMOTES = ['gg', 'nice', 'sorry', 'thanks'];
        if (!VALID_EMOTES.includes(msg.emote)) return;
        const p = room.getPlayer(playerId);
        if (!p) return;
        room.broadcast({ type: 'emote', id: playerId, name: p.name, emote: msg.emote }, playerId);
        break;
      }

      default: break;
    }
  });

  // ── Disconnect ─────────────────────────────────────────────
  server.addEventListener('close', () => {
    if (!joined) return;
    room.removePlayer(playerId);
    room.broadcast({ type: 'player_leave', id: playerId });
    ctx.waitUntil(syncRoomCountToKV(env, roomKey, room.players.size));
  });

  server.addEventListener('error', () => {
    if (joined) room.removePlayer(playerId);
  });

  return new Response(null, { status: 101, webSocket: client });
}

// ── Helpers ────────────────────────────────────────────────────

function scheduleRespawnOrEnd(ctx, room, victimId) {
  if (!room.mode.respawns) return; // battle royale: no respawn, player stays eliminated
  const delay = RESPAWN_DELAY_MS + Math.floor(Math.random() * 1000);
  ctx.waitUntil(
    sleep(delay).then(() => {
      const revived = room.respawnPlayer(victimId);
      if (revived) {
        room.sendTo(victimId, {
          type:  'respawn',
          spawn: { x: revived.x, y: revived.y, z: revived.z },
          health: revived.health,
          armor:  revived.armor,
          score:  room.mode.teams ? { ...room.score } : null,
        });
        room.broadcast({ type: 'player_respawn', id: victimId, x: revived.x, y: revived.y, z: revived.z }, victimId);
      }
    })
  );
}

function uid() {
  return Math.random().toString(36).slice(2, 10) +
         Math.random().toString(36).slice(2, 10);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function validateWeapon(w) {
  return Object.prototype.hasOwnProperty.call(WEAPON_BALLISTICS, w);
}

async function syncRoomCountToKV(env, roomKey, count) {
  try {
    if (!env.ROOMS) return;
    await env.ROOMS.put(
      `room:${roomKey}:count`,
      String(count),
      { expirationTtl: 300 }   // auto-expire if worker dies
    );
  } catch (_) {}
}
