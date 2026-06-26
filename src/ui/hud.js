// src/ui/hud.js
// ─────────────────────────────────────────────────────────────
// HUD: health, armor, ammo, minimap, kill feed, scoreboard,
//      notifications, crosshair, hit-marker, chat box
// ─────────────────────────────────────────────────────────────

export class HUD {
  constructor(container) {
    this.root = container || document.body;
    this._el  = {};
    this._minimapCtx = null;
    this._killFeedQueue = [];
    this._notifyTimer   = 0;
    this._hitMarkerTimer = 0;
    this._chatMessages  = [];
    this._build();
  }

  // ── Build DOM ───────────────────────────────────────────────

  _build() {
    this.root.insertAdjacentHTML('beforeend', `
    <div id="hud" style="display:none;position:fixed;inset:0;pointer-events:none;z-index:10;font-family:'Courier New',monospace">

      <!-- Crosshair -->
      <div id="hud-xhair" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:20px;height:20px">
        <div style="position:absolute;width:2px;height:100%;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.85)"></div>
        <div style="position:absolute;height:2px;width:100%;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.85)"></div>
        <div id="hud-hitmarker" style="position:absolute;inset:0;opacity:0;transition:opacity 0.05s">
          <div style="position:absolute;width:2px;height:100%;left:50%;transform:translateX(-50%);background:#ff3333"></div>
          <div style="position:absolute;height:2px;width:100%;top:50%;transform:translateY(-50%);background:#ff3333"></div>
        </div>
      </div>

      <!-- FPS / Ping -->
      <div id="hud-fps" style="position:absolute;top:8px;left:8px;font-size:11px;color:#44ff88;opacity:0.7">60 FPS</div>

      <!-- Ammo -->
      <div id="hud-ammo" style="position:absolute;bottom:60px;right:40px;text-align:right">
        <span id="hud-ammo-cur" style="font-size:46px;font-weight:bold;color:#fff;text-shadow:0 0 10px rgba(0,0,0,0.8)">30</span>
        <span id="hud-ammo-sep" style="font-size:20px;color:#666"> / </span>
        <span id="hud-ammo-res" style="font-size:20px;color:#aaa">90</span>
      </div>
      <div id="hud-weapon-name" style="position:absolute;bottom:44px;right:40px;font-size:12px;color:#888;letter-spacing:2px;text-align:right">AK-47</div>
      <div id="hud-reload-bar-wrap" style="position:absolute;bottom:38px;right:40px;width:120px;height:3px;background:#333;border-radius:2px;display:none">
        <div id="hud-reload-bar" style="height:100%;background:#ffaa00;width:0%;border-radius:2px;transition:width 0.05s"></div>
      </div>

      <!-- Health & Armor -->
      <div style="position:absolute;bottom:32px;left:40px;display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">❤</span>
          <div style="width:190px;height:8px;background:#2a2a2a;border-radius:4px;overflow:hidden">
            <div id="hud-hp-fill" style="height:100%;background:#dd3333;width:100%;border-radius:4px;transition:width 0.2s;box-shadow:0 0 6px #ff4444"></div>
          </div>
          <span id="hud-hp-text" style="font-size:14px;font-weight:bold;min-width:28px">100</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">🛡</span>
          <div style="width:190px;height:5px;background:#2a2a2a;border-radius:4px;overflow:hidden">
            <div id="hud-armor-fill" style="height:100%;background:#4488ff;width:50%;border-radius:4px;transition:width 0.2s;box-shadow:0 0 6px #4488ff"></div>
          </div>
          <span id="hud-armor-text" style="font-size:12px;color:#aaa;min-width:28px">50</span>
        </div>
      </div>

      <!-- Scoreboard top -->
      <div id="hud-score" style="position:absolute;top:18px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);border:1px solid rgba(255,68,68,0.2);border-radius:8px;padding:8px 28px;display:flex;gap:36px;align-items:center">
        <div style="text-align:center">
          <div id="hud-score-red" style="font-size:30px;font-weight:bold;color:#ff4444">0</div>
          <div style="font-size:9px;color:#884444;letter-spacing:2px">RED</div>
        </div>
        <div id="hud-timer" style="font-size:17px;font-weight:bold;color:#ddd;min-width:44px;text-align:center">5:00</div>
        <div style="text-align:center">
          <div id="hud-score-blue" style="font-size:30px;font-weight:bold;color:#4488ff">0</div>
          <div style="font-size:9px;color:#224488;letter-spacing:2px">BLUE</div>
        </div>
      </div>

      <!-- Kill feed -->
      <div id="hud-killfeed" style="position:absolute;top:78px;right:18px;display:flex;flex-direction:column;gap:4px;align-items:flex-end;max-width:280px"></div>

      <!-- Minimap -->
      <div style="position:absolute;top:18px;right:18px;width:130px;height:130px;background:rgba(0,0,0,0.72);border:1px solid rgba(255,68,68,0.18);border-radius:4px;overflow:hidden">
        <canvas id="hud-minimap" width="130" height="130"></canvas>
      </div>

      <!-- Notification center -->
      <div id="hud-notify" style="position:absolute;top:44%;left:50%;transform:translate(-50%,-50%);font-size:30px;font-weight:bold;text-align:center;pointer-events:none;opacity:0;transition:opacity 0.4s;text-shadow:0 2px 8px rgba(0,0,0,0.9)"></div>

      <!-- Streak display -->
      <div id="hud-streak" style="position:absolute;top:52%;left:50%;transform:translate(-50%,-50%);font-size:16px;font-weight:bold;color:#ffdd44;opacity:0;transition:opacity 0.4s;letter-spacing:2px;text-shadow:0 2px 8px rgba(0,0,0,0.9)"></div>

      <!-- Chat box -->
      <div id="hud-chat" style="position:absolute;bottom:90px;left:20px;width:330px;display:flex;flex-direction:column;gap:3px;pointer-events:none"></div>

      <!-- Compass -->
      <div id="hud-compass" style="position:absolute;top:74px;left:50%;transform:translateX(-50%);font-size:11px;color:#aaa;letter-spacing:4px;background:rgba(0,0,0,0.4);padding:2px 10px;border-radius:3px">N</div>

      <!-- Low ammo warning -->
      <div id="hud-low-ammo" style="position:absolute;bottom:60px;right:180px;font-size:13px;color:#ff4444;letter-spacing:2px;opacity:0;transition:opacity 0.3s;animation:blink 0.7s infinite">LOW AMMO</div>

    </div>

    <!-- TAB scoreboard overlay -->
    <div id="hud-tab" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.86);z-index:50;align-items:center;justify-content:center;font-family:'Courier New',monospace">
      <div style="min-width:680px">
        <div style="text-align:center;font-size:22px;font-weight:bold;color:#ff4444;letter-spacing:4px;margin-bottom:16px">SCOREBOARD</div>
        <table id="hud-tab-table" style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433;text-align:left">PLAYER</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">TEAM</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">KILLS</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">DEATHS</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">K/D</th>
              <th style="color:#ff4444;font-size:12px;letter-spacing:2px;padding:8px 16px;border-bottom:1px solid #ff444433">PING</th>
            </tr>
          </thead>
          <tbody id="hud-tab-body"></tbody>
        </table>
        <div style="text-align:center;font-size:11px;color:#444;margin-top:16px;letter-spacing:2px">TAB 키를 놓으면 닫힙니다</div>
      </div>
    </div>

    <!-- Respawn overlay -->
    <div id="hud-respawn" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:100;flex-direction:column;align-items:center;justify-content:center;gap:14px;font-family:'Courier New',monospace">
      <div style="font-size:52px;font-weight:bold;color:#ff4444;letter-spacing:4px;text-shadow:0 0 30px #ff4444">ELIMINATED</div>
      <div id="hud-respawn-killer" style="font-size:16px;color:#aaa"></div>
      <div id="hud-respawn-count" style="font-size:22px;color:#fff">3초 후 리스폰...</div>
      <div id="hud-respawn-stats" style="font-size:13px;color:#666;margin-top:4px"></div>
    </div>

    <!-- Damage vignette -->
    <div id="hud-damage" style="position:fixed;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse,transparent 50%,#ff000055 100%);opacity:0;transition:opacity 0.1s"></div>

    <style>
      @keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }
      .killfeed-entry { background:rgba(0,0,0,0.72);padding:3px 10px;border-radius:3px;border-left:2px solid #ff4444;font-size:12px;white-space:nowrap;animation:kffade 4s forwards }
      @keyframes kffade { 0%{opacity:1;transform:translateX(0)}80%{opacity:1}100%{opacity:0;transform:translateX(20px)} }
      .chat-entry { background:rgba(0,0,0,0.65);padding:3px 10px;border-radius:3px;font-size:12px;animation:chatfade 8s forwards;pointer-events:none }
      @keyframes chatfade { 0%{opacity:1}75%{opacity:1}100%{opacity:0} }
    </style>
    `);

    // Cache references
    for (const id of [
      'hud','hud-xhair','hud-hitmarker','hud-fps',
      'hud-ammo-cur','hud-ammo-res','hud-weapon-name','hud-reload-bar-wrap','hud-reload-bar',
      'hud-hp-fill','hud-hp-text','hud-armor-fill','hud-armor-text',
      'hud-score-red','hud-score-blue','hud-timer',
      'hud-killfeed','hud-minimap','hud-notify','hud-streak',
      'hud-chat','hud-compass','hud-low-ammo',
      'hud-tab','hud-tab-body',
      'hud-respawn','hud-respawn-killer','hud-respawn-count','hud-respawn-stats',
      'hud-damage',
    ]) {
      this._el[id] = document.getElementById(id);
    }

    this._minimapCtx = this._el['hud-minimap']?.getContext('2d');
  }

  // ── Show / Hide ─────────────────────────────────────────────

  show() { if (this._el['hud']) this._el['hud'].style.display = 'block'; }
  hide() { if (this._el['hud']) this._el['hud'].style.display = 'none'; }

  // ── Per-frame update ────────────────────────────────────────

  update(dt, state) {
    this._hitMarkerTimer -= dt;
    if (this._hitMarkerTimer <= 0 && this._el['hud-hitmarker']) {
      this._el['hud-hitmarker'].style.opacity = '0';
    }
    this._updateCompass(state.yaw);
    this._updateFPS(state.fps, state.ping);
    this._updateTimer(state.roundTimer);
  }

  // ── Setters ─────────────────────────────────────────────────

  setHealth(hp, maxHp=100) {
    const pct = Math.max(0, hp/maxHp*100);
    if (this._el['hud-hp-fill'])  this._el['hud-hp-fill'].style.width  = pct+'%';
    if (this._el['hud-hp-text'])  this._el['hud-hp-text'].textContent  = Math.ceil(hp);
    if (this._el['hud-hp-fill']) {
      this._el['hud-hp-fill'].style.background = hp>50?'#dd3333':hp>25?'#ff8800':'#ff2200';
    }
  }

  setArmor(armor, maxArmor=100) {
    const pct = Math.max(0, armor/maxArmor*100);
    if (this._el['hud-armor-fill']) this._el['hud-armor-fill'].style.width = pct+'%';
    if (this._el['hud-armor-text']) this._el['hud-armor-text'].textContent = Math.ceil(armor);
  }

  setAmmo(cur, reserve, reloading=false, reloadPct=0) {
    if (this._el['hud-ammo-cur']) {
      this._el['hud-ammo-cur'].textContent = cur;
      this._el['hud-ammo-cur'].style.color = cur===0?'#ff4444':cur<5?'#ffaa00':'#fff';
    }
    if (this._el['hud-ammo-res']) this._el['hud-ammo-res'].textContent = reserve;
    if (this._el['hud-reload-bar-wrap']) {
      this._el['hud-reload-bar-wrap'].style.display = reloading ? 'block' : 'none';
    }
    if (this._el['hud-reload-bar'] && reloading) {
      this._el['hud-reload-bar'].style.width = (reloadPct*100)+'%';
    }
    if (this._el['hud-low-ammo']) {
      this._el['hud-low-ammo'].style.opacity = (cur>0 && cur<=5 && !reloading) ? '1' : '0';
    }
  }

  setWeapon(name, reloading=false) {
    if (this._el['hud-weapon-name']) {
      this._el['hud-weapon-name'].textContent = reloading ? 'RELOADING...' : name;
    }
  }

  setScore(red, blue) {
    if (this._el['hud-score-red'])  this._el['hud-score-red'].textContent  = red;
    if (this._el['hud-score-blue']) this._el['hud-score-blue'].textContent = blue;
  }

  // ── Damage flash ────────────────────────────────────────────

  showDamage(alpha=0.7) {
    const el = this._el['hud-damage'];
    if (!el) return;
    el.style.opacity = String(alpha);
    clearTimeout(this._damageTimer);
    this._damageTimer = setTimeout(() => { el.style.opacity = '0'; }, 180);
  }

  // ── Hit marker ──────────────────────────────────────────────

  showHitMarker(killed=false) {
    const el = this._el['hud-hitmarker'];
    if (!el) return;
    el.style.opacity = '1';
    el.style.color = killed ? '#ffdd00' : '#ff3333';
    this._hitMarkerTimer = killed ? 0.4 : 0.15;
  }

  // ── Kill feed ────────────────────────────────────────────────

  addKill(killerName, victimName, weapon='') {
    const feed = this._el['hud-killfeed'];
    if (!feed) return;
    const el = document.createElement('div');
    el.className = 'killfeed-entry';
    const icon = { ak47:'🔫', awp:'🎯', shotgun:'💥', deagle:'🔫', mp5:'🔫', m4a1:'🔫' }[weapon] || '⚡';
    el.innerHTML = `<span style="color:#ff8888">${killerName}</span> ${icon} <span style="color:#88aaff">${victimName}</span>`;
    feed.appendChild(el);
    if (feed.children.length > 5) feed.firstChild.remove();
    setTimeout(() => el.remove(), 4200);
  }

  // ── Notification ─────────────────────────────────────────────

  notify(msg, color='#fff', sub='') {
    const el = this._el['hud-notify'];
    if (!el) return;
    el.textContent  = msg;
    el.style.color  = color;
    el.style.opacity = '1';
    clearTimeout(this._notifyT);
    this._notifyT = setTimeout(() => { el.style.opacity='0'; }, 2000);

    if (sub && this._el['hud-streak']) {
      this._el['hud-streak'].textContent = sub;
      this._el['hud-streak'].style.opacity = '1';
      clearTimeout(this._streakT);
      this._streakT = setTimeout(() => { this._el['hud-streak'].style.opacity='0'; }, 2500);
    }
  }

  // ── Chat ─────────────────────────────────────────────────────

  addChat(from, team, text) {
    const box = this._el['hud-chat'];
    if (!box) return;
    const el   = document.createElement('div');
    el.className = 'chat-entry';
    const col  = team==='red'?'#ff7766':'#6699ff';
    el.innerHTML = `<span style="color:${col}">[${from}]</span> <span style="color:#ddd">${text}</span>`;
    box.appendChild(el);
    if (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => el.remove(), 8000);
  }

  // ── Respawn overlay ─────────────────────────────────────────

  showRespawn(killerName, onDone) {
    const ov = this._el['hud-respawn'];
    if (!ov) return;
    ov.style.display = 'flex';
    if (this._el['hud-respawn-killer']) {
      this._el['hud-respawn-killer'].textContent = killerName ? `킬러: ${killerName}` : '';
    }
    let cnt = 4;
    const tick = () => {
      cnt--;
      if (cnt <= 0) {
        ov.style.display = 'none';
        onDone?.();
      } else {
        if (this._el['hud-respawn-count']) this._el['hud-respawn-count'].textContent = `${cnt}초 후 리스폰...`;
        setTimeout(tick, 1000);
      }
    };
    if (this._el['hud-respawn-count']) this._el['hud-respawn-count'].textContent = `${cnt}초 후 리스폰...`;
    setTimeout(tick, 1000);
  }

  hideRespawn() {
    if (this._el['hud-respawn']) this._el['hud-respawn'].style.display = 'none';
  }

  // ── TAB scoreboard ──────────────────────────────────────────

  showTab(players, myId) {
    const tab = this._el['hud-tab'];
    if (tab) tab.style.display = 'flex';
    this.updateTab(players, myId);
  }

  hideTab() {
    const tab = this._el['hud-tab'];
    if (tab) tab.style.display = 'none';
  }

  updateTab(players, myId) {
    const tbody = this._el['hud-tab-body'];
    if (!tbody) return;
    tbody.innerHTML = '';
    const sorted = [...players].sort((a,b) => b.kills - a.kills);
    for (const p of sorted) {
      const tr = document.createElement('tr');
      if (p.id === myId) tr.style.background = 'rgba(255,68,68,0.1)';
      const kd = p.deaths > 0 ? (p.kills/p.deaths).toFixed(2) : p.kills > 0 ? '∞' : '0.00';
      const teamCol = p.team==='red'?'#ff4444':'#4488ff';
      tr.innerHTML = `
        <td style="padding:7px 16px;font-size:13px;border-bottom:1px solid #1a1a1a">${p.name}${p.id===myId?' <span style="color:#ff4444">(나)</span>':''}</td>
        <td style="padding:7px 16px;font-size:13px;color:${teamCol};text-align:center;border-bottom:1px solid #1a1a1a">${p.team.toUpperCase()}</td>
        <td style="padding:7px 16px;font-size:13px;text-align:center;border-bottom:1px solid #1a1a1a">${p.kills}</td>
        <td style="padding:7px 16px;font-size:13px;text-align:center;border-bottom:1px solid #1a1a1a">${p.deaths}</td>
        <td style="padding:7px 16px;font-size:13px;text-align:center;border-bottom:1px solid #1a1a1a">${kd}</td>
        <td style="padding:7px 16px;font-size:13px;text-align:center;border-bottom:1px solid #1a1a1a;color:${(p.ping||0)<60?'#44ff88':(p.ping||0)<120?'#ffaa44':'#ff4444'}">${p.ping||'?'}ms</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // ── Minimap ─────────────────────────────────────────────────

  renderMinimap(mapData, playerPos, playerYaw, entities) {
    const ctx  = this._minimapCtx;
    if (!ctx) return;
    const mw=130, mh=130;
    const scX = mw/mapData.W, scZ = mh/mapData.D;

    ctx.clearRect(0,0,mw,mh);
    ctx.fillStyle='rgba(0,0,0,0.85)';
    ctx.fillRect(0,0,mw,mh);

    // Blocks (sample every 2)
    for (let x=0;x<mapData.W;x+=2) for (let z=0;z<mapData.D;z+=2) {
      let solid=false;
      for (let y=1;y<mapData.H;y++) if(mapData.isSolid(x,y,z)){solid=true;break;}
      if (solid) {
        ctx.fillStyle='#2a3040';
        ctx.fillRect(x*scX,z*scZ,scX*2,scZ*2);
      }
    }

    // Entities (bots + remote players)
    for (const e of (entities||[])) {
      ctx.fillStyle = e.team==='red'?'#ff5544':'#4466ff';
      ctx.fillRect(e.x*scX-2, e.z*scZ-2, 4, 4);
    }

    // Player arrow
    ctx.save();
    ctx.translate(playerPos.x*scX, playerPos.z*scZ);
    ctx.rotate(playerYaw);
    ctx.fillStyle='#44ff88';
    ctx.beginPath();
    ctx.moveTo(0,-6); ctx.lineTo(4,4); ctx.lineTo(-4,4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ── Internal helpers ────────────────────────────────────────

  _updateCompass(yaw) {
    const el = this._el['hud-compass'];
    if (!el) return;
    const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
    const idx  = Math.round(((yaw % (Math.PI*2)) + Math.PI*2) % (Math.PI*2) / (Math.PI/4));
    el.textContent = dirs[idx] || 'N';
  }

  _updateFPS(fps, ping) {
    const el = this._el['hud-fps'];
    if (el) el.textContent = `${fps} FPS${ping?'  '+ping+'ms':''}`;
  }

  _updateTimer(sec) {
    const el = this._el['hud-timer'];
    if (!el) return;
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s/60);
    el.textContent = `${m}:${String(s%60).padStart(2,'0')}`;
    el.style.color = s < 30 ? '#ff4444' : '#ddd';
  }
}
