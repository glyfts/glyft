/**
 * Built-in procedural materials for 3D worlds.
 *
 * Every surface a world needs (terrain, buildings, ships) has a named
 * material drawn on a small canvas, so a world renders with zero asset files.
 * Any material slot also accepts a hex colour or an image URL.
 */

import type { WorldTexture } from './types';

/** Material names available to terrain, buildings and ships. */
export const MATERIAL_NAMES = [
  'sand', 'grass', 'rock', 'snow', 'dirt', 'mud',
  'stone', 'brick', 'plaster', 'wood', 'planks', 'thatch', 'slate',
  'door', 'window', 'sail', 'rope', 'metal', 'hull', 'deck', 'lava',
] as const;

export type MaterialName = typeof MATERIAL_NAMES[number];

const TILE = 32;

/** Base colour and noise strength per material. */
const BASE: Record<MaterialName, [number, number, number, number]> = {
  sand: [214, 196, 148, 14],
  grass: [92, 142, 64, 22],
  rock: [122, 116, 108, 26],
  snow: [236, 240, 246, 8],
  dirt: [124, 92, 62, 20],
  mud: [86, 70, 52, 16],
  stone: [138, 134, 126, 18],
  brick: [150, 78, 58, 14],
  plaster: [222, 210, 186, 8],
  wood: [118, 82, 50, 14],
  planks: [150, 108, 66, 12],
  thatch: [186, 152, 82, 22],
  slate: [74, 82, 94, 12],
  door: [96, 62, 36, 10],
  window: [70, 96, 120, 6],
  sail: [232, 224, 204, 6],
  rope: [168, 140, 96, 10],
  metal: [70, 72, 78, 10],
  hull: [92, 60, 36, 12],
  deck: [176, 136, 88, 10],
  lava: [230, 90, 20, 30],
};

/** Small deterministic RNG so materials look the same every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function shade(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rgb: [number, number, number], d: number): void {
  ctx.fillStyle = `rgb(${clamp(rgb[0] + d)},${clamp(rgb[1] + d)},${clamp(rgb[2] + d)})`;
  ctx.fillRect(x, y, w, h);
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Draw one material into a TILE x TILE square at (ox, oy). */
function drawMaterial(ctx: CanvasRenderingContext2D, name: MaterialName, ox: number, oy: number): void {
  const [r, g, b, noise] = BASE[name];
  const rgb: [number, number, number] = [r, g, b];
  const rand = rng(name.length * 7919 + name.charCodeAt(0) * 104729);

  // Speckled base
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      shade(ctx, ox + x, oy + y, 1, 1, rgb, (rand() - 0.5) * noise);
    }
  }

  const line = (x: number, y: number, w: number, h: number, d: number) => shade(ctx, ox + x, oy + y, w, h, rgb, d);

  switch (name) {
    case 'brick':
      for (let row = 0; row < 4; row++) {
        line(0, row * 8 + 7, TILE, 1, 60);
        const off = row % 2 ? 8 : 0;
        for (let c = 0; c < 2; c++) line((off + c * 16) % TILE, row * 8, 1, 7, 60);
      }
      break;
    case 'stone':
      for (let row = 0; row < 3; row++) {
        line(0, row * 11 + 10, TILE, 1, -40);
        const off = row % 2 ? 6 : 14;
        line(off, row * 11, 1, 10, -40);
        line((off + 14) % TILE, row * 11, 1, 10, -40);
      }
      break;
    case 'planks':
    case 'deck':
      for (let i = 0; i < 4; i++) line(0, i * 8 + 7, TILE, 1, -45);
      break;
    case 'wood':
    case 'hull':
      for (let i = 0; i < 6; i++) line(0, Math.floor(rand() * TILE), TILE, 1, -25);
      break;
    case 'thatch':
      for (let i = 0; i < 40; i++) line(Math.floor(rand() * TILE), Math.floor(rand() * TILE), 1, 4, rand() > 0.5 ? 30 : -30);
      break;
    case 'slate':
      for (let row = 0; row < 4; row++) {
        line(0, row * 8 + 7, TILE, 1, -30);
        for (let c = 0; c < 4; c++) line(((row % 2) * 4 + c * 8) % TILE, row * 8, 1, 7, -30);
      }
      break;
    case 'door':
      line(0, 0, TILE, TILE, 30);
      line(6, 4, 20, 28, 0);
      for (let i = 0; i < 3; i++) line(6 + i * 7, 4, 1, 28, -30);
      line(21, 18, 2, 2, 120);
      break;
    case 'window':
      line(0, 0, TILE, TILE, 140);
      line(6, 6, 20, 20, 0);
      line(15, 6, 2, 20, 140);
      line(6, 15, 20, 2, 140);
      line(8, 8, 3, 3, 90);
      break;
    case 'grass':
      for (let i = 0; i < 30; i++) line(Math.floor(rand() * TILE), Math.floor(rand() * TILE), 1, 2, rand() > 0.5 ? 26 : -22);
      break;
    case 'rock':
      for (let i = 0; i < 8; i++) line(Math.floor(rand() * TILE), Math.floor(rand() * TILE), Math.floor(rand() * 8) + 2, 1, -35);
      break;
    case 'sail':
      for (let i = 0; i < 4; i++) line(0, i * 8 + 7, TILE, 1, -14);
      break;
    case 'lava':
      for (let i = 0; i < 10; i++) line(Math.floor(rand() * TILE), Math.floor(rand() * TILE), 4, 2, 25);
      break;
  }
}

function isMaterialName(v: string): v is MaterialName {
  return (MATERIAL_NAMES as readonly string[]).includes(v);
}

function uploadCanvas(gl: WebGL2RenderingContext, source: TexImageSource, smooth = false): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d')!];
}

/**
 * Resolve a texture slot: material name, hex colour, or image URL.
 * Unknown names fail loudly with the list of valid materials.
 */
export async function loadWorldTexture(gl: WebGL2RenderingContext, source: WorldTexture): Promise<WebGLTexture> {
  if (typeof source === 'number') {
    const [canvas, ctx] = makeCanvas(TILE, TILE);
    ctx.fillStyle = '#' + source.toString(16).padStart(6, '0');
    ctx.fillRect(0, 0, TILE, TILE);
    return uploadCanvas(gl, canvas);
  }
  if (isMaterialName(source)) {
    const [canvas, ctx] = makeCanvas(TILE, TILE);
    drawMaterial(ctx, source, 0, 0);
    return uploadCanvas(gl, canvas);
  }
  if (!source.includes('.') && !source.includes('/')) {
    throw new Error(
      `Unknown material '${source}'.\n\nFix: use one of ${MATERIAL_NAMES.join(', ')}, a hex colour like 0x88aa55, or an image URL.`
    );
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = source;
  await img.decode().catch(() => {
    throw new Error(`Failed to load texture '${source}'.\n\nFix: check the path is correct relative to your HTML page.`);
  });
  return uploadCanvas(gl, img, true);
}

/** Built-in building atlas: every material as one tile, looked up by name. */
export interface MaterialAtlas {
  texture: WebGLTexture;
  width: number;
  height: number;
  tileSize: number;
  /** Tile index for a material name or a raw index */
  index(face: string | number): number;
}

export function createMaterialAtlas(gl: WebGL2RenderingContext): MaterialAtlas {
  const perRow = 8;
  const rows = Math.ceil(MATERIAL_NAMES.length / perRow);
  const size = perRow * TILE;
  const [canvas, ctx] = makeCanvas(size, Math.max(rows, perRow) * TILE);
  MATERIAL_NAMES.forEach((name, i) => drawMaterial(ctx, name, (i % perRow) * TILE, Math.floor(i / perRow) * TILE));

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    texture,
    width: size,
    height: size,
    tileSize: TILE,
    index(face) {
      if (typeof face === 'number') return face;
      const i = MATERIAL_NAMES.indexOf(face as MaterialName);
      if (i < 0) {
        throw new Error(`Unknown building material '${face}'.\n\nFix: use one of ${MATERIAL_NAMES.join(', ')}.`);
      }
      return i;
    },
  };
}
