// src/workers/protocol.js
// Realtime WebSocket protocol and load metrics shared by game workers.
export const WS_PROTOCOL_VERSION = 2;
export const SERVER_TICK_HZ = 20;
export const MAX_WS_MESSAGE_BYTES = 1024;
export const TRUSTED_BOT_UA = [/googlebot/i, /bingbot/i, /duckduckbot/i, /slurp/i, /facebookexternalhit/i, /twitterbot/i, /applebot/i];
export const BAD_BOT_UA = [/python-requests/i, /curl/i, /wget/i, /scrapy/i, /httpclient/i, /libwww/i, /masscan/i, /zgrab/i, /nikto/i, /sqlmap/i];

export function makeEnvelope(type, payload = {}, seq = 0) {
  return { v: WS_PROTOCOL_VERSION, type, seq, ts: Date.now(), ...payload };
}

export function parseEnvelope(raw) {
  if (typeof raw !== 'string' || raw.length > MAX_WS_MESSAGE_BYTES) return null;
  try {
    const msg = JSON.parse(raw);
    if (!msg || typeof msg.type !== 'string') return null;
    return msg;
  } catch {
    return null;
  }
}

export function scoreServerForPlayer(server, client = {}) {
  const fill = Math.min(1, (server.players || 0) / Math.max(1, server.maxPlayers || 20));
  const ping = Number.isFinite(server.ping) ? server.ping : estimateGeoLatency(server, client);
  const regionPenalty = server.locationHint && client.coloHint && server.locationHint !== client.coloHint ? 45 : 0;
  const customPenalty = server.kind === 'custom' ? 18 : 0;
  return Math.round(ping + regionPenalty + customPenalty + fill * 220 + (server.status === 'provisioning' ? 500 : 0));
}

export function pickBestServer(servers, client = {}) {
  return servers
    .filter(s => (s.status || 'active') === 'active' && (s.players || 0) < (s.maxPlayers || 20))
    .map(s => ({ ...s, placementScore: scoreServerForPlayer(s, client) }))
    .sort((a, b) => a.placementScore - b.placementScore)[0] || null;
}

export function estimateGeoLatency(server, client = {}) {
  if (server.locationHint && client.coloHint && server.locationHint === client.coloHint) return 35;
  if ((server.id || '').startsWith('asia')) return 95;
  if ((server.id || '').startsWith('us')) return 120;
  return 150;
}

export function botVerdict(request) {
  const ua = request.headers.get('user-agent') || '';
  if (!ua) return { allow: false, trusted: false, reason: 'missing_user_agent' };
  if (TRUSTED_BOT_UA.some(re => re.test(ua))) return { allow: true, trusted: true, reason: 'trusted_bot' };
  if (BAD_BOT_UA.some(re => re.test(ua))) return { allow: false, trusted: false, reason: 'bad_automation_ua' };
  return { allow: true, trusted: false, reason: 'browser_or_unknown' };
}
