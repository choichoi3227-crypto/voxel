// src/workers/room-registry.js
// ─────────────────────────────────────────────────────────────
// In-memory room registry — NO Durable Objects, NO external services.
// Each Cloudflare Worker isolate holds its own registry in memory.
// KV is used only for:
//   (a) best-effort cross-isolate visibility (player counts for /api/servers)
//   (b) periodic state snapshots so a cold-started isolate can recover
//       room state instead of silently resetting it.
//
// IMPORTANT — Workers global-scope rule:
//   Nothing in this module may call setInterval/setTimeout/fetch at
//   module-evaluation time. RoomRegistry is a plain class with NO
//   side effects in its constructor. The registry instance itself is
//   created lazily, on first request, inside a handler — see router.js.
//   All per-room timers are armed lazily on first access too (see
//   Room.touch()), and only while ctx is available to extend their
//   lifetime via ctx.waitUntil from the call site.
// ─────────────────────────────────────────────────────────────
import { GAME_MODES } from './constants.js';

export const MAX_PLAYERS = 20;
export const ROUND_DURATION_MS = 5 * 60 * 1000; // default (multiplayer) — overridden per-mode
export const CLEANUP_INTERVAL_MS = 60_000;
export const SNAPSHOT_INTERVAL_MS = 30_000;

export class RoomRegistry {
  constructor() {
    /** Map<roomKey, Room> — roomKey = `${serverId}:${modeId}:${instanceId}` */
    this._rooms = new Map();
    this._lastCleanup  = 0;
    this._lastSnapshot = 0;
  }

  /**
   * Get or lazily create a room. Caller (ws-handler / api) supplies ctx so
   * we can schedule the periodic maintenance tick via ctx.waitUntil instead
   * of a bare setInterval — this keeps everything inside a request handler,
   * never the module's global scope.
   */
  getOrCreate(roomKey, { modeId = 'multiplayer', customConfig = null } = {}) {
    let room = this._rooms.get(roomKey);
    if (!room) {
      room = new Room(roomKey, modeId, customConfig);
      this._rooms.set(roomKey, room);
    }
    return room;
  }

  get(roomKey) { return this._rooms.get(roomKey) || null; }

  has(roomKey) { return this._rooms.has(roomKey); }

  delete(roomKey) { this._rooms.delete(roomKey); }

  list() {
    return [...this._rooms.values()].map(r => r.summary());
  }

  /** Total players currently held in THIS isolate's memory, across all rooms. */
  totalPlayers() {
    let n = 0;
    for (const r of this._rooms.values()) n += r.players.size;
    return n;
  }

  /**
   * Run light maintenance: evict empty/expired rooms. Safe to call on every
   * request — internally throttled so the actual sweep only runs at most
   * once per CLEANUP_INTERVAL_MS. This replaces the old setInterval-based
   * approach, and only ever runs while handling a real request.
   */
  maybeCleanup(nowMs = Date.now()) {
    if (nowMs - this._lastCleanup < CLEANUP_INTERVAL_MS) return;
    this._lastCleanup = nowMs;
    for (const [key, room] of this._rooms) {
      const expired = room.isExpired(nowMs);
      const emptyStale = room.isEmpty() && room.ageMs(nowMs) > 30_000 && !room.isPersonal;
      // Personal (training) rooms are kept alive until TTL even when empty,
      // so the owner can reconnect within their hour.
      if (expired || emptyStale) this._rooms.delete(key);
    }
  }

  /**
   * Returns true if a KV snapshot sweep is due. Caller is responsible for
   * actually writing to KV (via ctx.waitUntil) — this registry never
   * touches KV itself so it stays a pure in-memory structure.
   */
  maybeSnapshotDue(nowMs = Date.now()) {
    if (nowMs - this._lastSnapshot < SNAPSHOT_INTERVAL_MS) return false;
    this._lastSnapshot = nowMs;
    return true;
  }

  /** Serialize lightweight metadata (NOT full player state) for KV snapshot. */
  snapshotMeta() {
    return this.list();
  }
}

// ─────────────────────────────────────────────────────────────
// Room — holds all state for one game room (one mode instance)
// ─────────────────────────────────────────────────────────────
export class Room {
  constructor(roomKey, modeId = 'multiplayer', customConfig = null) {
    const mode = GAME_MODES[modeId] || GAME_MODES.multiplayer;

    this.key        = roomKey;
    this.modeId      = mode.id;
    this.mode        = mode;
    this.id          = roomKey; // backward-compat alias used by api.js summaries
    this.createdAt   = Date.now();
    this.lastActive  = Date.now();

    const roundMs = (customConfig?.roundDurationSec ?? mode.roundDurationSec ?? 300) * 1000;
    this.roundDurationMs = roundMs;
    this.roundEnd    = roundMs > 0 ? Date.now() + roundMs : 0;

    /** Map<playerId, PlayerState> */
    this.players = new Map();

    this.score = { red: 0, blue: 0 };
    // Battle-royale specific: solo kill counts, Map<playerId, kills>
    this.soloKills = new Map();

    this.maxPlayers = customConfig?.maxPlayers ?? mode.maxPlayers ?? MAX_PLAYERS;
    this.isPersonal = !!mode.isPersonal;
    this.ownerName  = customConfig?.ownerName || null;

    // Custom server TTL (training / user-created rooms only)
    this.ttlMs        = (customConfig?.ttlSec ?? mode.ttlSec ?? 0) * 1000;
    this.expiresAt    = this.ttlMs > 0 ? Date.now() + this.ttlMs : 0;

    // Battle-royale shrinking zone state
    this.zone = mode.shrinkingZone ? {
      cx: 32, cz: 32,
      radius: 32,
      minRadius: mode.zoneMinRadius || 6,
      nextShrinkAt: Date.now() + (mode.zoneShrinkIntervalSec || 45) * 1000,
      shrinkIntervalMs: (mode.zoneShrinkIntervalSec || 45) * 1000,
    } : null;

    this._roundTimerArmedAt = 0; // see touch()
  }

  /**
   * Lazily "arms" round-end checking. Rather than a setTimeout (forbidden
   * at module scope and unreliable across isolate restarts anyway), round
   * end is checked opportunistically every time touch() is called from a
   * real request (ws message, snapshot tick, etc). This is sufficient
   * because activity always continues to flow through real requests while
   * players are connected.
   */
  touch(nowMs = Date.now()) {
    this.lastActive = nowMs;
    if (this.roundDurationMs > 0 && this.roundEnd > 0 && nowMs >= this.roundEnd) {
      this._endRound(nowMs);
    }
    if (this.zone && nowMs >= this.zone.nextShrinkAt) {
      this._shrinkZone(nowMs);
    }
  }

  isExpired(nowMs = Date.now()) {
    return this.expiresAt > 0 && nowMs >= this.expiresAt;
  }

  // ── Players ────────────────────────────────────────────────

  addPlayer(playerId, ws, opts = {}) {
    if (this.players.size >= this.maxPlayers) return null;

    const team  = this.mode.teams ? this._assignTeam() : null;
    const spawn = this._spawnPoint(team);

    const player = {
      id:       playerId,
      ws,
      name:     sanitize(opts.name) || `Player${Math.floor(Math.random() * 9999)}`,
      team,
      x: spawn.x, y: spawn.y, z: spawn.z,
      yaw: 0, pitch: 0,
      health: 100, armor: 50,
      weapon: 'ak47',
      kills: 0, deaths: 0,
      alive: true,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      ping: 0,
    };

    this.players.set(playerId, player);
    if (!this.mode.teams) this.soloKills.set(playerId, 0);
    return player;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
    this.soloKills.delete(playerId);
  }

  getPlayer(id) { return this.players.get(id) || null; }

  // ── State mutation ─────────────────────────────────────────

  movePlayer(id, x, y, z, yaw, pitch) {
    const p = this.players.get(id);
    if (!p) return;
    p.x = x; p.y = y; p.z = z;
    p.yaw = yaw; p.pitch = pitch;
    p.lastSeen = Date.now();

    // Battle-royale: damage-over-time outside the safe zone
    if (this.zone) {
      const d = Math.hypot(x - this.zone.cx, z - this.zone.cz);
      if (d > this.zone.radius && p.alive) {
        p.health = Math.max(0, p.health - 2); // tick handled at move-rate, intentionally gentle per-packet
        if (p.health === 0) this._killByZone(p);
      }
    }
  }

  /**
   * Returns { killed: bool, victim: PlayerState|null, damage }.
   * `precomputedDamage` is the SERVER-side validated damage (see
   * computeServerDamage in ws-handler.js) — this function never trusts
   * a client-provided raw number directly.
   */
  applyHit(shooterId, victimId, precomputedDamage) {
    const shooter = this.players.get(shooterId);
    const victim  = this.players.get(victimId);
    if (!shooter || !victim) return { killed: false, victim: null };
    if (this.mode.teams && shooter.team === victim.team) return { killed: false, victim: null };
    if (!victim.alive || victim.health <= 0) return { killed: false, victim: null };

    let dmg = Math.max(1, Math.floor(precomputedDamage));
    if (victim.armor > 0) {
      const absorbed = Math.min(victim.armor, Math.floor(dmg * 0.5));
      victim.armor  -= absorbed;
      dmg            -= absorbed;
    }
    victim.health = Math.max(0, victim.health - dmg);

    const killed = victim.health === 0;
    if (killed) {
      victim.alive = false;
      shooter.kills++;
      victim.deaths++;
      if (this.mode.teams) {
        this.score[shooter.team]++;
      } else {
        this.soloKills.set(shooterId, (this.soloKills.get(shooterId) || 0) + 1);
      }
    }
    return { killed, victim, shooter, damage: dmg };
  }

  respawnPlayer(playerId) {
    if (!this.mode.respawns) return null;
    const p = this.players.get(playerId);
    if (!p) return null;
    const spawn = this._spawnPoint(p.team);
    p.x = spawn.x; p.y = spawn.y; p.z = spawn.z;
    p.health = 100; p.armor = 50;
    p.alive  = true;
    return p;
  }

  /** Count of players still alive (used by battle-royale win condition) */
  aliveCount() {
    let n = 0;
    for (const [, p] of this.players) if (p.alive) n++;
    return n;
  }

  lastAlivePlayer() {
    for (const [, p] of this.players) if (p.alive) return p;
    return null;
  }

  // ── Broadcast helpers ──────────────────────────────────────

  broadcast(msg, excludeId = null) {
    const raw = JSON.stringify(msg);
    for (const [id, p] of this.players) {
      if (id === excludeId) continue;
      try { p.ws.send(raw); } catch (_) {}
    }
  }

  broadcastTeam(team, msg) {
    const raw = JSON.stringify(msg);
    for (const [, p] of this.players) {
      if (p.team !== team) continue;
      try { p.ws.send(raw); } catch (_) {}
    }
  }

  sendTo(playerId, msg) {
    const p = this.players.get(playerId);
    if (!p) return;
    try { p.ws.send(JSON.stringify(msg)); } catch (_) {}
  }

  // ── Queries ────────────────────────────────────────────────

  isEmpty()  { return this.players.size === 0; }
  isFull()   { return this.players.size >= this.maxPlayers; }
  ageMs(nowMs = Date.now())  { return nowMs - this.createdAt; }
  ttlRemainingSec(nowMs = Date.now()) {
    if (!this.expiresAt) return null;
    return Math.max(0, Math.round((this.expiresAt - nowMs) / 1000));
  }

  summary() {
    return {
      id:           this.id,
      modeId:       this.modeId,
      players:      this.players.size,
      maxPlayers:   this.maxPlayers,
      score:        this.mode.teams ? this.score : null,
      roundEnd:     this.roundEnd,
      isPersonal:   this.isPersonal,
      ownerName:    this.ownerName,
      ttlRemaining: this.ttlRemainingSec(),
      zone:         this.zone ? { radius: this.zone.radius, cx: this.zone.cx, cz: this.zone.cz } : null,
    };
  }

  /** Snapshot of all players safe to send over the wire */
  playersSnapshot(excludeId = null) {
    const list = [];
    for (const [id, p] of this.players) {
      if (id === excludeId) continue;
      list.push({
        id: p.id, name: p.name, team: p.team,
        x: p.x, y: p.y, z: p.z,
        yaw: p.yaw, pitch: p.pitch,
        health: p.health, armor: p.armor,
        weapon: p.weapon, alive: p.alive,
        kills: p.kills, deaths: p.deaths,
      });
    }
    return list;
  }

  // ── Internal ───────────────────────────────────────────────

  _assignTeam() {
    let red = 0, blue = 0;
    for (const [, p] of this.players) {
      if (p.team === 'red') red++; else blue++;
    }
    return red <= blue ? 'red' : 'blue';
  }

  _spawnPoint(team) {
    if (!this.mode.teams) {
      // Solo modes: scatter spawns across the whole map ring
      const angle = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 14;
      return {
        x: Math.max(2, Math.min(62, 32 + Math.cos(angle) * r)),
        y: 1,
        z: Math.max(2, Math.min(62, 32 + Math.sin(angle) * r)),
      };
    }
    const SPAWNS = {
      red:  [
        { x: 4,  y: 1, z: 4  }, { x: 6,  y: 1, z: 4  },
        { x: 4,  y: 1, z: 6  }, { x: 8,  y: 1, z: 5  },
      ],
      blue: [
        { x: 58, y: 1, z: 58 }, { x: 56, y: 1, z: 58 },
        { x: 58, y: 1, z: 56 }, { x: 56, y: 1, z: 56 },
      ],
    };
    const list = SPAWNS[team] || SPAWNS.red;
    const sp   = list[Math.floor(Math.random() * list.length)];
    return { x: sp.x + (Math.random() - 0.5) * 2, y: sp.y, z: sp.z + (Math.random() - 0.5) * 2 };
  }

  _killByZone(victim) {
    victim.alive = false;
    victim.deaths++;
    this.broadcast({ type: 'kill', killerId: null, killerName: '안전구역 밖', victimId: victim.id, victimName: victim.name, score: this.mode.teams ? { ...this.score } : null });
    this._checkBattleRoyaleWin();
  }

  _shrinkZone(nowMs) {
    const z = this.zone;
    z.radius = Math.max(z.minRadius, z.radius - 4);
    z.nextShrinkAt = nowMs + z.shrinkIntervalMs;
    this.broadcast({ type: 'zone_update', cx: z.cx, cz: z.cz, radius: z.radius });
  }

  _checkBattleRoyaleWin() {
    if (this.mode.teams || !this.mode.shrinkingZone) return;
    if (this.players.size <= 1) return;
    const alive = this.aliveCount();
    if (alive <= 1) {
      const winner = this.lastAlivePlayer();
      this.broadcast({ type: 'round_end', winner: winner ? winner.id : null, winnerName: winner ? winner.name : null, mode: 'battle_royale' });
      this._resetForNextRound();
    }
  }

  _endRound(nowMs) {
    if (this.mode.teams) {
      const winner = this.score.red > this.score.blue ? 'red'
                   : this.score.blue > this.score.red  ? 'blue'
                   : 'draw';
      this.broadcast({ type: 'round_end', winner, score: { ...this.score } });
    } else if (this.mode.shrinkingZone) {
      // Time ran out before a single winner emerged — most kills wins
      let best = null;
      for (const [pid, kills] of this.soloKills) {
        if (!best || kills > best.kills) best = { pid, kills };
      }
      const winner = best ? this.players.get(best.pid) : null;
      this.broadcast({ type: 'round_end', winner: winner ? winner.id : null, winnerName: winner ? winner.name : null, mode: 'battle_royale' });
    }
    this._resetForNextRound(nowMs);
  }

  _resetForNextRound(nowMs = Date.now()) {
    this.score = { red: 0, blue: 0 };
    this.soloKills.clear();
    this.roundEnd = this.roundDurationMs > 0 ? nowMs + this.roundDurationMs : 0;
    if (this.zone) {
      this.zone.radius = 32;
      this.zone.nextShrinkAt = nowMs + this.zone.shrinkIntervalMs;
    }
    for (const [, p] of this.players) {
      const spawn = this._spawnPoint(p.team);
      p.x = spawn.x; p.y = spawn.y; p.z = spawn.z;
      p.health = 100; p.armor = 50; p.alive = true;
    }
    this.broadcast({ type: 'round_start', roundEnd: this.roundEnd, zone: this.zone ? { cx: this.zone.cx, cz: this.zone.cz, radius: this.zone.radius } : null });
  }
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&"']/g, '').slice(0, 20);
}
