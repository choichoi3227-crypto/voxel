// src/ui/menu.js
// ─────────────────────────────────────────────────────────────
// Main menu: server list, settings, leaderboard, loading screen
// ─────────────────────────────────────────────────────────────

export class Menu {
  constructor(container) {
    this.root    = container || document.body;
    this._el     = {};
    this.onPlay  = null;   // (serverObj) => void
    this._servers = [];
    this._settings = loadSettings();
    this._build();
  }

  // ── Build ───────────────────────────────────────────────────

  _build() {
    this.root.insertAdjacentHTML('beforeend', `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
      :root{--red:#ff3333;--blue:#3366ff;--bg:#080c10;--panel:rgba(10,15,22,0.95);--border:rgba(255,51,51,0.18)}
      *{box-sizing:border-box;margin:0;padding:0}
      body{background:var(--bg);color:#e0e0e0;font-family:'Courier New',monospace;overflow:hidden}
      .menu-btn{background:var(--red);color:#fff;border:none;padding:13px 38px;font-family:inherit;font-size:15px;font-weight:bold;letter-spacing:3px;cursor:pointer;border-radius:3px;transition:all .18s;text-transform:uppercase}
      .menu-btn:hover{background:#ff5555;box-shadow:0 0 18px var(--red);transform:translateY(-2px)}
      .menu-btn.sec{background:transparent;border:1px solid var(--red);color:var(--red)}
      .menu-btn.sec:hover{background:rgba(255,51,51,.12)}
      input[type=text],input[type=range]{background:#0d1117;border:1px solid var(--border);color:#ddd;padding:8px 12px;font-family:inherit;font-size:13px;border-radius:3px;outline:none;width:100%}
      input[type=text]:focus{border-color:var(--red)}
      .tab-btn{background:transparent;border:1px solid var(--border);color:#aaa;padding:8px 20px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px;transition:all .15s;border-radius:3px}
      .tab-btn.active,.tab-btn:hover{border-color:var(--red);color:var(--red);background:rgba(255,51,51,.08)}
    </style>

    <!-- Loading Screen -->
    <div id="screen-loading" style="position:fixed;inset:0;background:#080c10;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2000;gap:18px">
      <div style="font-size:52px;font-weight:bold;color:var(--red);letter-spacing:10px;text-shadow:0 0 30px var(--red),0 0 60px rgba(255,0,0,.3);animation:pls 2s infinite">VOXEL STRIKE</div>
      <div style="font-size:11px;color:#444;letter-spacing:4px">TACTICAL BROWSER FPS</div>
      <div style="width:280px;height:3px;background:#111;border-radius:2px;overflow:hidden;margin-top:8px">
        <div id="load-bar" style="height:100%;background:var(--red);width:0;box-shadow:0 0 8px var(--red);transition:width .28s"></div>
      </div>
      <div id="load-text" style="font-size:11px;color:#555;letter-spacing:2px">INITIALIZING...</div>
      <style>@keyframes pls{0%,100%{text-shadow:0 0 30px var(--red)}50%{text-shadow:0 0 50px #ff6666,0 0 80px rgba(255,0,0,.4)}}</style>
    </div>

    <!-- Main Menu -->
    <div id="screen-menu" style="display:none;position:fixed;inset:0;z-index:900">
      <!-- Background animated particles -->
      <canvas id="menu-bg" style="position:absolute;inset:0;opacity:0.18"></canvas>

      <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:22px;padding:20px">

        <div style="text-align:center">
          <div style="font-size:56px;font-weight:bold;color:var(--red);letter-spacing:10px;text-shadow:0 0 30px var(--red)">VOXEL STRIKE</div>
          <div style="font-size:11px;color:#444;letter-spacing:5px;margin-top:4px">TACTICAL FPS — BROWSER EDITION</div>
        </div>

        <!-- Name input -->
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:12px;color:#666;letter-spacing:2px">닉네임</span>
          <input id="name-input" type="text" style="width:200px" placeholder="PlayerXXXX" maxlength="20"/>
        </div>

        <!-- Menu tabs -->
        <div style="display:flex;gap:8px">
          <button class="tab-btn active" id="tab-servers">SERVERS</button>
          <button class="tab-btn" id="tab-settings">SETTINGS</button>
          <button class="tab-btn" id="tab-leaderboard">LEADERBOARD</button>
        </div>

        <!-- SERVERS panel -->
        <div id="panel-servers" style="width:640px">
          <div id="server-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px"></div>
          <div style="display:flex;gap:10px;margin-top:14px;justify-content:center">
            <button class="menu-btn" id="btn-quickplay">▶ 지금 플레이</button>
            <button class="menu-btn sec" id="btn-create-server">＋ 서버 제작</button>
            <button class="menu-btn sec" id="btn-download">⬇ PC/Mobile 다운로드</button>
            <button class="menu-btn sec" id="btn-refresh">↺ REFRESH</button>
          </div>
        </div>

        <!-- SETTINGS panel -->
        <div id="panel-settings" style="display:none;width:420px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:22px;display:none;flex-direction:column;gap:14px">
          <div class="setting-row" data-key="sensitivity">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px;display:block;margin-bottom:4px">마우스 감도 <span id="lbl-sensitivity">2.0</span></label>
            <input type="range" id="sl-sensitivity" min="0.5" max="6" step="0.1" value="2.0">
          </div>
          <div class="setting-row" data-key="fov">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px;display:block;margin-bottom:4px">FOV <span id="lbl-fov">75</span>°</label>
            <input type="range" id="sl-fov" min="60" max="110" step="1" value="75">
          </div>
          <div class="setting-row" data-key="renderScale">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px;display:block;margin-bottom:4px">렌더 해상도 <span id="lbl-renderScale">100</span>%</label>
            <input type="range" id="sl-renderScale" min="50" max="100" step="10" value="100">
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px">사운드</label>
            <input type="checkbox" id="cb-sound" checked style="width:auto;cursor:pointer">
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <label style="font-size:12px;color:#aaa;letter-spacing:1px">ADS (우클릭 조준)</label>
            <input type="checkbox" id="cb-ads" checked style="width:auto;cursor:pointer">
          </div>
          <button class="menu-btn" id="btn-save-settings" style="width:100%;margin-top:4px">저장</button>
        </div>

        <!-- LEADERBOARD panel -->
        <div id="panel-leaderboard" style="display:none;width:560px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:22px">
          <div style="font-size:13px;color:#ff4444;letter-spacing:3px;margin-bottom:14px;text-align:center">🏆 GLOBAL TOP 20</div>
          <table id="lb-table" style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr>
              <th style="color:#ff4444;padding:6px 12px;border-bottom:1px solid var(--border);text-align:left">#</th>
              <th style="color:#ff4444;padding:6px 12px;border-bottom:1px solid var(--border);text-align:left">PLAYER</th>
              <th style="color:#ff4444;padding:6px 12px;border-bottom:1px solid var(--border)">KILLS</th>
              <th style="color:#ff4444;padding:6px 12px;border-bottom:1px solid var(--border)">K/D</th>
            </tr></thead>
            <tbody id="lb-body"><tr><td colspan="4" style="text-align:center;color:#444;padding:20px">불러오는 중...</td></tr></tbody>
          </table>
        </div>

        <div style="font-size:11px;color:#2a2a2a;letter-spacing:2px;margin-top:4px">WASD 이동 · 마우스 조준 · LMB 사격 · R 재장전 · TAB 점수판 · T 채팅</div>
      </div>
    </div>

    <!-- Pointer lock prompt -->
    <div id="screen-pointer" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);flex-direction:column;align-items:center;justify-content:center;z-index:200;gap:14px;font-family:'Courier New',monospace">
      <div style="font-size:34px;font-weight:bold;color:#fff">⊕ CLICK TO RESUME</div>
      <div style="font-size:13px;color:#888">ESC → 메뉴 복귀</div>
    </div>
    `);

    // Cache elements
    for (const id of [
      'screen-loading','load-bar','load-text',
      'screen-menu','menu-bg',
      'name-input','server-grid',
      'btn-quickplay','btn-create-server','btn-download','btn-refresh',
      'panel-servers','panel-settings','panel-leaderboard',
      'tab-servers','tab-settings','tab-leaderboard',
      'sl-sensitivity','lbl-sensitivity',
      'sl-fov','lbl-fov',
      'sl-renderScale','lbl-renderScale',
      'cb-sound','cb-ads',
      'btn-save-settings',
      'lb-body',
      'screen-pointer',
    ]) {
      this._el[id] = document.getElementById(id);
    }

    this._bindEvents();
    this._startMenuBg();
    this._applySettings();
  }

  // ── Public ──────────────────────────────────────────────────

  /** Animate loading bar: steps = [{pct, text}] */
  async loadWith(steps) {
    for (const { pct, text } of steps) {
      if (this._el['load-bar'])  this._el['load-bar'].style.width  = pct + '%';
      if (this._el['load-text']) this._el['load-text'].textContent = text;
      await sleep(260);
    }
    await sleep(300);
    this._el['screen-loading'].style.display = 'none';
    this._el['screen-menu'].style.display    = 'flex';
    this._el['screen-menu'].style.flexDirection = 'column';
    this._el['screen-menu'].style.alignItems    = 'center';
    this._el['screen-menu'].style.justifyContent = 'center';
    this._el['screen-menu'].style.height = '100%';
  }

  hideMenu()       { if (this._el['screen-menu']) this._el['screen-menu'].style.display = 'none'; }
  showMenu()       { if (this._el['screen-menu']) this._el['screen-menu'].style.display = 'flex'; }
  showPointerMsg() { if (this._el['screen-pointer']) this._el['screen-pointer'].style.display = 'flex'; }
  hidePointerMsg() { if (this._el['screen-pointer']) this._el['screen-pointer'].style.display = 'none'; }

  get playerName() {
    const v = this._el['name-input']?.value?.trim();
    return v || ('Player' + Math.floor(Math.random()*9999));
  }

  get settings() { return this._settings; }

  populateServers(servers) {
    this._servers = servers;
    const grid = this._el['server-grid'];
    if (!grid) return;
    grid.innerHTML = '';
    for (const s of servers) {
      const pingColor = s.ping<50?'#44ff88':s.ping<120?'#ffaa44':'#ff4444';
      const full      = s.players >= s.maxPlayers;
      const el        = document.createElement('div');
      el.style.cssText = 'background:#0d1117;border:1px solid rgba(255,51,51,.18);border-radius:7px;padding:14px;cursor:pointer;transition:all .17s;display:flex;flex-direction:column;gap:5px';
      el.innerHTML = `
        <div style="font-size:13px;font-weight:bold;color:#ff6644">${s.flag||''} ${s.name}</div>
        <div style="font-size:11px;color:#556">${s.region}</div>
        <div style="font-size:11px;color:${full?'#ff4444':'#778'}">${s.players}/${s.maxPlayers} 명${full?' · FULL':''}</div>
        <div style="font-size:11px;color:${pingColor}">핑: ${s.ping??'?'}ms</div>
      `;
      if (!full) {
        el.addEventListener('mouseenter', () => { el.style.borderColor='#ff4444'; el.style.background='#1a0a0a'; el.style.transform='translateY(-2px)'; });
        el.addEventListener('mouseleave', () => { el.style.borderColor='rgba(255,51,51,.18)'; el.style.background='#0d1117'; el.style.transform='translateY(0)'; });
        el.addEventListener('click', () => this.onPlay?.(s));
      } else {
        el.style.opacity = '0.4'; el.style.cursor = 'not-allowed';
      }
      grid.appendChild(el);
    }
  }

  populateLeaderboard(entries) {
    const tbody = this._el['lb-body'];
    if (!tbody) return;
    if (!entries.length) { tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:#444;padding:20px">데이터 없음</td></tr>'; return; }
    tbody.innerHTML = entries.slice(0,20).map((e,i) => `
      <tr style="border-bottom:1px solid #111">
        <td style="padding:6px 12px;color:${i<3?'#ffdd44':'#666'}">${i+1}</td>
        <td style="padding:6px 12px">${e.name}</td>
        <td style="padding:6px 12px;text-align:center">${e.kills}</td>
        <td style="padding:6px 12px;text-align:center;color:#44ff88">${e.kd}</td>
      </tr>
    `).join('');
  }

  // ── Events ──────────────────────────────────────────────────

  _bindEvents() {
    const switchTab = (name) => {
      for (const t of ['servers','settings','leaderboard']) {
        this._el[`tab-${t}`]?.classList.toggle('active', t===name);
        if (this._el[`panel-${t}`]) this._el[`panel-${t}`].style.display = t===name ? 'block':'none';
      }
    };
    this._el['tab-servers']?.addEventListener('click', () => switchTab('servers'));
    this._el['tab-settings']?.addEventListener('click', () => { switchTab('settings'); });
    this._el['tab-leaderboard']?.addEventListener('click', () => {
      switchTab('leaderboard');
      this._fetchLeaderboard();
    });

    this._el['btn-quickplay']?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/matchmake', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ modeId:'battle_royale' }), signal:AbortSignal.timeout(3000) });
        const data = await res.json();
        if (data?.server) return this.onPlay?.({ ...data.server, wsPath:data.wsPath });
      } catch (_) {}
      const best = this._servers.filter(s=>s.players<s.maxPlayers).sort((a,b)=>(a.placementScore??a.ping)-(b.placementScore??b.ping))[0];
      if (best) this.onPlay?.(best);
    });

    this._el['btn-create-server']?.addEventListener('click', async () => {
      const ownerName = this.playerName;
      try {
        const res = await fetch('/api/servers/custom', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ ownerName, maxPlayers:64, ttlSec:7200 }), signal:AbortSignal.timeout(5000) });
        const data = await res.json();
        if (data?.server) { alert('서버 제작 요청 완료: '+data.server.id); await this._fetchServers(); }
      } catch { alert('현재 배포 환경에서는 커스텀 서버 API가 비활성화되어 있습니다.'); }
    });

    this._el['btn-download']?.addEventListener('click', () => {
      const blob = new Blob([location.href], { type:'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'voxel-strike-web-launcher.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    this._el['btn-refresh']?.addEventListener('click', () => {
      this._el['btn-refresh'].textContent = '↺ ...';
      this._fetchServers().then(() => { this._el['btn-refresh'].textContent = '↺ REFRESH'; });
    });

    // Settings sliders
    for (const key of ['sensitivity','fov','renderScale']) {
      const sl  = this._el[`sl-${key}`];
      const lbl = this._el[`lbl-${key}`];
      sl?.addEventListener('input', () => {
        if (lbl) lbl.textContent = sl.value;
        this._settings[key] = parseFloat(sl.value);
      });
    }

    this._el['btn-save-settings']?.addEventListener('click', () => {
      this._settings.sound = this._el['cb-sound']?.checked ?? true;
      this._settings.ads   = this._el['cb-ads']?.checked   ?? true;
      saveSettings(this._settings);
      this._el['btn-save-settings'].textContent = '✓ 저장됨';
      setTimeout(() => { this._el['btn-save-settings'].textContent = '저장'; }, 1200);
    });

    this._el['screen-pointer']?.addEventListener('click', () => {
      document.getElementById('game-canvas')?.requestPointerLock();
    });
  }

  _applySettings() {
    const s = this._settings;
    if (this._el['sl-sensitivity']) { this._el['sl-sensitivity'].value = s.sensitivity; this._el['lbl-sensitivity'].textContent = s.sensitivity; }
    if (this._el['sl-fov'])         { this._el['sl-fov'].value = s.fov; this._el['lbl-fov'].textContent = s.fov; }
    if (this._el['sl-renderScale']) { this._el['sl-renderScale'].value = s.renderScale; this._el['lbl-renderScale'].textContent = s.renderScale; }
    if (this._el['cb-sound'])    this._el['cb-sound'].checked = s.sound;
    if (this._el['cb-ads'])      this._el['cb-ads'].checked   = s.ads;
  }

  async _fetchServers() {
    try {
      const res  = await fetch('/api/servers', { signal: AbortSignal.timeout(3000) });
      const list = await res.json();
      // Estimate ping locally
      for (const s of list) s.ping = s.ping ?? await estimatePing(s.id);
      this.populateServers(list);
    } catch {
      // Fallback static list
      this.populateServers([
        { id:'asia-1', name:'Asia #1', region:'Seoul',       flag:'🇰🇷', players:0, maxPlayers:20, ping:12 },
        { id:'asia-2', name:'Asia #2', region:'Tokyo',       flag:'🇯🇵', players:0, maxPlayers:20, ping:28 },
        { id:'asia-3', name:'Asia #3', region:'Singapore',   flag:'🇸🇬', players:0, maxPlayers:20, ping:55 },
        { id:'eu-1',   name:'EU #1',   region:'Frankfurt',   flag:'🇩🇪', players:0, maxPlayers:20, ping:145},
        { id:'us-west',name:'US West', region:'Los Angeles', flag:'🇺🇸', players:0, maxPlayers:20, ping:180},
        { id:'us-east',name:'US East', region:'New York',    flag:'🇺🇸', players:0, maxPlayers:20, ping:200},
      ]);
    }
  }

  async _fetchLeaderboard() {
    try {
      const res  = await fetch('/api/leaderboard?limit=20');
      const data = await res.json();
      this.populateLeaderboard(data);
    } catch { this.populateLeaderboard([]); }
  }

  _startMenuBg() {
    const canvas = this._el['menu-bg'];
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const stars = Array.from({length:120},()=>({
      x:Math.random()*canvas.width,
      y:Math.random()*canvas.height,
      vx:(Math.random()-.5)*.3,
      vy:(Math.random()-.5)*.3,
      r:Math.random()*1.5,
    }));
    const draw = () => {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      for (const s of stars) {
        s.x=(s.x+s.vx+canvas.width)%canvas.width;
        s.y=(s.y+s.vy+canvas.height)%canvas.height;
        ctx.fillStyle=`rgba(255,60,60,${0.3+s.r/3})`;
        ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
      }
      requestAnimationFrame(draw);
    };
    draw();
  }
}

// ── Settings persistence ─────────────────────────────────────

function loadSettings() {
  try {
    const raw = sessionStorage.getItem('vs_settings');
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { sensitivity:2.0, fov:75, renderScale:100, sound:true, ads:true };
}

function saveSettings(s) {
  try { sessionStorage.setItem('vs_settings', JSON.stringify(s)); } catch (_) {}
}

async function estimatePing(serverId) {
  try {
    const t0  = Date.now();
    await fetch(`/api/room/${serverId}`, { signal:AbortSignal.timeout(2000) });
    return Date.now() - t0;
  } catch { return 999; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
