// src/game/bots.js
// ─────────────────────────────────────────────────────────────
// Bot AI — finite state machine
//   States: patrol → alert → chase → combat → retreat → dead
// ─────────────────────────────────────────────────────────────
import { WEAPONS } from './weapons.js';

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

export class BotManager {
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
