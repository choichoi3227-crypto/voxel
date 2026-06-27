// src/workers/constants.js
// ─────────────────────────────────────────────────────────────
// Shared constants used by both server (Worker) and client.
// Keep in sync with src/game/weapons.js
// ─────────────────────────────────────────────────────────────

/**
 * Full per-weapon ballistic profile used by the SERVER to validate
 * client-reported hits (damage clamp, range clamp, falloff curve).
 * Client mirrors the same numbers in src/game/weapons.js for prediction.
 *
 *  - damage:        base damage at muzzle (0m)
 *  - falloffStart:  range (world units) before damage starts dropping
 *  - falloffEnd:    range at which damage reaches minDamageMult
 *  - minDamageMult: damage multiplier floor at/after falloffEnd
 *  - muzzleVelocity:units/sec — used for projectile travel time + drop
 *  - gravityMult:   multiplier on world gravity applied to this round
 *  - maxRange:      absolute range; beyond this the round is discarded
 *  - pellets:       shotgun-style multi-pellet count
 *  - penetration:   number of "thin" voxel layers the round can pass through
 */
export const WEAPON_BALLISTICS = {
  ak47:    { damage: 28,  headshotMult: 2.5, falloffStart: 18, falloffEnd: 55,  minDamageMult: 0.55, muzzleVelocity: 220, gravityMult: 0.35, maxRange: 80,  pellets: 1, penetration: 1 },
  m4a1:    { damage: 24,  headshotMult: 2.5, falloffStart: 20, falloffEnd: 60,  minDamageMult: 0.55, muzzleVelocity: 240, gravityMult: 0.3,  maxRange: 90,  pellets: 1, penetration: 1 },
  awp:     { damage: 120, headshotMult: 1.0, falloffStart: 60, falloffEnd: 140, minDamageMult: 0.75, muzzleVelocity: 380, gravityMult: 0.15, maxRange: 200, pellets: 1, penetration: 2 },
  mp5:     { damage: 18,  headshotMult: 2.0, falloffStart: 10, falloffEnd: 35,  minDamageMult: 0.45, muzzleVelocity: 180, gravityMult: 0.4,  maxRange: 40,  pellets: 1, penetration: 0 },
  shotgun: { damage: 15,  headshotMult: 1.5, falloffStart: 5,  falloffEnd: 16,  minDamageMult: 0.1,  muzzleVelocity: 140, gravityMult: 0.55, maxRange: 20,  pellets: 9, penetration: 0 },
  deagle:  { damage: 55,  headshotMult: 2.0, falloffStart: 14, falloffEnd: 45,  minDamageMult: 0.5,  muzzleVelocity: 200, gravityMult: 0.4,  maxRange: 60,  pellets: 1, penetration: 1 },
  beryl:   { damage: 31,  headshotMult: 2.35, falloffStart: 16, falloffEnd: 70,  minDamageMult: 0.50, muzzleVelocity: 210, gravityMult: 0.38, maxRange: 95,  pellets: 1, penetration: 2 },
  sks:     { damage: 53,  headshotMult: 2.2,  falloffStart: 45, falloffEnd: 120, minDamageMult: 0.68, muzzleVelocity: 330, gravityMult: 0.20, maxRange: 180, pellets: 1, penetration: 2 },
  kar98:   { damage: 95,  headshotMult: 2.4,  falloffStart: 70, falloffEnd: 180, minDamageMult: 0.72, muzzleVelocity: 360, gravityMult: 0.18, maxRange: 220, pellets: 1, penetration: 3 },
  vector:  { damage: 16,  headshotMult: 2.0,  falloffStart: 8,  falloffEnd: 32,  minDamageMult: 0.42, muzzleVelocity: 165, gravityMult: 0.45, maxRange: 45,  pellets: 1, penetration: 0 },
  ump45:   { damage: 22,  headshotMult: 2.0,  falloffStart: 12, falloffEnd: 42,  minDamageMult: 0.48, muzzleVelocity: 175, gravityMult: 0.42, maxRange: 55,  pellets: 1, penetration: 1 },
  m249:    { damage: 26,  headshotMult: 2.15, falloffStart: 22, falloffEnd: 85,  minDamageMult: 0.52, muzzleVelocity: 250, gravityMult: 0.30, maxRange: 110, pellets: 1, penetration: 2 },
};

/** Maximum damage per shot for each weapon (server uses to clamp client reports) */
export const WEAPON_DAMAGE = Object.fromEntries(
  Object.entries(WEAPON_BALLISTICS).map(([id, w]) => [id, Math.ceil(w.damage * w.headshotMult * w.pellets)])
);

export const WEAPON_IDS = Object.keys(WEAPON_BALLISTICS);

export const MAP = {
  W: 64, H: 8, D: 64,
};

export const TEAMS = ['red', 'blue'];

/** World gravity (units/s²) — shared between client physics and server ballistics validation */
export const WORLD_GRAVITY = 22;

// ─────────────────────────────────────────────────────────────
// Game modes
// ─────────────────────────────────────────────────────────────
export const GAME_MODES = {
  multiplayer: {
    id: 'multiplayer',
    label: '멀티플레이 (팀 데스매치)',
    teams: true,
    maxPlayers: 20,
    roundDurationSec: 300,
    botsAllowed: true,
    respawns: true,
    shrinkingZone: false,
  },
  battle_royale: {
    id: 'battle_royale',
    label: '배틀로얄',
    teams: false,
    maxPlayers: 64,
    roundDurationSec: 1200,
    botsAllowed: true,
    respawns: false,
    shrinkingZone: true,
    zoneShrinkIntervalSec: 45,
    zoneMinRadius: 6,
  },
  training: {
    id: 'training',
    label: '훈련 (개인 서버)',
    teams: false,
    maxPlayers: 1,
    roundDurationSec: 0, // unlimited; ends only by TTL
    botsAllowed: true,
    respawns: true,
    shrinkingZone: false,
    isPersonal: true,
    ttlSec: 3600, // 1 hour
  },
};

export const GAME_MODE_IDS = Object.keys(GAME_MODES);

// ─────────────────────────────────────────────────────────────
// Server registry — shared shape between control-plane and clients
// ─────────────────────────────────────────────────────────────

/** Server kinds tracked by the control-plane registry */
export const SERVER_KIND = {
  REGION: 'region',     // long-lived, regional, auto-provisioned on demand
  CUSTOM: 'custom',     // user-created, has owner + TTL
};

export const SERVER_STATUS = {
  PROVISIONING: 'provisioning',
  ACTIVE: 'active',
  DRAINING: 'draining',
  DEAD: 'dead',
};

/** Capacity thresholds the control-plane uses to decide on scaling actions */
export const SCALING = {
  SCALE_UP_THRESHOLD: 0.8,    // spin up a sibling once a region's active worker(s) hit 80% avg fill
  SCALE_DOWN_THRESHOLD: 0.15, // mark drain-eligible once sustained below 15% (and >1 worker in region)
  MIN_WORKERS_PER_REGION: 1,
  MAX_WORKERS_PER_REGION: 8,
  HEALTHCHECK_INTERVAL_SEC: 20,
  SCALE_COOLDOWN_SEC: 60,      // don't scale the same region more than once per cooldown
};

export const REGIONS = [
  { id: 'asia-1',  name: 'Asia #1',  region: 'Seoul',       flag: '🇰🇷', locationHint: 'apac' },
  { id: 'asia-2',  name: 'Asia #2',  region: 'Tokyo',       flag: '🇯🇵', locationHint: 'apac' },
  { id: 'asia-3',  name: 'Asia #3',  region: 'Singapore',   flag: '🇸🇬', locationHint: 'apac' },
  { id: 'eu-1',    name: 'EU #1',    region: 'Frankfurt',   flag: '🇩🇪', locationHint: 'weur' },
  { id: 'us-west', name: 'US West',  region: 'Los Angeles', flag: '🇺🇸', locationHint: 'wnam' },
  { id: 'us-east', name: 'US East',  region: 'New York',    flag: '🇺🇸', locationHint: 'enam' },
];
