// src/control-plane/bundle-game-worker.js
// ─────────────────────────────────────────────────────────────
// Bundles src/workers/*.js into a single ES module string so the
// control-plane can upload it as a brand-new Worker script via the
// Cloudflare API (deployWorkerScript). This avoids needing a build
// step / external bundler dependency inside the control-plane Worker
// itself — it just concatenates the already-ESM-clean source files
// from src/workers/, which only import from each other (no npm deps).
//
// IMPORTANT: This module is loaded inside the control-plane Worker at
// request time via static imports of the *source text*. Cloudflare
// Workers can't read its own deployed sibling files from disk at
// runtime, so instead we inline the game-worker source as importable
// strings at control-plane BUILD time using Wrangler's text module
// support (see wrangler config: rules = [{type="Text", globs=[...]}]).
// ─────────────────────────────────────────────────────────────

// Each of these is pulled in as raw text by Wrangler's [[rules]] Text
// loader (configured in control-plane/wrangler.toml) so the control-
// plane worker can embed the full game-server source verbatim and ship
// it to the Cloudflare API when provisioning a new server.
import routerSrc      from '../workers/router.js?raw' assert { type: 'text' };
import wsHandlerSrc    from '../workers/ws-handler.js?raw' assert { type: 'text' };
import apiSrc          from '../workers/api.js?raw' assert { type: 'text' };
import roomRegistrySrc from '../workers/room-registry.js?raw' assert { type: 'text' };
import constantsSrc    from '../workers/constants.js?raw' assert { type: 'text' };
import ballisticsSrc   from '../workers/ballistics.js?raw' assert { type: 'text' };

/**
 * Produces a single-file ES module bundle equivalent to the multi-file
 * src/workers/ tree, with all relative imports between these six files
 * stripped and the modules concatenated in dependency order, each
 * wrapped in its own namespace object to avoid symbol collisions.
 *
 * We use a simple, safe approach: keep every file as its own module
 * scope via IIFE-style namespacing is unnecessary because Workers'
 * module upload API accepts MULTIPLE files per script (metadata.bindings
 * + multiple parts) — so we don't actually need to flatten imports at
 * all. See buildModuleParts() below, used by deploy.js instead of this
 * flattening approach. This function is kept as a fallback for
 * environments where only a single-file module upload is desired.
 */
export function buildModuleParts() {
  return {
    'router.js':         routerSrc,
    'ws-handler.js':      wsHandlerSrc,
    'api.js':             apiSrc,
    'room-registry.js':   roomRegistrySrc,
    'constants.js':       constantsSrc,
    'ballistics.js':      ballisticsSrc,
  };
}
