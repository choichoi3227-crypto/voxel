// src/control-plane/game-worker-source.js
// ─────────────────────────────────────────────────────────────
// Re-exports the exact source text of every file under src/workers/
// so the control-plane can ship them verbatim to the Cloudflare API
// when provisioning a brand-new game-server Worker (deployWorkerScript
// accepts multiple named modules — see cf-api.js).
//
// The control-plane's wrangler.toml configures a Text module rule for
// these imports (see control-plane/wrangler.toml [[rules]]), which makes
// Wrangler inline the raw file contents as plain JS strings at BUILD
// time. No bundler, no flattening, no runtime filesystem access — the
// control-plane Worker just holds these strings in memory and re-uploads
// them as-is. Because they're the literal same files the region workers
// already run, a newly provisioned server is byte-for-byte identical to
// its siblings.
// ─────────────────────────────────────────────────────────────
import routerSrc       from '../workers/router.js';
import wsHandlerSrc     from '../workers/ws-handler.js';
import apiSrc           from '../workers/api.js';
import roomRegistrySrc  from '../workers/room-registry.js';
import constantsSrc     from '../workers/constants.js';
import ballisticsSrc    from '../workers/ballistics.js';

export function gameWorkerModuleParts() {
  return {
    'router.js':        routerSrc,
    'ws-handler.js':     wsHandlerSrc,
    'api.js':            apiSrc,
    'room-registry.js':  roomRegistrySrc,
    'constants.js':      constantsSrc,
    'ballistics.js':     ballisticsSrc,
  };
}
