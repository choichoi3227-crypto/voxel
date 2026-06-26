#!/usr/bin/env node
// scripts/create-kv.js
// Run once to create all KV namespaces and patch wrangler configs
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const NAMESPACES = ['KV_LEADERBOARD','KV_SESSIONS','KV_ROOMS'];
const CONFIG_DIR = path.join(__dirname,'..','config');
const IDS = {};

console.log('Creating KV namespaces via wrangler...\n');

for (const ns of NAMESPACES) {
  try {
    const out  = execSync(`wrangler kv:namespace create "${ns}"`, { encoding:'utf8' });
    const prod = out.match(/id\s*=\s*"([^"]+)"/);
    const prev = out.match(/preview_id\s*=\s*"([^"]+)"/);
    IDS[ns] = { id: prod?.[1]||'', preview_id: prev?.[1]||'' };
    console.log(`✓ ${ns}: id=${IDS[ns].id}`);
  } catch(e) {
    console.warn(`✗ ${ns}: ${e.message.slice(0,80)}`);
    IDS[ns] = { id:'TODO', preview_id:'TODO' };
  }
}

// Patch all wrangler configs
const configs = [
  path.join(__dirname,'..','wrangler.toml'),
  ...fs.readdirSync(CONFIG_DIR).filter(f=>f.endsWith('.toml')).map(f=>path.join(CONFIG_DIR,f)),
];

for (const cfg of configs) {
  let src = fs.readFileSync(cfg,'utf8');
  for (const ns of NAMESPACES) {
    src = src.replace(`REPLACE_${ns}_ID`, IDS[ns].id);
    src = src.replace(`REPLACE_${ns}_PREVIEW_ID`, IDS[ns].preview_id);
  }
  fs.writeFileSync(cfg, src);
  console.log(`Patched ${path.basename(cfg)}`);
}

console.log('\nAll done. You can now run: npm run deploy:all');
