/**
 * Reactive Sound System
 *
 * Define sound rules, engine triggers automatically.
 * No playSound() calls scattered through game code.
 */

import type { SoundRule, SfxDef } from './types';

export interface SoundManager {
  /** Define sound rules */
  define(rules: Record<string, string | SoundRule>): void;
  /** Register named sound effect definitions */
  defineSfx(defs: Record<string, SfxDef>): void;
  /** Manually play a sound */
  play(sound: string, options?: { volume?: number; pitch?: number; x?: number }): void;
  /** Set master volume (0-1) */
  setVolume(volume: number): void;
  /** Preload sounds */
  preload(sounds: string[]): Promise<void>;
}

interface LoadedSound {
  buffer: AudioBuffer;
  lastPlayed: number;
}

interface ParsedRule {
  pattern: string;
  sound: string;
  cooldown: number;
  interval: number;
  volume: number | [number, number];
  pitch: number | [number, number];
  spatial: boolean;
  lastTriggered: number;
}

/**
 * Create the sound manager.
 */
export function createSoundManager(viewportWidth: number): SoundManager {
  // Audio context (created on first interaction)
  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;

  // Loaded sounds cache
  const sounds = new Map<string, LoadedSound>();

  // Parsed rules
  const rules = new Map<string, ParsedRule>();

  // Ensure audio context exists
  function ensureContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
      masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
    }
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  // Load a sound file
  async function loadSound(url: string): Promise<AudioBuffer> {
    const context = ensureContext();

    // Check cache
    const cached = sounds.get(url);
    if (cached) return cached.buffer;

    // Load and decode
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer);

    sounds.set(url, { buffer: audioBuffer, lastPlayed: 0 });
    return audioBuffer;
  }

  // Play a sound buffer
  function playBuffer(
    buffer: AudioBuffer,
    volume: number,
    pitch: number,
    pan: number
  ): void {
    const context = ensureContext();
    if (!masterGain) return;

    // Create nodes
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitch;

    const gainNode = context.createGain();
    gainNode.gain.value = volume;

    // Panning (-1 to 1)
    const panNode = context.createStereoPanner();
    panNode.pan.value = Math.max(-1, Math.min(1, pan));

    // Connect: source -> gain -> pan -> master
    source.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(masterGain);

    source.start();
  }

  // Get random value from range or single value
  function _randomize(value: number | [number, number]): number {
    if (Array.isArray(value)) {
      return value[0] + Math.random() * (value[1] - value[0]);
    }
    return value;
  }

  // ---------------------------------------------------------------------------
  // Declarative SFX System
  // ---------------------------------------------------------------------------

  // Named sound effect definitions
  const sfxDefs = new Map<string, SfxDef>();

  // Built-in presets (legacy $name aliases)
  const BUILTIN_SFX: Record<string, SfxDef> = {
    beep:  { wave: 'square',   freq: 880,        duration: 0.1 },
    blip:  { wave: 'sine',     freq: 1200,       duration: 0.05 },
    hit:   { wave: 'sawtooth', freq: 150,        duration: 0.15 },
    step:  { wave: 'triangle', freq: [100, 150],  duration: 0.05 },
    coin:  { wave: 'square',   freq: 1400,       duration: 0.1, sweep: 2100, sweepTime: 0.05 },
    hurt:  { wave: 'sawtooth', freq: 200,        duration: 0.2 },
  };

  // Resolve a sound name to an SfxDef (user defs > builtins > $prefix builtins)
  function _resolveSfx(name: string): SfxDef | null {
    // User-defined sfx (exact name)
    const userDef = sfxDefs.get(name);
    if (userDef) return userDef;

    // $preset shorthand: strip $ prefix and check builtins
    if (name.startsWith('$')) {
      const key = name.slice(1);
      // Check user defs first (user can override built-in names)
      const userOverride = sfxDefs.get(key);
      if (userOverride) return userOverride;
      return BUILTIN_SFX[key] ?? null;
    }

    // Check builtins by bare name
    return BUILTIN_SFX[name] ?? null;
  }

  // Play a sound effect from an SfxDef
  function playSfx(
    def: SfxDef,
    volume: number,
    pitch: number,
    x?: number
  ): void {
    const context = ensureContext();
    if (!masterGain) return;

    const now = context.currentTime;
    const duration = def.duration ?? 0.1;
    const attack = def.attack ?? 0;
    const baseFreq = _randomize(def.freq ?? 440) * pitch;
    const waveType = def.wave ?? 'square';

    // -- Oscillator --
    const osc = context.createOscillator();
    osc.type = waveType;
    if (def.detune) osc.detune.value = def.detune;

    // Frequency + optional sweep
    if (def.sweep !== undefined) {
      const sweepTime = def.sweepTime ?? duration;
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(def.sweep * pitch, 1), now + sweepTime
      );
    } else {
      osc.frequency.value = baseFreq;
    }

    // -- Gain envelope --
    const gainNode = context.createGain();
    const peakGain = volume * 0.3;
    if (attack > 0) {
      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.exponentialRampToValueAtTime(peakGain, now + attack);
    } else {
      gainNode.gain.setValueAtTime(peakGain, now);
    }

    // Decay
    const decayStart = now + attack;
    const decayEnd = now + duration;
    if (def.decay === 'linear') {
      gainNode.gain.linearRampToValueAtTime(0.001, decayEnd);
    } else {
      // Default: exponential decay
      gainNode.gain.exponentialRampToValueAtTime(0.001, decayEnd);
    }

    // -- Panning --
    const panNode = context.createStereoPanner();
    if (x !== undefined) {
      panNode.pan.value = Math.max(-1, Math.min(1, (x / viewportWidth) * 2 - 1));
    }

    // -- Optional biquad filter --
    let filterNode: BiquadFilterNode | null = null;
    if (def.filter) {
      filterNode = context.createBiquadFilter();
      filterNode.type = def.filter;
      filterNode.frequency.value = def.filterFreq ?? 1000;
      filterNode.Q.value = def.filterQ ?? 1;
    }

    // -- Optional noise layer --
    let noiseSource: AudioBufferSourceNode | null = null;
    let noiseGain: GainNode | null = null;
    if (def.noise && def.noise > 0) {
      const bufferSize = Math.ceil(context.sampleRate * duration);
      const noiseBuffer = context.createBuffer(1, bufferSize, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      noiseSource = context.createBufferSource();
      noiseSource.buffer = noiseBuffer;

      noiseGain = context.createGain();
      noiseGain.gain.setValueAtTime(peakGain * def.noise, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, decayEnd);
    }

    // -- Connect graph --
    // osc -> [filter] -> gainNode -> panNode -> masterGain
    let oscOutput: AudioNode = osc;
    if (filterNode) {
      osc.connect(filterNode);
      oscOutput = filterNode;
    }
    oscOutput.connect(gainNode);
    gainNode.connect(panNode);
    panNode.connect(masterGain);

    // noise -> noiseGain -> panNode (shares pan + master)
    if (noiseSource && noiseGain) {
      noiseSource.connect(noiseGain);
      noiseGain.connect(panNode);
      noiseSource.start(now);
      noiseSource.stop(now + duration);
    }

    void decayStart; // attack informs decay timing via gain scheduling

    osc.start(now);
    osc.stop(now + duration);
  }

  return {
    define(newRules: Record<string, string | SoundRule>): void {
      for (const [pattern, rule] of Object.entries(newRules)) {
        const parsed: ParsedRule = {
          pattern,
          sound: typeof rule === 'string' ? rule : rule.sound,
          cooldown: typeof rule === 'string' ? 0 : (rule.cooldown ?? 0),
          interval: typeof rule === 'string' ? 0 : (rule.interval ?? 0),
          volume: typeof rule === 'string' ? 1 : (rule.volume ?? 1),
          pitch: typeof rule === 'string' ? 1 : (rule.pitch ?? 1),
          spatial: typeof rule === 'string' ? false : (rule.spatial ?? false),
          lastTriggered: 0,
        };
        rules.set(pattern, parsed);

        // Preload the sound (skip sfx/procedural sounds)
        if (!parsed.sound.startsWith('$') && !_resolveSfx(parsed.sound)) {
          loadSound(parsed.sound).catch(() => {
            console.warn(`[Glyft] Failed to load sound: ${parsed.sound}`);
          });
        }
      }
    },

    defineSfx(defs: Record<string, SfxDef>): void {
      for (const [name, def] of Object.entries(defs)) {
        sfxDefs.set(name, def);
      }
    },

    play(sound: string, options?: { volume?: number; pitch?: number; x?: number }): void {
      // Try sfx definitions first (user-defined, then $presets, then builtins)
      const sfx = _resolveSfx(sound);
      if (sfx) {
        playSfx(sfx, options?.volume ?? 1, options?.pitch ?? 1, options?.x);
        return;
      }

      // Try loaded audio buffer
      const cached = sounds.get(sound);
      if (cached) {
        const vol = options?.volume ?? 1;
        const pitch = options?.pitch ?? 1;
        const pan = options?.x !== undefined
          ? (options.x / viewportWidth) * 2 - 1
          : 0;
        playBuffer(cached.buffer, vol, pitch, pan);
        return;
      }

      // Try to load as audio file
      loadSound(sound)
        .then((buffer) => {
          const vol = options?.volume ?? 1;
          const pitch = options?.pitch ?? 1;
          const pan = options?.x !== undefined
            ? (options.x / viewportWidth) * 2 - 1
            : 0;
          playBuffer(buffer, vol, pitch, pan);
        })
        .catch(() => {
          console.warn(`[Glyft] Sound not found: ${sound}`);
        });
    },

    setVolume(volume: number): void {
      if (masterGain) {
        masterGain.gain.value = Math.max(0, Math.min(1, volume));
      }
    },

    async preload(soundUrls: string[]): Promise<void> {
      await Promise.all(soundUrls.map((url) => loadSound(url)));
    },
  };
}

/**
 * Pattern matching for reactive sounds.
 *
 * Patterns:
 * - `[tag]` - sprite has tag
 * - `name*` - wildcard
 * - `[t1,t2]` - multiple tags (AND)
 * - `a:b` - a collides with b
 * - `a:moving` - a has velocity
 * - `a:destroyed` - a was destroyed
 */
export function matchesPattern(
  pattern: string,
  spriteA: { type: string; tags: string[]; vx: number; vy: number },
  spriteB?: { type: string; tags: string[] }
): boolean {
  // Split collision pattern
  const parts = pattern.split(':');

  if (parts.length === 2) {
    const [patternA, patternB] = parts;

    // Special patterns for B
    if (patternB === 'moving') {
      return matchesSingle(patternA, spriteA) &&
        (Math.abs(spriteA.vx) > 0.5 || Math.abs(spriteA.vy) > 0.5);
    }

    if (patternB === 'destroyed') {
      // This is handled separately in the destroy logic
      return matchesSingle(patternA, spriteA);
    }

    // Regular collision pattern
    if (!spriteB) return false;
    return matchesSingle(patternA, spriteA) && matchesSingle(patternB, spriteB);
  }

  // Single pattern (just matches sprite A)
  return matchesSingle(pattern, spriteA);
}

function matchesSingle(
  pattern: string,
  sprite: { type: string; tags: string[] }
): boolean {
  // Tag pattern: [tag] or [tag1,tag2]
  if (pattern.startsWith('[') && pattern.endsWith(']')) {
    const tagList = pattern.slice(1, -1).split(',');
    return tagList.every((tag) => sprite.tags.includes(tag.trim()));
  }

  // Wildcard: name*
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return sprite.type.startsWith(prefix);
  }

  // Exact match
  return sprite.type === pattern;
}

/**
 * Find the best matching rule for a collision/event.
 * More specific patterns take priority.
 */
export function findMatchingRule(
  rules: Map<string, ParsedRule>,
  spriteA: { type: string; tags: string[]; vx: number; vy: number },
  spriteB?: { type: string; tags: string[] },
  currentTime?: number
): ParsedRule | null {
  let bestMatch: ParsedRule | null = null;
  let bestScore = -1;

  for (const rule of rules.values()) {
    if (!matchesPattern(rule.pattern, spriteA, spriteB)) continue;

    // Check cooldown
    if (currentTime !== undefined && rule.cooldown > 0) {
      if (currentTime - rule.lastTriggered < rule.cooldown) continue;
    }

    // Score based on specificity
    const score = patternSpecificity(rule.pattern);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = rule;
    }
  }

  return bestMatch;
}

/**
 * Calculate pattern specificity (higher = more specific = higher priority).
 */
function patternSpecificity(pattern: string): number {
  let score = 0;

  // Exact names are most specific
  if (!pattern.includes('[') && !pattern.includes('*')) {
    score += 100;
  }

  // Multiple tags are more specific than single
  const tagMatches = pattern.match(/\[([^\]]+)\]/g);
  if (tagMatches) {
    for (const match of tagMatches) {
      const tags = match.slice(1, -1).split(',');
      score += tags.length * 10;
    }
  }

  // Wildcards are less specific
  if (pattern.includes('*')) {
    score -= 50;
  }

  // Collision patterns (a:b) are more specific than single
  if (pattern.includes(':')) {
    score += 20;
  }

  return score;
}
