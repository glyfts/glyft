/**
 * Heightmap sources for 3D terrain: image URL, raw array, or a seeded generator.
 *
 * Generated land puts its shoreline at about 0.2 of maxHeight, so a water
 * height of 0.2 x maxHeight gives a clean coast.
 */

import type { HeightmapGenerator } from './types';

/** Seeded 2D value noise with smooth interpolation. */
function createNoise(seed: number): (x: number, y: number) => number {
  const perm = new Uint8Array(512);
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const values = Float32Array.from({ length: 256 }, () => rand());

  const smooth = (t: number) => t * t * (3 - 2 * t);
  const at = (x: number, y: number) => values[perm[(x & 255) + perm[y & 255]]];

  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = smooth(x - xi), ty = smooth(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi);
    const c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves = 5): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Generate a heightmap grid of (size+1) x (size+1) values in 0..1. */
export function generateHeightmap(def: HeightmapGenerator): number[][] {
  const size = def.size ?? 128;
  const seed = def.seed ?? 1;
  const noise = createNoise(seed);
  const rand = createNoise(seed * 31 + 7);

  // Island centres for the archipelago, placed on a jittered ring plus one in the middle
  const centres: [number, number, number][] = [];
  if (def.generate === 'archipelago') {
    centres.push([0.5, 0.5, 0.22]);
    const count = 5;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand(i, 1) * 0.8;
      const dist = 0.28 + rand(i, 2) * 0.1;
      centres.push([0.5 + Math.cos(angle) * dist, 0.5 + Math.sin(angle) * dist, 0.1 + rand(i, 3) * 0.08]);
    }
  }

  // Cave layout: a central chamber, a few side pockets, some columns
  const caveRooms: [number, number, number][] = [];
  const cavePillars: [number, number][] = [];
  if (def.generate === 'cave') {
    caveRooms.push([0.5, 0.5, 0.26]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rand(i, 5) * 0.9;
      const d = 0.2 + rand(i, 6) * 0.06;
      caveRooms.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.12 + rand(i, 7) * 0.06]);
    }
    for (let i = 0; i < 5; i++) {
      const a = rand(i, 8) * Math.PI * 2, d = 0.06 + rand(i, 9) * 0.14;
      cavePillars.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d]);
    }
  }

  const grid: number[][] = [];
  for (let gy = 0; gy <= size; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx <= size; gx++) {
      const u = gx / size, v = gy / size;
      const n = fbm(noise, u * 6, v * 6);
      let h: number;

      switch (def.generate) {
        case 'flat':
          h = 0.25;
          break;
        case 'cave': {
          // A main chamber plus side pockets; the floor is low and lumpy, the walls climb steeply
          let open = -1;
          for (const [cx, cy, r] of caveRooms) {
            const dx = u - cx, dy = v - cy;
            open = Math.max(open, 1 - Math.sqrt(dx * dx + dy * dy) / (r * (0.85 + fbm(noise, u * 5 + cx * 7, v * 5, 3) * 0.35)));
          }
          if (open > 0) {
            h = 0.04 + (n - 0.5) * 0.06 + Math.max(0, 0.12 - open) * 1.5;
            for (const [px, py] of cavePillars) {
              const d = Math.hypot(u - px, v - py);
              if (d < 0.025) h = Math.max(h, 0.9 - d * 12);
            }
          } else {
            h = Math.min(1, 0.22 - open * 2.4 + (n - 0.5) * 0.25);
          }
          break;
        }
        case 'hills':
          h = 0.22 + n * 0.55;
          break;
        case 'island': {
          const dx = u - 0.5, dy = v - 0.5;
          const d = Math.sqrt(dx * dx + dy * dy) / 0.4;
          // Wobbly coastline: distance bent by low-frequency noise
          const shape = 1 - d * (0.85 + fbm(noise, u * 3 + 9, v * 3 + 9, 3) * 0.5);
          h = shape > 0 ? 0.2 + shape * 0.5 + (n - 0.5) * 0.35 * Math.min(1, shape * 3) : 0.2 + shape * 0.3;
          break;
        }
        case 'archipelago': {
          let best = -1;
          for (const [cx, cy, r] of centres) {
            const dx = u - cx, dy = v - cy;
            const d = Math.sqrt(dx * dx + dy * dy) / r;
            best = Math.max(best, 1 - d * (0.8 + fbm(noise, u * 4 + cx * 10, v * 4, 3) * 0.5));
          }
          h = best > 0 ? 0.2 + best * 0.45 + (n - 0.5) * 0.3 * Math.min(1, best * 3) : 0.2 + best * 0.15;
          break;
        }
        default:
          throw new Error(
            `Unknown heightmap generator '${(def as HeightmapGenerator).generate}'.\n\nFix: use 'island', 'archipelago', 'hills', 'cave' or 'flat'.`
          );
      }
      row.push(Math.max(0, Math.min(1, h)));
    }
    grid.push(row);
  }
  return grid;
}

/** Read an image's red channel as heights (0..1). */
async function loadHeightmapImage(url: string): Promise<number[][]> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode().catch(() => {
    throw new Error(`Failed to load heightmap '${url}'.\n\nFix: check the path is correct relative to your HTML page.`);
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const grid: number[][] = [];
  for (let y = 0; y < img.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < img.width; x++) row.push(data[(y * img.width + x) * 4] / 255);
    grid.push(row);
  }
  return grid;
}

/** Resolve any heightmap source to a grid of 0..1 heights. */
export async function resolveHeightmap(source: string | number[][] | HeightmapGenerator): Promise<number[][]> {
  if (typeof source === 'string') return loadHeightmapImage(source);
  if (Array.isArray(source)) {
    if (source.length < 2 || !Array.isArray(source[0]) || source[0].length < 2) {
      throw new Error('Heightmap array must be at least 2x2.\n\nFix: pass number[][] with rows of 0..1 heights.');
    }
    return source;
  }
  return generateHeightmap(source);
}
