// src/game/weapons.js
// ─────────────────────────────────────────────────────────────
// Weapon data & shoot-logic helpers (client side)
// ─────────────────────────────────────────────────────────────

export const WEAPONS = {
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
};

export const WEAPON_SLOTS = {
  1: ['ak47', 'm4a1'],
  2: ['mp5', 'shotgun'],
  3: ['awp'],
  4: ['deagle'],
};

/** State for one weapon instance in the player's hands */
export class WeaponState {
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
