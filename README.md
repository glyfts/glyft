<p align="center">
  <img src="https://raw.githubusercontent.com/glyfts/glyft/main/logo.png" alt="Glyft" height="140">
</p>

<p align="center">
  <strong>Faster to write. Faster to run.</strong>
</p>

<p align="center">
  Less code. More sprites.<br>
  A WebGL2 framework that moves work from your code to the GPU.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/glyft"><img src="https://img.shields.io/npm/v/glyft?style=flat-square&color=cb3837" alt="npm"></a>
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?style=flat-square" alt="TypeScript">
  <img src="https://img.shields.io/badge/runtime-WebGL2-ff6600?style=flat-square" alt="WebGL2">
  <img src="https://img.shields.io/badge/dependencies-0-success?style=flat-square" alt="Zero Dependencies">
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT%20%2F%20Commercial-blue?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <a href="https://glyft.dev">Website</a> •
  <a href="https://glyft.dev/docs">Docs</a> •
  <a href="https://glyft.dev/examples">Examples</a> •
  <a href="https://github.com/glyfts/glyft">GitHub</a>
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
  settings: {
    tileSize: 16,
    viewport: [320, 240],
    spriteMode: '4dir',
  },

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

  // GPU particle effects
  particles: {
    hit_sparks: { count: 8, speed: 60, spread: 120, lifetime: 0.3, color: 0xffcc44, colorEnd: 0xff4400, size: 3, sizeEnd: 1, gravity: 100 },
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

Glyft batches everything into a single draw call per texture atlas. Animation, direction, HP bars, labels, and particles are all computed in GPU shaders with zero per-frame allocations.

| Sprites | FPS | Draw Calls |
|---------|-----|------------|
| 5,000 | 60 | 1 |
| 10,000 | 30-40 | 1 |
| 25,000+ | 15-20 | 1 |

## Features

- **Config-driven** - Collisions, sounds, music, particles defined as data
- **GPU animation** - Velocity-driven direction and frame selection in shaders
- **GPU particle system** - Burst particles with color/size fade, gravity, spread
- **GPU ring effects** - Expanding shockwaves with gradients (fire, ice, holy, poison, shadow)
- **GPU arc effects** - Directional sweeps with shapes (arc, wave, zigzag, axe, spear, thrust)
- **GPU floating text** - Damage numbers, pickups, XP popups with rise and pop styles
- **GPU HP bars** - Per-sprite health bars with custom colors
- **GPU labels** - Sprite names and icons with visibility modes (always, hover, proximity)
- **Tween system** - Animate any property with easing curves (easeIn, easeOut, bounce, elastic)
- **Declarative SFX** - Synthesized sounds from wave parameters, no audio files needed
- **Declarative music** - Melodies from note sequences, no audio files needed
- **Reactive sounds** - Pattern-matched triggers with spatial audio and cooldowns
- **Collision system** - Pattern-based rules with damage, knockback, magnetize, particles
- **Canvas HUD** - Multi-panel stats, level/XP bar, room announcements, dialogue box
- **Addon system** - `game.use()` plugins for projectiles, AI, rooms, dialogue, death, HUD
- **Tiled map loader** - Import maps from Tiled editor
- **Zero dependencies** - Pure TypeScript + WebGL2

## Addons

Opt-in modules that extend the engine with common game systems. Each addon is self-contained and tree-shakeable.

```typescript
import { projectiles, ai, death, rooms, dialogue, hud } from 'glyft/addons';

game.use(projectiles({ types: { bolt: { speed: 200, cooldown: 0.3 } } }));
game.use(ai({ behaviors: { chaser: { type: 'chase', speed: 30, range: 150 } } }));
game.use(death({ rules: { enemy: { particles: 'burst', xpReward: 10 } } }));
game.use(rooms({ atlas, startRoom: 'village', rooms: { /* ... */ } }));
game.use(dialogue({ dialogues: { elder: { lines: ['Welcome!'], speaker: 'Elder' } } }));
game.use(hud({
  panels: [
    { position: 'top-left', stats: [{ stat: 'hp', label: '\u2665', color: 0xff4444, max: 100 }] },
    { position: 'top-right', stats: [{ stat: 'coins', label: '\u25cf', color: 0xffdd44 }] },
  ],
  announcement: { hold: 2.0 },
  dialogue: {},
}));
```

| Addon | Purpose |
|-------|---------|
| `projectiles` | Fire projectiles with cooldown, lifetime, wall collision |
| `ai` | Enemy behaviors: chase, wander, patrol, flee, idle |
| `death` | HP death checks, rewards, player respawn |
| `rooms` | Room transitions, spawn management, exit detection |
| `dialogue` | NPC interaction with proximity detection and events |
| `hud` | Canvas overlay with stat panels, level/XP bar, announcements, dialogue box |

## Declarative Audio

Define sound effects and music as config data - no audio files required.

```typescript
const config = {
  // Sound effects: procedural synthesis from parameters
  sfx: {
    laser:  { wave: 'sine', freq: 880, duration: 0.15, sweep: 440 },
    coin:   { wave: 'square', freq: 1400, duration: 0.1, sweep: 2100, sweepTime: 0.05 },
    hurt:   { wave: 'sawtooth', freq: 200, duration: 0.2, noise: 0.2 },
  },

  // Music: melodies from note sequences
  music: {
    village: {
      bpm: 56, wave: 'sine',
      notes: ['C4', 'E4', 'G4', 'C5', 'B4', 'G4', 'E4', 'G4'],
      pad: { wave: 'sine', freq: 131, volume: 0.3 },
    },
  },

  // Reactive triggers use sfx names or built-in $presets
  sounds: {
    '[player]:[enemy]': { sound: 'hurt', cooldown: 0.5 },
    '[player]:moving': { sound: '$step', interval: 0.25 },
  },
};
```

## Collision Rules

Pattern `[A]:[B]` means "A encounters B":
- **Effects** (damage, heal, knockback, flash) target A
- **Removal** (destroy, collect) targets B
- **Particles** emit at the collision midpoint

```typescript
collisions: {
  // Player takes 10 damage, enemy is unharmed
  '[player]:[enemy]': { damage: 10, knockback: 80, particles: 'hit_sparks' },
  // Coin is destroyed, player gets +1 coins
  '[player]:[coin]': { collect: 'coins', destroy: true, particles: 'sparkle' },
}
```

## 3D Worlds

3D is built the same way as 2D: rules, not code. Set `mode: '3d'` and describe the world. Sprites keep `x`/`y` in pixels on the ground, `vx`/`vy`, collisions, sounds and stats; Glyft lifts them onto the terrain (one tile = one world unit).

```typescript
const config: GlyftConfig = {
  settings: { tileSize: 16, viewport: [960, 540], mode: '3d' },
  autoTags: { hero: ['player'], orc: ['enemy'], coin: ['pickup'] },
  collisions: {
    '[player]:[pickup]': { collect: 'coins', destroy: true },
    '[player]:[enemy]': { damage: 10, knockback: 60, cooldown: 0.8 },
    '[enemy]:slash': { damage: 25, knockback: 90 },
  },
  world: {
    terrain: {
      heightmap: { generate: 'island', seed: 4 },          // or 'map.png' or number[][]
      maxHeight: 16,
      water: { height: 3.2, style: 'ocean' },
    },
    sky: { time: 0.3, dayLength: 240 },                     // day/night drives all lighting
    camera: { mode: 'follow', target: 'hero' },             // follow, orbit, fps, fixed
    controller: { sprite: 'hero', jump: 2, board: { vehicles: ['boat'] }, attack: { spawn: 'slash' } },
    buildings: {
      hut: [
        { type: 'box', position: [0, 0, 0], size: [4, 2.6, 4], faces: { all: 'plaster' } },
        { type: 'roof', position: [0, 2.6, 0], size: [4.6, 1.8, 4.6], faces: { all: 'thatch' } },
      ],
    },
    ships: { boat: { preset: 'cutter' } },
    place: [{ building: 'hut', count: 4, where: 'flat' }],  // Glyft finds the spots
    spawns: {
      hero: { near: 'hut', with: { label: 'You' } },
      boat: { where: 'shore', near: 'hero', facing: 'out' },
      orc: { count: 6, where: 'hills' },
      coin: { count: 20 },
    },
  },
};

const game = new Glyft(canvas, config);
game.use(ai({ behaviors: { hunter: { type: 'chase', speed: 45 } }, auto: { enemy: 'hunter' } }));
await game.loadTexture('hero', 'hero.png', { frameWidth: 32, frameHeight: 32 });
// ...orc, coin
await game.start();
```

- **Places, not coordinates:** `where` takes `'land'`, `'flat'`, `'hills'`, `'shore'`, `'sea'` or an exact `[x, y]`; `near` keeps things close to something placed earlier; `count` and `spacing` do the rest.
- **Combat:** `controller.attack: { spawn: 'slash', frames: [4, 1] }` puts a short-lived hitbox in front of the player on click, and collision rules such as `'[enemy]:slash': { damage: 25 }` decide what a hit does.
- **Areas and exits:** `world.areas` holds an island, a cavern, a keep interior, each with its own terrain, sky or underground light, buildings and spawns. `world.exits` joins them at building doors or rule-placed spots; walking in fades you through.
- **Props:** `scatter: { pine: { count: 70 }, rock: { count: 30, where: 'hills' } }` places built-in trees, bushes, grass, rocks, boulders, stalagmites, crystals and mushrooms, one instanced draw call per kind.
- **Vehicles and mounts built in:** `controller.board: { vehicles: ['boat', 'horse'] }`. Ships float and steer like boats; anything else is a mount the rider sits on.
- **Rules for movement:** `world.blockedBy` stops every moving sprite at water, cliffs and buildings; ships are stopped by land. Addons take tag rules too (`ai({ auto })`, `death({ auto, playerRespawn })`).
- **Types map to looks:** atlas sprites become billboards, `world.ships` types become procedural ships that float and turn to face their velocity, `world.models` types become glTF models.
- **Zero assets:** built-in materials (`sand`, `grass`, `rock`, `snow`, `stone`, `brick`, `plaster`, `wood`, `planks`, `thatch`, `slate`, `door`, `window` and more). Any slot also takes a hex colour or an image URL.
- **Runtime:** `game.world.time`, `wind`, `waves`, `riding`, `boardable`, `heightAt(x, y)`, `isWater(x, y)`, `pick(screenX, screenY)`, `findSpot(rule)`, `place(def)`.

## Examples

```bash
git clone https://github.com/glyfts/glyft
cd glyft && npm install && npm run dev
# http://localhost:5173/examples/basic/
# http://localhost:5173/examples/rpg/
# http://localhost:5173/examples/platformer/
# http://localhost:5173/examples/shmup/
# http://localhost:5173/examples/island/
```

| Example | Features |
|---------|----------|
| Basic | Tilemap, sprites, enemies, sounds, music, collisions |
| Benchmark | 5K-50K animated sprites, FPS counter |
| RPG | Multi-room dungeon, NPCs, dialogue, combat, projectiles, particles, HP bars, labels |
| Platformer | Gravity, jumping, platforms, stomping enemies, collectibles, coyote time |
| Shmup | Bullet hell, radial/spiral/aimed patterns, bombs, graze scoring, boss fights |
| Island | 3D: an island and the cavern under it joined by exits, trees and rocks, day/night, combat, sailing, minimap HUD |

## License

Glyft is **free for personal projects, learning, and open source**.

A [commercial license](https://glyft.dev/license) is required for:
- Commercial games and products
- Closed-source applications
- Client work and internal business tools

**$80 one-time**. It covers your team forever, including future updates.

See [LICENSE.md](./LICENSE.md) for full terms.
