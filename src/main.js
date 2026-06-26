// src/main.js
// Entry point — instantiate Game and start
import { Game } from './game/game.js';

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.start();
  // Expose for debug
  if (location.hostname === 'localhost') window._game = game;
});
