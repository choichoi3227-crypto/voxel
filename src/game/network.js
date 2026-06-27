// src/game/network.js
// ─────────────────────────────────────────────────────────────
// Multiplayer network client
//   • WebSocket connection management + auto-reconnect
//   • Player interpolation (dead reckoning)
//   • Message dispatch
//   • Move packet throttling (10 Hz)
// ─────────────────────────────────────────────────────────────

const MOVE_HZ        = 20;     // position updates per second
const RECONNECT_MS   = 3000;
const MAX_MSG_BYTES  = 512;
const INTERP_SPEED   = 18;     // lerp factor (higher = snappier)

export class NetworkClient {
  constructor() {
    this._ws          = null;
    this._myId        = null;
    this._serverUrl   = null;
    this._playerName  = null;
    this._connected   = false;
    this._reconnTimer = null;
    this._moveTimer   = null;
    this._pingTimer   = null;
    this._pingTs      = 0;
    this.latency      = 0;

    // Map<id, RemotePlayer>
    this.remotePlayers = new Map();

    // Callbacks — set by game
    this.onWelcome     = null;
    this.onPlayerJoin  = null;
    this.onPlayerLeave = null;
    this.onMove        = null;
    this.onShoot       = null;
    this.onKill        = null;
    this.onDamage      = null;
    this.onHitConfirm  = null;
    this.onRespawn     = null;
    this.onChat        = null;
    this.onRoundEnd    = null;
    this.onRoundStart  = null;
    this.onError       = null;
  }

  // ── Connection ──────────────────────────────────────────────

  connect(serverId, playerName, wsPath = null, modeId = 'multiplayer') {
    this._serverUrl  = wsPath ? this._buildUrlFromPath(wsPath) : this._buildUrl(serverId, modeId);
    this._playerName = playerName;
    this._open();
  }

  disconnect() {
    clearTimeout(this._reconnTimer);
    clearInterval(this._moveTimer);
    clearInterval(this._pingTimer);
    if (this._ws) { this._ws.onclose = null; this._ws.close(); this._ws = null; }
    this._connected = false;
    this.remotePlayers.clear();
  }

  get connected() { return this._connected; }
  get myId()      { return this._myId; }

  // ── Outbound messages ────────────────────────────────────────

  sendMove(pos, yaw, pitch) {
    this._send({ type:'move', x:pos.x, y:pos.y, z:pos.z, yaw, pitch });
  }

  sendShoot(weaponId, pos, eyeY, dx, dy, dz) {
    this._send({ type:'shoot', weapon:weaponId, x:pos.x, y:eyeY, z:pos.z, dx, dy, dz });
  }

  sendHit(victimId, damage, weapon) {
    this._send({ type:'hit', victimId, damage:Math.floor(damage), weapon });
  }

  sendWeaponSwitch(weaponId) {
    this._send({ type:'weapon_switch', weapon:weaponId });
  }

  sendChat(text, teamOnly = false) {
    this._send({ type:'chat', text, team_only:teamOnly });
  }

  sendEmote(emote) {
    this._send({ type:'emote', emote });
  }

  // ── Per-frame update (call from game loop) ───────────────────

  update(dt, pos, yaw, pitch) {
    this._interpolatePlayers(dt);
  }

  // ── Internal ─────────────────────────────────────────────────

  _open() {
    if (!this._serverUrl) return;
    try {
      this._ws = new WebSocket(this._serverUrl);
    } catch (e) {
      console.warn('[Net] WS unavailable — offline mode');
      return;
    }

    this._ws.onopen = () => {
      this._connected = true;
      this._send({ type:'join', name:this._playerName });
      this._startPing();
      this._startMoveLoop();
      console.log('[Net] Connected to', this._serverUrl);
    };

    this._ws.onmessage = (evt) => {
      if (typeof evt.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      this._dispatch(msg);
    };

    this._ws.onerror = () => {
      this._connected = false;
    };

    this._ws.onclose = () => {
      this._connected = false;
      clearInterval(this._moveTimer);
      clearInterval(this._pingTimer);
      this.remotePlayers.clear();
      console.log('[Net] Disconnected — retrying in', RECONNECT_MS, 'ms');
      this._reconnTimer = setTimeout(() => this._open(), RECONNECT_MS);
    };
  }

  _send(obj) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    try {
      const raw = JSON.stringify(obj);
      if (raw.length > MAX_MSG_BYTES) return;  // drop oversized
      this._ws.send(raw);
    } catch (_) {}
  }

  _startMoveLoop() {
    clearInterval(this._moveTimer);
    // The game will call sendMove directly; this is a fallback
    this._moveTimer = null;
  }

  _startPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      this._pingTs = Date.now();
      this._send({ type:'ping', t:this._pingTs });
    }, 2000);
  }

  _dispatch(msg) {
    switch (msg.type) {

      case 'welcome': {
        this._myId = msg.playerId;
        // Populate remote players
        for (const p of (msg.players || [])) {
          this.remotePlayers.set(p.id, this._makeRemote(p));
        }
        this.onWelcome?.(msg);
        break;
      }

      case 'player_join': {
        const p = msg.player;
        if (p.id !== this._myId) {
          this.remotePlayers.set(p.id, this._makeRemote(p));
        }
        this.onPlayerJoin?.(p);
        break;
      }

      case 'player_leave': {
        this.remotePlayers.delete(msg.id);
        this.onPlayerLeave?.(msg.id);
        break;
      }

      case 'move': {
        const rp = this.remotePlayers.get(msg.id);
        if (rp) {
          rp.tx=msg.x; rp.ty=msg.y; rp.tz=msg.z;
          rp.tyaw=msg.yaw; rp.tpitch=msg.pitch;
        }
        this.onMove?.(msg);
        break;
      }

      case 'shoot': {
        const rp = this.remotePlayers.get(msg.id);
        if (rp) rp.weapon = msg.weapon;
        this.onShoot?.(msg);
        break;
      }

      case 'weapon_switch': {
        const rp = this.remotePlayers.get(msg.id);
        if (rp) rp.weapon = msg.weapon;
        break;
      }

      case 'damage': {
        this.onDamage?.(msg);
        break;
      }

      case 'hit_confirm': {
        this.onHitConfirm?.(msg);
        break;
      }

      case 'kill': {
        const victim = this.remotePlayers.get(msg.victimId);
        if (victim) victim.health = 0;
        this.onKill?.(msg);
        break;
      }

      case 'player_respawn': {
        const rp = this.remotePlayers.get(msg.id);
        if (rp) { rp.tx=msg.x; rp.ty=msg.y; rp.tz=msg.z; rp.x=msg.x; rp.y=msg.y; rp.z=msg.z; rp.health=100; }
        break;
      }

      case 'respawn': {
        this.onRespawn?.(msg);
        break;
      }

      case 'chat': {
        this.onChat?.(msg);
        break;
      }

      case 'round_end': {
        this.onRoundEnd?.(msg);
        break;
      }

      case 'round_start': {
        this.onRoundStart?.(msg);
        break;
      }

      case 'pong': {
        this.latency = Date.now() - this._pingTs;
        break;
      }

      case 'emote': {
        // handled by UI
        break;
      }

      case 'error': {
        console.warn('[Net] Server error:', msg.code, msg.message);
        this.onError?.(msg);
        break;
      }
    }
  }

  _makeRemote(p) {
    return {
      id:     p.id,
      name:   p.name,
      team:   p.team,
      x:  p.x, y:  p.y, z:  p.z,
      tx: p.x, ty: p.y, tz: p.z,
      yaw: p.yaw||0, tyaw: p.yaw||0,
      pitch: p.pitch||0, tpitch: p.pitch||0,
      health: p.health??100,
      armor:  p.armor??0,
      weapon: p.weapon||'ak47',
    };
  }

  _interpolatePlayers(dt) {
    const alpha = Math.min(1, INTERP_SPEED * dt);
    for (const [, p] of this.remotePlayers) {
      if (p.tx===undefined) continue;
      p.x   = lerp(p.x,   p.tx,   alpha);
      p.y   = lerp(p.y,   p.ty,   alpha);
      p.z   = lerp(p.z,   p.tz,   alpha);
      p.yaw = lerpAngle(p.yaw, p.tyaw, alpha);
    }
  }

  _buildUrlFromPath(path) {
    if (/^wss?:\/\//i.test(path)) return path;
    const loc = typeof window !== 'undefined' ? window.location : { host:'localhost:8787', protocol:'http:' };
    const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${loc.host}${path.startsWith('/') ? path : '/' + path}`;
  }

  _buildUrl(serverId, modeId = 'multiplayer') {
    const loc = typeof window !== 'undefined' ? window.location : { hostname:'localhost', host:'localhost:8787', protocol:'http:' };
    const isLocal = loc.hostname==='localhost' || loc.hostname==='127.0.0.1';
    const proto = isLocal ? 'ws' : 'wss';
    return `${proto}://${loc.host}/ws/${serverId}/${modeId}`;
  }
}

function lerp(a, b, t) { return a + (b-a)*t; }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI*2;
  while (d < -Math.PI) d += Math.PI*2;
  return a + d*t;
}
