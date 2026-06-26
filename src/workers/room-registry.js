// src/workers/room-registry.js
// ─────────────────────────────────────────────────────────────
// In-memory room registry — replaces Durable Objects.
// Each Cloudflare Worker isolate holds its own registry.
// KV is used for cross-isolate coordination (player counts, etc.)
// ─────────────────────────────────────────────────────────────

export const MAX_PLAYERS = 20;
export const ROUND_DURATION_MS = 5 * 60 * 1000; // 5 min

export class RoomRegistry {
  constructor() {
    // Map<serverId, Room>
    this._rooms = new Map();
    // Cleanup interval: evict empty rooms every 60s
    this._cleanupHandle = setInterval(() => this._cleanup(), 60_000);
  }

  /** Get or lazily create a room for the given serverId */
  getOrCreate(serverId) {
    if (!this._rooms.has(serverId)) {
      this._rooms.set(serverId, new Room(serverId));
    }
    return this._rooms.get(serverId);
  }

  get(serverId) { return this._rooms.get(serverId) || null; }

  list() {
    return [...this._rooms.values()].map(r => r.summary());
  }

  _cleanup() {
    for (const [id, room] of this._rooms) {
      if (room.isEmpty() && room.ageMs() > 30_000) {
        this._rooms.delete(id);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Room — holds all state for one game room
// ─────────────────────────────────────────────────────────────
export class Room {
  constructor(serverId) {
    this.id        = serverId;
    this.createdAt = Date.now();
    this.roundEnd  = Date.now() + ROUND_DURATION_MS;

    /** Map<playerId, PlayerState> */
    this.players = new Map();

    this.score = { red: 0, blue: 0 };

    // Round reset timer
    this._roundTimer = setTimeout(() => this._endRound(), ROUND_DURATION_MS);
  }

  // ── Players ────────────────────────────────────────────────

  addPlayer(playerId, ws, opts = {}) {
    if (this.players.size >= MAX_PLAYERS) return null;

    const team  = this._assignTeam();
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
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      ping: 0,
    };

    this.players.set(playerId, player);
    return player;
  }

  removePlayer(playerId) {
    this.players.delete(playerId);
  }

  getPlayer(id) { return this.players.get(id) || null; }

  // ── State mutation ─────────────────────────────────────────

  movePlayer(id, x, y, z, yaw, pitch) {
    const p = this.players.get(id);
    if (!p) return;
    p.x = x; p.y = y; p.z = z;
    p.yaw = yaw; p.pitch = pitch;
    p.lastSeen = Date.now();
  }

  /** Returns { killed: bool, victim: PlayerState|null } */
  applyHit(shooterId, victimId, rawDamage) {
    const shooter = this.players.get(shooterId);
    const victim  = this.players.get(victimId);
    if (!shooter || !victim) return { killed: false, victim: null };
    if (shooter.team === victim.team) return { killed: false, victim: null };
    if (victim.health <= 0) return { killed: false, victim: null };

    // Armor absorption: armor soaks 50% of damage up to armor amount
    let dmg = Math.max(1, Math.floor(rawDamage));
    if (victim.armor > 0) {
      const absorbed = Math.min(victim.armor, Math.floor(dmg * 0.5));
      victim.armor  -= absorbed;
      dmg            -= absorbed;
    }
    victim.health = Math.max(0, victim.health - dmg);

    const killed = victim.health === 0;
    if (killed) {
      shooter.kills++;
      victim.deaths++;
      this.score[shooter.team]++;
    }
    return { killed, victim, shooter, damage: dmg };
  }

  respawnPlayer(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    const spawn = this._spawnPoint(p.team);
    p.x = spawn.x; p.y = spawn.y; p.z = spawn.z;
    p.health = 100; p.armor = 50;
    return p;
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
  isFull()   { return this.players.size >= MAX_PLAYERS; }
  ageMs()    { return Date.now() - this.createdAt; }

  summary() {
    return {
      id:       this.id,
      players:  this.players.size,
      maxPlayers: MAX_PLAYERS,
      score:    this.score,
      roundEnd: this.roundEnd,
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
        weapon: p.weapon,
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
    // Small random offset so players don't stack
    return { x: sp.x + (Math.random() - 0.5) * 2, y: sp.y, z: sp.z + (Math.random() - 0.5) * 2 };
  }

  _endRound() {
    clearTimeout(this._roundTimer);
    const winner = this.score.red > this.score.blue ? 'red'
                 : this.score.blue > this.score.red  ? 'blue'
                 : 'draw';
    this.broadcast({ type: 'round_end', winner, score: { ...this.score } });

    // Reset and start new round
    this.score    = { red: 0, blue: 0 };
    this.roundEnd = Date.now() + ROUND_DURATION_MS;
    this._roundTimer = setTimeout(() => this._endRound(), ROUND_DURATION_MS);
    this.broadcast({ type: 'round_start', roundEnd: this.roundEnd });
  }
}

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&"']/g, '').slice(0, 20);
}
