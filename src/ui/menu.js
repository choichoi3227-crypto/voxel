// src/ui/menu.js
// ─────────────────────────────────────────────────────────────
// Main menu — fully responsive, mobile-friendly, mode selector
// ─────────────────────────────────────────────────────────────

const MODES = [
  {
    id: 'multiplayer',
    icon: '⚔️',
    label: '팀 데스매치',
    desc: '레드 vs 블루 · 팀 킬 경쟁 · 리스폰 무제한',
    badge: 'TEAM',
    color: '#ff3333',
  },
  {
    id: 'battle_royale',
    icon: '🏆',
    label: '배틀로얄',
    desc: '최후의 1인 생존 · 수축하는 안전구역 · 64명',
    badge: 'HOT',
    color: '#ff9900',
  },
  {
    id: 'training',
    icon: '🎯',
    label: '훈련 서버',
    desc: '혼자 연습 · 봇 상대 · 개인 서버 1시간',
    badge: 'SOLO',
    color: '#44aaff',
  },
];

export class Menu {
  constructor(container) {
    this.root     = container || document.body;
    this._el      = {};
    this.onPlay   = null;   // (serverObj) => void
    this._servers = [];
    this._settings = loadSettings();
    this._selectedMode = 'battle_royale';
    this._selectedServer = null;
    this._build();
  }

  // ── Public API ──────────────────────────────────────────────

  async loadWith(steps) {
    for (const { pct, text } of steps) {
      if (this._el['load-bar'])  this._el['load-bar'].style.width  = pct + '%';
      if (this._el['load-text']) this._el['load-text'].textContent = text;
      await sleep(240);
    }
    await sleep(280);
    this._el['screen-loading'].style.display = 'none';
    this._el['screen-menu'].style.display = 'flex';
  }

  hideMenu()       { if (this._el['screen-menu'])    this._el['screen-menu'].style.display    = 'none'; }
  showMenu()       { if (this._el['screen-menu'])    this._el['screen-menu'].style.display    = 'flex'; }
  showPointerMsg() { if (this._el['screen-pointer']) this._el['screen-pointer'].style.display = 'flex'; }
  hidePointerMsg() { if (this._el['screen-pointer']) this._el['screen-pointer'].style.display = 'none'; }

  get playerName() {
    const v = this._el['name-input']?.value?.trim();
    return v || ('Player' + Math.floor(Math.random() * 9999));
  }
  get settings() { return this._settings; }

  populateServers(servers) {
    this._servers = servers;
    this._renderServers();
  }

  populateLeaderboard(entries) {
    const tbody = this._el['lb-body'];
    if (!tbody) return;
    if (!entries.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="vs-lb-empty">데이터 없음</td></tr>';
      return;
    }
    tbody.innerHTML = entries.slice(0, 20).map((e, i) => `
      <tr class="vs-lb-row">
        <td class="vs-lb-rank ${i < 3 ? 'top' : ''}">${i < 3 ? ['🥇','🥈','🥉'][i] : i+1}</td>
        <td class="vs-lb-name">${e.name}</td>
        <td class="vs-lb-num">${e.kills}</td>
        <td class="vs-lb-kd">${e.kd}</td>
      </tr>`).join('');
  }

  // ── Build ───────────────────────────────────────────────────

  _build() {
    const style = document.createElement('style');
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&family=Share+Tech+Mono&display=swap');

      :root {
        --vs-red:    #ff3333;
        --vs-orange: #ff7700;
        --vs-blue:   #3399ff;
        --vs-bg:     #07090d;
        --vs-panel:  rgba(10,14,22,0.97);
        --vs-border: rgba(255,51,51,0.15);
        --vs-text:   #c8d0dc;
        --vs-muted:  #48505a;
      }

      .vs-root { font-family: 'Rajdhani', 'Courier New', monospace; }

      /* ── Loading ── */
      #vs-loading {
        position: fixed; inset: 0; background: var(--vs-bg);
        display: flex; flex-direction: column; align-items: center;
        justify-content: center; z-index: 2000; gap: 16px;
      }
      .vs-logo-big {
        font-size: clamp(32px, 8vw, 64px); font-weight: 700;
        color: var(--vs-red); letter-spacing: clamp(4px,2vw,12px);
        text-shadow: 0 0 40px var(--vs-red), 0 0 80px rgba(255,0,0,.2);
        animation: vs-pulse 2s infinite;
      }
      .vs-tagline { font-size: 11px; color: var(--vs-muted); letter-spacing: 4px; }
      .vs-load-track {
        width: min(300px, 75vw); height: 3px; background: #111; border-radius: 2px; overflow: hidden;
      }
      #vs-load-bar {
        height: 100%; background: var(--vs-red); width: 0;
        box-shadow: 0 0 10px var(--vs-red); transition: width .3s ease;
      }
      #vs-load-text { font-size: 11px; color: var(--vs-muted); letter-spacing: 3px; }

      /* ── Menu root ── */
      #vs-menu {
        position: fixed; inset: 0; z-index: 900;
        display: none; flex-direction: column;
        overflow-y: auto; overflow-x: hidden;
        background: var(--vs-bg);
      }

      /* ── Animated BG ── */
      #vs-bg-canvas {
        position: fixed; inset: 0; opacity: .12;
        pointer-events: none; z-index: 0;
      }

      /* ── Layout ── */
      .vs-inner {
        position: relative; z-index: 1;
        display: flex; flex-direction: column;
        align-items: center;
        min-height: 100%;
        padding: clamp(16px, 4vw, 40px) clamp(12px, 4vw, 32px);
        gap: clamp(14px, 2.5vh, 24px);
      }

      /* ── Header ── */
      .vs-header { text-align: center; }
      .vs-logo {
        font-size: clamp(28px, 6vw, 52px); font-weight: 700;
        color: var(--vs-red); letter-spacing: clamp(3px, 1.5vw, 10px);
        text-shadow: 0 0 30px var(--vs-red);
        animation: vs-pulse 2.5s infinite;
      }
      .vs-subtitle { font-size: clamp(9px, 1.5vw, 11px); color: var(--vs-muted); letter-spacing: 4px; margin-top: 4px; }

      /* ── Name row ── */
      .vs-name-row {
        display: flex; align-items: center; gap: 10px;
        width: 100%; max-width: 480px;
        background: rgba(255,51,51,.05);
        border: 1px solid var(--vs-border);
        border-radius: 8px; padding: 10px 16px;
      }
      .vs-name-label { font-size: 11px; color: var(--vs-muted); letter-spacing: 2px; white-space: nowrap; }
      #vs-name {
        flex: 1; background: transparent; border: none;
        color: var(--vs-text); font-family: inherit; font-size: 15px;
        font-weight: 600; outline: none; min-width: 0;
      }
      #vs-name::placeholder { color: var(--vs-muted); }

      /* ── Tabs ── */
      .vs-tabs {
        display: flex; gap: 6px; flex-wrap: wrap; justify-content: center;
        width: 100%; max-width: 560px;
      }
      .vs-tab {
        background: transparent; border: 1px solid var(--vs-border);
        color: var(--vs-muted); padding: 8px 18px;
        cursor: pointer; font-family: inherit; font-size: 12px;
        letter-spacing: 2px; border-radius: 6px;
        transition: all .15s; white-space: nowrap;
      }
      .vs-tab:hover, .vs-tab.active {
        border-color: var(--vs-red); color: var(--vs-red);
        background: rgba(255,51,51,.08);
      }

      /* ── Panels ── */
      .vs-panel {
        width: 100%; max-width: 720px;
        display: none; flex-direction: column; gap: 16px;
      }
      .vs-panel.active { display: flex; }

      /* ── Mode cards ── */
      .vs-modes {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 10px;
      }
      .vs-mode-card {
        border: 2px solid var(--vs-border); border-radius: 10px;
        padding: 16px; cursor: pointer;
        transition: all .18s; position: relative; overflow: hidden;
        background: rgba(255,255,255,.02);
      }
      .vs-mode-card:hover { transform: translateY(-2px); }
      .vs-mode-card.selected {
        background: rgba(255,51,51,.08);
      }
      .vs-mode-icon { font-size: 28px; margin-bottom: 8px; }
      .vs-mode-label { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px; }
      .vs-mode-desc { font-size: 11px; color: var(--vs-muted); line-height: 1.5; }
      .vs-mode-badge {
        position: absolute; top: 10px; right: 10px;
        font-size: 9px; letter-spacing: 2px;
        padding: 2px 7px; border-radius: 4px;
        font-weight: 700; background: var(--vs-red); color: #fff;
      }
      .vs-mode-check {
        position: absolute; bottom: 10px; right: 10px;
        font-size: 18px; opacity: 0; transition: opacity .15s;
      }
      .vs-mode-card.selected .vs-mode-check { opacity: 1; }

      /* ── Server list ── */
      .vs-server-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 8px;
      }
      .vs-server-card {
        background: rgba(255,255,255,.025);
        border: 1px solid var(--vs-border);
        border-radius: 8px; padding: 14px;
        cursor: pointer; transition: all .15s;
        display: flex; flex-direction: column; gap: 5px;
      }
      .vs-server-card:not(.full):hover {
        border-color: var(--vs-red); background: rgba(255,51,51,.07);
        transform: translateY(-2px);
      }
      .vs-server-card.selected { border-color: var(--vs-red); background: rgba(255,51,51,.12); }
      .vs-server-card.full { opacity: .38; cursor: not-allowed; }
      .vs-srv-name { font-size: 14px; font-weight: 700; color: #ff6644; }
      .vs-srv-region { font-size: 11px; color: var(--vs-muted); }
      .vs-srv-row { display: flex; justify-content: space-between; font-size: 11px; }
      .vs-srv-players { color: var(--vs-text); }
      .vs-srv-ping { font-weight: 600; }
      .vs-srv-bar {
        height: 3px; border-radius: 2px; background: #1a2030; overflow: hidden; margin-top: 2px;
      }
      .vs-srv-bar-fill { height: 100%; border-radius: 2px; transition: width .3s; }
      .vs-srv-selected-tag {
        font-size: 10px; color: var(--vs-red); letter-spacing: 1px; display: none;
      }
      .vs-server-card.selected .vs-srv-selected-tag { display: block; }

      /* ── Play button area ── */
      .vs-play-row {
        display: flex; gap: 10px; flex-wrap: wrap; justify-content: center;
      }
      .vs-btn {
        background: var(--vs-red); color: #fff; border: none;
        padding: 14px 32px; font-family: inherit; font-size: 14px;
        font-weight: 700; letter-spacing: 3px; cursor: pointer;
        border-radius: 6px; transition: all .18s; text-transform: uppercase;
        white-space: nowrap;
      }
      .vs-btn:hover { background: #ff5555; box-shadow: 0 0 22px rgba(255,51,51,.5); transform: translateY(-2px); }
      .vs-btn:active { transform: translateY(0); }
      .vs-btn.sec {
        background: transparent; border: 1px solid var(--vs-border);
        color: var(--vs-muted); font-size: 12px; padding: 12px 20px;
      }
      .vs-btn.sec:hover { border-color: var(--vs-red); color: var(--vs-red); background: rgba(255,51,51,.06); box-shadow: none; }

      /* ── Settings ── */
      .vs-settings { display: flex; flex-direction: column; gap: 18px; }
      .vs-setting-label {
        font-size: 12px; color: var(--vs-muted); letter-spacing: 1px;
        display: flex; justify-content: space-between; margin-bottom: 6px;
      }
      .vs-setting-label span { color: var(--vs-text); font-weight: 600; }
      input[type=range].vs-slider {
        width: 100%; -webkit-appearance: none; background: transparent; cursor: pointer;
      }
      input[type=range].vs-slider::-webkit-slider-runnable-track {
        height: 4px; border-radius: 2px;
        background: linear-gradient(90deg, var(--vs-red) var(--pct,50%), #1e2530 var(--pct,50%));
      }
      input[type=range].vs-slider::-webkit-slider-thumb {
        -webkit-appearance: none; width: 16px; height: 16px;
        border-radius: 50%; background: #fff;
        border: 2px solid var(--vs-red); margin-top: -6px;
        box-shadow: 0 0 8px rgba(255,51,51,.4);
      }
      input[type=range].vs-slider::-moz-range-track {
        height: 4px; border-radius: 2px; background: #1e2530;
      }
      input[type=range].vs-slider::-moz-range-progress { background: var(--vs-red); }
      input[type=range].vs-slider::-moz-range-thumb {
        width: 16px; height: 16px; border-radius: 50%;
        background: #fff; border: 2px solid var(--vs-red);
      }
      .vs-toggle-row { display: flex; justify-content: space-between; align-items: center; }
      .vs-toggle-label { font-size: 13px; color: var(--vs-text); }
      .vs-toggle {
        position: relative; display: inline-block; width: 42px; height: 24px;
      }
      .vs-toggle input { opacity: 0; width: 0; height: 0; }
      .vs-toggle-track {
        position: absolute; inset: 0; border-radius: 12px;
        background: #1e2530; cursor: pointer; transition: background .2s;
      }
      .vs-toggle-track::after {
        content: ''; position: absolute; left: 3px; top: 3px;
        width: 18px; height: 18px; border-radius: 50%;
        background: #fff; transition: transform .2s;
      }
      .vs-toggle input:checked + .vs-toggle-track { background: var(--vs-red); }
      .vs-toggle input:checked + .vs-toggle-track::after { transform: translateX(18px); }

      /* ── Leaderboard ── */
      .vs-lb-table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .vs-lb-table th {
        color: var(--vs-red); padding: 8px 12px;
        border-bottom: 1px solid var(--vs-border); text-align: left;
        font-size: 11px; letter-spacing: 2px;
      }
      .vs-lb-row { border-bottom: 1px solid rgba(255,255,255,.04); transition: background .1s; }
      .vs-lb-row:hover { background: rgba(255,51,51,.05); }
      .vs-lb-rank { padding: 8px 12px; color: var(--vs-muted); min-width: 40px; }
      .vs-lb-rank.top { font-size: 16px; }
      .vs-lb-name { padding: 8px 12px; color: var(--vs-text); font-weight: 600; }
      .vs-lb-num  { padding: 8px 12px; text-align: center; color: #fff; font-weight: 700; }
      .vs-lb-kd   { padding: 8px 12px; text-align: center; color: #44ff88; font-weight: 600; }
      .vs-lb-empty { text-align: center; color: var(--vs-muted); padding: 28px; }

      /* ── Help text ── */
      .vs-hint { font-size: 11px; color: #222; letter-spacing: 2px; text-align: center; }

      /* ── Pointer lock ── */
      #vs-pointer {
        display: none; position: fixed; inset: 0;
        background: rgba(0,0,0,.75); backdrop-filter: blur(8px);
        flex-direction: column; align-items: center; justify-content: center;
        z-index: 200; gap: 12px; font-family: inherit;
      }
      .vs-pointer-title { font-size: clamp(24px, 5vw, 36px); font-weight: 700; color: #fff; }
      .vs-pointer-sub   { font-size: 13px; color: #777; }

      /* ── Animations ── */
      @keyframes vs-pulse {
        0%,100% { text-shadow: 0 0 30px var(--vs-red); }
        50%      { text-shadow: 0 0 55px #ff6666, 0 0 90px rgba(255,0,0,.35); }
      }
      @keyframes vs-fadein {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .vs-panel.active { animation: vs-fadein .2s ease; }

      /* ── Responsive tweaks ── */
      @media (max-width: 480px) {
        .vs-modes { grid-template-columns: 1fr; }
        .vs-play-row { flex-direction: column; align-items: stretch; }
        .vs-btn { text-align: center; }
        .vs-tabs { gap: 4px; }
        .vs-tab { padding: 7px 12px; font-size: 11px; }
      }
    `;
    document.head.appendChild(style);

    const html = `
    <div class="vs-root">

      <!-- Loading -->
      <div id="vs-loading">
        <div class="vs-logo-big">VOXEL STRIKE</div>
        <div class="vs-tagline">TACTICAL BROWSER FPS</div>
        <div class="vs-load-track">
          <div id="vs-load-bar"></div>
        </div>
        <div id="vs-load-text">INITIALIZING...</div>
      </div>

      <!-- Menu -->
      <div id="vs-menu">
        <canvas id="vs-bg-canvas"></canvas>
        <div class="vs-inner">

          <!-- Header -->
          <div class="vs-header">
            <div class="vs-logo">VOXEL STRIKE</div>
            <div class="vs-subtitle">TACTICAL FPS · BROWSER EDITION</div>
          </div>

          <!-- Nickname -->
          <div class="vs-name-row">
            <div class="vs-name-label">닉네임</div>
            <input id="vs-name" type="text" placeholder="PlayerXXXX" maxlength="20" autocomplete="off" spellcheck="false"/>
          </div>

          <!-- Tabs -->
          <div class="vs-tabs">
            <button class="vs-tab active" data-tab="play">🎮 플레이</button>
            <button class="vs-tab" data-tab="servers">🌐 서버</button>
            <button class="vs-tab" data-tab="settings">⚙ 설정</button>
            <button class="vs-tab" data-tab="leaderboard">🏆 랭킹</button>
          </div>

          <!-- PLAY panel -->
          <div class="vs-panel active" id="vs-panel-play">
            <div class="vs-modes" id="vs-modes"></div>
            <div class="vs-play-row">
              <button class="vs-btn" id="vs-btn-play">▶ 지금 플레이</button>
              <button class="vs-btn sec" id="vs-btn-quickplay">⚡ 빠른 게임</button>
            </div>
          </div>

          <!-- SERVERS panel -->
          <div class="vs-panel" id="vs-panel-servers">
            <div class="vs-server-grid" id="vs-server-grid"></div>
            <div class="vs-play-row">
              <button class="vs-btn" id="vs-btn-srv-play">▶ 이 서버로 플레이</button>
              <button class="vs-btn sec" id="vs-btn-create">＋ 개인 서버 만들기</button>
              <button class="vs-btn sec" id="vs-btn-refresh">↺ 새로고침</button>
            </div>
          </div>

          <!-- SETTINGS panel -->
          <div class="vs-panel" id="vs-panel-settings">
            <div class="vs-settings">
              <div>
                <div class="vs-setting-label">마우스 감도 <span id="lbl-sens">2.0</span></div>
                <input class="vs-slider" type="range" id="sl-sens" min="0.5" max="6" step="0.1" value="2.0">
              </div>
              <div>
                <div class="vs-setting-label">시야각 (FOV) <span id="lbl-fov">75</span>°</div>
                <input class="vs-slider" type="range" id="sl-fov" min="60" max="110" step="1" value="75">
              </div>
              <div>
                <div class="vs-setting-label">렌더 해상도 <span id="lbl-res">100</span>%</div>
                <input class="vs-slider" type="range" id="sl-res" min="50" max="100" step="10" value="100">
              </div>
              <div class="vs-toggle-row">
                <span class="vs-toggle-label">사운드</span>
                <label class="vs-toggle"><input type="checkbox" id="cb-sound" checked><span class="vs-toggle-track"></span></label>
              </div>
              <div class="vs-toggle-row">
                <span class="vs-toggle-label">ADS (우클릭 조준)</span>
                <label class="vs-toggle"><input type="checkbox" id="cb-ads" checked><span class="vs-toggle-track"></span></label>
              </div>
              <button class="vs-btn" id="vs-btn-save" style="margin-top:4px">저장</button>
            </div>
          </div>

          <!-- LEADERBOARD panel -->
          <div class="vs-panel" id="vs-panel-leaderboard">
            <table class="vs-lb-table">
              <thead><tr>
                <th>#</th><th>플레이어</th><th>킬</th><th>K/D</th>
              </tr></thead>
              <tbody id="vs-lb-body"><tr><td class="vs-lb-empty" colspan="4">불러오는 중...</td></tr></tbody>
            </table>
          </div>

          <div class="vs-hint">WASD 이동 &nbsp;·&nbsp; 마우스 조준 &nbsp;·&nbsp; LMB 사격 &nbsp;·&nbsp; R 재장전 &nbsp;·&nbsp; TAB 점수판</div>

        </div>
      </div>

      <!-- Pointer lock -->
      <div id="vs-pointer">
        <div class="vs-pointer-title">⊕ 클릭해서 재개</div>
        <div class="vs-pointer-sub">ESC → 메뉴로 돌아가기</div>
      </div>

    </div>`;

    this.root.insertAdjacentHTML('beforeend', html);

    // Cache
    const ids = [
      'vs-loading','vs-load-bar','vs-load-text',
      'vs-menu','vs-bg-canvas',
      'vs-name',
      'vs-modes','vs-server-grid',
      'vs-btn-play','vs-btn-quickplay','vs-btn-srv-play','vs-btn-create','vs-btn-refresh',
      'vs-panel-play','vs-panel-servers','vs-panel-settings','vs-panel-leaderboard',
      'sl-sens','lbl-sens','sl-fov','lbl-fov','sl-res','lbl-res',
      'cb-sound','cb-ads','vs-btn-save',
      'vs-lb-body','vs-pointer',
    ];
    for (const id of ids) this._el[id] = document.getElementById(id);

    this._buildModeCards();
    this._renderServers();
    this._bindEvents();
    this._applySettings();
    this._startBg();
    this._fetchServers();
  }

  // ── Mode cards ──────────────────────────────────────────────

  _buildModeCards() {
    const container = this._el['vs-modes'];
    if (!container) return;
    container.innerHTML = '';
    for (const m of MODES) {
      const card = document.createElement('div');
      card.className = 'vs-mode-card' + (m.id === this._selectedMode ? ' selected' : '');
      card.dataset.mode = m.id;
      card.style.setProperty('--mode-color', m.color);
      card.innerHTML = `
        <div class="vs-mode-icon">${m.icon}</div>
        <div class="vs-mode-label">${m.label}</div>
        <div class="vs-mode-desc">${m.desc}</div>
        <div class="vs-mode-badge" style="background:${m.color}">${m.badge}</div>
        <div class="vs-mode-check">✓</div>
      `;
      // border color on selected
      if (m.id === this._selectedMode) card.style.borderColor = m.color;
      card.addEventListener('click', () => {
        this._selectedMode = m.id;
        container.querySelectorAll('.vs-mode-card').forEach(c => {
          const mid = c.dataset.mode;
          const mc = MODES.find(x => x.id === mid);
          c.classList.remove('selected');
          c.style.borderColor = '';
        });
        card.classList.add('selected');
        card.style.borderColor = m.color;
      });
      container.appendChild(card);
    }
  }

  // ── Server rendering ────────────────────────────────────────

  _renderServers() {
    const grid = this._el['vs-server-grid'];
    if (!grid) return;
    if (!this._servers.length) {
      grid.innerHTML = '<div style="color:var(--vs-muted);font-size:13px;padding:20px;text-align:center">서버 불러오는 중...</div>';
      return;
    }
    grid.innerHTML = '';
    for (const s of this._servers) {
      const fill     = Math.min(1, (s.players || 0) / Math.max(1, s.maxPlayers || 20));
      const full     = s.players >= s.maxPlayers;
      const ping     = s.ping ?? '?';
      const pingColor = typeof ping === 'number'
        ? (ping < 60 ? '#44ff88' : ping < 120 ? '#ffcc44' : '#ff4444') : '#888';
      const fillColor = fill > .8 ? '#ff4444' : fill > .5 ? '#ffaa44' : '#44cc88';

      const card = document.createElement('div');
      card.className = 'vs-server-card' + (full ? ' full' : '') + (this._selectedServer?.id === s.id ? ' selected' : '');
      card.innerHTML = `
        <div class="vs-srv-name">${s.flag || ''} ${s.name}</div>
        <div class="vs-srv-region">${s.region}</div>
        <div class="vs-srv-row">
          <span class="vs-srv-players">${s.players}/${s.maxPlayers}명${full ? ' · FULL' : ''}</span>
          <span class="vs-srv-ping" style="color:${pingColor}">${ping}ms</span>
        </div>
        <div class="vs-srv-bar">
          <div class="vs-srv-bar-fill" style="width:${Math.round(fill*100)}%;background:${fillColor}"></div>
        </div>
        <div class="vs-srv-selected-tag">✓ 선택됨</div>
      `;
      if (!full) {
        card.addEventListener('click', () => {
          this._selectedServer = s;
          grid.querySelectorAll('.vs-server-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        });
      }
      grid.appendChild(card);
    }
  }

  // ── Events ──────────────────────────────────────────────────

  _bindEvents() {
    // Tabs
    document.querySelectorAll('.vs-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.vs-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const panels = { play:'vs-panel-play', servers:'vs-panel-servers', settings:'vs-panel-settings', leaderboard:'vs-panel-leaderboard' };
        document.querySelectorAll('.vs-panel').forEach(p => p.classList.remove('active'));
        document.getElementById(panels[tab])?.classList.add('active');
        if (tab === 'leaderboard') this._fetchLeaderboard();
        if (tab === 'servers') this._fetchServers();
      });
    });

    // Play button (mode panel)
    this._el['vs-btn-play']?.addEventListener('click', () => this._doPlay());

    // Quick play
    this._el['vs-btn-quickplay']?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/matchmake', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ modeId: this._selectedMode }),
          signal: AbortSignal.timeout(3000),
        });
        const data = await res.json();
        if (data?.server) return this.onPlay?.({ ...data.server, wsPath: data.wsPath, modeId: this._selectedMode });
      } catch (_) {}
      this._doPlay();
    });

    // Server panel play
    this._el['vs-btn-srv-play']?.addEventListener('click', () => {
      if (this._selectedServer) {
        this.onPlay?.({ ...this._selectedServer, modeId: this._selectedMode });
      } else {
        this._doPlay();
      }
    });

    // Create server
    this._el['vs-btn-create']?.addEventListener('click', async () => {
      const ownerName = this.playerName;
      try {
        const res = await fetch('/api/servers/custom', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerName, maxPlayers: 64, ttlSec: 7200 }),
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        if (data?.server) {
          this._el['vs-btn-create'].textContent = '✓ 서버 생성됨';
          await this._fetchServers();
          setTimeout(() => { this._el['vs-btn-create'].textContent = '＋ 개인 서버 만들기'; }, 2000);
        }
      } catch { alert('서버 생성에 실패했습니다.'); }
    });

    // Refresh
    this._el['vs-btn-refresh']?.addEventListener('click', async () => {
      const btn = this._el['vs-btn-refresh'];
      btn.textContent = '↺ ...'; btn.disabled = true;
      await this._fetchServers();
      btn.textContent = '↺ 새로고침'; btn.disabled = false;
    });

    // Settings sliders
    for (const [key, lbl] of [['sl-sens','lbl-sens'],['sl-fov','lbl-fov'],['sl-res','lbl-res']]) {
      const sl = this._el[key]; const lb = this._el[lbl];
      if (!sl) continue;
      const update = () => {
        if (lb) lb.textContent = sl.value;
        const pct = ((sl.value - sl.min) / (sl.max - sl.min) * 100).toFixed(1) + '%';
        sl.style.setProperty('--pct', pct);
      };
      sl.addEventListener('input', update);
      update();
    }

    // Save settings
    this._el['vs-btn-save']?.addEventListener('click', () => {
      this._settings.sensitivity = parseFloat(this._el['sl-sens']?.value) || 2.0;
      this._settings.fov         = parseInt(this._el['sl-fov']?.value)   || 75;
      this._settings.renderScale = parseInt(this._el['sl-res']?.value)   || 100;
      this._settings.sound       = this._el['cb-sound']?.checked ?? true;
      this._settings.ads         = this._el['cb-ads']?.checked   ?? true;
      saveSettings(this._settings);
      const btn = this._el['vs-btn-save'];
      btn.textContent = '✓ 저장됨'; btn.style.background = '#22aa55';
      setTimeout(() => { btn.textContent = '저장'; btn.style.background = ''; }, 1400);
    });

    // Pointer lock
    this._el['vs-pointer']?.addEventListener('click', () => {
      document.getElementById('game-canvas')?.requestPointerLock();
    });
  }

  _doPlay() {
    const best = this._servers
      .filter(s => s.players < s.maxPlayers)
      .sort((a, b) => (a.placementScore ?? a.ping ?? 999) - (b.placementScore ?? b.ping ?? 999))[0];
    if (best) this.onPlay?.({ ...best, modeId: this._selectedMode });
    else if (this._servers.length) this.onPlay?.({ ...this._servers[0], modeId: this._selectedMode });
  }

  _applySettings() {
    const s = this._settings;
    const set = (id, val, lblId) => {
      if (this._el[id]) {
        this._el[id].value = val;
        const pct = ((val - this._el[id].min) / (this._el[id].max - this._el[id].min) * 100).toFixed(1) + '%';
        this._el[id].style.setProperty('--pct', pct);
      }
      if (lblId && this._el[lblId]) this._el[lblId].textContent = val;
    };
    set('sl-sens', s.sensitivity, 'lbl-sens');
    set('sl-fov',  s.fov,         'lbl-fov');
    set('sl-res',  s.renderScale, 'lbl-res');
    if (this._el['cb-sound']) this._el['cb-sound'].checked = s.sound;
    if (this._el['cb-ads'])   this._el['cb-ads'].checked   = s.ads;
  }

  // ── Data fetchers ────────────────────────────────────────────

  async _fetchServers() {
    try {
      const res  = await fetch('/api/servers', { signal: AbortSignal.timeout(3000) });
      const list = await res.json();
      for (const s of list) if (s.ping == null) s.ping = await estimatePing(s.id);
      this.populateServers(list);
    } catch {
      this.populateServers([
        { id:'asia-1',  name:'Asia #1',  region:'Seoul',       flag:'🇰🇷', players:0, maxPlayers:20, ping:12  },
        { id:'asia-2',  name:'Asia #2',  region:'Tokyo',       flag:'🇯🇵', players:0, maxPlayers:20, ping:28  },
        { id:'asia-3',  name:'Asia #3',  region:'Singapore',   flag:'🇸🇬', players:0, maxPlayers:20, ping:55  },
        { id:'eu-1',    name:'EU #1',    region:'Frankfurt',   flag:'🇩🇪', players:0, maxPlayers:20, ping:145 },
        { id:'us-west', name:'US West',  region:'Los Angeles', flag:'🇺🇸', players:0, maxPlayers:20, ping:180 },
        { id:'us-east', name:'US East',  region:'New York',    flag:'🇺🇸', players:0, maxPlayers:20, ping:200 },
      ]);
    }
  }

  async _fetchLeaderboard() {
    try {
      const res  = await fetch('/api/leaderboard?limit=20');
      const data = await res.json();
      this.populateLeaderboard(Array.isArray(data) ? data : []);
    } catch { this.populateLeaderboard([]); }
  }

  // ── Animated BG ──────────────────────────────────────────────

  _startBg() {
    const canvas = this._el['vs-bg-canvas'];
    if (!canvas) return;
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener('resize', resize);
    const ctx = canvas.getContext('2d');
    const stars = Array.from({ length: 100 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - .5) * .25,
      vy: (Math.random() - .5) * .25,
      r: Math.random() * 1.4 + .3,
    }));
    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        s.x = (s.x + s.vx + canvas.width)  % canvas.width;
        s.y = (s.y + s.vy + canvas.height) % canvas.height;
        ctx.fillStyle = `rgba(255,60,60,${0.25 + s.r / 4})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
}

// ── Helpers ──────────────────────────────────────────────────

function loadSettings() {
  try { const r = sessionStorage.getItem('vs_settings'); if (r) return JSON.parse(r); } catch (_) {}
  return { sensitivity: 2.0, fov: 75, renderScale: 100, sound: true, ads: true };
}
function saveSettings(s) {
  try { sessionStorage.setItem('vs_settings', JSON.stringify(s)); } catch (_) {}
}
async function estimatePing(serverId) {
  try {
    const t0 = Date.now();
    await fetch(`/api/room/${serverId}`, { signal: AbortSignal.timeout(2000) });
    return Date.now() - t0;
  } catch { return 999; }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
