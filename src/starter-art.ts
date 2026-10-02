/**
 * Built-in 2D art for createTestAtlas: a tileset and a cast of sprites,
 * drawn in code at 16px and scaled to the game's tile size.
 *
 * Tiles keep their old indices so existing maps still read sensibly:
 *   0 sky, 1 grass, 2 stone wall, 3 bush, 4 tree, 5 stone floor, 6 dungeon wall,
 *   7 crate, 8 sand, 9 void, 10 water, 11 rock, 12 dirt path, 13 boulder,
 *   14 lava, 15 planks (16+ repeat with a slight variation).
 *
 * Sprites (5 columns: idle + 4 walk, 4 rows: down, right, up, left):
 *   player, slime, npc, coin, key, heart, projectile, bullet, ship, drone, star
 */

const B = 16; // base art size

type RGB = [number, number, number];
type Frame = { x: number; y: number; w: number; h: number };

export const STARTER_TILES = [
  'sky', 'grass', 'wall', 'bush', 'tree', 'floor', 'dungeon', 'crate',
  'sand', 'void', 'water', 'rock', 'path', 'boulder', 'lava', 'planks',
] as const;

export const STARTER_SPRITES = [
  'player', 'slime', 'npc', 'coin', 'key', 'heart', 'projectile', 'bullet', 'ship', 'drone', 'star',
] as const;

function hex(c: number): RGB {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** A 16x16 pixel canvas with a few drawing helpers. */
class Px {
  readonly data = new Uint8ClampedArray(B * B * 4);

  set(x: number, y: number, c: RGB, a = 255): void {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= B || y >= B) return;
    const i = (y * B + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = a;
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }

  disc(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }

  fill(c: RGB, noise: number, seed: number): void {
    const r = rng(seed);
    for (let y = 0; y < B; y++) {
      for (let x = 0; x < B; x++) {
        const d = (r() - 0.5) * noise;
        this.set(x, y, [c[0] + d, c[1] + d, c[2] + d]);
      }
    }
  }

  /** Make a disc transparent (holes) */
  erase(cx: number, cy: number, rx: number, ry: number): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1 && x >= 0 && y >= 0 && x < B && y < B) this.data[(y * B + x) * 4 + 3] = 0;
      }
    }
  }

  alpha(x: number, y: number): number {
    return x < 0 || y < 0 || x >= B || y >= B ? 0 : this.data[(y * B + x) * 4 + 3];
  }

  /** Dark 1px outline around the opaque shape (sprites only). */
  outline(c: RGB = [24, 22, 32]): void {
    const edge: [number, number][] = [];
    for (let y = 0; y < B; y++) {
      for (let x = 0; x < B; x++) {
        if (this.alpha(x, y)) continue;
        if (this.alpha(x + 1, y) || this.alpha(x - 1, y) || this.alpha(x, y + 1) || this.alpha(x, y - 1)) edge.push([x, y]);
      }
    }
    for (const [x, y] of edge) this.set(x, y, c);
  }

  mirrored(): Px {
    const out = new Px();
    for (let y = 0; y < B; y++) {
      for (let x = 0; x < B; x++) {
        const i = (y * B + x) * 4, j = (y * B + (B - 1 - x)) * 4;
        for (let k = 0; k < 4; k++) out.data[j + k] = this.data[i + k];
      }
    }
    return out;
  }
}

// ---- Tiles ----

function drawTile(name: typeof STARTER_TILES[number], seed: number): Px {
  const p = new Px();
  const r = rng(seed * 7919 + 13);
  switch (name) {
    case 'sky':
      p.fill(hex(0x8ecdf0), 6, seed);
      break;
    case 'grass':
      p.fill(hex(0x5f9e45), 14, seed);
      for (let i = 0; i < 14; i++) {
        const x = Math.floor(r() * B), y = Math.floor(r() * (B - 1));
        p.set(x, y, hex(r() > 0.5 ? 0x78b856 : 0x4a8236));
        p.set(x, y + 1, hex(0x4a8236));
      }
      break;
    case 'wall':
      p.fill(hex(0x8a8a94), 10, seed);
      for (let row = 0; row < 4; row++) {
        p.rect(0, row * 4 + 3, B - 1, row * 4 + 3, hex(0x55555f));
        const off = row % 2 ? 4 : 0;
        for (let x = off; x < B; x += 8) p.rect(x, row * 4, x, row * 4 + 2, hex(0x55555f));
        p.rect(0, row * 4, B - 1, row * 4, hex(0xa4a4ae));
      }
      break;
    case 'bush':
      p.fill(hex(0x4f8a3a), 10, seed);
      for (let i = 0; i < 5; i++) p.disc(2 + r() * 12, 2 + r() * 12, 3, 3, hex(0x3c6e2c));
      for (let i = 0; i < 6; i++) p.set(r() * B, r() * B, hex(0x7cc25e));
      break;
    case 'tree':
      p.fill(hex(0x5f9e45), 12, seed);
      p.disc(8.5, 10.5, 6, 3, hex(0x3d6b2c));               // shadow
      p.disc(7.5, 7, 6.5, 6, hex(0x2f6b2a));                // canopy
      p.disc(6.5, 5.5, 4, 3.5, hex(0x3f8a35));
      p.disc(5.5, 4.5, 1.5, 1.2, hex(0x5fae4d));
      break;
    case 'floor':
      p.fill(hex(0x9a958a), 10, seed);
      for (const [x0, y0, x1, y1] of [[0, 0, 7, 7], [8, 0, 15, 5], [8, 6, 15, 15], [0, 8, 7, 15]]) {
        p.rect(x0, y1, x1, y1, hex(0x6f6a60));
        p.rect(x1, y0, x1, y1, hex(0x6f6a60));
        p.rect(x0, y0, x1 - 1, y0, hex(0xb0ab9f));
      }
      break;
    case 'dungeon':
      p.fill(hex(0x4d4559), 10, seed);
      for (let row = 0; row < 4; row++) {
        p.rect(0, row * 4 + 3, B - 1, row * 4 + 3, hex(0x2c2735));
        const off = row % 2 ? 4 : 0;
        for (let x = off; x < B; x += 8) p.rect(x, row * 4, x, row * 4 + 2, hex(0x2c2735));
      }
      if (seed % 3 === 0) p.rect(10, 5, 10, 6, hex(0x6c8a4a)); // moss
      break;
    case 'crate':
      p.rect(0, 0, B - 1, B - 1, hex(0x9b6a3c));
      p.rect(0, 0, B - 1, 1, hex(0xc08a50)); p.rect(0, B - 2, B - 1, B - 1, hex(0x6b4524));
      p.rect(0, 0, 1, B - 1, hex(0x6b4524)); p.rect(B - 2, 0, B - 1, B - 1, hex(0x6b4524));
      for (let i = 2; i < B - 2; i++) { p.set(i, i, hex(0x6b4524)); p.set(i, B - 1 - i, hex(0x6b4524)); }
      break;
    case 'sand':
      p.fill(hex(0xdcc58f), 12, seed);
      for (let i = 0; i < 5; i++) p.set(r() * B, r() * B, hex(0xb8a06c));
      break;
    case 'void':
      p.fill(hex(0x14121f), 6, seed);
      for (let i = 0; i < 3; i++) p.set(r() * B, r() * B, hex(0x6f6a9a));
      break;
    case 'water':
      p.fill(hex(0x3c7fc2), 8, seed);
      for (let i = 0; i < 3; i++) {
        const x = Math.floor(r() * 10), y = 2 + Math.floor(r() * 12);
        p.rect(x, y, x + 4, y, hex(0x78b2e6));
      }
      break;
    case 'rock':
      p.fill(hex(0x6e6a66), 14, seed);
      p.disc(5, 5, 4, 3, hex(0x85807a)); p.disc(11, 11, 4, 3, hex(0x85807a));
      p.rect(3, 3, 5, 3, hex(0x9c968f)); p.rect(9, 9, 11, 9, hex(0x9c968f));
      break;
    case 'path':
      p.fill(hex(0xa07a50), 14, seed);
      for (let i = 0; i < 6; i++) p.set(r() * B, r() * B, hex(0x7f5e3c));
      for (let i = 0; i < 3; i++) p.set(r() * B, r() * B, hex(0xc09a6c));
      break;
    case 'boulder':
      p.fill(hex(0x5f9e45), 12, seed);
      p.disc(8.5, 11, 6, 2.5, hex(0x3d6b2c));
      p.disc(8, 8, 6, 5.5, hex(0x7d7975));
      p.disc(6.5, 6.5, 3, 2.5, hex(0x9c968f));
      p.set(5, 5, hex(0xbdb7ae));
      break;
    case 'lava':
      p.fill(hex(0xd8461c), 20, seed);
      for (let i = 0; i < 4; i++) p.disc(r() * B, r() * B, 2, 1.5, hex(0xffb52e));
      for (let i = 0; i < 3; i++) p.set(r() * B, r() * B, hex(0x7a1d0c));
      break;
    case 'planks':
      p.fill(hex(0xa8743e), 8, seed);
      for (let y = 3; y < B; y += 4) p.rect(0, y, B - 1, y, hex(0x6e4a26));
      p.rect(0, 0, B - 1, 0, hex(0xc99055));
      for (let y = 0; y < B; y += 4) p.set(((y * 5) % 13) + 1, y + 1, hex(0x6e4a26));
      break;
  }
  return p;
}

// ---- Sprites ----

type View = 'down' | 'right' | 'up';
const OUTLINE: RGB = [24, 22, 32];

function legs(p: Px, view: View, frame: number, c: RGB, y = 14): void {
  const step = frame === 0 ? 0 : [0, 1, 0, -1][(frame - 1) % 4];
  if (view === 'right') {
    p.rect(6 + step, y - 1, 7 + step, y, c);
    p.rect(9 - step, y - 1, 10 - step, y, c);
  } else {
    p.rect(5, y - 1 - Math.max(0, step), 6, y - Math.max(0, step), c);
    p.rect(9, y - 1 - Math.max(0, -step), 10, y - Math.max(0, -step), c);
  }
}

function drawSprite(name: typeof STARTER_SPRITES[number], view: View, frame: number): Px {
  const p = new Px();
  const walking = frame > 0;
  const bob = walking && frame % 2 === 1 ? 1 : 0;

  switch (name) {
    case 'player': {
      legs(p, view, frame, hex(0x5a3a22));
      p.rect(4, 8 + bob, 11, 12 + bob, hex(0x3a62b8));     // tunic
      p.rect(4, 11 + bob, 11, 11 + bob, hex(0x6e4826));    // belt
      p.disc(7.5, 4.5 + bob, 4, 4, hex(0x9aa4b1));          // helmet
      p.rect(5, 2 + bob, 7, 3 + bob, hex(0xc9d1db));
      p.rect(7, 0 + bob, 8, 1 + bob, hex(0xc0392b));        // plume
      if (view === 'down') p.rect(5, 5 + bob, 10, 5 + bob, hex(0x1e1e28));
      if (view === 'right') p.rect(9, 5 + bob, 11, 5 + bob, hex(0x1e1e28));
      if (view !== 'up') p.rect(view === 'right' ? 10 : 3, 9 + bob, view === 'right' ? 11 : 3, 11 + bob, hex(0xc9d1db));
      break;
    }
    case 'slime': {
      const squash = walking ? [0, 1, 0, -1][(frame - 1) % 4] : 0;
      p.disc(7.5, 10 - squash / 2, 6 + squash / 2, 4.5 - squash / 2, hex(0x5ec94a));
      p.disc(5.5, 8 - squash / 2, 2, 1.2, hex(0x9be880));   // shine
      if (view !== 'up') {
        const ex = view === 'right' ? [9, 12] : [5, 10];
        for (const x of ex) { p.rect(x, 9, x, 10, hex(0x1e1e28)); p.set(x, 9, hex(0xffffff)); }
      }
      break;
    }
    case 'npc': {
      legs(p, view, frame, hex(0x6a5a4a));
      p.rect(4, 7 + bob, 11, 13 + bob, hex(0xd8d2c4));     // light robe (tintable)
      p.rect(4, 12 + bob, 11, 13 + bob, hex(0xb8b0a0));
      p.disc(7.5, 4.5 + bob, 3.6, 3.6, hex(0xc8c0b0));      // hood
      if (view === 'down') { p.rect(6, 4 + bob, 9, 6 + bob, hex(0xe8b48a)); p.set(6, 5 + bob, hex(0x2a2a2a)); p.set(9, 5 + bob, hex(0x2a2a2a)); }
      if (view === 'right') { p.rect(8, 4 + bob, 10, 6 + bob, hex(0xe8b48a)); p.set(9, 5 + bob, hex(0x2a2a2a)); }
      break;
    }
    case 'coin': {
      const w = walking ? [5, 3, 1, 3][(frame - 1) % 4] : 5;   // spin when moving
      p.disc(7.5, 7.5, w, 5.5, hex(0xd99a1f));
      p.disc(7.5, 7.5, Math.max(0.5, w - 1.5), 4, hex(0xffd23f));
      if (w > 2) p.rect(6, 5, 6, 8, hex(0xfff1a8));
      break;
    }
    case 'key':
      p.disc(4.5, 7.5, 3, 3, hex(0xe0b030));
      p.erase(4.5, 7.5, 1.2, 1.2);
      p.rect(7, 7, 13, 8, hex(0xe0b030));
      p.rect(11, 9, 11, 10, hex(0xe0b030)); p.rect(13, 9, 13, 11, hex(0xe0b030));
      break;
    case 'heart':
      p.disc(5, 6, 3, 3, hex(0xe0344a)); p.disc(10, 6, 3, 3, hex(0xe0344a));
      for (let y = 6; y < 14; y++) p.rect(2 + (y - 6), y, 13 - (y - 6), y, hex(0xe0344a));
      p.set(4, 5, hex(0xff9aa8)); p.set(5, 4, hex(0xff9aa8));
      break;
    case 'projectile':
      p.disc(7.5, 7.5, 4, 4, hex(0xbfe8ff));
      p.disc(7.5, 7.5, 2.5, 2.5, hex(0xffffff));
      break;
    case 'bullet':
      p.disc(7.5, 7.5, 2.5, 3.5, hex(0xffffff));
      p.disc(7.5, 6.5, 1, 1.5, hex(0xfff8d0));
      break;
    case 'ship': {
      for (let y = 2; y < 13; y++) { const hw = Math.min(5, Math.floor((y - 1) / 2)); p.rect(7 - hw, y, 8 + hw, y, hex(0xc9d1db)); }
      p.rect(7, 4, 8, 7, hex(0x3fa9f5));                     // cockpit
      p.rect(2, 10, 4, 12, hex(0x8a94a3)); p.rect(11, 10, 13, 12, hex(0x8a94a3));
      if (frame % 2 === 0) p.rect(6, 13, 9, 14, hex(0xffb52e)); else p.rect(7, 13, 8, 15, hex(0xff6a2e));
      break;
    }
    case 'drone': {
      p.disc(7.5, 8, 6.5, 3, hex(0x8a94a3));
      p.disc(7.5, 6.5, 3.5, 3, hex(0xc9d1db));
      p.rect(6, 6, 9, 7, hex(0xff4d4d));                     // eye
      for (const x of [2, 7, 12]) p.set(x + (frame % 2), 9, hex(0xffd23f));
      break;
    }
    case 'star':
      p.rect(7, 6, 8, 9, hex(0xffffff)); p.rect(6, 7, 9, 8, hex(0xffffff));
      return p; // no outline: background stars stay soft
  }
  p.outline(OUTLINE);
  return p;
}

/**
 * Draw the starter atlas. The canvas keeps tilesX columns so tile indices map
 * the same way as before; sprite blocks (5 x 4 cells each) stack below the tiles.
 */
export function drawStarterAtlas(tileSize: number, tilesX: number, tilesY: number): { canvas: HTMLCanvasElement; frames: Map<string, Frame> } {
  const cols = Math.max(tilesX, 5);
  const spriteRows = 4 * STARTER_SPRITES.length;
  const rows = Math.max(tilesY, 4 + spriteRows);

  // Draw at 16px, then scale to the game's tile size
  const base = document.createElement('canvas');
  base.width = cols * B;
  base.height = rows * B;
  const bctx = base.getContext('2d')!;
  const put = (p: Px, cx: number, cy: number) => bctx.putImageData(new ImageData(p.data, B, B), cx * B, cy * B);

  for (let y = 0; y < 4 && y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = x + y * cols;
      put(drawTile(STARTER_TILES[idx % STARTER_TILES.length], idx + 1), x, y);
    }
  }

  const frames = new Map<string, Frame>();
  STARTER_SPRITES.forEach((name, i) => {
    const row0 = 4 + i * 4;
    (['down', 'right', 'up', 'left'] as const).forEach((dir, d) => {
      for (let f = 0; f < 5; f++) {
        const view: View = dir === 'left' ? 'right' : dir;
        let px = drawSprite(name, view, f);
        if (dir === 'left') px = px.mirrored();
        put(px, f, row0 + d);
      }
    });
    frames.set(name, { x: 0, y: row0 * tileSize, w: tileSize, h: tileSize });
  });

  const canvas = document.createElement('canvas');
  canvas.width = cols * tileSize;
  canvas.height = rows * tileSize;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0, canvas.width, canvas.height);
  return { canvas, frames };
}
