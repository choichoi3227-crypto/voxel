// src/workers/constants.js
// ─────────────────────────────────────────────────────────────
// Shared constants used by both server (Worker) and client.
// Keep in sync with src/game/weapons.js
// ─────────────────────────────────────────────────────────────

/** Maximum damage per shot for each weapon (server uses to clamp client reports) */
export const WEAPON_DAMAGE = {
  ak47:    28,
  m4a1:    24,
  awp:     120,
  mp5:     18,
  shotgun: 135,  // 15 × 9 pellets max
  deagle:  55,
};

export const WEAPON_IDS = Object.keys(WEAPON_DAMAGE);

export const MAP = {
  W: 64, H: 8, D: 64,
};

export const TEAMS = ['red', 'blue'];
