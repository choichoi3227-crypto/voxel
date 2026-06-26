#!/usr/bin/env node
// scripts/build.js
// ─────────────────────────────────────────────────────────────
// Simple bundler: reads src/ modules and outputs public/game.js
// using native Node.js (no webpack/vite needed for Cloudflare Workers Sites)
// ─────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, '..', 'src');
const DIST = path.join(__dirname, '..', 'public');

if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

// Order matters: dependencies first
const FILES = [
  'game/map.js',
  'game/weapons.js',
  'game/physics.js',
  'game/bots.js',
  'game/renderer.js',
  'game/network.js',
  'ui/hud.js',
  'ui/menu.js',
  'game/game.js',
  'main.js',
];

let bundle = `// VOXEL STRIKE — Bundled ${new Date().toISOString()}\n'use strict';\n\n`;

for (const file of FILES) {
  const full = path.join(SRC, file);
  if (!fs.existsSync(full)) { console.warn('Missing:', file); continue; }
  let src = fs.readFileSync(full, 'utf8');
  // Strip ES module import/export for simple concat bundle
  src = src
    .replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^export\s+(default\s+)?/gm, '')
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  bundle += `\n// ── ${file} ──\n${src}\n`;
}

// Wrap in IIFE
bundle = `(function(){\n${bundle}\n})();\n`;

const outFile = path.join(DIST, 'game.js');
fs.writeFileSync(outFile, bundle);
console.log(`✓ Built ${outFile} (${(bundle.length/1024).toFixed(1)} KB)`);

// Copy index.html (just reference game.js)
const indexSrc = path.join(__dirname, '..', 'public', 'index.html');
if (!fs.existsSync(indexSrc)) {
  console.log('⚠ public/index.html not found — skipping HTML copy');
} else {
  console.log('✓ public/index.html already exists');
}

console.log('Build complete.');
