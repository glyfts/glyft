/**
 * Glyft 10K Sprite Benchmark
 *
 * Tests raw GPU performance with thousands of animated sprites.
 * All animation runs on GPU - zero CPU cost per sprite.
 */

import { Glyft, type GlyftConfig, type Sprite } from '../../src';

const config: GlyftConfig = {
  settings: {
    tileSize: 16,
    viewport: [400, 300],
    spriteMode: '4dir',
    backgroundColor: 0x1a1a2e,
  },
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;
const game = new Glyft(canvas, config);

// Create test atlas
const atlas = game.createTestAtlas('test', 8, 8);

// Create tilemap (simple floor)
const map = game.createMap(atlas, 50, 50);
map.fill(0, 0, 50, 50, 1);

// Sprite storage
let sprites: Sprite[] = [];
let targetCount = 10000;

// Performance tracking
let frameCount = 0;
let lastFpsTime = performance.now();
let fps = 0;
let frameTime = 0;

function createSprites(count: number) {
  // Remove existing sprites
  for (const sprite of sprites) {
    sprite.destroy();
  }
  sprites = [];

  // Create new sprites
  const mapWidth = 50 * 16;
  const mapHeight = 50 * 16;

  for (let i = 0; i < count; i++) {
    const sprite = game.createSprite(atlas, 'player');

    // Random position across the map
    sprite.x = Math.random() * mapWidth;
    sprite.y = Math.random() * mapHeight;

    // Random velocity (creates movement + animation)
    const speed = 20 + Math.random() * 60;
    const angle = Math.random() * Math.PI * 2;
    sprite.vx = Math.cos(angle) * speed;
    sprite.vy = Math.sin(angle) * speed;

    // Random tint for visual variety
    const hue = Math.random();
    sprite.tint = hslToRgb(hue, 0.7, 0.6);

    sprites.push(sprite);
  }

  targetCount = count;
}

// HSL to RGB helper
function hslToRgb(h: number, s: number, l: number): number {
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

// Initialize with 10k sprites
createSprites(10000);

// Button handlers
document.getElementById('btn1k')?.addEventListener('click', () => createSprites(1000));
document.getElementById('btn5k')?.addEventListener('click', () => createSprites(5000));
document.getElementById('btn10k')?.addEventListener('click', () => createSprites(10000));
document.getElementById('btn25k')?.addEventListener('click', () => createSprites(25000));
document.getElementById('btn50k')?.addEventListener('click', () => createSprites(50000));

// Game loop
const mapWidth = 50 * 16;
const mapHeight = 50 * 16;

game.onUpdate((dt) => {
  // Move sprites and bounce off edges
  for (const sprite of sprites) {
    // Update position
    sprite.x += sprite.vx * dt;
    sprite.y += sprite.vy * dt;

    // Bounce off map edges
    if (sprite.x < 0 || sprite.x > mapWidth - 16) {
      sprite.vx *= -1;
      sprite.x = Math.max(0, Math.min(sprite.x, mapWidth - 16));
    }
    if (sprite.y < 0 || sprite.y > mapHeight - 16) {
      sprite.vy *= -1;
      sprite.y = Math.max(0, Math.min(sprite.y, mapHeight - 16));
    }
  }

  // FPS calculation
  frameCount++;
  const now = performance.now();
  const elapsed = now - lastFpsTime;

  if (elapsed >= 500) {
    fps = Math.round((frameCount / elapsed) * 1000);
    frameTime = elapsed / frameCount;
    frameCount = 0;
    lastFpsTime = now;

    // Update stats display
    statsEl.textContent = `${targetCount.toLocaleString()} sprites | ${fps} FPS | ${frameTime.toFixed(2)}ms/frame`;
  }
});

// Center camera on map
game.camera.x = (mapWidth - 400) / 2;
game.camera.y = (mapHeight - 300) / 2;

game.start();

console.log('Glyft benchmark running!');
console.log('All sprites use GPU-driven animation - direction and walk cycle determined by velocity.');
