// src/game/renderer.js
// ─────────────────────────────────────────────────────────────
// Software raycaster renderer
//   • DDA column-by-column wall rendering
//   • Floor / ceiling projection
//   • Sprite billboard rendering (players, bots, items)
//   • Particle renderer
//   • Weapon viewmodel
//   • Post-processing: vignette, scope overlay, damage flash
// ─────────────────────────────────────────────────────────────
import { BLOCK_COLOR, BLOCK } from './map.js';

const FOG_START  = 18;
const FOG_END    = 55;
const SKY_TOP    = [10, 20, 40];
const SKY_BOT    = [26, 38, 72];
const FLOOR_COL  = [22, 20, 18];
const CEIL_COL   = [14, 14, 20];

export class Renderer {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.w       = canvas.width;
    this.h       = canvas.height;
    // Pre-allocate ImageData for fast pixel writes
    this.imgData = this.ctx.createImageData(this.w, this.h);
    this.buf     = this.imgData.data;   // Uint8ClampedArray
    this.zbuf    = new Float32Array(this.w);  // depth buffer per column
    this.fov     = 75 * Math.PI / 180;
  }

  resize(w, h) {
    this.canvas.width  = w;
    this.canvas.height = h;
    this.w       = w;
    this.h       = h;
    this.imgData = this.ctx.createImageData(w, h);
    this.buf     = this.imgData.data;
    this.zbuf    = new Float32Array(w);
  }

  render(state) {
    const { pos, eyeY, yaw, pitch, map, entities, bullets, particles, weapon, scopedIn, damageAlpha, flashAlpha } = state;
    const { w, h, buf, zbuf } = this;

    // Clear depth buffer
    zbuf.fill(1e9);

    const hFOV  = Math.tan(this.fov / 2);
    const vFOV  = hFOV * (h / w);
    const cosY  = Math.cos(yaw);
    const sinY  = Math.sin(yaw);
    const pitchShift = Math.tan(pitch) * h * 0.5;

    // ── Sky & floor gradient ────────────────────────────────
    this._drawBackground(buf, w, h, pitchShift);

    // ── Wall columns (DDA) ──────────────────────────────────
    for (let col = 0; col < w; col++) {
      const sx      = (col / w) * 2 - 1;
      const rdx     = cosY * 1 - sinY * sx * hFOV;  // right = cos, forward = no turn
      // Swap: forward is +Z, right is +X, so:
      const rayDX   = sinY + cosY * sx * hFOV;
      const rayDZ   = cosY - sinY * sx * hFOV;

      this._castColumn(col, rayDX, rayDZ, pos, eyeY, yaw, pitch, pitchShift, w, h, hFOV, vFOV, map, zbuf, buf);
    }

    // Flush pixels to canvas
    this.ctx.putImageData(this.imgData, 0, 0);

    // ── Sprites (2.5D billboard) ────────────────────────────
    this._drawSprites(entities, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h, zbuf);

    // ── Bullet tracers ──────────────────────────────────────
    this._drawBullets(bullets, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h, zbuf);

    // ── Particles ───────────────────────────────────────────
    this._drawParticles(particles, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h);

    // ── Weapon viewmodel ─────────────────────────────────────
    if (!scopedIn) this._drawWeapon(weapon, w, h);

    // ── Post-processing ──────────────────────────────────────
    this._drawVignette(w, h);
    if (scopedIn)     this._drawScope(w, h);
    if (damageAlpha > 0) this._drawDamage(w, h, damageAlpha);
    if (flashAlpha  > 0) this._drawFlash(w, h, flashAlpha);
  }

  // ──────────────────────────────────────────────────────────
  _drawBackground(buf, w, h, pitchShift) {
    const horizon = Math.floor(h / 2 + pitchShift * 0.5);
    for (let y = 0; y < h; y++) {
      const isSky = y < horizon;
      const t     = isSky ? y / Math.max(1, horizon) : (y - horizon) / Math.max(1, h - horizon);
      const [r0,g0,b0] = isSky ? SKY_TOP : FLOOR_COL;
      const [r1,g1,b1] = isSky ? SKY_BOT : CEIL_COL;
      const r = Math.floor(r0 + (r1-r0)*t);
      const g = Math.floor(g0 + (g1-g0)*t);
      const b = Math.floor(b0 + (b1-b0)*t);
      const off = y * w * 4;
      for (let x = 0; x < w; x++) {
        buf[off + x*4]   = r;
        buf[off + x*4+1] = g;
        buf[off + x*4+2] = b;
        buf[off + x*4+3] = 255;
      }
    }
  }

  _castColumn(col, rayDX, rayDZ, pos, eyeY, yaw, pitch, pitchShift, w, h, hFOV, vFOV, map, zbuf, buf) {
    let mx = Math.floor(pos.x), mz = Math.floor(pos.z);
    if (Math.abs(rayDX) < 1e-9) rayDX = 1e-9;
    if (Math.abs(rayDZ) < 1e-9) rayDZ = 1e-9;
    const dX = Math.abs(1/rayDX), dZ = Math.abs(1/rayDZ);
    const stepX = rayDX < 0 ? -1 : 1, stepZ = rayDZ < 0 ? -1 : 1;
    let sdX = (rayDX < 0 ? pos.x-mx : mx+1-pos.x)*dX;
    let sdZ = (rayDZ < 0 ? pos.z-mz : mz+1-pos.z)*dZ;
    let side = 0, dist = 0;
    let hit = false, hitType = 0, stepsMade = 0;

    while (!hit && dist < FOG_END && stepsMade++ < 120) {
      if (sdX < sdZ) { sdX+=dX; mx+=stepX; side=0; dist=sdX-dX; }
      else            { sdZ+=dZ; mz+=stepZ; side=1; dist=sdZ-dZ; }
      for (let by = map.H-1; by >= 0; by--) {
        const t = map.get(mx, by, mz);
        if (t !== BLOCK.AIR) { hit=true; hitType=t; break; }
      }
    }

    if (!hit || dist < 0.01) return;

    // Store dist in zbuf for sprite clipping
    zbuf[col] = dist;

    // Fog blend
    const fogT = Math.min(1, Math.max(0, (dist - FOG_START) / (FOG_END - FOG_START)));

    // Draw all vertical slabs from tallest y down
    for (let by = map.H-1; by >= 0; by--) {
      const type = map.get(mx, by, mz);
      if (type === BLOCK.AIR) continue;

      const blockTop = by + 1;
      const blockBot = by;
      const topAngle = Math.atan2(blockTop - eyeY, dist);
      const botAngle = Math.atan2(blockBot - eyeY, dist);
      const topPx = Math.floor(h/2 - topAngle * h/(vFOV*2) - pitchShift*0.5);
      const botPx = Math.floor(h/2 - botAngle * h/(vFOV*2) - pitchShift*0.5);
      const drawH = Math.max(1, botPx - topPx);

      const bc    = BLOCK_COLOR[type];
      if (!bc) continue;
      const faceKey = side===0 ? (rayDX>0?'sd':'sl') : (rayDZ>0?'sd':'sl');
      const [br,bg,bb] = bc[faceKey] || bc.sl;

      // Fog
      const fr = Math.floor(br*(1-fogT) + SKY_BOT[0]*fogT);
      const fg = Math.floor(bg*(1-fogT) + SKY_BOT[1]*fogT);
      const fb = Math.floor(bb*(1-fogT) + SKY_BOT[2]*fogT);

      // Write pixels
      for (let py=Math.max(0,topPx); py<Math.min(h,botPx); py++) {
        const off = (py*w + col)*4;
        buf[off]  =fr; buf[off+1]=fg; buf[off+2]=fb; buf[off+3]=255;
      }
    }
  }

  _worldToScreen(wx,wy,wz, px,py,pz, yaw,pitch,pitchShift,hFOV,vFOV,w,h) {
    const dx=wx-px, dy=wy-py, dz=wz-pz;
    const cosY=Math.cos(-yaw), sinY=Math.sin(-yaw);
    const tx= cosY*dx - sinY*dz;
    const tz= sinY*dx + cosY*dz;
    const ty= dy;
    if (tz <= 0.05) return null;
    const sx = (0.5 + tx/(tz*hFOV*2))*w;
    const sy = (0.5 - ty/(tz*vFOV*2))*h - pitchShift*0.5;
    return { x:sx, y:sy, z:tz };
  }

  _drawSprites(entities, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h, zbuf) {
    const ctx = this.ctx;
    // Sort back-to-front
    const sorted = [...entities].sort((a,b)=>{
      const da=(a.x-pos.x)**2+(a.z-pos.z)**2;
      const db=(b.x-pos.x)**2+(b.z-pos.z)**2;
      return db-da;
    });

    for (const ent of sorted) {
      if (ent.health !== undefined && ent.health <= 0) continue;
      const sp = this._worldToScreen(ent.x, ent.y+0.9, ent.z, pos.x, eyeY, pos.z, yaw, pitch, pitchShift, hFOV, vFOV, w, h);
      if (!sp || sp.z>60 || sp.z<0.3) continue;
      if (sp.x<-100||sp.x>w+100) continue;
      // Clip against zbuf
      const colIdx = Math.floor(sp.x);
      if (colIdx>=0&&colIdx<w&&zbuf[colIdx]<sp.z-0.5) continue;

      const size   = h/sp.z * 1.8;
      const half   = size/2;
      const sx=sp.x, sy=sp.y;
      const teamR  = ent.team==='red';
      const bodyC  = teamR?'#bf2222':'#2244bb';
      const darkC  = teamR?'#7a1111':'#152d7a';

      ctx.save();
      // Shadow
      ctx.fillStyle='rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(sx,sy+half*0.97,half*0.4,half*0.07,0,0,Math.PI*2);
      ctx.fill();
      // Legs
      ctx.fillStyle='#2a2a2a';
      ctx.fillRect(sx-half*0.26,sy+half*0.08,half*0.22,half*0.85);
      ctx.fillRect(sx+half*0.04,sy+half*0.08,half*0.22,half*0.85);
      // Torso
      ctx.fillStyle=bodyC;
      ctx.fillRect(sx-half*0.34,sy-half*0.32,half*0.68,half*0.42);
      // Head
      ctx.fillStyle='#c9a880';
      ctx.fillRect(sx-half*0.19,sy-half*0.72,half*0.38,half*0.40);
      // Helmet
      ctx.fillStyle=darkC;
      ctx.fillRect(sx-half*0.21,sy-half*0.76,half*0.42,half*0.22);
      // Left arm
      ctx.fillStyle=bodyC;
      ctx.fillRect(sx-half*0.46,sy-half*0.28,half*0.13,half*0.35);
      // Weapon
      ctx.fillStyle='#3a3a3a';
      ctx.fillRect(sx-half*0.60,sy-half*0.20,half*0.32,half*0.10);

      // Name tag (closer than 18 units)
      if (sp.z < 18) {
        const nm=ent.name||'???';
        const fs=Math.max(8, Math.min(13, 200/sp.z));
        ctx.font=`${fs}px "Courier New"`;
        const tw=ctx.measureText(nm).width;
        ctx.fillStyle='rgba(0,0,0,0.7)';
        ctx.fillRect(sx-tw/2-4,sy-half*0.9-fs-2,tw+8,fs+4);
        ctx.fillStyle= teamR?'#ff8888':'#88aaff';
        ctx.fillText(nm,sx-tw/2,sy-half*0.9-2);
      }
      // Health bar (closer than 25 units)
      if (sp.z < 25 && ent.health < 100) {
        const bw=size*0.55, bh=Math.max(2,size*0.035);
        const bx=sx-bw/2, by2=sy-half*0.88-bh-3;
        ctx.fillStyle='#1a1a1a'; ctx.fillRect(bx,by2,bw,bh);
        const hpC = ent.health>50?'#44ff44':'#ff4444';
        ctx.fillStyle=hpC; ctx.fillRect(bx,by2,bw*ent.health/100,bh);
      }
      ctx.restore();
    }
  }

  _drawBullets(bullets, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h, zbuf) {
    const ctx=this.ctx;
    for (const b of bullets) {
      const sp  = this._worldToScreen(b.x, b.y, b.z, pos.x, eyeY, pos.z, yaw, pitch, pitchShift, hFOV, vFOV, w, h);
      const sp2 = this._worldToScreen(b.ox||b.x, b.oy||b.y, b.oz||b.z, pos.x, eyeY, pos.z, yaw, pitch, pitchShift, hFOV, vFOV, w, h);
      if (!sp||!sp2) continue;
      ctx.save();
      ctx.strokeStyle=`rgba(255,215,80,${b.life*0.9})`;
      ctx.lineWidth=Math.max(1,3/sp.z);
      ctx.shadowColor='rgba(255,180,0,0.6)';
      ctx.shadowBlur=4;
      ctx.beginPath(); ctx.moveTo(sp.x,sp.y); ctx.lineTo(sp2.x,sp2.y); ctx.stroke();
      ctx.restore();
    }
  }

  _drawParticles(particles, pos, eyeY, yaw, pitch, pitchShift, hFOV, vFOV, w, h) {
    const ctx=this.ctx;
    for (const p of particles) {
      const sp=this._worldToScreen(p.x,p.y,p.z,pos.x,eyeY,pos.z,yaw,pitch,pitchShift,hFOV,vFOV,w,h);
      if (!sp||sp.z>40) continue;
      const s=Math.max(1.5,5/sp.z);
      ctx.fillStyle=`rgba(${p.r},${p.g},${p.b},${p.life})`;
      ctx.fillRect(sp.x-s/2,sp.y-s/2,s,s);
    }
  }

  _drawWeapon(weapon, w, h) {
    if (!weapon) return;
    const ctx=this.ctx;
    const sc = h/800;
    const cx = w*0.72 + weapon.bobX*8;
    const cy = h*0.72 + weapon.kickY*h*0.013 + weapon.bobY*5;

    ctx.save();
    ctx.translate(cx,cy);

    switch(weapon.id) {
      case 'ak47': case 'm4a1': this._drawAR(ctx,sc,weapon); break;
      case 'awp':   this._drawSniper(ctx,sc);  break;
      case 'mp5':   this._drawSMG(ctx,sc);     break;
      case 'shotgun': this._drawShotgun(ctx,sc); break;
      case 'deagle':  this._drawPistol(ctx,sc);  break;
    }

    // Muzzle flash
    if (weapon.flash > 0) {
      const fx=-210*sc, fy=-40*sc;
      const grd=ctx.createRadialGradient(fx,fy,0,fx,fy,44*sc);
      grd.addColorStop(0,`rgba(255,240,140,${weapon.flash})`);
      grd.addColorStop(0.3,`rgba(255,120,0,${weapon.flash*0.7})`);
      grd.addColorStop(1,'rgba(255,80,0,0)');
      ctx.fillStyle=grd;
      ctx.beginPath(); ctx.arc(fx,fy,44*sc,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  _drawAR(ctx,sc,wep) {
    ctx.fillStyle='#2a1a08'; ctx.fillRect(-18*sc,-18*sc,108*sc,28*sc);
    ctx.fillStyle='#181818'; ctx.fillRect(-80*sc,-28*sc,158*sc,38*sc);
    ctx.fillStyle='#111';    ctx.fillRect(-220*sc,-9*sc,144*sc,16*sc);
    ctx.fillStyle='#222';    ctx.fillRect(28*sc,8*sc,32*sc,54*sc);
    ctx.fillStyle='#2e2e2e'; ctx.fillRect(8*sc,10*sc,20*sc,64*sc);
    ctx.fillStyle='#3a3a3a'; ctx.fillRect(-60*sc,-36*sc,78*sc,9*sc);
    ctx.fillStyle='#2a1a08'; ctx.fillRect(-132*sc,10*sc,24*sc,44*sc);
    if(wep.id==='m4a1'){ctx.fillStyle='#2a2a2a';ctx.fillRect(-232*sc,-11*sc,16*sc,20*sc);}
  }
  _drawSniper(ctx,sc){
    ctx.fillStyle='#3a2808'; ctx.fillRect(-28*sc,-22*sc,128*sc,30*sc);
    ctx.fillStyle='#111';    ctx.fillRect(-130*sc,-27*sc,198*sc,35*sc);
    ctx.fillStyle='#0a0a0a'; ctx.fillRect(-262*sc,-9*sc,136*sc,14*sc);
    ctx.fillStyle='#1a1a1a'; ctx.fillRect(-62*sc,-48*sc,78*sc,24*sc);
    ctx.fillStyle='#0d1825'; ctx.fillRect(-58*sc,-46*sc,68*sc,20*sc);
    ctx.fillStyle='#222';    ctx.fillRect(50*sc,8*sc,28*sc,56*sc);
  }
  _drawSMG(ctx,sc){
    ctx.fillStyle='#1a1a1a'; ctx.fillRect(-58*sc,-24*sc,118*sc,34*sc);
    ctx.fillStyle='#111';    ctx.fillRect(-128*sc,-8*sc,74*sc,14*sc);
    ctx.fillStyle='#222';    ctx.fillRect(20*sc,8*sc,22*sc,50*sc);
    ctx.fillStyle='#333';    ctx.fillRect(10*sc,9*sc,18*sc,44*sc);
  }
  _drawShotgun(ctx,sc){
    ctx.fillStyle='#4a2808'; ctx.fillRect(-28*sc,-17*sc,138*sc,28*sc);
    ctx.fillStyle='#111';    ctx.fillRect(-195*sc,-10*sc,170*sc,20*sc);
    ctx.fillStyle='#0d0d0d'; ctx.fillRect(-190*sc,-8*sc,160*sc,16*sc);
    ctx.fillStyle='#333';    ctx.fillRect(48*sc,10*sc,36*sc,58*sc);
    ctx.fillStyle='#222';    ctx.fillRect(52*sc,12*sc,28*sc,52*sc);
  }
  _drawPistol(ctx,sc){
    ctx.fillStyle='#222'; ctx.fillRect(-38*sc,-28*sc,78*sc,44*sc);
    ctx.fillStyle='#111'; ctx.fillRect(-98*sc,-14*sc,64*sc,17*sc);
    ctx.fillStyle='#333'; ctx.fillRect(18*sc,12*sc,26*sc,50*sc);
  }

  _drawVignette(w,h) {
    const ctx=this.ctx;
    const grd=ctx.createRadialGradient(w/2,h/2,h*0.3,w/2,h/2,h*0.8);
    grd.addColorStop(0,'rgba(0,0,0,0)');
    grd.addColorStop(1,'rgba(0,0,0,0.48)');
    ctx.fillStyle=grd; ctx.fillRect(0,0,w,h);
  }
  _drawScope(w,h) {
    const ctx=this.ctx;
    const r=h*0.44;
    ctx.fillStyle='rgba(0,0,0,0.92)';
    ctx.fillRect(0,0,w,h);
    ctx.save();
    ctx.beginPath(); ctx.arc(w/2,h/2,r,0,Math.PI*2); ctx.clip();
    ctx.clearRect(0,0,w,h);
    ctx.restore();
    ctx.strokeStyle='rgba(255,255,255,0.7)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(w/2,h/2,r,0,Math.PI*2); ctx.stroke();
    // Reticle
    ctx.strokeStyle='rgba(255,255,255,0.8)'; ctx.lineWidth=1;
    const cx=w/2, cy=h/2;
    ctx.beginPath(); ctx.moveTo(cx-r,cy); ctx.lineTo(cx+r,cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx,cy-r); ctx.lineTo(cx,cy+r); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx,cy,r*0.04,0,Math.PI*2); ctx.stroke();
  }
  _drawDamage(w,h,alpha) {
    const ctx=this.ctx;
    const grd=ctx.createRadialGradient(w/2,h/2,h*0.1,w/2,h/2,h*0.7);
    grd.addColorStop(0,`rgba(180,0,0,0)`);
    grd.addColorStop(1,`rgba(200,0,0,${alpha*0.65})`);
    ctx.fillStyle=grd; ctx.fillRect(0,0,w,h);
  }
  _drawFlash(w,h,alpha) {
    const ctx=this.ctx;
    const grd=ctx.createRadialGradient(w*0.72,h*0.72,0,w*0.72,h*0.72,h*0.6);
    grd.addColorStop(0,`rgba(255,220,100,${alpha*0.08})`);
    grd.addColorStop(1,'rgba(255,100,0,0)');
    ctx.fillStyle=grd; ctx.fillRect(0,0,w,h);
  }
}
