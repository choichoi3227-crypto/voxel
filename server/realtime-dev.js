// Local realtime bridge used by GitHub Actions/dev smoke runs.
// Production realtime is Cloudflare Worker WebSocket code in src/workers/ws-handler.js.
const express = require('express');
const http = require('http');

const app = express();
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true, runtime: 'express-realtime-dev', durableObjects: false }));
app.get('/api/servers', (_req, res) => res.json([{ id: 'local-dev', name: 'Local Dev', region: 'CI', flag: '🧪', players: 0, maxPlayers: 64, status: 'active' }]));

const server = http.createServer(app);
const port = process.env.PORT || 8788;
server.listen(port, () => console.log(`Realtime dev server listening on :${port}`));
