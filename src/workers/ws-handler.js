// src/workers/ws-handler.js
// ─────────────────────────────────────────────────────────────
// WebSocket upgrade + message dispatch for one player session.
// One handler instance per connected client.
// ─────────────────────────────────────────────────────────────
import { MAX_PLAYERS } from './room-registry.js';
import { WEAPON_DAMAGE } from './constants.js';

const RESPAWN_DELAY_MS = 4000;
const MOVE_THROTTLE_MS = 50;   // ignore duplicate moves faster than 50ms
const MAX_MSG_LEN      = 512;

export function handleWebSocket(request, env, ctx, registry, serverId) {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();

  const room     = registry.getOrCreate(serverId);
  const playerId = uid();
  let   joined   = false;
  let   lastMove = 0;
  let   pingTs   = 0;

  // ── Message handler ────────────────────────────────────────
  server.addEventListener('message', evt => {
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

        // Welcome packet: full room state
        server.send(JSON.stringify({
          type:     'welcome',
          playerId: player.id,
          name:     player.name,
          team:     player.team,
          spawn:    { x: player.x, y: player.y, z: player.z },
          score:    room.score,
          roundEnd: room.roundEnd,
          players:  room.playersSnapshot(playerId),
          serverId,
        }));

        // Notify others
        room.broadcast({
          type:   'player_join',
          player: {
            id: player.id, name: player.name, team: player.team,
            x: player.x, y: player.y, z: player.z,
            health: player.health, weapon: player.weapon,
          },
        }, playerId);

        // Persist player count to KV (best-effort, fire-and-forget)
        ctx.waitUntil(syncRoomCountToKV(env, serverId, room.players.size));
        break;
      }

      // ── MOVE ───────────────────────────────────────────────
      case 'move': {
        const now = Date.now();
        if (now - lastMove < MOVE_THROTTLE_MS) return;
        lastMove = now;

        const x = clamp(+msg.x, 0, 64);
        const y = clamp(+msg.y, 0, 20);
        const z = clamp(+msg.z, 0, 64);
        const yaw   = +msg.yaw   || 0;
        const pitch = clamp(+msg.pitch, -1.5, 1.5);

        room.movePlayer(playerId, x, y, z, yaw, pitch);
        room.broadcast({ type: 'move', id: playerId, x, y, z, yaw, pitch }, playerId);
        break;
      }

      // ── SHOOT ──────────────────────────────────────────────
      case 'shoot': {
        const player = room.getPlayer(playerId);
        if (!player || player.health <= 0) return;

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
        if (!shooter || shooter.health <= 0) return;

        const victimId = msg.victimId;
        if (typeof victimId !== 'string') return;

        const weapon = validateWeapon(msg.weapon) ? msg.weapon : shooter.weapon;
        const maxDmg = WEAPON_DAMAGE[weapon] || 30;
        // Clamp to max weapon damage ± 5 to allow spread/headshot bonus
        const damage = clamp(Math.floor(+msg.damage || maxDmg), 1, maxDmg + 5);

        const result = room.applyHit(playerId, victimId, damage);
        if (!result.victim) return;

        // Always tell victim their new health
        room.sendTo(victimId, {
          type:   'damage',
          fromId: playerId,
          fromName: shooter.name,
          damage: result.damage,
          health: result.victim.health,
          armor:  result.victim.armor,
        });

        // Broadcast hit marker to shooter
        room.sendTo(playerId, { type: 'hit_confirm', victimId, damage: result.damage, killed: result.killed });

        if (result.killed) {
          // Announce kill to room
          room.broadcast({
            type:       'kill',
            killerId:   playerId,
            killerName: shooter.name,
            victimId,
            victimName: result.victim.name,
            score:      { ...room.score },
          });

          // Schedule respawn
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
                  score:  { ...room.score },
                });
                room.broadcast({ type: 'player_respawn', id: victimId, x: revived.x, y: revived.y, z: revived.z }, victimId);
              }
            })
          );

          // Persist score (fire and forget)
          ctx.waitUntil(syncRoomCountToKV(env, serverId, room.players.size));
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

        const isTeam = !!msg.team_only;
        const chatMsg = {
          type: 'chat',
          from: p.name,
          team: p.team,
          text,
          teamOnly: isTeam,
          ts: Date.now(),
        };

        if (isTeam) room.broadcastTeam(p.team, chatMsg);
        else        room.broadcast(chatMsg);
        break;
      }

      // ── PING ───────────────────────────────────────────────
      case 'ping': {
        pingTs = +msg.t || Date.now();
        server.send(JSON.stringify({ type: 'pong', t: pingTs, serverTime: Date.now() }));
        const p = room.getPlayer(playerId);
        if (p) p.ping = Date.now() - pingTs;
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
    ctx.waitUntil(syncRoomCountToKV(env, serverId, room.players.size));
  });

  server.addEventListener('error', () => {
    if (joined) room.removePlayer(playerId);
  });

  return new Response(null, { status: 101, webSocket: client });
}

// ── Helpers ────────────────────────────────────────────────────

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
  return ['ak47','m4a1','awp','mp5','shotgun','deagle'].includes(w);
}

async function syncRoomCountToKV(env, serverId, count) {
  try {
    if (!env.KV_ROOMS) return;
    await env.KV_ROOMS.put(
      `room:${serverId}:count`,
      String(count),
      { expirationTtl: 300 }   // auto-expire if worker dies
    );
  } catch (_) {}
}
