/**
 * Glyft Basic Example
 *
 * Tests core engine: tilemap, sprites, input, camera.
 */

import { Glyft, type GlyftConfig } from '../../src';

const config: GlyftConfig = {
  settings: {
    tileSize: 16,
    viewport: [320, 240],
    spriteMode: '4dir',
    backgroundColor: 0x2d3436,
  },
  autoTags: {
    'enemy_': ['enemy'],
    'pickup_': ['pickup'],
  },
  stats: {
    hp: { default: 100, max: 100 },
    coins: { default: 0 },
  },
  sounds: {
    // Movement sounds - procedural test sounds (prefix with $)
    '[player]:moving': { sound: '$step', interval: 0.2, volume: 0.3 },
    '[enemy]:moving': { sound: '$step', interval: 0.3, volume: 0.15, pitch: [0.8, 1.0] },
    // Collision sounds
    '[player]:[enemy]': { sound: '$hurt', cooldown: 0.5, volume: 0.5 },
  },
  collisions: {
    // Player takes damage from enemies
    '[player]:[enemy]': { damage: 10, knockback: 100, flash: 0.2, cooldown: 0.5 },
  },
  music: {
    // Procedural test music (no audio files needed)
    'overworld': { track: '$peaceful', loop: true, volume: 1 },
    'danger': { track: '$battle', loop: true, volume: 1 },
  },
};

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Glyft(canvas, config);

// Create test atlas (procedural - no image files needed)
const atlas = game.createTestAtlas('test', 8, 8);

// Create tilemap
const map = game.createMap(atlas, 32, 32);

// Fill with floor tiles
map.fill(0, 0, 32, 32, 1);

// Add some walls around the edges
for (let x = 0; x < 32; x++) {
  map.set(x, 0, 2);
  map.set(x, 31, 2);
  map.setCollision(x, 0, true);
  map.setCollision(x, 31, true);
}
for (let y = 0; y < 32; y++) {
  map.set(0, y, 2);
  map.set(31, y, 2);
  map.setCollision(0, y, true);
  map.setCollision(31, y, true);
}

// Add some obstacles
const obstacles = [
  [10, 10], [11, 10], [10, 11],
  [20, 15], [21, 15], [22, 15],
  [15, 20], [15, 21], [15, 22],
];
for (const [x, y] of obstacles) {
  map.set(x, y, 3);
  map.setCollision(x, y, true);
}

// Create player sprite
const player = game.createSprite(atlas, 'player');
player.x = 16 * 16;  // Center of map
player.y = 16 * 16;
player.tags = ['player'];

// Create some enemy sprites
const enemies = [];
for (let i = 0; i < 5; i++) {
  const enemy = game.createSprite(atlas, 'player');
  enemy.x = (5 + i * 5) * 16;
  enemy.y = (5 + i * 3) * 16;
  enemy.tint = 0xff6b6b;  // Red tint
  enemy.tags = ['enemy'];
  enemies.push(enemy);
}

// Camera follows player
game.camera.follow(player, { smoothing: 0.08 });
game.camera.setBounds(0, 0, map.widthPx, map.heightPx);

// Game loop
const SPEED = 120;

game.onUpdate((dt) => {
  // Player input
  let vx = 0;
  let vy = 0;

  if (game.input.isDown('ArrowLeft') || game.input.isDown('KeyA')) vx -= 1;
  if (game.input.isDown('ArrowRight') || game.input.isDown('KeyD')) vx += 1;
  if (game.input.isDown('ArrowUp') || game.input.isDown('KeyW')) vy -= 1;
  if (game.input.isDown('ArrowDown') || game.input.isDown('KeyS')) vy += 1;

  // Normalize diagonal
  if (vx !== 0 && vy !== 0) {
    vx *= 0.707;
    vy *= 0.707;
  }

  // Set velocity (GPU handles animation)
  player.vx = vx * SPEED;
  player.vy = vy * SPEED;

  // Move with collision (uses sprite's frame size automatically)
  const nx = player.x + player.vx * dt;
  const ny = player.y + player.vy * dt;

  if (!game.spriteCollidesWithMap(player, nx, player.y)) {
    player.x = nx;
  }
  if (!game.spriteCollidesWithMap(player, player.x, ny)) {
    player.y = ny;
  }

  // Simple enemy AI - move toward player
  for (const enemy of enemies) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 30 && dist < 200) {
      const speed = 40;
      enemy.vx = (dx / dist) * speed;
      enemy.vy = (dy / dist) * speed;

      const ex = enemy.x + enemy.vx * dt;
      const ey = enemy.y + enemy.vy * dt;

      if (!game.spriteCollidesWithMap(enemy, ex, enemy.y)) {
        enemy.x = ex;
      }
      if (!game.spriteCollidesWithMap(enemy, enemy.x, ey)) {
        enemy.y = ey;
      }
    } else {
      enemy.vx = 0;
      enemy.vy = 0;
    }
  }
});

// Add HP display
const hpDisplay = document.createElement('div');
hpDisplay.style.cssText = 'position:fixed;top:10px;left:10px;color:white;font-family:monospace;font-size:14px;';
document.body.appendChild(hpDisplay);

game.onUpdate(() => {
  hpDisplay.textContent = `HP: ${player.hp ?? 100}`;
});

// Start background music
game.music.play('overworld', { fade: 1 });

// Switch to danger music when HP is low
let wasLowHP = false;

game.onUpdate(() => {
  const hp = player.hp ?? 100;
  const isLowHP = hp < 50;

  if (isLowHP && !wasLowHP) {
    game.music.play('danger', { fade: 0.5 });
  } else if (!isLowHP && wasLowHP) {
    game.music.play('overworld', { fade: 0.5 });
  }
  wasLowHP = isLowHP;
});

game.start();

// Music toggle
let musicEnabled = true;
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') {
    musicEnabled = !musicEnabled;
    if (musicEnabled) {
      game.music.play(wasLowHP ? 'danger' : 'overworld', { fade: 0.3 });
    } else {
      game.music.stop({ fade: 0.3 });
    }
    console.log(`Music: ${musicEnabled ? 'ON' : 'OFF'}`);
  }
});

console.log('Glyft running! Use arrow keys or WASD to move.');
console.log('Sound: footsteps, hurt sounds | Music: changes when HP < 50');
console.log('Press M to toggle music on/off');
