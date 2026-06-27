// src/game/game.js
// ─────────────────────────────────────────────────────────────
// Game orchestrator — creates and connects all subsystems:
//   Menu → Input → Physics → BotManager → Renderer → HUD → Network
// ─────────────────────────────────────────────────────────────
import { GameMap }       from './map.js';
import { PlayerPhysics } from './physics.js';
import { BotManager }    from './bots.js';
import { Renderer }      from './renderer.js';
import { WeaponState, WEAPONS, WEAPON_SLOTS } from './weapons.js';
import { NetworkClient } from './network.js';
import { HUD }           from '../ui/hud.js';
import { Menu }          from '../ui/menu.js';

const KILL_STREAK_MSGS = {
  2:  ['DOUBLE KILL!',  '#ff8844'],
  3:  ['TRIPLE KILL!',  '#ff5500'],
  4:  ['QUAD KILL!!',   '#ff2200'],
  5:  ['PENTA KILL!!!', '#ffdd00'],
  10: ['UNSTOPPABLE',   '#ff00ff'],
};

export class Game {
  constructor() {
    // ── Canvas ───────────────────────────────────────────────
    this.canvas          = document.createElement('canvas');
    this.canvas.id       = 'game-canvas';
    this.canvas.style.cssText = 'display:block;position:fixed;inset:0;z-index:1;cursor:crosshair';
    document.body.appendChild(this.canvas);

    // ── Sub-systems ─────────────────────────────────────────
    this.map      = new GameMap();
    this.phys     = new PlayerPhysics(this.map);
    this.renderer = new Renderer(this.canvas);
    this.hud      = new HUD();
    this.menu     = new Menu();
    this.net      = new NetworkClient();
    this.bots     = new BotManager(this.map, this.map.spawnPoints);

    // ── State ────────────────────────────────────────────────
    this.running     = false;
    this.paused      = false;
    this.myTeam      = 'red';
    this.myName      = 'Player' + Math.floor(Math.random() * 9999);
    this.myId        = null;
    this.kills       = 0;
    this.deaths      = 0;
    this.killStreak  = 0;
    this.score       = { red: 0, blue: 0 };
    this.roundTimer  = 300;
    this.yaw         = 0;
    this.pitch       = 0;
    this.keys        = {};
    this.mouseDown   = false;
    this.cameraMode  = 'first';
    this.inLobby     = true;
    this.parachuting = false;
    this.vehicle     = null;
    this.selectedMode = 'battle_royale';

    // Weapon inventory
    this.weaponStates  = {};
    for (const id of Object.keys(WEAPONS)) this.weaponStates[id] = new WeaponState(id);
    this.currentWeapon = 'ak47';
    this.scopedIn      = false;

    // Effects
    this.damageAlpha = 0;
    this.flashAlpha  = 0;
    this.bullets     = [];
    this.particles   = [];

    // Timing
    this._lastTime = 0;
    this._fpsAcc   = 0;
    this._fpsCount = 0;
    this.fps       = 60;

    // Move send throttle
    this._moveAcc = 0;
    const MOVE_HZ = 20;
    this._moveDt  = 1 / MOVE_HZ;

    // Inject bullets/particles into bots for visuals
    this.bots._bullets   = this.bullets;
    this.bots._particles = this.particles;

    this._setupNet();
    this._setupInput();
    this._setupMenu();
    this._setupMobileControls();
  }

  // ── Boot ────────────────────────────────────────────────────

  async start() {
    await this.menu.loadWith([
      { pct:20,  text:'맵 생성 중...' },
      { pct:45,  text:'물리 엔진 초기화...' },
      { pct:65,  text:'AI 봇 준비...' },
      { pct:85,  text:'서버 목록 불러오는 중...' },
      { pct:100, text:'완료!' },
    ]);
    await this.menu._fetchServers();
    requestAnimationFrame((ts) => this._loop(ts));
  }

  // ── Game start / stop ────────────────────────────────────────

  _startGame(server) {
    this.selectedMode = server.modeId || 'battle_royale';
    this.myName  = this.menu.playerName;
    this.myTeam  = Math.random() < 0.5 ? 'red' : 'blue';
    this.kills   = 0;
    this.deaths  = 0;
    this.killStreak = 0;
    this.score   = { red:0, blue:0 };
    this.roundTimer = 300;
    this.bullets.length = 0;
    this.particles.length = 0;

    // PUBG-style lobby/airdrop opening instead of spawning on the ground.
    const drops = this.map.dropPoints || [];
    const sp = (this.selectedMode.includes('battle') || this.selectedMode === 'solo' || this.selectedMode === 'squad')
      ? (drops[Math.floor(Math.random()*drops.length)] || { x:64, y:14, z:64 })
      : (this.map.spawnPoints.find(s => s.team === this.myTeam) || { x:8, y:1, z:8 });
    this.inLobby = true; this.parachuting = sp.y > 3;
    this.phys.pos    = { x: sp.x + (Math.random()-.5)*2, y: sp.y, z: sp.z + (Math.random()-.5)*2 };
    this.phys.vel    = { x:0, y:0, z:0 };
    this.phys.health = 100;
    this.phys.alive  = true;

    // Reset weapon/loadout
    this._equip(this.menu.settings.weapon || 'ak47');

    // Bots
    this.bots.spawn(this.selectedMode === 'training' ? 6 : 23);

    this.menu.hideMenu();
    this.hud.show();
    this.hud.setHealth(100);
    this.hud.setArmor(50);
    this.hud.setScore(0, 0);

    this.running = true;
    this.paused  = false;

    // Pointer lock
    this.canvas.requestPointerLock();

    // Network
    this.net.connect(server.id, this.myName, server.wsPath || null, server.modeId || 'multiplayer');
    this.hud.notify(`${server.flag||''} ${server.name} 접속! · 3초 로비 후 강하`, '#44ff88');
    setTimeout(() => { this.inLobby = false; this.hud.notify(this.parachuting ? '🪂 낙하산 강하! WASD로 착지 지점 조정' : 'MATCH START', '#ffdd44'); }, 3000);
  }

  _returnToMenu() {
    this.running = false;
    this.paused  = false;
    this.net.disconnect();
    document.exitPointerLock?.();
    this.hud.hide();
    this.menu.showMenu();
    this.menu.hidePointerMsg();
    // Clear canvas
    this.renderer.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  // ── Main loop ────────────────────────────────────────────────

  _loop(ts) {
    requestAnimationFrame((t) => this._loop(t));

    const dt = Math.min(0.05, (ts - this._lastTime) / 1000);
    this._lastTime = ts;

    // FPS counter
    this._fpsAcc += dt; this._fpsCount++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsCount / this._fpsAcc);
      this._fpsAcc = 0; this._fpsCount = 0;
    }

    if (!this.running || this.paused) return;

    this._update(dt);
    this._draw();
  }

  _update(dt) {
    const wep = this.weaponStates[this.currentWeapon];
    wep.update(dt);

    // Auto-fire
    if (this.mouseDown && WEAPONS[this.currentWeapon].auto) this._shoot();

    // Physics
    if (this.parachuting) {
      this.keys['ShiftLeft'] = false;
      this.phys.vel.y = Math.max(this.phys.vel.y, -3.2);
      this.hud.notify('🪂 PARACHUTE', '#ffdd44');
      if (this.phys.pos.y <= this.map.floorY(this.phys.pos.x, this.phys.pos.z) + 0.15) this.parachuting = false;
    }
    if (this.vehicle) this._updateVehicle(dt);
    else this.phys.update(dt, this.keys, this.yaw);

    // Bots
    this.bots.update(dt,
      { x: this.phys.pos.x, y: this.phys.pos.y, z: this.phys.pos.z },
      this.myTeam,
      this.phys.health,
      (dmg, killer) => this._takeDamage(dmg, killer),
      (killer, victim) => this._killFeedEntry(killer, victim),
    );

    // Bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.ox = b.x; b.oy = b.y; b.oz = b.z;
      if (b.vx) { b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; }
      b.life -= dt * 2.2;
      if (b.life <= 0) this.bullets.splice(i, 1);
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vy -= 10 * dt;
      p.life -= dt * 2;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Effects decay
    if (this.damageAlpha > 0) this.damageAlpha = Math.max(0, this.damageAlpha - dt * 5);
    if (this.flashAlpha  > 0) this.flashAlpha  = Math.max(0, this.flashAlpha  - dt * 8);
    if (wep.flash !== undefined) wep.flash = Math.max(0, (wep.flash||0) - dt * 9);

    // Bob on weapon
    wep.bobX = Math.sin(this.phys.bobPhase * 2) * this.phys.bobAmt;
    wep.bobY = Math.abs(Math.cos(this.phys.bobPhase))  * this.phys.bobAmt;

    // Round timer
    this.roundTimer -= dt;
    if (this.roundTimer <= 0) {
      this.roundTimer = 0;
      this._endRound();
    }

    // Network: interpolate + send moves
    this.net.update(dt, this.phys.pos, this.yaw, this.pitch);
    this._moveAcc += dt;
    if (this._moveAcc >= this._moveDt) {
      this._moveAcc = 0;
      this.net.sendMove(this.phys.pos, this.yaw, this.pitch);
    }

    // HUD update
    this.hud.update(dt, {
      yaw:        this.yaw,
      fps:        this.fps,
      ping:       this.net.latency,
      roundTimer: this.roundTimer,
    });
    this.hud.setAmmo(
      wep.ammo, wep.reserve, wep.reloading,
      wep.reloading ? 1 - wep.reloadTimer / WEAPONS[this.currentWeapon].reloadTime : 0,
    );

    // Minimap
    const entities = [
      ...this.bots.bots.filter(b => b.state !== 'dead'),
      ...[...this.net.remotePlayers.values()],
    ];
    this.hud.renderMinimap(this.map, this.phys.pos, this.yaw, entities);
  }

  _draw() {
    // Resize canvas if needed
    if (this.canvas.width !== window.innerWidth || this.canvas.height !== window.innerHeight) {
      this.renderer.resize(window.innerWidth, window.innerHeight);
    }

    const wep = this.weaponStates[this.currentWeapon];
    const allEntities = [
      ...this.bots.bots,
      ...[...this.net.remotePlayers.values()],
    ];

    this.renderer.render({
      pos:         this.phys.pos,
      eyeY:        this.phys.eyeY,
      yaw:         this.yaw,
      pitch:       this.pitch,
      cameraMode:  this.cameraMode,
      map:         this.map,
      entities:    allEntities,
      bullets:     this.bullets,
      particles:   this.particles,
      weapon:      wep,
      scopedIn:    this.scopedIn,
      damageAlpha: this.damageAlpha,
      flashAlpha:  this.flashAlpha,
    });
  }

  // ── Weapon ──────────────────────────────────────────────────

  _equip(id) {
    this.currentWeapon = id;
    this.weaponStates[id].drawTimer = WEAPONS[id].drawTime;
    this.scopedIn = false;
    this.hud.setWeapon(WEAPONS[id].name);
    this.net.sendWeaponSwitch(id);
  }

  _shoot() {
    if (!this.phys.alive) return;
    const wep = this.weaponStates[this.currentWeapon];
    if (!wep.tryShoot(this.mouseDown)) return;

    this.flashAlpha = 0.9;
    wep.flash       = 0.9;

    // Ray for each pellet
    const vecs = wep.getShootVectors(this.yaw + wep.recoilX, this.pitch + wep.recoilY * 0.01);
    const eyeY = this.phys.eyeY;

    for (const { dx, dy, dz } of vecs) {
      const { hit, x, y, z, type } = this.map.castRay(
        this.phys.pos.x, eyeY, this.phys.pos.z, dx, dy, dz, WEAPONS[this.currentWeapon].range
      );

      // Bullet tracer
      const endX = hit ? x + 0.5 : this.phys.pos.x + dx * 60;
      const endY = hit ? y + 0.5 : eyeY + dy * 60;
      const endZ = hit ? z + 0.5 : this.phys.pos.z + dz * 60;
      this.bullets.push({
        x: endX, y: endY, z: endZ,
        ox: this.phys.pos.x, oy: eyeY, oz: this.phys.pos.z,
        vx: 0, vy: 0, vz: 0, life: 0.5,
        team: this.myTeam, owner: 'me',
      });

      if (hit) {
        this._spawnHitParticles(x+.5, y+.5, z+.5, type);
      }

      // Hit detection vs bots
      let killed = false;
      for (const bot of this.bots.bots) {
        if (bot.team === this.myTeam || bot.state === 'dead') continue;
        const d = Math.hypot(endX-bot.x, endY-(bot.y+0.9), endZ-bot.z);
        if (d < 0.7) {
          killed = this.bots.takeDamage(bot.id, WEAPONS[this.currentWeapon].damage, this.myName,
            (k,v) => { this._killFeedEntry(k,v); this._onKill(); }
          );
          this.hud.showHitMarker(killed);
          this._spawnBloodParticles(bot.x, bot.y+0.9, bot.z);
          // Tell server
          this.net.sendHit(bot.id, WEAPONS[this.currentWeapon].damage, this.currentWeapon);
          break;
        }
      }

      // Hit detection vs remote players
      for (const [rid, rp] of this.net.remotePlayers) {
        if (rp.team === this.myTeam) continue;
        const d = Math.hypot(endX-rp.x, endY-(rp.y+0.9), endZ-rp.z);
        if (d < 0.7) {
          this.hud.showHitMarker(false);
          this.net.sendHit(rid, WEAPONS[this.currentWeapon].damage, this.currentWeapon);
          break;
        }
      }
    }

    // Network broadcast
    const cosP = Math.cos(this.pitch), cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    this.net.sendShoot(this.currentWeapon, this.phys.pos, eyeY, sinY*cosP, Math.sin(this.pitch), cosY*cosP);
  }

  // ── Damage / death ─────────────────────────────────────────

  _takeDamage(dmg, killer) {
    this.phys.health -= dmg;
    this.damageAlpha  = Math.min(1, this.damageAlpha + 0.55);
    this.hud.showDamage(0.7);
    this.hud.setHealth(this.phys.health);
    if (this.phys.health <= 0) this._die(killer);
  }

  _die(killer) {
    this.phys.alive  = false;
    this.deaths++;
    this.killStreak  = 0;
    this.hud.showRespawn(killer, () => this._respawn());
    this.hud.notify('ELIMINATED', '#ff4444');
  }

  _respawn() {
    const sp = this.map.spawnPoints.find(s => s.team === this.myTeam) || { x:8, y:1, z:8 };
    this.phys.pos    = { x: sp.x+(Math.random()-.5)*2, y:sp.y, z: sp.z+(Math.random()-.5)*2 };
    this.phys.vel    = { x:0, y:0, z:0 };
    this.phys.health = 100;
    this.phys.alive  = true;
    this.damageAlpha = 0;
    this.hud.setHealth(100);
    this.hud.setArmor(50);
    this._equip('ak47');
    this.hud.notify('RESPAWNED', '#44ff88');
  }

  // ── Kill tracking ────────────────────────────────────────────

  _onKill() {
    this.kills++;
    this.killStreak++;
    this.score[this.myTeam]++;
    this.hud.setScore(this.score.red, this.score.blue);

    const msg = KILL_STREAK_MSGS[this.killStreak];
    if (msg) this.hud.notify(msg[0], msg[1]);
    else     this.hud.notify('+1 KILL', '#ff8844');
  }

  _killFeedEntry(killer, victim) {
    this.hud.addKill(killer, victim, this.currentWeapon);
  }

  // ── Round end ────────────────────────────────────────────────

  _endRound() {
    const winner = this.score.red > this.score.blue ? 'RED'
                 : this.score.blue > this.score.red  ? 'BLUE' : 'DRAW';
    const myWin  = (winner==='RED'&&this.myTeam==='red')||(winner==='BLUE'&&this.myTeam==='blue');
    this.hud.notify(myWin ? '🏆 VICTORY!' : '💀 DEFEAT', myWin ? '#ffdd00' : '#ff4444');
    this._submitScore();
    setTimeout(() => {
      this.score     = { red:0, blue:0 };
      this.roundTimer = 300;
      this.hud.setScore(0, 0);
      this._respawn();
    }, 5000);
  }

  _submitScore() {
    try {
      const token = btoa(`${this.myName}:${this.kills}:voxelstrike`);
      fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: this.myName, kills: this.kills, deaths: this.deaths,
          playtime_sec: Math.floor(300 - this.roundTimer), token,
        }),
      });
    } catch (_) {}
  }

  // ── Input setup ─────────────────────────────────────────────

  _setupInput() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (!this.running) return;

      // Weapon slots
      for (let slot = 1; slot <= 4; slot++) {
        if (e.code === `Digit${slot}`) {
          const list = WEAPON_SLOTS[slot];
          if (list?.length) this._equip(list[0]);
        }
      }

      if (e.code === 'KeyV') this.cameraMode = this.cameraMode === 'first' ? 'third' : 'first';
      if (e.code === 'KeyE') this._toggleVehicle();
      if (e.code === 'KeyR') {
        const wep = this.weaponStates[this.currentWeapon];
        if (!wep.reloading) wep.startReload();
      }
      if (e.code === 'Tab') {
        e.preventDefault();
        const players = [
          { id:'me', name:this.myName, team:this.myTeam, kills:this.kills, deaths:this.deaths, ping:this.net.latency },
          ...this.bots.bots.map(b => ({ id:b.id, name:b.name, team:b.team, kills:b.kills, deaths:b.deaths, ping:Math.floor(Math.random()*60+10) })),
          ...[...this.net.remotePlayers.values()].map(p => ({ id:p.id, name:p.name, team:p.team, kills:0, deaths:0, ping:0 })),
        ];
        this.hud.showTab(players, 'me');
      }
      if (e.code === 'KeyT' && this.running) {
        this._openChat();
      }
      if (e.code === 'Escape') {
        if (this.running) this._returnToMenu();
      }
    });

    document.addEventListener('keyup', (e) => {
      delete this.keys[e.code];
      if (e.code === 'Tab') this.hud.hideTab();
    });

    document.addEventListener('mousemove', (e) => {
      if (!document.pointerLockElement || !this.running) return;
      const sens = (this.menu.settings.sensitivity || 2.0) * 0.001;
      this.yaw   += e.movementX * sens;
      this.pitch  = Math.max(-1.3, Math.min(1.3, this.pitch - e.movementY * sens));
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        if (!document.pointerLockElement && this.running) {
          this.canvas.requestPointerLock();
          return;
        }
        if (this.running && !this.paused) this._shoot();
      }
      if (e.button === 2 && this.running) {
        const def = WEAPONS[this.currentWeapon];
        if (def.scopeZoom) this.scopedIn = !this.scopedIn;
      }
    });

    document.addEventListener('mouseup',  (e) => { if (e.button === 0) this.mouseDown = false; });
    document.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('wheel', (e) => {
      if (!this.running) return;
      const keys = Object.keys(WEAPONS);
      const idx  = keys.indexOf(this.currentWeapon);
      const next = keys[(idx + (e.deltaY > 0 ? 1 : -1) + keys.length) % keys.length];
      this._equip(next);
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.canvas) {
        this.paused = false;
        this.menu.hidePointerMsg();
      } else if (this.running) {
        this.paused = true;
        this.menu.showPointerMsg();
      }
    });

    window.addEventListener('resize', () => {
      this.renderer.resize(window.innerWidth, window.innerHeight);
    });
  }

  _toggleVehicle() {
    if (this.vehicle) { this.vehicle = null; this.hud.notify('차량에서 내림', '#ddd'); return; }
    const near = (this.map.vehicleSpawns || []).find(v => Math.hypot(v.x-this.phys.pos.x, v.z-this.phys.pos.z) < 4);
    if (near) { this.vehicle = { ...near, speed: 0 }; this.hud.notify(`🚙 ${near.type.toUpperCase()} 탑승`, '#44ff88'); }
    else this.hud.notify('근처에 탈 것이 없습니다', '#ffaa44');
  }

  _updateVehicle(dt) {
    const accel = (this.keys['KeyW']?1:0) - (this.keys['KeyS']?1:0);
    this.vehicle.speed = Math.max(-8, Math.min(18, this.vehicle.speed + accel * 18 * dt));
    this.vehicle.speed *= Math.pow(0.85, dt*8);
    this.phys.pos.x += Math.sin(this.yaw) * this.vehicle.speed * dt;
    this.phys.pos.z += Math.cos(this.yaw) * this.vehicle.speed * dt;
    this.phys.pos.y = this.map.floorY(this.phys.pos.x, this.phys.pos.z);
  }

  _setupMobileControls() {
    const style = document.createElement('style');
    style.textContent = `#mobile-controls{display:none}@media (pointer:coarse),(max-width:820px){#mobile-controls{display:block;position:fixed;inset:0;z-index:30;pointer-events:none}.mc-pad{position:absolute;bottom:22px;left:18px;display:grid;grid-template-columns:repeat(3,54px);gap:8px;pointer-events:auto}.mc-pad button,.mc-actions button{width:54px;height:54px;border-radius:16px;border:1px solid #ffffff33;background:#0b1220cc;color:#fff;font-weight:800}.mc-actions{position:absolute;right:18px;bottom:22px;display:grid;grid-template-columns:repeat(2,58px);gap:10px;pointer-events:auto}.mc-fire{background:#ff3333dd!important}.mc-look{position:absolute;right:0;top:0;width:58%;height:70%;pointer-events:auto}}`;
    document.head.appendChild(style);
    document.body.insertAdjacentHTML('beforeend', `<div id="mobile-controls"><div class="mc-look"></div><div class="mc-pad"><span></span><button data-k="KeyW">▲</button><span></span><button data-k="KeyA">◀</button><button data-k="Space">⤴</button><button data-k="KeyD">▶</button><span></span><button data-k="KeyS">▼</button><span></span></div><div class="mc-actions"><button class="mc-fire">발사</button><button data-act="reload">R</button><button data-act="scope">ADS</button><button data-act="vehicle">E</button><button data-act="cam">시점</button><button data-act="weapon">무기</button></div></div>`);
    document.querySelectorAll('#mobile-controls [data-k]').forEach(b => { const k=b.dataset.k; b.addEventListener('touchstart',e=>{e.preventDefault();this.keys[k]=true}); b.addEventListener('touchend',e=>{e.preventDefault();delete this.keys[k]}); });
    document.querySelector('.mc-fire')?.addEventListener('touchstart', e=>{e.preventDefault();this.mouseDown=true;this._shoot();}); document.querySelector('.mc-fire')?.addEventListener('touchend', e=>{e.preventDefault();this.mouseDown=false;});
    document.querySelector('[data-act=reload]')?.addEventListener('click',()=>this.weaponStates[this.currentWeapon].startReload()); document.querySelector('[data-act=scope]')?.addEventListener('click',()=>this.scopedIn=!this.scopedIn); document.querySelector('[data-act=vehicle]')?.addEventListener('click',()=>this._toggleVehicle()); document.querySelector('[data-act=cam]')?.addEventListener('click',()=>this.cameraMode=this.cameraMode==='first'?'third':'first'); document.querySelector('[data-act=weapon]')?.addEventListener('click',()=>{const keys=Object.keys(WEAPONS);this._equip(keys[(keys.indexOf(this.currentWeapon)+1)%keys.length]);});
    let lx=0,ly=0; const look=document.querySelector('.mc-look'); look?.addEventListener('touchstart',e=>{lx=e.touches[0].clientX;ly=e.touches[0].clientY}); look?.addEventListener('touchmove',e=>{const t=e.touches[0];this.yaw+=(t.clientX-lx)*0.006;this.pitch=Math.max(-1.3,Math.min(1.3,this.pitch-(t.clientY-ly)*0.006));lx=t.clientX;ly=t.clientY;e.preventDefault();});
  }

  // ── Chat ────────────────────────────────────────────────────

  _openChat() {
    if (!document.pointerLockElement) return;
    document.exitPointerLock();
    const wrap = document.createElement('div');
    wrap.id = 'chat-inp-wrap';
    wrap.style.cssText = 'position:fixed;bottom:130px;left:20px;z-index:500;display:flex;gap:8px;align-items:center;font-family:"Courier New",monospace';
    wrap.innerHTML = `
      <input id="chat-inp" placeholder="메시지 (Enter 전송, Esc 취소)" style="background:#111;border:1px solid #ff4444;color:#fff;padding:7px 12px;font-family:inherit;font-size:13px;border-radius:3px;width:280px;outline:none">
      <button style="background:#ff4444;border:none;color:#fff;padding:7px 14px;cursor:pointer;font-family:inherit;border-radius:3px">전송</button>
    `;
    document.body.appendChild(wrap);
    const inp = document.getElementById('chat-inp');
    inp.focus();
    const send = () => {
      const t = inp.value.trim();
      if (t) this.net.sendChat(t);
      wrap.remove();
      this.canvas.requestPointerLock();
    };
    inp.addEventListener('keydown', e => {
      if (e.code==='Enter')  send();
      if (e.code==='Escape') { wrap.remove(); this.canvas.requestPointerLock(); }
      e.stopPropagation();
    });
    wrap.querySelector('button').addEventListener('click', send);
  }

  // ── Network callbacks ────────────────────────────────────────

  _setupNet() {
    this.net.onWelcome    = (msg) => {
      this.myId    = msg.playerId;
      this.myTeam  = msg.team;
      this.score   = msg.score || { red:0, blue:0 };
      this.roundTimer = Math.max(0, (msg.roundEnd - Date.now()) / 1000);
      this.hud.setScore(this.score.red, this.score.blue);
      if (msg.spawn) {
        this.phys.pos = { x:msg.spawn.x, y:msg.spawn.y, z:msg.spawn.z };
      }
    };

    this.net.onKill       = (msg) => {
      this.score = msg.score || this.score;
      this.hud.setScore(this.score.red, this.score.blue);
      this.hud.addKill(msg.killerName, msg.victimName);
    };

    this.net.onDamage     = (msg) => {
      this._takeDamage(msg.damage, msg.fromName);
    };

    this.net.onHitConfirm = (msg) => {
      this.hud.showHitMarker(msg.killed);
    };

    this.net.onRespawn    = (msg) => {
      if (msg.spawn) {
        this.phys.pos = { x:msg.spawn.x, y:msg.spawn.y, z:msg.spawn.z };
        this.phys.health = msg.health ?? 100;
        this.phys.alive  = true;
        this.hud.setHealth(this.phys.health);
        this.hud.hideRespawn();
      }
    };

    this.net.onChat       = (msg) => {
      this.hud.addChat(msg.from, msg.team, msg.text);
    };

    this.net.onRoundEnd   = (msg) => {
      const myWin = (msg.winner==='red'&&this.myTeam==='red')||(msg.winner==='blue'&&this.myTeam==='blue');
      this.hud.notify(myWin?'🏆 VICTORY!':'💀 DEFEAT', myWin?'#ffdd00':'#ff4444');
    };

    this.net.onRoundStart = (msg) => {
      this.roundTimer = Math.max(0, (msg.roundEnd - Date.now()) / 1000);
      this.score = { red:0, blue:0 };
      this.hud.setScore(0, 0);
    };

    this.net.onShoot = (msg) => {
      // Spawn remote bullet tracer
      this.bullets.push({
        x: msg.x + msg.dx*2, y: msg.y + msg.dy*2, z: msg.z + msg.dz*2,
        ox: msg.x, oy: msg.y, oz: msg.z,
        vx: msg.dx*35, vy: msg.dy*35, vz: msg.dz*35,
        life: 0.45, team:'remote', owner: msg.id,
      });
    };

    this.net.onError = (msg) => {
      if (msg.code === 'ROOM_FULL') {
        this.hud.notify('서버 가득 참!', '#ff4444');
        setTimeout(() => this._returnToMenu(), 1500);
      }
    };
  }

  _setupMenu() {
    this.menu.onPlay = (server) => this._startGame(server);
  }

  // ── Particles ────────────────────────────────────────────────

  _spawnHitParticles(x, y, z, blockType) {
    const { BLOCK_COLOR } = this.map.constructor ? {} : {};
    for (let i = 0; i < 7; i++) {
      this.particles.push({
        x, y, z,
        vx:(Math.random()-.5)*7, vy:Math.random()*5, vz:(Math.random()-.5)*7,
        r:140,g:120,b:100, life:1,
      });
    }
  }

  _spawnBloodParticles(x, y, z) {
    for (let i = 0; i < 12; i++) {
      this.particles.push({
        x, y, z,
        vx:(Math.random()-.5)*9, vy:Math.random()*7, vz:(Math.random()-.5)*9,
        r:190+Math.random()*40, g:20, b:20, life:1,
      });
    }
  }
}
