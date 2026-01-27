<p align="center">
  <img src="logo.png" alt="Glyft" width="120" height="120">
</p>

<h1 align="center">Glyft</h1>

<p align="center">
  <strong>Faster to write. Faster to run.</strong>
</p>

<p align="center">
  Less code. More sprites.<br>
  A WebGL2 framework that moves work from your code to the GPU.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?style=flat-square" alt="TypeScript">
  <img src="https://img.shields.io/badge/runtime-WebGL2-ff6600?style=flat-square" alt="WebGL2">
  <img src="https://img.shields.io/badge/dependencies-0-success?style=flat-square" alt="Zero Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <a href="https://glyft.dev">Website</a> •
  <a href="https://glyft.dev/docs">Docs</a> •
  <a href="https://glyft.dev/examples">Examples</a> •
  <a href="#quick-start">Quick Start</a>
</p>

---

## The Idea

Most game code is boilerplate: animation state machines, collision callbacks, sound triggers. Glyft handles these declaratively so you can focus on what makes your game unique.

```typescript
// You write this:
player.vx = -100;

// The GPU figures out:
// - Character is moving left
// - Play walk animation
// - Use left-facing sprite row
// - Return to idle when velocity is zero
// - Remember which way you're facing
```

No animation state machine. No frame counters. No direction enums. Set velocity, and animation just works.

## Quick Start

```bash
npm install glyft
```

```typescript
import { Glyft } from 'glyft';

const game = new Glyft(canvas, {
  tileSize: 16,
  viewport: [320, 240],

  // Collisions as rules, not callbacks
  collisions: {
    '[player]:[enemy]': { damage: 10, knockback: 50, flash: 0.1 },
    '[player]:[coin]': { collect: 'coins', destroy: true },
  },

  // Sounds trigger automatically
  sounds: {
    '[player]:[enemy]': { sound: 'hit.wav', cooldown: 0.5 },
    '[player]:moving': { sound: 'step.wav', interval: 0.25 },
  },
});

const sprites = await game.loadAtlas('sprites.png', 'sprites.json');
const player = game.createSprite(sprites, 'hero');

// Your game loop: just movement logic
game.onUpdate(() => {
  player.vx = 0;
  player.vy = 0;
  if (game.input.isDown('ArrowRight')) player.vx = 100;
  if (game.input.isDown('ArrowLeft')) player.vx = -100;
  if (game.input.isDown('ArrowDown')) player.vy = 100;
  if (game.input.isDown('ArrowUp')) player.vy = -100;
});

game.start();
```

## Why It's Fast

Traditional engines process each sprite individually. That's O(n) CPU work per frame.

Glyft batches everything. All sprites using the same atlas render in one draw call. Animation frames are computed in GPU shaders, not JavaScript loops.

| Sprites | FPS | Draw Calls |
|---------|-----|------------|
| 1,000 | 60 | 1 |
| 10,000 | 30-40 | 1 |
| 25,000+ | 15-20 | 1 |

## Examples

```bash
git clone https://github.com/glyft/glyft
cd glyft && npm install && npm run dev
# http://localhost:5173/examples/basic/
# http://localhost:5173/examples/benchmark/
```

## License

MIT
