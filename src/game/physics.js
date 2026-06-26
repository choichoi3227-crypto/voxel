// src/game/physics.js
// ─────────────────────────────────────────────────────────────
// Player physics: movement, collision, gravity, crouch, jump
// ─────────────────────────────────────────────────────────────

export const GRAVITY        = 22;
export const JUMP_VEL       = 8.5;
export const MOVE_SPEED     = 6.0;
export const SPRINT_MULT    = 1.65;
export const CROUCH_MULT    = 0.5;
export const PLAYER_RADIUS  = 0.3;
export const PLAYER_HEIGHT  = 1.75;
export const CROUCH_HEIGHT  = 1.0;
export const EYE_OFFSET     = 0.85;   // fraction of player height
export const STEP_HEIGHT    = 0.45;   // auto-step over low edges
export const AIR_CONTROL    = 0.35;   // fraction of normal control in air
export const FRICTION       = 18;     // ground friction coefficient

export class PlayerPhysics {
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
