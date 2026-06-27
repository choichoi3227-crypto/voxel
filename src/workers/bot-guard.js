// src/workers/bot-guard.js
import { botVerdict } from './protocol.js';

export function blockBadBots(request) {
  const verdict = botVerdict(request);
  if (verdict.allow) return null;
  return new Response('Forbidden', {
    status: 403,
    headers: {
      'X-Bot-Guard': verdict.reason,
      'Cache-Control': 'no-store',
    },
  });
}
