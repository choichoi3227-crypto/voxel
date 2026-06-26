// src/control-plane/cf-api.js
// ─────────────────────────────────────────────────────────────
// Thin wrapper around the Cloudflare REST API for deploying new game-
// server Worker scripts on demand. This is the ONLY place in the whole
// project allowed to hold the Cloudflare API token (env.CF_API_TOKEN),
// and the only place that calls api.cloudflare.com directly.
//
// All calls here happen inside request handlers / ctx.waitUntil — never
// at module scope — same global-scope discipline as the game workers.
// ─────────────────────────────────────────────────────────────

const CF_BASE = 'https://api.cloudflare.com/client/v4';

function authHeaders(env) {
  return {
    Authorization: `Bearer ${env.CF_API_TOKEN}`,
  };
}

/**
 * Upload (create or update) a Worker script as a multi-module ES Worker,
 * with the given KV namespace bindings and plaintext vars.
 *
 * `moduleParts` is a plain object { "router.js": "...", "api.js": "...", ... }
 * mirroring the exact file tree of src/workers/ — Cloudflare's module
 * upload API accepts multiple JS modules per script and resolves the
 * relative imports between them (`./api.js`, `./constants.js`, etc.)
 * exactly as they're written in source, so no bundling/flattening is
 * needed. `mainModule` names which part is the entry point.
 */
export async function deployWorkerScript(env, { scriptName, moduleParts, mainModule = 'router.js', kvBindings = [], vars = {}, compatibilityDate = '2024-09-23' }) {
  const metadata = {
    main_module: mainModule,
    compatibility_date: compatibilityDate,
    compatibility_flags: ['nodejs_compat'],
    bindings: [
      ...kvBindings.map(b => ({ type: 'kv_namespace', name: b.binding, namespace_id: b.id })),
      ...Object.entries(vars).map(([name, text]) => ({ type: 'plain_text', name, text: String(text) })),
    ],
  };

  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata));
  for (const [filename, body] of Object.entries(moduleParts)) {
    form.append(filename, new Blob([body], { type: 'application/javascript+module' }), filename);
  }

  const res = await fetch(`${CF_BASE}/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${scriptName}`, {
    method: 'PUT',
    headers: authHeaders(env),
    body: form,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`deployWorkerScript(${scriptName}) failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result;
}

/** Enable workers.dev subdomain routing for a script so it's reachable immediately. */
export async function enableWorkersDevRoute(env, scriptName) {
  const res = await fetch(`${CF_BASE}/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${scriptName}/subdomain`, {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`enableWorkersDevRoute(${scriptName}) failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result;
}

export async function listWorkerScripts(env) {
  const res = await fetch(`${CF_BASE}/accounts/${env.CF_ACCOUNT_ID}/workers/scripts`, {
    headers: authHeaders(env),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`listWorkerScripts failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data.result || [];
}

export async function deleteWorkerScript(env, scriptName) {
  const res = await fetch(`${CF_BASE}/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${scriptName}`, {
    method: 'DELETE',
    headers: authHeaders(env),
  });
  // 404 is fine — already gone.
  if (res.status === 404) return true;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    throw new Error(`deleteWorkerScript(${scriptName}) failed: ${JSON.stringify(data.errors || data)}`);
  }
  return true;
}

/** Builds the public URL for a deployed game-server worker on workers.dev. */
export function workerUrlFor(env, scriptName) {
  return `https://${scriptName}.${env.CF_WORKERS_DEV_SUBDOMAIN}.workers.dev`;
}
