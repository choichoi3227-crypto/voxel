(function(){
// VOXEL STRIKE — Bundled 2026-06-27T01:57:35.253Z
'use strict';


// ── game/map.js ──
// src/game/map.js
// ─────────────────────────────────────────────────────────────
// Voxel world: block data, generation, raycasting queries
// Block types:
//   0 = air    1 = grass    2 = brick    3 = stone
//   4 = metal  5 = wood     6 = dirt     7 = concrete
// ─────────────────────────────────────────────────────────────

const BLOCK = { AIR:0, GRASS:1, BRICK:2, STONE:3, METAL:4, WOOD:5, DIRT:6, CONCRETE:7 };

const BLOCK_COLOR = [
  null,
  // face colors [top, side-light, side-dark] as [r,g,b]
  { top:[72,148,52],  sl:[62,128,42],  sd:[52,108,36]  }, // 1 GRASS
  { top:[110,85,60],  sl:[95,70,50],   sd:[80,58,42]   }, // 2 BRICK
  { top:[110,115,125],sl:[95,100,110], sd:[80,85,95]   }, // 3 STONE
  { top:[140,150,160],sl:[120,130,140],sd:[100,110,120]}, // 4 METAL
  { top:[160,115,65], sl:[140,95,50],  sd:[120,78,38]  }, // 5 WOOD
  { top:[100,80,50],  sl:[85,68,42],   sd:[72,58,36]   }, // 6 DIRT
  { top:[130,130,135],sl:[115,115,120],sd:[100,100,105]}, // 7 CONCRETE
];

const W = 64, H = 10, D = 64;

class GameMap {
  constructor() {
    this.W = W; this.H = H; this.D = D;
    this.data = new Uint8Array(W * H * D);
    this.spawnPoints = [];
    this._generate();
  }

  get(x, y, z) {
    x=Math.floor(x); y=Math.floor(y); z=Math.floor(z);
    if (x<0||x>=W||y<0||y>=H||z<0||z>=D) return BLOCK.STONE;
    return this.data[x*H*D + y*D + z];
  }

  set(x, y, z, type) {
    if (x<0||x>=W||y<0||y>=H||z<0||z>=D) return;
    this.data[x*H*D + y*D + z] = type;
  }

  isSolid(x, y, z) { return this.get(x,y,z) !== BLOCK.AIR; }

  floorY(x, z) {
    for (let y = H-1; y >= 0; y--) {
      if (this.isSolid(Math.floor(x), y, Math.floor(z))) return y + 1;
    }
    return 0;
  }

  /** DDA ray cast. Returns { hit, x, y, z, face, dist, type } */
  castRay(ox, oy, oz, dx, dy, dz, maxDist = 80) {
    let mx=Math.floor(ox), my=Math.floor(oy), mz=Math.floor(oz);
    const lenXZ = Math.sqrt(dx*dx+dz*dz);
    const deltaX = lenXZ>0 ? Math.abs(1/dx) : 1e30;
    const deltaZ = lenXZ>0 ? Math.abs(1/dz) : 1e30;
    const deltaY = Math.abs(dy)>0 ? Math.abs(1/dy) : 1e30;
    const stepX = dx<0?-1:1, stepZ = dz<0?-1:1, stepY = dy<0?-1:1;
    let sdX = (dx<0 ? ox-mx : mx+1-ox)*deltaX;
    let sdZ = (dz<0 ? oz-mz : mz+1-oz)*deltaZ;
    let sdY = (dy<0 ? oy-my : my+1-oy)*deltaY;
    let face=0, dist=0;

    for (let i=0; i<180 && dist<maxDist; i++) {
      // advance smallest
      if (sdX < sdZ && sdX < sdY) { dist=sdX; sdX+=deltaX; mx+=stepX; face=0; }
      else if (sdY < sdZ)          { dist=sdY; sdY+=deltaY; my+=stepY; face=1; }
      else                         { dist=sdZ; sdZ+=deltaZ; mz+=stepZ; face=2; }

      if (my<0||my>=H) break;
      const type = this.get(mx,my,mz);
      if (type !== BLOCK.AIR) {
        return { hit:true, x:mx, y:my, z:mz, face, dist, type };
      }
    }
    return { hit:false, x:0, y:0, z:0, face:0, dist:maxDist, type:0 };
  }

  // ─── Map generation ──────────────────────────────────────────
  _generate() {
    const set = this.set.bind(this);

    // Ground floor: grass on top, dirt below
    for (let x=0;x<W;x++) for (let z=0;z<D;z++) {
      set(x,0,z,BLOCK.GRASS);
    }

    // Outer concrete boundary walls
    for (let x=0;x<W;x++) for (let y=0;y<H;y++) {
      set(x,y,0,BLOCK.CONCRETE); set(x,y,D-1,BLOCK.CONCRETE);
    }
    for (let z=0;z<D;z++) for (let y=0;y<H;y++) {
      set(0,y,z,BLOCK.CONCRETE); set(W-1,y,z,BLOCK.CONCRETE);
    }

    // ── Central fortified building ──────────────────────────
    this._box(26,0,26, 12,5,12, BLOCK.BRICK);
    // Interior (hollow)
    this._box(27,1,27, 10,4,10, BLOCK.AIR);
    // Roof
    this._box(26,5,26, 12,1,12, BLOCK.METAL);
    // Doors (4 sides)
    for (const [dx,dz] of [[0,4],[0,7],[4,0],[7,0],[11,4],[11,7],[4,11],[7,11]]) {
      set(26+dx,1,26+dz,BLOCK.AIR); set(26+dx,2,26+dz,BLOCK.AIR);
    }
    // Windows (each wall)
    for (let i=2;i<10;i+=3) {
      set(26,3,26+i,BLOCK.AIR); set(37,3,26+i,BLOCK.AIR);
      set(26+i,3,26,BLOCK.AIR); set(26+i,3,37,BLOCK.AIR);
    }
    // Second-floor interior ledge
    this._box(27,4,27, 10,1,2,  BLOCK.CONCRETE);
    this._box(27,4,35, 10,1,2,  BLOCK.CONCRETE);
    this._box(27,4,27, 2,1,10,  BLOCK.CONCRETE);
    this._box(35,4,27, 2,1,10,  BLOCK.CONCRETE);

    // ── Sniper tower NW ─────────────────────────────────────
    this._box(3,0,28, 5,7,5, BLOCK.STONE);
    this._box(4,1,29, 3,6,3, BLOCK.AIR);  // hollow
    // Battlements
    for (let i=0;i<5;i+=2) {
      set(3,7,28+i,BLOCK.STONE); set(7,7,28+i,BLOCK.STONE);
      set(3+i,7,28,BLOCK.STONE); set(3+i,7,32,BLOCK.STONE);
    }
    // Stairs (zigzag ramp)
    for (let i=0;i<7;i++) set(8+i,i,28+i%3, BLOCK.STONE);

    // ── Bunker SE ────────────────────────────────────────────
    this._box(50,0,46, 8,3,8, BLOCK.METAL);
    this._box(51,1,47, 6,2,6, BLOCK.AIR);
    set(50,1,50,BLOCK.AIR); set(50,2,50,BLOCK.AIR); // entrance
    set(58,1,50,BLOCK.AIR); set(58,2,50,BLOCK.AIR);
    // Roof hatches
    set(52,3,49,BLOCK.AIR); set(55,3,49,BLOCK.AIR);

    // ── Cover objects scattered ──────────────────────────────
    // NW crates
    this._box(8, 0,8,  3,2,3, BLOCK.WOOD);
    this._box(12,0,8,  2,1,2, BLOCK.WOOD);
    // NE crates
    this._box(52,0,8,  3,2,3, BLOCK.WOOD);
    this._box(56,0,12, 2,1,3, BLOCK.WOOD);
    // SW crates
    this._box(8, 0,52, 3,2,3, BLOCK.WOOD);
    this._box(8, 0,56, 2,1,2, BLOCK.WOOD);
    // Mid-field barriers (long)
    this._box(16,0,18, 1,2,14, BLOCK.CONCRETE);
    this._box(47,0,18, 1,2,14, BLOCK.CONCRETE);
    this._box(16,0,32, 1,2,14, BLOCK.CONCRETE);
    this._box(47,0,32, 1,2,14, BLOCK.CONCRETE);
    // Destroyed wall fragments
    this._box(22,0,22, 4,1,1, BLOCK.BRICK);
    set(22,1,22,BLOCK.BRICK); set(24,1,22,BLOCK.BRICK);
    this._box(38,0,22, 4,1,1, BLOCK.BRICK);
    this._box(22,0,42, 4,1,1, BLOCK.BRICK);
    this._box(38,0,42, 4,1,1, BLOCK.BRICK);

    // ── Underground tunnel (ditch) ───────────────────────────
    for (let x=20;x<44;x++) { set(x,0,32,BLOCK.AIR); } // trench floor
    for (let x=20;x<44;x++) { set(x,1,32,BLOCK.AIR); }

    // ── Rooftop platform (mid-height cover) ─────────────────
    this._box(24,3,22, 4,1,4, BLOCK.METAL);
    this._box(36,3,22, 4,1,4, BLOCK.METAL);
    this._box(24,3,38, 4,1,4, BLOCK.METAL);
    this._box(36,3,38, 4,1,4, BLOCK.METAL);

    // ── Spawn zones (floors already set) ────────────────────
    this.spawnPoints = [
      { x:4,  y:1, z:4,  team:'red'  },
      { x:6,  y:1, z:4,  team:'red'  },
      { x:5,  y:1, z:7,  team:'red'  },
      { x:7,  y:1, z:6,  team:'red'  },
      { x:58, y:1, z:58, team:'blue' },
      { x:56, y:1, z:58, team:'blue' },
      { x:58, y:1, z:55, team:'blue' },
      { x:56, y:1, z:56, team:'blue' },
    ];
  }

  _box(x0,y0,z0, w,h,d, type) {
    for (let x=x0;x<x0+w;x++) for (let y=y0;y<y0+h;y++) for (let z=z0;z<z0+d;z++)
      this.set(x,y,z,type);
  }
}


// ── game/weapons.js ──
// src/game/weapons.js
// ─────────────────────────────────────────────────────────────
// Weapon data & shoot-logic helpers (client side)
// ─────────────────────────────────────────────────────────────

const WEAPONS = {
  ak47: {
    id: 'ak47', name: 'AK-47',
    damage: 28, headshotMult: 2.5,
    rof: 600,        // rounds per minute
    spread: 0.04,    // rad base spread
    spreadInc: 0.008,// spread added per shot
    spreadMax: 0.14,
    spreadDecay: 6,  // rad/s recovery
    reloadTime: 2.1, // seconds
    mag: 30, reserve: 90,
    auto: true,
    range: 80,       // effective range (world units)
    pellets: 1,
    kickX: 0.4, kickY: 1.2,  // recoil in degrees
    drawTime: 0.35,
    slot: 1,
  },
  m4a1: {
    id: 'm4a1', name: 'M4A1',
    damage: 24, headshotMult: 2.5,
    rof: 700, spread: 0.03, spreadInc: 0.006,
    spreadMax: 0.12, spreadDecay: 7,
    reloadTime: 1.9, mag: 30, reserve: 90,
    auto: true, range: 90, pellets: 1,
    kickX: 0.3, kickY: 1.0, drawTime: 0.3, slot: 1,
  },
  awp: {
    id: 'awp', name: 'AWP',
    damage: 120, headshotMult: 1.0,
    rof: 50, spread: 0.001, spreadInc: 0.02,
    spreadMax: 0.05, spreadDecay: 3,
    reloadTime: 3.2, mag: 5, reserve: 20,
    auto: false, range: 200, pellets: 1,
    kickX: 0.0, kickY: 3.5, drawTime: 0.7, slot: 3,
    scopeZoom: 4.0,
  },
  mp5: {
    id: 'mp5', name: 'MP5',
    damage: 18, headshotMult: 2.0,
    rof: 900, spread: 0.06, spreadInc: 0.005,
    spreadMax: 0.18, spreadDecay: 8,
    reloadTime: 1.5, mag: 30, reserve: 120,
    auto: true, range: 40, pellets: 1,
    kickX: 0.2, kickY: 0.7, drawTime: 0.25, slot: 2,
  },
  shotgun: {
    id: 'shotgun', name: 'SPAS-12',
    damage: 15, headshotMult: 1.5,
    rof: 70, spread: 0.15, spreadInc: 0,
    spreadMax: 0.15, spreadDecay: 10,
    reloadTime: 0.5, mag: 8, reserve: 32,
    auto: false, range: 20, pellets: 9,
    kickX: 0.0, kickY: 4.0, drawTime: 0.45, slot: 2,
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle',
    damage: 55, headshotMult: 2.0,
    rof: 200, spread: 0.05, spreadInc: 0.015,
    spreadMax: 0.12, spreadDecay: 5,
    reloadTime: 1.8, mag: 7, reserve: 35,
    auto: false, range: 60, pellets: 1,
    kickX: 0.6, kickY: 2.0, drawTime: 0.3, slot: 4,
  },

  beryl: { id:'beryl', name:'Beryl M762', damage:31, headshotMult:2.35, rof:700, spread:0.05, spreadInc:0.010, spreadMax:0.18, spreadDecay:5.5, reloadTime:2.4, mag:30, reserve:120, auto:true, range:95, pellets:1, kickX:0.55, kickY:1.55, drawTime:0.38, slot:1 },
  sks: { id:'sks', name:'SKS', damage:53, headshotMult:2.2, rof:240, spread:0.018, spreadInc:0.012, spreadMax:0.11, spreadDecay:4, reloadTime:2.6, mag:10, reserve:60, auto:false, range:180, pellets:1, kickX:0.35, kickY:2.0, drawTime:0.55, slot:3, scopeZoom:2.5 },
  kar98: { id:'kar98', name:'Kar98k', damage:95, headshotMult:2.4, rof:42, spread:0.002, spreadInc:0.018, spreadMax:0.05, spreadDecay:3, reloadTime:3.6, mag:5, reserve:25, auto:false, range:220, pellets:1, kickX:0.1, kickY:3.1, drawTime:0.75, slot:3, scopeZoom:5.0 },
  vector: { id:'vector', name:'Vector', damage:16, headshotMult:2.0, rof:1100, spread:0.055, spreadInc:0.004, spreadMax:0.17, spreadDecay:9, reloadTime:1.7, mag:25, reserve:125, auto:true, range:45, pellets:1, kickX:0.18, kickY:0.55, drawTime:0.22, slot:2 },
  ump45: { id:'ump45', name:'UMP45', damage:22, headshotMult:2.0, rof:650, spread:0.045, spreadInc:0.006, spreadMax:0.15, spreadDecay:7, reloadTime:2.0, mag:30, reserve:120, auto:true, range:55, pellets:1, kickX:0.22, kickY:0.8, drawTime:0.28, slot:2 },
  m249: { id:'m249', name:'M249', damage:26, headshotMult:2.15, rof:750, spread:0.06, spreadInc:0.007, spreadMax:0.20, spreadDecay:4, reloadTime:5.8, mag:100, reserve:200, auto:true, range:110, pellets:1, kickX:0.42, kickY:1.3, drawTime:0.9, slot:1 },
};

const WEAPON_SLOTS = {
  1: ['ak47', 'm4a1', 'beryl', 'm249'],
  2: ['mp5', 'shotgun', 'vector', 'ump45'],
  3: ['awp', 'sks', 'kar98'],
  4: ['deagle'],
};

/** State for one weapon instance in the player's hands */
class WeaponState {
  constructor(id) {
    this.id       = id;
    this.def      = WEAPONS[id];
    this.ammo     = this.def.mag;
    this.reserve  = this.def.reserve;
    this.spread   = this.def.spread;
    this.reloading = false;
    this.reloadTimer = 0;
    this.canShoot  = true;
    this.shootTimer = 0;
    this.drawTimer  = 0;   // time until fully drawn
    this.recoilX    = 0;
    this.recoilY    = 0;
    this.scopedIn   = false;
    this._autoHeld  = false;
    this._reloadCb  = null;
  }

  /** Returns true if a shot was fired */
  tryShoot(autoHeld = false) {
    if (this.drawTimer > 0)   return false;
    if (this.reloading)        return false;
    if (!this.canShoot)        return false;
    if (this.ammo <= 0)        { this.startReload(); return false; }
    if (!this.def.auto && autoHeld) return false;

    this.ammo--;
    this.canShoot   = false;
    this.shootTimer = 60 / this.def.rof;
    this.spread     = Math.min(this.def.spreadMax, this.spread + this.def.spreadInc);
    this.recoilX   += (Math.random() - 0.5) * this.def.kickX;
    this.recoilY   += this.def.kickY;
    return true;
  }

  startReload() {
    if (this.reloading || this.reserve <= 0 || this.ammo >= this.def.mag) return;
    this.reloading  = true;
    this.reloadTimer = this.def.reloadTime;
    this.scopedIn   = false;
  }

  update(dt) {
    // Shoot cooldown
    if (!this.canShoot) {
      this.shootTimer -= dt;
      if (this.shootTimer <= 0) { this.canShoot = true; this.shootTimer = 0; }
    }
    // Spread recovery
    if (this.spread > this.def.spread) {
      this.spread = Math.max(this.def.spread, this.spread - this.def.spreadDecay * dt);
    }
    // Recoil recovery
    this.recoilY = Math.max(0, this.recoilY - dt * 12);
    this.recoilX *= Math.pow(0.05, dt);
    // Reload
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading   = false;
        this.reloadTimer = 0;
        const need = this.def.mag - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo    += take;
        this.reserve -= take;
      }
    }
    // Draw
    if (this.drawTimer > 0) this.drawTimer = Math.max(0, this.drawTimer - dt);
  }

  /** Get spread directions for one shot (returns array of {dx,dy,dz} length=pellets) */
  getShootVectors(yaw, pitch) {
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const spread = this.scopedIn ? this.def.spread * 0.1 : this.spread;
    const vecs = [];
    for (let i = 0; i < this.def.pellets; i++) {
      const sx = (Math.random() - 0.5) * 2 * spread;
      const sy = (Math.random() - 0.5) * 2 * spread;
      vecs.push({
        dx: sinY * cosP + sx,
        dy: sinP + sy,
        dz: cosY * cosP + (Math.random() - 0.5) * 2 * spread,
      });
    }
    return vecs;
  }
}


// ── game/physics.js ──
// src/game/physics.js
// ─────────────────────────────────────────────────────────────
// Player physics: movement, collision, gravity, crouch, jump
// ─────────────────────────────────────────────────────────────

const GRAVITY        = 22;
const JUMP_VEL       = 8.5;
const MOVE_SPEED     = 6.0;
const SPRINT_MULT    = 1.65;
const CROUCH_MULT    = 0.5;
const PLAYER_RADIUS  = 0.3;
const PLAYER_HEIGHT  = 1.75;
const CROUCH_HEIGHT  = 1.0;
const EYE_OFFSET     = 0.85;   // fraction of player height
const STEP_HEIGHT    = 0.45;   // auto-step over low edges
const AIR_CONTROL    = 0.35;   // fraction of normal control in air
const FRICTION       = 18;     // ground friction coefficient

class PlayerPhysics {
  constructor(map) {
    this.map = map;
    this.pos        = { x: 8, y: 2, z: 8 };
    this.vel        = { x: 0, y: 0, z: 0 };
    this.onGround   = false;
    this.crouching  = false;
    this.sprinting  = false;
    this.health     = 100;
    this.alive      = true;

    // bob
    this.bobPhase   = 0;
    this.bobAmt     = 0;

    // landing shake
    this.landShake  = 0;
  }

  get eyeY() {
    const h = this.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    return this.pos.y + h * EYE_OFFSET + Math.sin(this.bobPhase) * this.bobAmt * 0.22 - this.landShake;
  }

  update(dt, keys, yaw) {
    if (!this.alive) return;

    this.crouching = !!(keys['KeyC'] || keys['ControlLeft']);
    this.sprinting = !!(keys['ShiftLeft']) && !this.crouching;

    const speed = MOVE_SPEED
      * (this.sprinting ? SPRINT_MULT : 1)
      * (this.crouching ? CROUCH_MULT : 1)
      * (this.onGround  ? 1 : AIR_CONTROL);

    // Input vector
    let mx = 0, mz = 0;
    if (keys['KeyW'] || keys['ArrowUp'])    { mx += Math.sin(yaw); mz += Math.cos(yaw); }
    if (keys['KeyS'] || keys['ArrowDown'])  { mx -= Math.sin(yaw); mz -= Math.cos(yaw); }
    if (keys['KeyA'] || keys['ArrowLeft'])  { mx -= Math.cos(yaw); mz += Math.sin(yaw); }
    if (keys['KeyD'] || keys['ArrowRight']) { mx += Math.cos(yaw); mz -= Math.sin(yaw); }

    const len = Math.sqrt(mx * mx + mz * mz);
    if (len > 0) { mx /= len; mz /= len; }
    const moving = len > 0;

    // Apply movement (with step-up)
    const dx = mx * speed * dt;
    const dz = mz * speed * dt;
    this._moveAndSlide(dx, 0, dz);

    // Gravity
    if (this.onGround && (keys['Space'] || keys['KeyF'])) {
      this.vel.y = JUMP_VEL;
      this.onGround = false;
    }
    if (!this.onGround) this.vel.y -= GRAVITY * dt;
    else {
      // Ground friction on horizontal vel
      const fric = Math.pow(FRICTION * dt, 2);
      this.vel.x *= Math.max(0, 1 - fric);
      this.vel.z *= Math.max(0, 1 - fric);
    }

    // Vertical movement
    this._applyGravity(dt);

    // Head bob
    const targetBob = moving && this.onGround ? 1 : 0;
    this.bobAmt += (targetBob - this.bobAmt) * Math.min(1, dt * 8);
    if (moving) this.bobPhase += dt * (this.sprinting ? 14 : 9);

    // Landing shake decay
    if (this.landShake > 0) this.landShake = Math.max(0, this.landShake - dt * 8);
  }

  _moveAndSlide(dx, dy, dz) {
    const { map } = this;
    // Try X
    if (!this._collides(this.pos.x + dx, this.pos.y, this.pos.z)) {
      this.pos.x += dx;
    } else if (!this._collides(this.pos.x + dx, this.pos.y + STEP_HEIGHT, this.pos.z)) {
      // Step up
      this.pos.x += dx;
      this.pos.y += STEP_HEIGHT;
    }
    // Try Z
    if (!this._collides(this.pos.x, this.pos.y, this.pos.z + dz)) {
      this.pos.z += dz;
    } else if (!this._collides(this.pos.x, this.pos.y + STEP_HEIGHT, this.pos.z + dz)) {
      this.pos.z += dz;
      this.pos.y += STEP_HEIGHT;
    }

    // Clamp to map
    this.pos.x = Math.max(0.5, Math.min(this.map.W - 0.5, this.pos.x));
    this.pos.z = Math.max(0.5, Math.min(this.map.D - 0.5, this.pos.z));
  }

  _applyGravity(dt) {
    const newY = this.pos.y + this.vel.y * dt;
    const floor = this._floorY(this.pos.x, this.pos.z);
    const wasGround = this.onGround;

    if (newY <= floor) {
      const fallSpeed = -this.vel.y;
      this.pos.y    = floor;
      this.vel.y    = 0;
      this.onGround = true;
      if (!wasGround && fallSpeed > 8) {
        this.landShake = Math.min(0.3, (fallSpeed - 8) * 0.02);
        // Fall damage
        if (fallSpeed > 18) this.health -= Math.floor((fallSpeed - 18) * 4);
      }
    } else {
      this.pos.y    = newY;
      this.onGround = false;
    }
    // Head ceiling
    const ceil = this._ceilY(this.pos.x, this.pos.z, this.pos.y);
    const h    = this.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    if (this.pos.y + h > ceil) {
      this.pos.y = ceil - h;
      if (this.vel.y > 0) this.vel.y = 0;
    }
  }

  _collides(x, y, z) {
    const { map } = this;
    const r = PLAYER_RADIUS;
    const h = this.crouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    for (let dy = 0; dy < h; dy += 0.5) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const bx = Math.floor(x + dx * r), by = Math.floor(y + dy), bz = Math.floor(z + dz * r);
        if (!map.isSolid(bx, by, bz)) continue;
        // AABB overlap
        if (Math.abs(x - (bx + 0.5)) < r + 0.5 && Math.abs(z - (bz + 0.5)) < r + 0.5) return true;
      }
    }
    return false;
  }

  _floorY(x, z) {
    const { map } = this;
    for (let y = map.H - 1; y >= 0; y--) {
      if (map.isSolid(Math.floor(x), y, Math.floor(z))) return y + 1;
    }
    return 0;
  }

  _ceilY(x, z, fromY) {
    const { map } = this;
    for (let y = Math.ceil(fromY); y < map.H; y++) {
      if (map.isSolid(Math.floor(x), y, Math.floor(z))) return y;
    }
    return map.H;
  }
}


// ── game/bots.js ──
// src/game/bots.js
// ─────────────────────────────────────────────────────────────
// Bot AI — finite state machine
//   States: patrol → alert → chase → combat → retreat → dead
// ─────────────────────────────────────────────────────────────

const BOT_NAMES = [
  'Shadow','Reaper','Ghost','Viper','Storm','Blade',
  'Frost','Thunder','Hawk','Wolf','Raven','Serpent',
];

const STATES = { PATROL:'patrol', ALERT:'alert', CHASE:'chase', COMBAT:'combat', RETREAT:'retreat', DEAD:'dead' };
const BOT_SPEED    = { patrol: 3, alert: 4, chase: 5.5, retreat: 5.5 };
const SHOOT_RANGE  = 30;
const SIGHT_RANGE  = 45;
const ALERT_RANGE  = 55;
const THINK_RATE   = 0.3;   // seconds between AI decisions
const RETREAT_HP   = 25;    // HP threshold to trigger retreat

class BotManager {
  constructor(map, spawnPoints) {
    this.map         = map;
    this.spawnPoints = spawnPoints;
    this.bots        = [];
    this._particles  = [];  // inject particles externally via setter
    this._bullets    = [];
  }

  /** Called by game on init */
  spawn(count = 9) {
    this.bots = [];
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const team  = i < Math.ceil(count / 2) ? 'red' : 'blue';
      const sp    = this._getSpawn(team);
      const weaponList = ['ak47','m4a1','mp5','deagle','shotgun'];
      const weapon = weaponList[Math.floor(Math.random() * 3)]; // mostly rifles
      this.bots.push({
        id:           'bot_' + Math.random().toString(36).slice(2, 8),
        name:         names[i] || 'Bot' + i,
        team,
        x: sp.x, y: sp.y, z: sp.z,
        yaw: Math.random() * Math.PI * 2,
        vel: { y: 0 },
        onGround: true,
        health: 100, armor: Math.random() < 0.5 ? 50 : 0,
        weapon,
        state: STATES.PATROL,
        target: null,
        kills: 0, deaths: 0,
        // Timers
        thinkTimer:  Math.random() * THINK_RATE,
        shootTimer:  0,
        stuckTimer:  0,
        retreatTimer: 0,
        // Nav
        navTarget: { x: sp.x, z: sp.z },
        prevPos:   { x: sp.x, z: sp.z },
        stuckCounter: 0,
        // Aimbot accuracy (0=terrible, 1=perfect) — varies per bot
        accuracy: 0.3 + Math.random() * 0.45,
        reactionTime: 0.3 + Math.random() * 0.5,
        reactionTimer: 0,
      });
    }
    return this.bots;
  }

  update(dt, playerPos, playerTeam, playerHealth, onDamagePlayer, onKillFeed) {
    for (const bot of this.bots) {
      if (bot.state === STATES.DEAD) continue;
      this._updateBot(bot, dt, playerPos, playerTeam, playerHealth, onDamagePlayer, onKillFeed);
    }
  }

  _updateBot(bot, dt, playerPos, playerTeam, playerHealth, onDamagePlayer, onKillFeed) {
    // Gravity
    if (!bot.onGround) bot.vel.y -= 22 * dt;
    bot.y += bot.vel.y * dt;
    const floor = this.map.floorY(bot.x, bot.z);
    if (bot.y <= floor) { bot.y = floor; bot.vel.y = 0; bot.onGround = true; }
    else bot.onGround = false;

    bot.thinkTimer -= dt;
    bot.shootTimer  -= dt;
    if (bot.reactionTimer > 0) bot.reactionTimer -= dt;

    if (bot.thinkTimer <= 0) {
      bot.thinkTimer = THINK_RATE + Math.random() * 0.2;
      this._think(bot, playerPos, playerTeam, playerHealth);
    }

    this._move(bot, dt);
    this._shoot(bot, dt, playerPos, playerTeam, playerHealth, onDamagePlayer, onKillFeed);
  }

  _think(bot, playerPos, playerTeam, playerHealth) {
    const wep = WEAPONS[bot.weapon];

    // Find nearest enemy
    let nearest = null, nearDist = ALERT_RANGE;

    // Check player
    if (bot.team !== playerTeam && playerHealth > 0) {
      const d = dist2d(bot, playerPos);
      if (d < nearDist) { nearest = 'player'; nearDist = d; }
    }
    // Check other bots
    for (const other of this.bots) {
      if (other === bot || other.state === STATES.DEAD || other.team === bot.team) continue;
      const d = dist2d(bot, other);
      if (d < nearDist) { nearest = other; nearDist = d; }
    }

    // Retreat if low health
    if (bot.health < RETREAT_HP && nearest) {
      bot.state = STATES.RETREAT;
      bot.retreatTimer = 3 + Math.random() * 2;
      // Run away from nearest
      const tx = nearest === 'player' ? playerPos.x : nearest.x;
      const tz = nearest === 'player' ? playerPos.z : nearest.z;
      const angle = Math.atan2(bot.x - tx, bot.z - tz);
      bot.navTarget = {
        x: clamp(bot.x + Math.sin(angle) * 12, 2, this.map.W - 2),
        z: clamp(bot.z + Math.cos(angle) * 12, 2, this.map.D - 2),
      };
      return;
    }

    if (bot.state === STATES.RETREAT) {
      bot.retreatTimer -= THINK_RATE;
      if (bot.retreatTimer <= 0) bot.state = STATES.PATROL;
    }

    if (!nearest) {
      // Patrol: random waypoint
      if (bot.state !== STATES.PATROL || dist2d(bot, bot.navTarget) < 2) {
        bot.state = STATES.PATROL;
        bot.navTarget = {
          x: 4 + Math.random() * (this.map.W - 8),
          z: 4 + Math.random() * (this.map.D - 8),
        };
      }
      bot.target = null;
      return;
    }

    bot.target = nearest;

    if (nearDist < SHOOT_RANGE) {
      bot.state = STATES.COMBAT;
      // Set nav target to strafe around enemy
      const tx = nearest === 'player' ? playerPos.x : nearest.x;
      const tz = nearest === 'player' ? playerPos.z : nearest.z;
      const angleToEnemy = Math.atan2(tx - bot.x, tz - bot.z);
      const strafe = Math.random() < 0.5 ? 1 : -1;
      bot.navTarget = {
        x: clamp(tx + Math.cos(angleToEnemy + strafe * Math.PI / 2) * 6, 2, this.map.W - 2),
        z: clamp(tz - Math.sin(angleToEnemy + strafe * Math.PI / 2) * 6, 2, this.map.D - 2),
      };
    } else {
      bot.state = STATES.CHASE;
      // Chase: move toward enemy
      const tx = nearest === 'player' ? playerPos.x : nearest.x;
      const tz = nearest === 'player' ? playerPos.z : nearest.z;
      bot.navTarget = { x: tx, z: tz };
    }

    // React time before shooting
    if (bot.reactionTimer <= 0 && nearest) {
      bot.reactionTimer = bot.reactionTime;
    }
  }

  _move(bot, dt) {
    const speed = (BOT_SPEED[bot.state] || BOT_SPEED.patrol) * dt;
    const d     = dist2d(bot, bot.navTarget);
    if (d < 0.5) return;

    const nx = (bot.navTarget.x - bot.x) / d;
    const nz = (bot.navTarget.z - bot.z) / d;
    bot.yaw   = Math.atan2(nx, nz);

    // Slide along walls
    const newX = bot.x + nx * speed;
    const newZ = bot.z + nz * speed;

    if (!this.map.isSolid(Math.floor(newX), Math.floor(bot.y), Math.floor(bot.z))) bot.x = newX;
    else { // Try perpendicular
      const perpX = bot.x - nz * speed;
      if (!this.map.isSolid(Math.floor(perpX), Math.floor(bot.y), Math.floor(bot.z))) bot.x = perpX;
    }
    if (!this.map.isSolid(Math.floor(bot.x), Math.floor(bot.y), Math.floor(newZ))) bot.z = newZ;
    else {
      const perpZ = bot.z + nx * speed;
      if (!this.map.isSolid(Math.floor(bot.x), Math.floor(bot.y), Math.floor(perpZ))) bot.z = perpZ;
    }

    bot.x = clamp(bot.x, 0.5, this.map.W - 0.5);
    bot.z = clamp(bot.z, 0.5, this.map.D - 0.5);
  }

  _shoot(bot, dt, playerPos, playerTeam, playerHealth, onDamagePlayer, onKillFeed) {
    if (bot.state !== STATES.COMBAT) return;
    if (bot.shootTimer > 0) return;
    if (!bot.target) return;
    if (bot.reactionTimer > 0) return;  // still reacting

    const wep = WEAPONS[bot.weapon];
    bot.shootTimer = 60 / wep.rof + Math.random() * 0.1;

    const tx = bot.target === 'player' ? playerPos.x : bot.target.x;
    const ty = bot.target === 'player' ? (playerPos.y + 1.4) : (bot.target.y + 0.9);
    const tz = bot.target === 'player' ? playerPos.z : bot.target.z;
    const dx = tx - bot.x, dy = ty - (bot.y + 0.9), dz = tz - bot.z;
    const d  = Math.sqrt(dx*dx+dy*dy+dz*dz);
    if (d === 0) return;

    // Accuracy degrades with distance
    const distFactor = Math.max(0, 1 - d / wep.range);
    const hit        = Math.random() < bot.accuracy * distFactor;

    // Bullet tracer visual
    if (this._bullets) {
      for (let p = 0; p < wep.pellets; p++) {
        const spread = wep.spread * 1.5;
        this._bullets.push({
          x: bot.x + (dx/d)*2, y: bot.y+0.9+(dy/d)*2, z: bot.z+(dz/d)*2,
          ox: bot.x, oy: bot.y+0.9, oz: bot.z,
          vx: (dx/d+rand(spread))*35, vy: (dy/d+rand(spread))*35, vz: (dz/d+rand(spread))*35,
          life: 0.4, team: bot.team, owner: bot.id,
        });
      }
    }

    // Muzzle particles
    if (this._particles) {
      for (let i=0;i<3;i++) this._particles.push({
        x:bot.x,y:bot.y+0.9,z:bot.z,
        vx:rand(3),vy:rand(2)+1,vz:rand(3),
        r:255,g:180,b:60,life:0.5,
      });
    }

    if (hit) {
      if (bot.target === 'player' && playerHealth > 0) {
        onDamagePlayer(wep.damage, bot.name);
      } else if (bot.target && bot.target !== 'player') {
        bot.target.health -= wep.damage;
        if (bot.target.health <= 0 && bot.target.state !== STATES.DEAD) {
          bot.target.state = STATES.DEAD;
          bot.kills++;
          onKillFeed(bot.name, bot.target.name);
          this._scheduleRespawn(bot.target);
        }
      }
    }
  }

  takeDamage(botId, damage, killerName, onKillFeed) {
    const bot = this.bots.find(b => b.id === botId);
    if (!bot || bot.state === STATES.DEAD) return false;

    if (bot.armor > 0) {
      const ab = Math.min(bot.armor, Math.floor(damage * 0.5));
      bot.armor -= ab; damage -= ab;
    }
    bot.health = Math.max(0, bot.health - damage);

    if (bot.health === 0) {
      bot.state = STATES.DEAD;
      bot.deaths++;
      onKillFeed && onKillFeed(killerName, bot.name);
      this._scheduleRespawn(bot);
      return true; // killed
    }
    return false;
  }

  _scheduleRespawn(bot) {
    const delay = 4000 + Math.random() * 2000;
    setTimeout(() => {
      const sp = this._getSpawn(bot.team);
      Object.assign(bot, {
        x: sp.x, y: sp.y, z: sp.z,
        health: 100, armor: Math.random() < 0.5 ? 50 : 0,
        state: STATES.PATROL, target: null,
        vel: { y: 0 }, onGround: true,
        navTarget: { x: sp.x, z: sp.z },
      });
    }, delay);
  }

  _getSpawn(team) {
    const list = this.spawnPoints.filter(s => s.team === team);
    const sp   = list[Math.floor(Math.random() * list.length)] || { x: 8, y: 1, z: 8 };
    return { x: sp.x + rand(3), y: sp.y, z: sp.z + rand(3) };
  }
}

function dist2d(a, b) {
  return Math.sqrt((a.x-b.x)**2 + (a.z-b.z)**2);
}
function rand(r) { return (Math.random() - 0.5) * 2 * r; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }


// ── game/renderer.js ──
// src/game/renderer.js
// ─────────────────────────────────────────────────────────────
// Software raycaster renderer
//   • DDA column-by-column wall rendering
//   • Floor / ceiling projection
//   • Sprite billboard rendering (players, bots, items)
//   • Particle renderer
//   • Weapon viewmodel
//   • Post-processing: vignette, scope overlay, damage flash
// ─────────────────────────────────────────────────────────────

const FOG_START  = 18;
const FOG_END    = 55;
const SKY_TOP    = [10, 20, 40];
const SKY_BOT    = [26, 38, 72];
const FLOOR_COL  = [22, 20, 18];
const CEIL_COL   = [14, 14, 20];

class Renderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.w       = canvas.width;
    this.h       = canvas.height;
    // Pre-allocate ImageData for fast pixel writes
    this.imgData = this.ctx.createImageData(this.w, this.h);
    this.buf     = this.imgData.data;   // Uint8ClampedArray
    this.zbuf    = new Float32Array(this.w);  // depth buffer per column
    this.fov     = 75 * Math.PI / 180;
  }

  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
    this.w       = w;
    this.h       = h;
    this.imgData = this.ctx.createImageData(w, h);
    this.buf     = this.imgData.data;
    this.zbuf    = new Float32Array(w);
  }

  render(state) {
    const { pos, eyeY, yaw, pitch, map, entities, bullets, particles, weapon, scopedIn, damageAlpha, flashAlpha } = state;
    const { w, h, buf, zbuf } = this;

    // Clear depth buffer
    zbuf.fill(1e9);

    const hFOV  = Math.tan(this.fov / 2);
    const vFOV  = hFOV * (h / w);
    const cosY  = Math.cos(yaw);
    const sinY  = Math.sin(yaw);
    const pitchShift = Math.tan(pitch) * h * 0.5;

    // ── Sky & floor gradient ────────────────────────────────
    this._drawBackground(buf, w, h, pitchShift);

    // ── Wall columns (DDA) ──────────────────────────────────
    for (let col = 0; col < w; col++) {
      const sx      = (col / w) * 2 - 1;
      const rdx     = cosY * 1 - sinY * sx * hFOV;  // right = cos, forward = no turn
      // Swap: forward is +Z, right is +X, so:
      const rayDX   = sinY + cosY * sx * hFOV;
      const rayDZ   = cosY - sinY * sx * hFOV;

      this._castColumn(col, rayDX, rayDZ, pos, eyeY, yaw, pitch, pitchShift, w, h, hFOV, vFOV, map, zbuf, buf);
    }

    // Flush pixels to canvas
    this.ctx.putImageData(this.imgData, 0, 0);

    // ── Sprites (2.5D billboard) ────────────────────────────
    this._drawSprites(entities, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h, zbuf);

    // ── Bullet tracers ──────────────────────────────────────
    this._drawBullets(bullets, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h, zbuf);

    // ── Particles ───────────────────────────────────────────
    this._drawParticles(particles, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h);

    // ── Weapon viewmodel ─────────────────────────────────────
    if (!scopedIn) this._drawWeapon(weapon, w, h);

    // ── Post-processing ──────────────────────────────────────
    this._drawVignette(w, h);
    if (scopedIn)     this._drawScope(w, h);
    if (damageAlpha > 0) this._drawDamage(w, h, damageAlpha);
    if (flashAlpha  > 0) this._drawFlash(w, h, flashAlpha);
  }

  // ──────────────────────────────────────────────────────────
  _drawBackground(buf, w, h, pitchShift) {
    const horizon = Math.floor(h / 2 + pitchShift * 0.5);
    for (let y = 0; y < h; y++) {
      const isSky = y < horizon;
      const t     = isSky ? y / Math.max(1, horizon) : (y - horizon) / Math.max(1, h - horizon);
      const [r0,g0,b0] = isSky ? SKY_TOP : FLOOR_COL;
      const [r1,g1,b1] = isSky ? SKY_BOT : CEIL_COL;
      const r = Math.floor(r0 + (r1-r0)*t);
      const g = Math.floor(g0 + (g1-g0)*t);
      const b = Math.floor(b0 + (b1-b0)*t);
      const off = y * w * 4;
      for (let x = 0; x < w; x++) {
        buf[off + x*4]   = r;
        buf[off + x*4+1] = g;
        buf[off + x*4+2] = b;
        buf[off + x*4+3] = 255;
      }
    }
  }

  _castColumn(col, rayDX, rayDZ, pos, eyeY, yaw, pitch, pitchShift, w, h, hFOV, vFOV, map, zbuf, buf) {
    let mx = Math.floor(pos.x), mz = Math.floor(pos.z);
    if (Math.abs(rayDX) < 1e-9) rayDX = 1e-9;
    if (Math.abs(rayDZ) < 1e-9) rayDZ = 1e-9;
    const dX = Math.abs(1/rayDX), dZ = Math.abs(1/rayDZ);
    const stepX = rayDX < 0 ? -1 : 1, stepZ = rayDZ < 0 ? -1 : 1;
    let sdX = (rayDX < 0 ? pos.x-mx : mx+1-pos.x)*dX;
    let sdZ = (rayDZ < 0 ? pos.z-mz : mz+1-pos.z)*dZ;
    let side = 0, dist = 0;
    let hit = false, hitType = 0, stepsMade = 0;

    while (!hit && dist < FOG_END && stepsMade++ < 120) {
      if (sdX < sdZ) { sdX+=dX; mx+=stepX; side=0; dist=sdX-dX; }
      else            { sdZ+=dZ; mz+=stepZ; side=1; dist=sdZ-dZ; }
      for (let by = map.H-1; by >= 0; by--) {
        const t = map.get(mx, by, mz);
        if (t !== BLOCK.AIR) { hit=true; hitType=t; break; }
      }
    }

    if (!hit || dist < 0.01) return;

    // Store dist in zbuf for sprite clipping
    zbuf[col] = dist;

    // Fog blend
    const fogT = Math.min(1, Math.max(0, (dist - FOG_START) / (FOG_END - FOG_START)));

    // Draw all vertical slabs from tallest y down
    for (let by = map.H-1; by >= 0; by--) {
      const type = map.get(mx, by, mz);
      if (type === BLOCK.AIR) continue;

      const blockTop = by + 1;
      const blockBot = by;
      const topAngle = Math.atan2(blockTop - eyeY, dist);
      const botAngle = Math.atan2(blockBot - eyeY, dist);
      const topPx = Math.floor(h/2 - topAngle * h/(vFOV*2) - pitchShift*0.5);
      const botPx = Math.floor(h/2 - botAngle * h/(vFOV*2) - pitchShift*0.5);
      const drawH = Math.max(1, botPx - topPx);

      const bc    = BLOCK_COLOR[type];
      if (!bc) continue;
      const faceKey = side===0 ? (rayDX>0?'sd':'sl') : (rayDZ>0?'sd':'sl');
      const [br,bg,bb] = bc[faceKey] || bc.sl;

      // Fog
      const fr = Math.floor(br*(1-fogT) + SKY_BOT[0]*fogT);
      const fg = Math.floor(bg*(1-fogT) + SKY_BOT[1]*fogT);
      const fb = Math.floor(bb*(1-fogT) + SKY_BOT[2]*fogT);

      // Write pixels
      for (let py=Math.max(0,topPx); py<Math.min(h,botPx); py++) {
        const off = (py*w + col)*4;
        buf[off]  =fr; buf[off+1]=fg; buf[off+2]=fb; buf[off+3]=255;
      }
    }
  }

  _worldToScreen(wx,wy,wz, px,py,pz, yaw,pitch,pitchShift,hFOV,vFOV,w,h) {
    const dx=wx-px, dy=wy-py, dz=wz-pz;
    const cosY=Math.cos(-yaw), sinY=Math.sin(-yaw);
    const tx= cosY*dx - sinY*dz;
    const tz= sinY*dx + cosY*dz;
    const ty= dy;
    if (tz <= 0.05) return null;
    const sx = (0.5 + tx/(tz*hFOV*2))*w;
    const sy = (0.5 - ty/(tz*vFOV*2))*h - pitchShift*0.5;
    return { x:sx, y:sy, z:tz };
  }

  _drawSprites(entities, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h, zbuf) {
    const ctx = this.ctx;
    // Sort back-to-front
    const sorted = [...entities].sort((a,b)=>{
      const da=(a.x-pos.x)**2+(a.z-pos.z)**2;
      const db=(b.x-pos.x)**2+(b.z-pos.z)**2;
      return db-da;
    });

    for (const ent of sorted) {
      if (ent.health !== undefined && ent.health <= 0) continue;
      const sp = this._worldToScreen(ent.x, ent.y+0.9, ent.z, pos.x, eyeY, pos.z, yaw, pitch, pitchShift, hFOV, vFOV, w, h);
      if (!sp || sp.z>60 || sp.z<0.3) continue;
      if (sp.x<-100||sp.x>w+100) continue;
      // Clip against zbuf
      const colIdx = Math.floor(sp.x);
      if (colIdx>=0&&colIdx<w&&zbuf[colIdx]<sp.z-0.5) continue;

      const size   = h/sp.z * 1.8;
      const half   = size/2;
      const sx=sp.x, sy=sp.y;
      const teamR  = ent.team==='red';
      const bodyC  = teamR?'#bf2222':'#2244bb';
      const darkC  = teamR?'#7a1111':'#152d7a';

      ctx.save();
      // Shadow
      ctx.fillStyle='rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(sx,sy+half*0.97,half*0.4,half*0.07,0,0,Math.PI*2);
      ctx.fill();
      // Legs
      ctx.fillStyle='#2a2a2a';
      ctx.fillRect(sx-half*0.26,sy+half*0.08,half*0.22,half*0.85);
      ctx.fillRect(sx+half*0.04,sy+half*0.08,half*0.22,half*0.85);
      // Torso
      ctx.fillStyle=bodyC;
      ctx.fillRect(sx-half*0.34,sy-half*0.32,half*0.68,half*0.42);
      // Head
      ctx.fillStyle='#c9a880';
      ctx.fillRect(sx-half*0.19,sy-half*0.72,half*0.38,half*0.40);
      // Helmet
      ctx.fillStyle=darkC;
      ctx.fillRect(sx-half*0.21,sy-half*0.76,half*0.42,half*0.22);
      // Left arm
      ctx.fillStyle=bodyC;
      ctx.fillRect(sx-half*0.46,sy-half*0.28,half*0.13,half*0.35);
      // Weapon
      ctx.fillStyle='#3a3a3a';
      ctx.fillRect(sx-half*0.60,sy-half*0.20,half*0.32,half*0.10);

      // Name tag (closer than 18 units)
      if (sp.z < 18) {
        const nm=ent.name||'???';
        const fs=Math.max(8, Math.min(13, 200/sp.z));
        ctx.font=`${fs}px "Courier New"`;
        const tw=ctx.measureText(nm).width;
        ctx.fillStyle='rgba(0,0,0,0.7)';
        ctx.fillRect(sx-tw/2-4,sy-half*0.9-fs-2,tw+8,fs+4);
        ctx.fillStyle= teamR?'#ff8888':'#88aaff';
        ctx.fillText(nm,sx-tw/2,sy-half*0.9-2);
      }
      // Health bar (closer than 25 units)
      if (sp.z < 25 && ent.health < 100) {
        const bw=size*0.55, bh=Math.max(2,size*0.035);
        const bx=sx-bw/2, by2=sy-half*0.88-bh-3;
        ctx.fillStyle='#1a1a1a'; ctx.fillRect(bx,by2,bw,bh);
        const hpC = ent.health>50?'#44ff44':'#ff4444';
        ctx.fillStyle=hpC; ctx.fillRect(bx,by2,bw*ent.health/100,bh);
      }
      ctx.restore();
    }
  }

  _drawBullets(bullets, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h, zbuf) {
    const ctx=this.ctx;
    for (const b of bullets) {
      const sp  = this._worldToScreen(b.x, b.y, b.z, pos.x, eyeY, pos.z, yaw, pitch, pitchShift, hFOV, vFOV, w, h);
      const sp2 = this._worldToScreen(b.ox||b.x, b.oy||b.y, b.oz||b.z, pos.x, eyeY, pos.z, yaw, pitch, pitchShift, hFOV, vFOV, w, h);
      if (!sp||!sp2) continue;
      ctx.save();
      ctx.strokeStyle=`rgba(255,215,80,${b.life*0.9})`;
      ctx.lineWidth=Math.max(1,3/sp.z);
      ctx.shadowColor='rgba(255,180,0,0.6)';
      ctx.shadowBlur=4;
      ctx.beginPath(); ctx.moveTo(sp.x,sp.y); ctx.lineTo(sp2.x,sp2.y); ctx.stroke();
      ctx.restore();
    }
  }

  _drawParticles(particles, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h) {
    const ctx=this.ctx;
    for (const p of particles) {
      const sp=this._worldToScreen(p.x,p.y,p.z,pos.x,eyeY,pos.z,yaw,pitch,pitchShift,hFOV,vFOV,w,h);
      if (!sp||sp.z>40) continue;
      const s=Math.max(1.5,5/sp.z);
      ctx.fillStyle=`rgba(${p.r},${p.g},${p.b},${p.life})`;
      ctx.fillRect(sp.x-s/2,sp.y-s/2,s,s);
    }
  }

  _drawWeapon(weapon, w, h) {
    if (!weapon) return;
    const ctx=this.ctx;
    const sc = h/800;
    const cx = w*0.72 + weapon.bobX*8;
    const cy = h*0.72 + weapon.kickY*h*0.013 + weapon.bobY*5;

    ctx.save();
    ctx.translate(cx,cy);

    switch(weapon.id) {
      case 'ak47': case 'm4a1': this._drawAR(ctx,sc,weapon); break;
      case 'awp':   this._drawSniper(ctx,sc);  break;
      case 'mp5':   this._drawSMG(ctx,sc);     break;
      case 'shotgun': this._drawShotgun(ctx,sc); break;
      case 'deagle':  this._drawPistol(ctx,sc);  break;
    }

    // Muzzle flash
    if (weapon.flash > 0) {
      const fx=-210*sc, fy=-40*sc;
      const grd=ctx.createRadialGradient(fx,fy,0,fx,fy,44*sc);
      grd.addColorStop(0,`rgba(255,240,140,${weapon.flash})`);
      grd.addColorStop(0.3,`rgba(255,120,0,${weapon.flash*0.7})`);
      grd.addColorStop(1,'rgba(255,80,0,0)');
      ctx.fillStyle=grd;
      ctx.beginPath(); ctx.arc(fx,fy,44*sc,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  _drawAR(ctx,sc,wep) {
    ctx.fillStyle='#2a1a08'; ctx.fillRect(-18*sc,-18*sc,108*sc,28*sc);
    ctx.fillStyle='#181818'; ctx.fillRect(-80*sc,-28*sc,158*sc,38*sc);
    ctx.fillStyle='#111';    ctx.fillRect(-220*sc,-9*sc,144*sc,16*sc);
    ctx.fillStyle='#222';    ctx.fillRect(28*sc,8*sc,32*sc,54*sc);
    ctx.fillStyle='#2e2e2e'; ctx.fillRect(8*sc,10*sc,20*sc,64*sc);
    ctx.fillStyle='#3a3a3a'; ctx.fillRect(-60*sc,-36*sc,78*sc,9*sc);
    ctx.fillStyle='#2a1a08'; ctx.fillRect(-132*sc,10*sc,24*sc,44*sc);
    if(wep.id==='m4a1'){ctx.fillStyle='#2a2a2a';ctx.fillRect(-232*sc,-11*sc,16*sc,20*sc);}
  }
  _drawSniper(ctx,sc){
    ctx.fillStyle='#3a2808'; ctx.fillRect(-28*sc,-22*sc,128*sc,30*sc);
    ctx.fillStyle='#111';    ctx.fillRect(-130*sc,-27*sc,198*sc,35*sc);
    ctx.fillStyle='#0a0a0a'; ctx.fillRect(-262*sc,-9*sc,136*sc,14*sc);
    ctx.fillStyle='#1a1a1a'; ctx.fillRect(-62*sc,-48*sc,78*sc,24*sc);
    ctx.fillStyle='#0d1825'; ctx.fillRect(-58*sc,-46*sc,68*sc,20*sc);
    ctx.fillStyle='#222';    ctx.fillRect(50*sc,8*sc,28*sc,56*sc);
  }
  _drawSMG(ctx,sc){
    ctx.fillStyle='#1a1a1a'; ctx.fillRect(-58*sc,-24*sc,118*sc,34*sc);
    ctx.fillStyle='#111';    ctx.fillRect(-128*sc,-8*sc,74*sc,14*sc);
    ctx.fillStyle='#222';    ctx.fillRect(20*sc,8*sc,22*sc,50*sc);
    ctx.fillStyle='#333';    ctx.fillRect(10*sc,9*sc,18*sc,44*sc);
  }
  _drawShotgun(ctx,sc){
    ctx.fillStyle='#4a2808'; ctx.fillRect(-28*sc,-17*sc,138*sc,28*sc);
    ctx.fillStyle='#111';    ctx.fillRect(-195*sc,-10*sc,170*sc,20*sc);
    ctx.fillStyle='#0d0d0d'; ctx.fillRect(-190*sc,-8*sc,160*sc,16*sc);
    ctx.fillStyle='#333';    ctx.fillRect(48*sc,10*sc,36*sc,58*sc);
    ctx.fillStyle='#222';    ctx.fillRect(52*sc,12*sc,28*sc,52*sc);
  }
  _drawPistol(ctx,sc){
    ctx.fillStyle='#222'; ctx.fillRect(-38*sc,-28*sc,78*sc,44*sc);
    ctx.fillStyle='#111'; ctx.fillRect(-98*sc,-14*sc,64*sc,17*sc);
    ctx.fillStyle='#333'; ctx.fillRect(18*sc,12*sc,26*sc,50*sc);
  }

  _drawVignette(w,h) {
    const ctx=this.ctx;
    const grd=ctx.createRadialGradient(w/2,h/2,h*0.3,w/2,h/2,h*0.8);
    grd.addColorStop(0,'rgba(0,0,0,0)');
    grd.addColorStop(1,'rgba(0,0,0,0.48)');
    ctx.fillStyle=grd; ctx.fillRect(0,0,w,h);
  }
  _drawScope(w,h) {
    const ctx=this.ctx;
    const r=h*0.44;
    ctx.fillStyle='rgba(0,0,0,0.92)';
    ctx.fillRect(0,0,w,h);
    ctx.save();
    ctx.beginPath(); ctx.arc(w/2,h/2,r,0,Math.PI*2); ctx.clip();
    ctx.clearRect(0,0,w,h);
    ctx.restore();
    ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(w/2,h/2,r,0,Math.PI*2); ctx.stroke();
    // Reticle
    ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=1;
    const cx=w/2, cy=h/2;
    ctx.beginPath(); ctx.moveTo(cx-r,cy); ctx.lineTo(cx+r,cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,cy-r); ctx.lineTo(cx,cy+r); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,cy,r*0.04,0,Math.PI*2); ctx.stroke();
  }
  _drawDamage(w,h,alpha) {
    const ctx=this.ctx;
    const grd=ctx.createRadialGradient(w/2,h/2,h*0.1,w/2,h/2,h*0.7);
    grd.addColorStop(0,`rgba(180,0,0,0)`);
    grd.addColorStop(1,`rgba(200,0,0,${alpha*0.65})`);
    ctx.fillStyle=grd; ctx.fillRect(0,0,w,h);
  }
  _drawFlash(w,h,alpha) {
    const ctx=this.ctx;
    const grd=ctx.createRadialGradient(w*0.72,h*0.72,0,w*0.72,h*0.72,h*0.6);
    grd.addColorStop(0,`rgba(255,220,100,${alpha*0.08})`);
    grd.addColorStop(1,'rgba(255,100,0,0)');
    ctx.fillStyle=grd; ctx.fillRect(0,0,w,h);
  }
}


// ── game/network.js ──
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

class NetworkClient {
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

  connect(serverId, playerName, wsPath = null) {
    this._serverUrl  = wsPath ? this._buildUrlFromPath(wsPath) : this._buildUrl(serverId);
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

  _buildUrl(serverId) {
    const loc = typeof window !== 'undefined' ? window.location : { hostname:'localhost', host:'localhost:8787', protocol:'http:' };
    const isLocal = loc.hostname==='localhost' || loc.hostname==='127.0.0.1';
    const proto = isLocal ? 'ws' : 'wss';
    return `${proto}://${loc.host}/ws/${serverId}`;
  }
}

function lerp(a, b, t) { return a + (b-a)*t; }
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d >  Math.PI) d -= Math.PI*2;
  while (d < -Math.PI) d += Math.PI*2;
  return a + d*t;
}


// ── ui/hud.js ──
// src/ui/hud.js
// ─────────────────────────────────────────────────────────────
// HUD: health, armor, ammo, minimap, kill feed, scoreboard,
//      notifications, crosshair, hit-marker, chat box
// ─────────────────────────────────────────────────────────────

class HUD {
  constructor(container) {
    this.root = container || document.body;
    this._el  = {};
    this._minimapCtx = null;
    this._killFeedQueue = [];
    this._notifyTimer   = 0;
    this._hitMarkerTimer = 0;
    this._chatMessages  = [];
    this._build();
  }

  // ── Build DOM ───────────────────────────────────────────────

  _build() {
    this.root.insertAdjacentHTML('beforeend', `
    <div id="hud" style="display:none;position:fixed;inset:0;pointer-events:none;z-index:10;font-family:'Courier New',monospace">

      <!-- Crosshair -->
      <div id="hud-xhair" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:20px;height:20px">
        <div style="position:absolute;width:2px;height:100%;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.85)"></div>
        <div style="position:absolute;height:2px;width:100%;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.85)"></div>
        <div id="hud-hitmarker" style="position:absolute;inset:0;opacity:0;transition:opacity 0.05s">
          <div style="position:absolute;width:2px;height:100%;left:50%;transform:translateX(-50%);background:#ff3333"></div>
          <div style="position:absolute;height:2px;width:100%;top:50%;transform:translateY(-50%);background:#ff3333"></div>
        </div>
      </div>

      <!-- FPS / Ping -->
      <div id="hud-fps" style="position:absolute;top:8px;left:8px;font-size:11px;color:#44ff88;opacity:0.7">60 FPS</div>

      <!-- Ammo -->
      <div id="hud-ammo" style="position:absolute;bottom:60px;right:40px;text-align:right">
        <span id="hud-ammo-cur" style="font-size:46px;font-weight:bold;color:#fff;text-shadow:0 0 10px rgba(0,0,0,0.8)">30</span>
        <span id="hud-ammo-sep" style="font-size:20px;color:#666"> / </span>
        <span id="hud-ammo-res" style="font-size:20px;color:#aaa">90</span>
      </div>
      <div id="hud-weapon-name" style="position:absolute;bottom:44px;right:40px;font-size:12px;color:#888;letter-spacing:2px;text-align:right">AK-47</div>
      <div id="hud-reload-bar-wrap" style="position:absolute;bottom:38px;right:40px;width:120px;height:3px;background:#333;border-radius:2px;display:none">
        <div id="hud-reload-bar" style="height:100%;background:#ffaa00;width:0%;border-radius:2px;transition:width 0.05s"></div>
      </div>

      <!-- Health & Armor -->
      <div style="position:absolute;bottom:32px;left:40px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">❤</span>
          <div style="width:190px;height:8px;background:#2a2a2a;border-radius:4px;overflow:hidden">
            <div id="hud-hp-fill" style="height:100%;background:#dd3333;width:100%;border-radius:4px;transition:width 0.2s;box-shadow:0 0 6px #ff4444"></div>
          </div>
          <span id="hud-hp-text" style="font-size:14px;font-weight:bold;min-width:28px">100</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">🛡</span>
          <div style="width:190px;height:5px;background:#2a2a2a;border-radius:4px;overflow:hidden">
            <div id="hud-armor-fill" style="height:100%;background:#4488ff;width:50%;border-radius:4px;transition:width 0.2s;box-shadow:0 0 6px #4488ff"></div>
          </div>
          <span id="hud-armor-text" style="font-size:12px;color:#aaa;min-width:28px">50</span>
        </div>
      </div>

      <!-- Scoreboard top -->
      <div id="hud-score" style="position:absolute;top:18px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);border:1px solid rgba(255,68,68,0.2);border-radius:8px;padding:8px 28px;display:flex;gap:36px;align-items:center">
        <div style="text-align:center">
          <div id="hud-score-red" style="font-size:30px;font-weight:bold;color:#ff4444">0</div>
          <div style="font-size:9px;color:#884444;letter-spacing:2px">RED</div>
        </div>
        <div id="hud-timer" style="font-size:17px;font-weight:bold;color:#ddd;min-width:44px;text-align:center">5:00</div>
        <div style="text-align:center">
          <div id="hud-score-blue" style="font-size:30px;font-weight:bold;color:#4488ff">0</div>
          <div style="font-size:9px;color:#224488;letter-spacing:2px">BLUE</div>
        </div>
      </div>

      <!-- Kill feed -->
      <div id="hud-killfeed" style="position:absolute;top:78px;right:18px;display:flex;flex-direction:column;gap:4px;align-items:flex-end;max-width:280px"></div>

      <!-- Minimap -->
      <div style="position:absolute;top:18px;right:18px;width:130px;height:130px;background:rgba(0,0,0,0.72);border:1px solid rgba(255,68,68,0.18);border-radius:4px;overflow:hidden">
        <canvas id="hud-minimap" width="130" height="130"></canvas>
      </div>

      <!-- Notification center -->
      <div id="hud-notify" style="position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);font-size:30px;font-weight:bold;text-align:center;pointer-events:none;opacity:0;transition:opacity 0.4s;text-shadow:0 2px 8px rgba(0,0,0,0.9)"></div>

      <!-- Streak display -->
      <div id="hud-streak" style="position:absolute;top:52%;left:50%;transform:translate(-50%,-50%);font-size:16px;font-weight:bold;color:#ffdd44;opacity:0;transition:opacity 0.4s;letter-spacing:2px;text-shadow:0 2px 8px rgba(0,0,0,0.9)"></div>

      <!-- Chat box -->
      <div id="hud-chat" style="position:absolute;bottom:90px;left:20px;width:330px;display:flex;flex-direction:column;gap:3px;pointer-events:none"></div>

      <!-- Compass -->
      <div id="hud-compass" style="position:absolute;top:74px;left:50%;transform:translateX(-50%);font-size:11px;color:#aaa;letter-spacing:4px;background:rgba(0,0,0,0.4);padding:2px 10px;border-radius:3px">N</div>

      <!-- Low ammo warning -->
      <div id="hud-low-ammo" style="position:absolute;bottom:60px;right:180px;font-size:13px;color:#ff4444;letter-spacing:2px;opacity:0;transition:opacity 0.3s;animation:blink 0.7s infinite">LOW AMMO</div>

    </div>

    <!-- TAB scoreboard overlay -->
    <div id="hud-tab" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.86);z-index:50;align-items:center;justify-content:center;font-family:'Courier New',monospace">
      <div style="min-width:680px">
        <div style="text-align:center;font-size:22px;font-weight:bold;color:#ff4444;letter-spacing:4px;margin-bottom:16px">SCOREBOARD</div>
        <table id="hud-tab-table" style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433;text-align:left">PLAYER</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">TEAM</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">KILLS</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">DEATHS</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">K/D</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">PING</th>
            </tr>
          </thead>
          <tbody id="hud-tab-body"></tbody>
        </table>
        <div style="text-align:center;font-size:11px;color:#444;margin-top:16px;letter-spacing:2px">TAB 키를 놓으면 닫힙니다</div>
      </div>
    </div>

    <!-- Respawn overlay -->
    <div id="hud-respawn" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:100;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:'Courier New',monospace">
      <div style="font-size:52px;font-weight:bold;color:#ff4444;letter-spacing:4px;text-shadow:0 0 30px #ff4444">ELIMINATED</div>
      <div id="hud-respawn-killer" style="font-size:16px;color:#aaa"></div>
      <div id="hud-respawn-count" style="font-size:22px;color:#fff">3초 후 리스폰...</div>
      <div id="hud-respawn-stats" style="font-size:13px;color:#666;margin-top:4px"></div>
    </div>

    <!-- Damage vignette -->
    <div id="hud-damage" style="position:fixed;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse,transparent 50%,#ff000055 100%);opacity:0;transition:opacity 0.1s"></div>

    <style>
      @keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
      .killfeed-entry { background:rgba(0,0,0,0.72);padding:3px 10px;border-radius:3px;border-left:2px solid #ff4444;font-size:12px;white-space:nowrap;animation:kffade 4s forwards }
      @keyframes kffade { 0%{opacity:1;transform:translateX(0)}80%{opacity:1}100%{opacity:0;transform:translateX(20px)} }
      .chat-entry { background:rgba(0,0,0,0.65);padding:3px 10px;border-radius:3px;font-size:12px;animation:chatfade 8s forwards;pointer-events:none }
      @keyframes chatfade { 0%{opacity:1}75%{opacity:1}100%{opacity:0} }
    </style>
    `);

    // Cache references
    for (const id of [
      'hud','hud-xhair','hud-hitmarker','hud-fps',
      'hud-ammo-cur','hud-ammo-res','hud-weapon-name','hud-reload-bar-wrap','hud-reload-bar',
      'hud-hp-fill','hud-hp-text','hud-armor-fill','hud-armor-text',
      'hud-score-red','hud-score-blue','hud-timer',
      'hud-killfeed','hud-minimap','hud-notify','hud-streak',
      'hud-chat','hud-compass','hud-low-ammo',
      'hud-tab','hud-tab-body',
      'hud-respawn','hud-respawn-killer','hud-respawn-count','hud-respawn-stats',
      'hud-damage',
    ]) {
      this._el[id] = document.getElementById(id);
    }

    this._minimapCtx = this._el['hud-minimap']?.getContext('2d');
  }

  // ── Show / Hide ─────────────────────────────────────────────

  show() { if (this._el['hud']) this._el['hud'].style.display = 'block'; }
  hide() { if (this._el['hud']) this._el['hud'].style.display = 'none'; }

  // ── Per-frame update ────────────────────────────────────────

  update(dt, state) {
    this._hitMarkerTimer -= dt;
    if (this._hitMarkerTimer <= 0 && this._el['hud-hitmarker']) {
      this._el['hud-hitmarker'].style.opacity = '0';
    }
    this._updateCompass(state.yaw);
    this._updateFPS(state.fps, state.ping);
    this._updateTimer(state.roundTimer);
  }

  // ── Setters ─────────────────────────────────────────────────

  setHealth(hp, maxHp=100) {
    const pct = Math.max(0, hp/maxHp*100);
    if (this._el['hud-hp-fill'])  this._el['hud-hp-fill'].style.width  = pct+'%';
    if (this._el['hud-hp-text'])  this._el['hud-hp-text'].textContent  = Math.ceil(hp);
    if (this._el['hud-hp-fill']) {
      this._el['hud-hp-fill'].style.background = hp>50?'#dd3333':hp>25?'#ff8800':'#ff2200';
    }
  }

  setArmor(armor, maxArmor=100) {
    const pct = Math.max(0, armor/maxArmor*100);
    if (this._el['hud-armor-fill']) this._el['hud-armor-fill'].style.width = pct+'%';
    if (this._el['hud-armor-text']) this._el['hud-armor-text'].textContent = Math.ceil(armor);
  }

  setAmmo(cur, reserve, reloading=false, reloadPct=0) {
    if (this._el['hud-ammo-cur']) {
      this._el['hud-ammo-cur'].textContent = cur;
      this._el['hud-ammo-cur'].style.color = cur===0?'#ff4444':cur<5?'#ffaa00':'#fff';
    }
    if (this._el['hud-ammo-res']) this._el['hud-ammo-res'].textContent = reserve;
    if (this._el['hud-reload-bar-wrap']) {
      this._el['hud-reload-bar-wrap'].style.display = reloading ? 'block' : 'none';
    }
    if (this._el['hud-reload-bar'] && reloading) {
      this._el['hud-reload-bar'].style.width = (reloadPct*100)+'%';
    }
    if (this._el['hud-low-ammo']) {
      this._el['hud-low-ammo'].style.opacity = (cur>0 && cur<=5 && !reloading) ? '1' : '0';
    }
  }

  setWeapon(name, reloading=false) {
    if (this._el['hud-weapon-name']) {
      this._el['hud-weapon-name'].textContent = reloading ? 'RELOADING...' : name;
    }
  }

  setScore(red, blue) {
    if (this._el['hud-score-red'])  this._el['hud-score-red'].textContent  = red;
    if (this._el['hud-score-blue']) this._el['hud-score-blue'].textContent = blue;
  }

  // ── Damage flash ────────────────────────────────────────────

  showDamage(alpha=0.7) {
    const el = this._el['hud-damage'];
    if (!el) return;
    el.style.opacity = String(alpha);
    clearTimeout(this._damageTimer);
    this._damageTimer = setTimeout(() => { el.style.opacity = '0'; }, 180);
  }

  // ── Hit marker ──────────────────────────────────────────────

  showHitMarker(killed=false) {
    const el = this._el['hud-hitmarker'];
    if (!el) return;
    el.style.opacity = '1';
    el.style.color = killed ? '#ffdd00' : '#ff3333';
    this._hitMarkerTimer = killed ? 0.4 : 0.15;
  }

  // ── Kill feed ────────────────────────────────────────────────

  addKill(killerName, victimName, weapon='') {
    const feed = this._el['hud-killfeed'];
    if (!feed) return;
    const el = document.createElement('div');
    el.className = 'killfeed-entry';
    const icon = { ak47:'🔫', awp:'🎯', shotgun:'💥', deagle:'🔫', mp5:'🔫', m4a1:'🔫' }[weapon] || '⚡';
    el.innerHTML = `<span style="color:#ff8888">${killerName}</span> ${icon} <span style="color:#88aaff">${victimName}</span>`;
    feed.appendChild(el);
    if (feed.children.length > 5) feed.firstChild.remove();
    setTimeout(() => el.remove(), 4200);
  }

  // ── Notification ─────────────────────────────────────────────

  notify(msg, color='#fff', sub='') {
    const el = this._el['hud-notify'];
    if (!el) return;
    el.textContent  = msg;
    el.style.color  = color;
    el.style.opacity = '1';
    clearTimeout(this._notifyT);
    this._notifyT = setTimeout(() => { el.style.opacity='0'; }, 2000);

    if (sub && this._el['hud-streak']) {
      this._el['hud-streak'].textContent = sub;
      this._el['hud-streak'].style.opacity = '1';
      clearTimeout(this._streakT);
      this._streakT = setTimeout(() => { this._el['hud-streak'].style.opacity='0'; }, 2500);
    }
  }

  // ── Chat ─────────────────────────────────────────────────────

  addChat(from, team, text) {
    const box = this._el['hud-chat'];
    if (!box) return;
    const el   = document.createElement('div');
    el.className = 'chat-entry';
    const col  = team==='red'?'#ff7766':'#6699ff';
    el.innerHTML = `<span style="color:${col}">[${from}]</span> <span style="color:#ddd">${text}</span>`;
    box.appendChild(el);
    if (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => el.remove(), 8000);
  }

  // ── Respawn overlay ─────────────────────────────────────────

  showRespawn(killerName, onDone) {
    const ov = this._el['hud-respawn'];
    if (!ov) return;
    ov.style.display = 'flex';
    if (this._el['hud-respawn-killer']) {
      this._el['hud-respawn-killer'].textContent = killerName ? `킬러: ${killerName}` : '';
    }
    let cnt = 4;
    const tick = () => {
      cnt--;
      if (cnt <= 0) {
        ov.style.display = 'none';
        onDone?.();
      } else {
        if (this._el['hud-respawn-count']) this._el['hud-respawn-count'].textContent = `${cnt}초 후 리스폰...`;
        setTimeout(tick, 1000);
      }
    };
    if (this._el['hud-respawn-count']) this._el['hud-respawn-count'].textContent = `${cnt}초 후 리스폰...`;
    setTimeout(tick, 1000);
  }

  hideRespawn() {
    if (this._el['hud-respawn']) this._el['hud-respawn'].style.display = 'none';
  }

  // ── TAB scoreboard ──────────────────────────────────────────

  showTab(players, myId) {
    const tab = this._el['hud-tab'];
    if (tab) tab.style.display = 'flex';
    this.updateTab(players, myId);
  }

  hideTab() {
    const tab = this._el['hud-tab'];
    if (tab) tab.style.display = 'none';
  }

  updateTab(players, myId) {
    const tbody = this._el['hud-tab-body'];
    if (!tbody) return;
    tbody.innerHTML = '';
    const sorted = [...players].sort((a,b) => b.kills - a.kills);
    for (const p of sorted) {
      const tr = document.createElement('tr');
      if (p.id === myId) tr.style.background = 'rgba(255,68,68,0.1)';
      const kd = p.deaths > 0 ? (p.kills/p.deaths).toFixed(2) : p.kills > 0 ? '∞' : '0.00';
      const teamCol = p.team==='red'?'#ff4444':'#4488ff';
      tr.innerHTML = `
        <td style="padding:7px 16px;font-size:13px;border-bottom:1px solid #1a1a1a">${p.name}${p.id===myId?' <span style="color:#ff4444">(나)</span>':''}</td>
        <td style="padding:7px 16px;font-size:13px;color:${teamCol};text-align:center;border-bottom:1px solid #1a1a1a">${p.team.toUpperCase()}</td>
        <td style="padding:7px 16px;font-size:13px;text-align:center;border-bottom:1px solid #1a1a1a">${p.kills}</td>
        <td style="padding:7px 16px;font-size:13px;text-align:center;border-bottom:1px solid #1a1a1a">${p.deaths}</td>
        <td style="padding:7px 16px;font-size:13px;text-align:center;border-bottom:1px solid #1a1a1a">${kd}</td>
        <td style="padding:7px 16px;font-size:13px;text-align:center;border-bottom:1px solid #1a1a1a;color:${(p.ping||0)<60?'#44ff88':(p.ping||0)<120?'#ffaa44':'#ff4444'}">${p.ping||'?'}ms</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // ── Minimap ─────────────────────────────────────────────────

  renderMinimap(mapData, playerPos, playerYaw, entities) {
    const ctx  = this._minimapCtx;
    if (!ctx) return;
    const mw=130, mh=130;
    const scX = mw/mapData.W, scZ = mh/mapData.D;

    ctx.clearRect(0,0,mw,mh);
    ctx.fillStyle='rgba(0,0,0,0.85)';
    ctx.fillRect(0,0,mw,mh);

    // Blocks (sample every 2)
    for (let x=0;x<mapData.W;x+=2) for (let z=0;z<mapData.D;z+=2) {
      let solid=false;
      for (let y=1;y<mapData.H;y++) if(mapData.isSolid(x,y,z)){solid=true;break;}
      if (solid) {
        ctx.fillStyle='#2a3040';
        ctx.fillRect(x*scX,z*scZ,scX*2,scZ*2);
      }
    }

    // Entities (bots + remote players)
    for (const e of (entities||[])) {
      ctx.fillStyle = e.team==='red'?'#ff5544':'#4466ff';
      ctx.fillRect(e.x*scX-2, e.z*scZ-2, 4, 4);
    }

    // Player arrow
    ctx.save();
    ctx.translate(playerPos.x*scX, playerPos.z*scZ);
    ctx.rotate(playerYaw);
    ctx.fillStyle='#44ff88';
    ctx.beginPath();
    ctx.moveTo(0,-6); ctx.lineTo(4,4); ctx.lineTo(-4,4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ── Internal helpers ────────────────────────────────────────

  _updateCompass(yaw) {
    const el = this._el['hud-compass'];
    if (!el) return;
    const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
    const idx  = Math.round(((yaw % (Math.PI*2)) + Math.PI*2) % (Math.PI*2) / (Math.PI/4));
    el.textContent = dirs[idx] || 'N';
  }

  _updateFPS(fps, ping) {
    const el = this._el['hud-fps'];
    if (el) el.textContent = `${fps} FPS${ping?'  '+ping+'ms':''}`;
  }

  _updateTimer(sec) {
    const el = this._el['hud-timer'];
    if (!el) return;
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s/60);
    el.textContent = `${m}:${String(s%60).padStart(2,'0')}`;
    el.style.color = s < 30 ? '#ff4444' : '#ddd';
  }
}


// ── ui/menu.js ──
// src/ui/menu.js
// ─────────────────────────────────────────────────────────────
// Main menu: server list, settings, leaderboard, loading screen
// ─────────────────────────────────────────────────────────────

class Menu {
  constructor(container) {
    this.root    = container || document.body;
    this._el     = {};
    this.onPlay  = null;   // (serverObj) => void
    this._servers = [];
    this._settings = loadSettings();
    this._build();
  }

  // ── Build ───────────────────────────────────────────────────

  _build() {
    this.root.insertAdjacentHTML('beforeend', `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
      :root{--red:#ff3333;--blue:#3366ff;--bg:#080c10;--panel:rgba(10,15,22,0.95);--border:rgba(255,51,51,0.18)}
      *{box-sizing:border-box;margin:0;padding:0}
      body{background:var(--bg);color:#e0e0e0;font-family:'Courier New',monospace;overflow:hidden}
      .menu-btn{background:var(--red);color:#fff;border:none;padding:13px 38px;font-family:inherit;font-size:15px;font-weight:bold;letter-spacing:3px;cursor:pointer;border-radius:3px;transition:all .18s;text-transform:uppercase}
      .menu-btn:hover{background:#ff5555;box-shadow:0 0 18px var(--red);transform:translateY(-2px)}
      .menu-btn.sec{background:transparent;border:1px solid var(--red);color:var(--red)}
      .menu-btn.sec:hover{background:rgba(255,51,51,.12)}
      input[type=text],input[type=range]{background:#0d1117;border:1px solid var(--border);color:#ddd;padding:8px 12px;font-family:inherit;font-size:13px;border-radius:3px;outline:none;width:100%}
      input[type=text]:focus{border-color:var(--red)}
      .tab-btn{background:transparent;border:1px solid var(--border);color:#aaa;padding:8px 20px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px;transition:all .15s;border-radius:3px}
      .tab-btn.active,.tab-btn:hover{border-color:var(--red);color:var(--red);background:rgba(255,51,51,.08)}
    </style>

    <!-- Loading Screen -->
    <div id="screen-loading" style="position:fixed;inset:0;background:#080c10;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2000;gap:18px">
      <div style="font-size:52px;font-weight:bold;color:var(--red);letter-spacing:10px;text-shadow:0 0 30px var(--red),0 0 60px rgba(255,0,0,.3);animation:pls 2s infinite">VOXEL STRIKE</div>
      <div style="font-size:11px;color:#444;letter-spacing:4px">TACTICAL BROWSER FPS</div>
      <div style="width:280px;height:3px;background:#111;border-radius:2px;overflow:hidden;margin-top:8px">
        <div id="load-bar" style="height:100%;background:var(--red);width:0;box-shadow:0 0 8px var(--red);transition:width .28s"></div>
      </div>
      <div id="load-text" style="font-size:11px;color:#555;letter-spacing:2px">INITIALIZING...</div>
      <style>@keyframes pls{0%,100%{text-shadow:0 0 30px var(--red)}50%{text-shadow:0 0 50px #ff6666,0 0 80px rgba(255,0,0,.4)}}</style>
    </div>

    <!-- Main Menu -->
    <div id="screen-menu" style="display:none;position:fixed;inset:0;z-index:900">
      <!-- Background animated particles -->
      <canvas id="menu-bg" style="position:absolute;inset:0;opacity:0.18"></canvas>

      <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:22px;padding:20px">

        <div style="text-align:center">
          <div style="font-size:56px;font-weight:bold;color:var(--red);letter-spacing:10px;text-shadow:0 0 30px var(--red)">VOXEL STRIKE</div>
          <div style="font-size:11px;color:#444;letter-spacing:5px;margin-top:4px">TACTICAL FPS — BROWSER EDITION</div>
        </div>

        <!-- Name input -->
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:12px;color:#666;letter-spacing:2px">닉네임</span>
          <input id="name-input" type="text" style="width:200px" placeholder="PlayerXXXX" maxlength="20"/>
        </div>

        <!-- Menu tabs -->
        <div style="display:flex;gap:8px">
          <button class="tab-btn active" id="tab-servers">SERVERS</button>
          <button class="tab-btn" id="tab-settings">SETTINGS</button>
          <button class="tab-btn" id="tab-leaderboard">LEADERBOARD</button>
        </div>

        <!-- SERVERS panel -->
        <div id="panel-servers" style="width:640px">
          <div id="server-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px"></div>
          <div style="display:flex;gap:10px;margin-top:14px;justify-content:center">
            <button class="menu-btn" id="btn-quickplay">▶ 지금 플레이</button>
            <button class="menu-btn sec" id="btn-create-server">＋ 서버 제작</button>
            <button class="menu-btn sec" id="btn-download">⬇ PC/Mobile 다운로드</button>
            <button class="menu-btn sec" id="btn-refresh">↺ REFRESH</button>
          </div>
        </div>

        <!-- SETTINGS panel -->
        <div id="panel-settings" style="display:none;width:420px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:22px;display:none;flex-direction:column;gap:14px">
          <div class="setting-row" data-key="sensitivity">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px;display:block;margin-bottom:4px">마우스 감도 <span id="lbl-sensitivity">2.0</span></label>
            <input type="range" id="sl-sensitivity" min="0.5" max="6" step="0.1" value="2.0">
          </div>
          <div class="setting-row" data-key="fov">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px;display:block;margin-bottom:4px">FOV <span id="lbl-fov">75</span>°</label>
            <input type="range" id="sl-fov" min="60" max="110" step="1" value="75">
          </div>
          <div class="setting-row" data-key="renderScale">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px;display:block;margin-bottom:4px">렌더 해상도 <span id="lbl-renderScale">100</span>%</label>
            <input type="range" id="sl-renderScale" min="50" max="100" step="10" value="100">
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px">사운드</label>
            <input type="checkbox" id="cb-sound" checked style="width:auto;cursor:pointer">
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px">ADS (우클릭 조준)</label>
            <input type="checkbox" id="cb-ads" checked style="width:auto;cursor:pointer">
          </div>
          <button class="menu-btn" id="btn-save-settings" style="width:100%;margin-top:4px">저장</button>
        </div>

        <!-- LEADERBOARD panel -->
        <div id="panel-leaderboard" style="display:none;width:560px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:22px">
          <div style="font-size:13px;color:#ff4444;letter-spacing:3px;margin-bottom:14px;text-align:center">🏆 GLOBAL TOP 20</div>
          <table id="lb-table" style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr>
              <th style="color:#ff4444;padding:6px 12px;border-bottom:1px solid var(--border);text-align:left">#</th>
              <th style="color:#ff4444;padding:6px 12px;border-bottom:1px solid var(--border);text-align:left">PLAYER</th>
              <th style="color:#ff4444;padding:6px 12px;border-bottom:1px solid var(--border)">KILLS</th>
              <th style="color:#ff4444;padding:6px 12px;border-bottom:1px solid var(--border)">K/D</th>
            </tr></thead>
            <tbody id="lb-body"><tr><td colspan="4" style="text-align:center;color:#444;padding:20px">불러오는 중...</td></tr></tbody>
          </table>
        </div>

        <div style="font-size:11px;color:#2a2a2a;letter-spacing:2px;margin-top:4px">WASD 이동 · 마우스 조준 · LMB 사격 · R 재장전 · TAB 점수판 · T 채팅</div>
      </div>
    </div>

    <!-- Pointer lock prompt -->
    <div id="screen-pointer" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);flex-direction:column;align-items:center;justify-content:center;z-index:200;gap:14px;font-family:'Courier New',monospace">
      <div style="font-size:34px;font-weight:bold;color:#fff">⊕ CLICK TO RESUME</div>
      <div style="font-size:13px;color:#888">ESC → 메뉴 복귀</div>
    </div>
    `);

    // Cache elements
    for (const id of [
      'screen-loading','load-bar','load-text',
      'screen-menu','menu-bg',
      'name-input','server-grid',
      'btn-quickplay','btn-create-server','btn-download','btn-refresh',
      'panel-servers','panel-settings','panel-leaderboard',
      'tab-servers','tab-settings','tab-leaderboard',
      'sl-sensitivity','lbl-sensitivity',
      'sl-fov','lbl-fov',
      'sl-renderScale','lbl-renderScale',
      'cb-sound','cb-ads',
      'btn-save-settings',
      'lb-body',
      'screen-pointer',
    ]) {
      this._el[id] = document.getElementById(id);
    }

    this._bindEvents();
    this._startMenuBg();
    this._applySettings();
  }

  // ── Public ──────────────────────────────────────────────────

  /** Animate loading bar: steps = [{pct, text}] */
  async loadWith(steps) {
    for (const { pct, text } of steps) {
      if (this._el['load-bar'])  this._el['load-bar'].style.width  = pct + '%';
      if (this._el['load-text']) this._el['load-text'].textContent = text;
      await sleep(260);
    }
    await sleep(300);
    this._el['screen-loading'].style.display = 'none';
    this._el['screen-menu'].style.display    = 'flex';
    this._el['screen-menu'].style.flexDirection = 'column';
    this._el['screen-menu'].style.alignItems    = 'center';
    this._el['screen-menu'].style.justifyContent = 'center';
    this._el['screen-menu'].style.height = '100%';
  }

  hideMenu()       { if (this._el['screen-menu']) this._el['screen-menu'].style.display = 'none'; }
  showMenu()       { if (this._el['screen-menu']) this._el['screen-menu'].style.display = 'flex'; }
  showPointerMsg() { if (this._el['screen-pointer']) this._el['screen-pointer'].style.display = 'flex'; }
  hidePointerMsg() { if (this._el['screen-pointer']) this._el['screen-pointer'].style.display = 'none'; }

  get playerName() {
    const v = this._el['name-input']?.value?.trim();
    return v || ('Player' + Math.floor(Math.random()*9999));
  }

  get settings() { return this._settings; }

  populateServers(servers) {
    this._servers = servers;
    const grid = this._el['server-grid'];
    if (!grid) return;
    grid.innerHTML = '';
    for (const s of servers) {
      const pingColor = s.ping<50?'#44ff88':s.ping<120?'#ffaa44':'#ff4444';
      const full      = s.players >= s.maxPlayers;
      const el        = document.createElement('div');
      el.style.cssText = 'background:#0d1117;border:1px solid rgba(255,51,51,.18);border-radius:7px;padding:14px;cursor:pointer;transition:all .17s;display:flex;flex-direction:column;gap:5px';
      el.innerHTML = `
        <div style="font-size:13px;font-weight:bold;color:#ff6644">${s.flag||''} ${s.name}</div>
        <div style="font-size:11px;color:#556">${s.region}</div>
        <div style="font-size:11px;color:${full?'#ff4444':'#778'}">${s.players}/${s.maxPlayers} 명${full?' · FULL':''}</div>
        <div style="font-size:11px;color:${pingColor}">핑: ${s.ping??'?'}ms</div>
      `;
      if (!full) {
        el.addEventListener('mouseenter', () => { el.style.borderColor='#ff4444'; el.style.background='#1a0a0a'; el.style.transform='translateY(-2px)'; });
        el.addEventListener('mouseleave', () => { el.style.borderColor='rgba(255,51,51,.18)'; el.style.background='#0d1117'; el.style.transform='translateY(0)'; });
        el.addEventListener('click', () => this.onPlay?.(s));
      } else {
        el.style.opacity = '0.4'; el.style.cursor = 'not-allowed';
      }
      grid.appendChild(el);
    }
  }

  populateLeaderboard(entries) {
    const tbody = this._el['lb-body'];
    if (!tbody) return;
    if (!entries.length) { tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:#444;padding:20px">데이터 없음</td></tr>'; return; }
    tbody.innerHTML = entries.slice(0,20).map((e,i) => `
      <tr style="border-bottom:1px solid #111">
        <td style="padding:6px 12px;color:${i<3?'#ffdd44':'#666'}">${i+1}</td>
        <td style="padding:6px 12px">${e.name}</td>
        <td style="padding:6px 12px;text-align:center">${e.kills}</td>
        <td style="padding:6px 12px;text-align:center;color:#44ff88">${e.kd}</td>
      </tr>
    `).join('');
  }

  // ── Events ──────────────────────────────────────────────────

  _bindEvents() {
    const switchTab = (name) => {
      for (const t of ['servers','settings','leaderboard']) {
        this._el[`tab-${t}`]?.classList.toggle('active', t===name);
        if (this._el[`panel-${t}`]) this._el[`panel-${t}`].style.display = t===name ? 'block':'none';
      }
    };
    this._el['tab-servers']?.addEventListener('click', () => switchTab('servers'));
    this._el['tab-settings']?.addEventListener('click', () => { switchTab('settings'); });
    this._el['tab-leaderboard']?.addEventListener('click', () => {
      switchTab('leaderboard');
      this._fetchLeaderboard();
    });

    this._el['btn-quickplay']?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/matchmake', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ modeId:'battle_royale' }), signal:AbortSignal.timeout(3000) });
        const data = await res.json();
        if (data?.server) return this.onPlay?.({ ...data.server, wsPath:data.wsPath });
      } catch (_) {}
      const best = this._servers.filter(s=>s.players<s.maxPlayers).sort((a,b)=>(a.placementScore??a.ping)-(b.placementScore??b.ping))[0];
      if (best) this.onPlay?.(best);
    });

    this._el['btn-create-server']?.addEventListener('click', async () => {
      const ownerName = this.playerName;
      try {
        const res = await fetch('/api/servers/custom', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ownerName, maxPlayers:64, ttlSec:7200 }), signal:AbortSignal.timeout(5000) });
        const data = await res.json();
        if (data?.server) { alert('서버 제작 요청 완료: '+data.server.id); await this._fetchServers(); }
      } catch { alert('현재 배포 환경에서는 커스텀 서버 API가 비활성화되어 있습니다.'); }
    });

    this._el['btn-download']?.addEventListener('click', () => {
      const blob = new Blob([location.href], { type:'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'voxel-strike-web-launcher.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    this._el['btn-refresh']?.addEventListener('click', () => {
      this._el['btn-refresh'].textContent = '↺ ...';
      this._fetchServers().then(() => { this._el['btn-refresh'].textContent = '↺ REFRESH'; });
    });

    // Settings sliders
    for (const key of ['sensitivity','fov','renderScale']) {
      const sl  = this._el[`sl-${key}`];
      const lbl = this._el[`lbl-${key}`];
      sl?.addEventListener('input', () => {
        if (lbl) lbl.textContent = sl.value;
        this._settings[key] = parseFloat(sl.value);
      });
    }

    this._el['btn-save-settings']?.addEventListener('click', () => {
      this._settings.sound = this._el['cb-sound']?.checked ?? true;
      this._settings.ads   = this._el['cb-ads']?.checked   ?? true;
      saveSettings(this._settings);
      this._el['btn-save-settings'].textContent = '✓ 저장됨';
      setTimeout(() => { this._el['btn-save-settings'].textContent = '저장'; }, 1200);
    });

    this._el['screen-pointer']?.addEventListener('click', () => {
      document.getElementById('game-canvas')?.requestPointerLock();
    });
  }

  _applySettings() {
    const s = this._settings;
    if (this._el['sl-sensitivity']) { this._el['sl-sensitivity'].value = s.sensitivity; this._el['lbl-sensitivity'].textContent = s.sensitivity; }
    if (this._el['sl-fov'])         { this._el['sl-fov'].value = s.fov; this._el['lbl-fov'].textContent = s.fov; }
    if (this._el['sl-renderScale']) { this._el['sl-renderScale'].value = s.renderScale; this._el['lbl-renderScale'].textContent = s.renderScale; }
    if (this._el['cb-sound'])    this._el['cb-sound'].checked = s.sound;
    if (this._el['cb-ads'])      this._el['cb-ads'].checked   = s.ads;
  }

  async _fetchServers() {
    try {
      const res  = await fetch('/api/servers', { signal: AbortSignal.timeout(3000) });
      const list = await res.json();
      // Estimate ping locally
      for (const s of list) s.ping = s.ping ?? await estimatePing(s.id);
      this.populateServers(list);
    } catch {
      // Fallback static list
      this.populateServers([
        { id:'asia-1', name:'Asia #1', region:'Seoul',       flag:'🇰🇷', players:0, maxPlayers:20, ping:12 },
        { id:'asia-2', name:'Asia #2', region:'Tokyo',       flag:'🇯🇵', players:0, maxPlayers:20, ping:28 },
        { id:'asia-3', name:'Asia #3', region:'Singapore',   flag:'🇸🇬', players:0, maxPlayers:20, ping:55 },
        { id:'eu-1',   name:'EU #1',   region:'Frankfurt',   flag:'🇩🇪', players:0, maxPlayers:20, ping:145},
        { id:'us-west',name:'US West', region:'Los Angeles', flag:'🇺🇸', players:0, maxPlayers:20, ping:180},
        { id:'us-east',name:'US East', region:'New York',    flag:'🇺🇸', players:0, maxPlayers:20, ping:200},
      ]);
    }
  }

  async _fetchLeaderboard() {
    try {
      const res  = await fetch('/api/leaderboard?limit=20');
      const data = await res.json();
      this.populateLeaderboard(data);
    } catch { this.populateLeaderboard([]); }
  }

  _startMenuBg() {
    const canvas = this._el['menu-bg'];
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const stars = Array.from({length:120},()=>({
      x:Math.random()*canvas.width,
      y:Math.random()*canvas.height,
      vx:(Math.random()-.5)*.3,
      vy:(Math.random()-.5)*.3,
      r:Math.random()*1.5,
    }));
    const draw = () => {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      for (const s of stars) {
        s.x=(s.x+s.vx+canvas.width)%canvas.width;
        s.y=(s.y+s.vy+canvas.height)%canvas.height;
        ctx.fillStyle=`rgba(255,60,60,${0.3+s.r/3})`;
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
      }
      requestAnimationFrame(draw);
    };
    draw();
  }
}

// ── Settings persistence ─────────────────────────────────────

function loadSettings() {
  try {
    const raw = sessionStorage.getItem('vs_settings');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { sensitivity:2.0, fov:75, renderScale:100, sound:true, ads:true };
}

function saveSettings(s) {
  try { sessionStorage.setItem('vs_settings', JSON.stringify(s)); } catch (_) {}
}

async function estimatePing(serverId) {
  try {
    const t0  = Date.now();
    await fetch(`/api/room/${serverId}`, { signal:AbortSignal.timeout(2000) });
    return Date.now() - t0;
  } catch { return 999; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


// ── game/game.js ──
// src/game/game.js
// ─────────────────────────────────────────────────────────────
// Game orchestrator — creates and connects all subsystems:
//   Menu → Input → Physics → BotManager → Renderer → HUD → Network
// ─────────────────────────────────────────────────────────────








const KILL_STREAK_MSGS = {
  2:  ['DOUBLE KILL!',  '#ff8844'],
  3:  ['TRIPLE KILL!',  '#ff5500'],
  4:  ['QUAD KILL!!',   '#ff2200'],
  5:  ['PENTA KILL!!!', '#ffdd00'],
  10: ['UNSTOPPABLE',   '#ff00ff'],
};

class Game {
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
    this.myName  = this.menu.playerName;
    this.myTeam  = Math.random() < 0.5 ? 'red' : 'blue';
    this.kills   = 0;
    this.deaths  = 0;
    this.killStreak = 0;
    this.score   = { red:0, blue:0 };
    this.roundTimer = 300;
    this.bullets.length = 0;
    this.particles.length = 0;

    // Place player at spawn
    const sp = this.map.spawnPoints.find(s => s.team === this.myTeam) || { x:8, y:1, z:8 };
    this.phys.pos    = { x: sp.x + (Math.random()-.5)*2, y: sp.y, z: sp.z + (Math.random()-.5)*2 };
    this.phys.vel    = { x:0, y:0, z:0 };
    this.phys.health = 100;
    this.phys.alive  = true;

    // Reset weapon
    this._equip('ak47');

    // Bots
    this.bots.spawn(9);

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
    this.net.connect(server.id, this.myName, server.wsPath || null);
    this.hud.notify(`${server.flag||''} ${server.name} 접속!`, '#44ff88');
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
    this.phys.update(dt, this.keys, this.yaw);

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


// ── main.js ──
// src/main.js
// Entry point — instantiate Game and start

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.start();
  // Expose for debug
  if (location.hostname === 'localhost') window._game = game;
});


})();
