// src/workers/ballistics.js
// ─────────────────────────────────────────────────────────────
// Server-authoritative ballistics validation.
// The client predicts hits locally for responsiveness, but the SERVER
// recomputes max-allowed damage from first principles (distance falloff,
// max range, penetration count) before ever applying it to a victim.
// This is what makes "hit" reports tamper-resistant without needing the
// server to simulate full projectile flight per shot.
// ─────────────────────────────────────────────────────────────
import { WEAPON_BALLISTICS } from './constants.js';

/**
 * Compute the maximum legitimate damage for a single hit, given the
 * straight-line distance between shooter and victim at the moment of
 * the shot, and how many obstacles the round claims to have already
 * penetrated.
 *
 * Distance falloff model:
 *   - dist <= falloffStart        → full damage
 *   - falloffStart < dist < falloffEnd → linear interpolation down to minDamageMult
 *   - dist >= falloffEnd          → minDamageMult floor
 *   - dist >  maxRange            → 0 (out of range entirely)
 *
 * Penetration model:
 *   - each claimed penetration beyond the weapon's `penetration` stat is
 *     rejected outright (treated as 0 distance traveled through cover,
 *     i.e. damage forced to the post-penetration floor of 0).
 */
export function computeMaxDamage(weaponId, distance, opts = {}) {
  const w = WEAPON_BALLISTICS[weaponId];
  if (!w) return 0;

  const { penetrationsClaimed = 0, isHeadshot = false } = opts;

  if (distance > w.maxRange) return 0;
  if (penetrationsClaimed > w.penetration) return 0;

  let mult = 1;
  if (distance > w.falloffStart) {
    const t = Math.min(1, (distance - w.falloffStart) / Math.max(1, w.falloffEnd - w.falloffStart));
    mult = 1 - t * (1 - w.minDamageMult);
  }

  // Slight extra falloff per penetration already claimed (round loses energy)
  if (penetrationsClaimed > 0) {
    mult *= Math.pow(0.8, penetrationsClaimed);
  }

  let dmg = w.damage * mult;
  if (isHeadshot) dmg *= w.headshotMult;

  return Math.max(0, dmg);
}

/**
 * Estimate projectile travel time (seconds) for tracer/sound sync and for
 * sanity-bounding "instant" client hit reports (a hit reported with an
 * implausibly small travel time for the claimed distance is suspicious,
 * though we don't hard-reject on timing alone — network jitter is real).
 */
export function travelTimeSec(weaponId, distance) {
  const w = WEAPON_BALLISTICS[weaponId];
  if (!w) return 0;
  return distance / Math.max(1, w.muzzleVelocity);
}

/**
 * Vertical bullet drop (world units) accumulated over a given travel time,
 * used by the client to bend tracers/visuals to match what the server
 * will validate, and available here for any server-side recompute needs
 * (e.g. future replay/anti-cheat tooling).
 */
export function bulletDropAt(weaponId, t, worldGravity) {
  const w = WEAPON_BALLISTICS[weaponId];
  if (!w) return 0;
  return 0.5 * worldGravity * w.gravityMult * t * t;
}

/**
 * Clamp a client-reported damage value against the server-computed max for
 * the given distance/conditions. Never trust the client's raw number —
 * this always returns min(clientClaim, serverMax), floor 0.
 */
export function clampReportedDamage(weaponId, clientClaimedDamage, distance, opts = {}) {
  const serverMax = computeMaxDamage(weaponId, distance, opts);
  const claimed = Math.max(0, Number(clientClaimedDamage) || 0);
  return Math.min(claimed, serverMax);
}
