// src/game/map.js
// ─────────────────────────────────────────────────────────────
// Voxel world: block data, generation, raycasting queries
// Block types:
//   0 = air    1 = grass    2 = brick    3 = stone
//   4 = metal  5 = wood     6 = dirt     7 = concrete
// ─────────────────────────────────────────────────────────────

export const BLOCK = { AIR:0, GRASS:1, BRICK:2, STONE:3, METAL:4, WOOD:5, DIRT:6, CONCRETE:7 };

export const BLOCK_COLOR = [
  null,
  // face colors [top, side-light, side-dark] as [r,g,b]
  { top:[72,148,52],  sl:[62,128,42],  sd:[52,108,36]  }, // 1 GRASS
  { top:[110,85,60],  sl:[95,70,50],   sd:[80,58,42]   }, // 2 BRICK
  { top:[110,115,125],sl:[95,100,110], sd:[80,85,95]   }, // 3 STONE
  { top:[140,150,160],sl:[120,130,140],sd:[100,110,120]}, // 4 METAL
  { top:[160,115,65], sl:[140,95,50],  sd:[120,78,38]  }, // 5 WOOD
  { top:[100,80,50],  sl:[85,68,42],   sd:[72,58,36]   }, // 6 DIRT
  { top:[130,130,135],sl:[115,115,120],sd:[100,100,105]}, // 7 CONCRETE
];

export const W = 64, H = 10, D = 64;

export class GameMap {
  constructor() {
    this.W = W; this.H = H; this.D = D;
    this.data = new Uint8Array(W * H * D);
    this.spawnPoints = [];
    this._generate();
  }

  get(x, y, z) {
    x=Math.floor(x); y=Math.floor(y); z=Math.floor(z);
    if (x<0||x>=W||y<0||y>=H||z<0||z>=D) return BLOCK.STONE;
    return this.data[x*H*D + y*D + z];
  }

  set(x, y, z, type) {
    if (x<0||x>=W||y<0||y>=H||z<0||z>=D) return;
    this.data[x*H*D + y*D + z] = type;
  }

  isSolid(x, y, z) { return this.get(x,y,z) !== BLOCK.AIR; }

  floorY(x, z) {
    for (let y = H-1; y >= 0; y--) {
      if (this.isSolid(Math.floor(x), y, Math.floor(z))) return y + 1;
    }
    return 0;
  }

  /** DDA ray cast. Returns { hit, x, y, z, face, dist, type } */
  castRay(ox, oy, oz, dx, dy, dz, maxDist = 80) {
    let mx=Math.floor(ox), my=Math.floor(oy), mz=Math.floor(oz);
    const lenXZ = Math.sqrt(dx*dx+dz*dz);
    const deltaX = lenXZ>0 ? Math.abs(1/dx) : 1e30;
    const deltaZ = lenXZ>0 ? Math.abs(1/dz) : 1e30;
    const deltaY = Math.abs(dy)>0 ? Math.abs(1/dy) : 1e30;
    const stepX = dx<0?-1:1, stepZ = dz<0?-1:1, stepY = dy<0?-1:1;
    let sdX = (dx<0 ? ox-mx : mx+1-ox)*deltaX;
    let sdZ = (dz<0 ? oz-mz : mz+1-oz)*deltaZ;
    let sdY = (dy<0 ? oy-my : my+1-oy)*deltaY;
    let face=0, dist=0;

    for (let i=0; i<180 && dist<maxDist; i++) {
      // advance smallest
      if (sdX < sdZ && sdX < sdY) { dist=sdX; sdX+=deltaX; mx+=stepX; face=0; }
      else if (sdY < sdZ)          { dist=sdY; sdY+=deltaY; my+=stepY; face=1; }
      else                         { dist=sdZ; sdZ+=deltaZ; mz+=stepZ; face=2; }

      if (my<0||my>=H) break;
      const type = this.get(mx,my,mz);
      if (type !== BLOCK.AIR) {
        return { hit:true, x:mx, y:my, z:mz, face, dist, type };
      }
    }
    return { hit:false, x:0, y:0, z:0, face:0, dist:maxDist, type:0 };
  }

  // ─── Map generation ──────────────────────────────────────────
  _generate() {
    const set = this.set.bind(this);

    // Ground floor: grass on top, dirt below
    for (let x=0;x<W;x++) for (let z=0;z<D;z++) {
      set(x,0,z,BLOCK.GRASS);
    }

    // Outer concrete boundary walls
    for (let x=0;x<W;x++) for (let y=0;y<H;y++) {
      set(x,y,0,BLOCK.CONCRETE); set(x,y,D-1,BLOCK.CONCRETE);
    }
    for (let z=0;z<D;z++) for (let y=0;y<H;y++) {
      set(0,y,z,BLOCK.CONCRETE); set(W-1,y,z,BLOCK.CONCRETE);
    }

    // ── Central fortified building ──────────────────────────
    this._box(26,0,26, 12,5,12, BLOCK.BRICK);
    // Interior (hollow)
    this._box(27,1,27, 10,4,10, BLOCK.AIR);
    // Roof
    this._box(26,5,26, 12,1,12, BLOCK.METAL);
    // Doors (4 sides)
    for (const [dx,dz] of [[0,4],[0,7],[4,0],[7,0],[11,4],[11,7],[4,11],[7,11]]) {
      set(26+dx,1,26+dz,BLOCK.AIR); set(26+dx,2,26+dz,BLOCK.AIR);
    }
    // Windows (each wall)
    for (let i=2;i<10;i+=3) {
      set(26,3,26+i,BLOCK.AIR); set(37,3,26+i,BLOCK.AIR);
      set(26+i,3,26,BLOCK.AIR); set(26+i,3,37,BLOCK.AIR);
    }
    // Second-floor interior ledge
    this._box(27,4,27, 10,1,2,  BLOCK.CONCRETE);
    this._box(27,4,35, 10,1,2,  BLOCK.CONCRETE);
    this._box(27,4,27, 2,1,10,  BLOCK.CONCRETE);
    this._box(35,4,27, 2,1,10,  BLOCK.CONCRETE);

    // ── Sniper tower NW ─────────────────────────────────────
    this._box(3,0,28, 5,7,5, BLOCK.STONE);
    this._box(4,1,29, 3,6,3, BLOCK.AIR);  // hollow
    // Battlements
    for (let i=0;i<5;i+=2) {
      set(3,7,28+i,BLOCK.STONE); set(7,7,28+i,BLOCK.STONE);
      set(3+i,7,28,BLOCK.STONE); set(3+i,7,32,BLOCK.STONE);
    }
    // Stairs (zigzag ramp)
    for (let i=0;i<7;i++) set(8+i,i,28+i%3, BLOCK.STONE);

    // ── Bunker SE ────────────────────────────────────────────
    this._box(50,0,46, 8,3,8, BLOCK.METAL);
    this._box(51,1,47, 6,2,6, BLOCK.AIR);
    set(50,1,50,BLOCK.AIR); set(50,2,50,BLOCK.AIR); // entrance
    set(58,1,50,BLOCK.AIR); set(58,2,50,BLOCK.AIR);
    // Roof hatches
    set(52,3,49,BLOCK.AIR); set(55,3,49,BLOCK.AIR);

    // ── Cover objects scattered ──────────────────────────────
    // NW crates
    this._box(8, 0,8,  3,2,3, BLOCK.WOOD);
    this._box(12,0,8,  2,1,2, BLOCK.WOOD);
    // NE crates
    this._box(52,0,8,  3,2,3, BLOCK.WOOD);
    this._box(56,0,12, 2,1,3, BLOCK.WOOD);
    // SW crates
    this._box(8, 0,52, 3,2,3, BLOCK.WOOD);
    this._box(8, 0,56, 2,1,2, BLOCK.WOOD);
    // Mid-field barriers (long)
    this._box(16,0,18, 1,2,14, BLOCK.CONCRETE);
    this._box(47,0,18, 1,2,14, BLOCK.CONCRETE);
    this._box(16,0,32, 1,2,14, BLOCK.CONCRETE);
    this._box(47,0,32, 1,2,14, BLOCK.CONCRETE);
    // Destroyed wall fragments
    this._box(22,0,22, 4,1,1, BLOCK.BRICK);
    set(22,1,22,BLOCK.BRICK); set(24,1,22,BLOCK.BRICK);
    this._box(38,0,22, 4,1,1, BLOCK.BRICK);
    this._box(22,0,42, 4,1,1, BLOCK.BRICK);
    this._box(38,0,42, 4,1,1, BLOCK.BRICK);

    // ── Underground tunnel (ditch) ───────────────────────────
    for (let x=20;x<44;x++) { set(x,0,32,BLOCK.AIR); } // trench floor
    for (let x=20;x<44;x++) { set(x,1,32,BLOCK.AIR); }

    // ── Rooftop platform (mid-height cover) ─────────────────
    this._box(24,3,22, 4,1,4, BLOCK.METAL);
    this._box(36,3,22, 4,1,4, BLOCK.METAL);
    this._box(24,3,38, 4,1,4, BLOCK.METAL);
    this._box(36,3,38, 4,1,4, BLOCK.METAL);

    // ── Spawn zones (floors already set) ────────────────────
    this.spawnPoints = [
      { x:4,  y:1, z:4,  team:'red'  },
      { x:6,  y:1, z:4,  team:'red'  },
      { x:5,  y:1, z:7,  team:'red'  },
      { x:7,  y:1, z:6,  team:'red'  },
      { x:58, y:1, z:58, team:'blue' },
      { x:56, y:1, z:58, team:'blue' },
      { x:58, y:1, z:55, team:'blue' },
      { x:56, y:1, z:56, team:'blue' },
    ];
  }

  _box(x0,y0,z0, w,h,d, type) {
    for (let x=x0;x<x0+w;x++) for (let y=y0;y<y0+h;y++) for (let z=z0;z<z0+d;z++)
      this.set(x,y,z,type);
  }
}
