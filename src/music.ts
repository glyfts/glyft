/**
 * Music System
 *
 * Background music with crossfade transitions.
 */

import type { MusicTrack } from './types';

export interface MusicManager {
  /** Define music tracks */
  define(tracks: Record<string, MusicTrack>): void;
  /** Play a track (with optional crossfade) */
  play(track: string, options?: { fade?: number }): void;
  /** Stop current track */
  stop(options?: { fade?: number }): void;
  /** Pause current track */
  pause(): void;
  /** Resume current track */
  resume(): void;
  /** Set master volume (0-1) */
  setVolume(volume: number): void;
  /** Get current volume */
  getVolume(): number;
  /** Get currently playing track name */
  getCurrentTrack(): string | null;
  /** Preload tracks */
  preload(tracks: string[]): Promise<void>;
}

interface LoadedTrack {
  buffer: AudioBuffer;
  config: MusicTrack;
}

interface ActiveTrack {
  name: string;
  source: AudioBufferSourceNode | OscillatorNode;
  gainNode: GainNode;
  startTime: number;
  pauseTime: number;
  isProcedural?: boolean;
}

/**
 * Create the music manager.
 */
export function createMusicManager(): MusicManager {
  // Audio context (created on first interaction)
  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let masterVolume = 1;

  // Track definitions and loaded audio
  const trackDefs = new Map<string, MusicTrack>();
  const loadedTracks = new Map<string, LoadedTrack>();

  // Currently playing
  let currentTrack: ActiveTrack | null = null;
  let fadingOutTrack: ActiveTrack | null = null;

  // Ensure audio context exists
  function ensureContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
      masterGain = ctx.createGain();
      masterGain.gain.value = masterVolume;
      masterGain.connect(ctx.destination);
    }
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  // Load a music track
  async function loadTrack(name: string): Promise<LoadedTrack | null> {
    const def = trackDefs.get(name);
    if (!def) {
      console.warn(`[Glyft] Music track not defined: ${name}`);
      return null;
    }

    // Check cache
    const cached = loadedTracks.get(name);
    if (cached) return cached;

    const context = ensureContext();

    try {
      const response = await fetch(def.track);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await context.decodeAudioData(arrayBuffer);

      const loaded: LoadedTrack = {
        buffer: audioBuffer,
        config: def,
      };

      loadedTracks.set(name, loaded);
      return loaded;
    } catch (e) {
      console.warn(`[Glyft] Failed to load music: ${def.track}`, e);
      return null;
    }
  }

  // Create and start a track
  function createTrackSource(
    loaded: LoadedTrack,
    name: string,
    startOffset: number = 0
  ): ActiveTrack {
    const context = ensureContext();
    if (!masterGain) throw new Error('No master gain');

    const source = context.createBufferSource();
    source.buffer = loaded.buffer;
    source.loop = loaded.config.loop ?? true;

    const gainNode = context.createGain();
    gainNode.gain.value = loaded.config.volume ?? 1;

    source.connect(gainNode);
    gainNode.connect(masterGain);

    source.start(0, startOffset);

    return {
      name,
      source,
      gainNode,
      startTime: context.currentTime - startOffset,
      pauseTime: 0,
    };
  }

  // Fade a gain node
  function fadeGain(
    gainNode: GainNode,
    fromValue: number,
    toValue: number,
    duration: number,
    onComplete?: () => void
  ): void {
    const context = ensureContext();
    const now = context.currentTime;

    gainNode.gain.setValueAtTime(fromValue, now);
    gainNode.gain.linearRampToValueAtTime(toValue, now + duration);

    if (onComplete) {
      setTimeout(onComplete, duration * 1000);
    }
  }

  // Stop a track immediately
  function stopTrack(track: ActiveTrack): void {
    try {
      track.source.stop();
      track.source.disconnect();
      track.gainNode.disconnect();
    } catch {
      // Already stopped
    }
  }

  // Create procedural ambient music (for testing without audio files)
  // Formats: $ambient, $dungeon, $battle, $peaceful
  function createProceduralTrack(
    type: string,
    volume: number
  ): ActiveTrack {
    const context = ensureContext();
    if (!masterGain) throw new Error('No master gain');

    const gainNode = context.createGain();
    gainNode.gain.value = volume * 0.15; // Procedural is quieter

    // Create multiple oscillators for richer sound
    const oscs: OscillatorNode[] = [];

    // Base frequencies for different moods
    let baseFreq = 110;
    let oscType: OscillatorType = 'sine';

    switch (type) {
      case '$ambient':
        baseFreq = 110; // A2
        oscType = 'sine';
        break;
      case '$dungeon':
        baseFreq = 73.42; // D2
        oscType = 'triangle';
        break;
      case '$battle':
        baseFreq = 146.83; // D3
        oscType = 'sawtooth';
        break;
      case '$peaceful':
        baseFreq = 130.81; // C3
        oscType = 'sine';
        break;
      default:
        baseFreq = 110;
        oscType = 'sine';
    }

    // Create chord (root + fifth + octave)
    const frequencies = [baseFreq, baseFreq * 1.5, baseFreq * 2];

    for (const freq of frequencies) {
      const osc = context.createOscillator();
      osc.type = oscType;
      osc.frequency.value = freq;

      // Add slight detune for warmth
      osc.detune.value = (Math.random() - 0.5) * 10;

      // Individual gain for mixing
      const oscGain = context.createGain();
      oscGain.gain.value = 0.3;

      osc.connect(oscGain);
      oscGain.connect(gainNode);
      osc.start();

      oscs.push(osc);
    }

    gainNode.connect(masterGain);

    // Use first oscillator as the "source" for the track
    // We'll stop all when stopping the track
    const mainOsc = oscs[0];
    (mainOsc as OscillatorNode & { _allOscs?: OscillatorNode[] })._allOscs = oscs;

    return {
      name: type,
      source: mainOsc,
      gainNode,
      startTime: context.currentTime,
      pauseTime: 0,
      isProcedural: true,
    };
  }

  // Stop procedural track (all oscillators)
  function stopProceduralTrack(track: ActiveTrack): void {
    try {
      const mainOsc = track.source as OscillatorNode & { _allOscs?: OscillatorNode[] };
      const allOscs = mainOsc._allOscs ?? [mainOsc];
      for (const osc of allOscs) {
        osc.stop();
        osc.disconnect();
      }
      track.gainNode.disconnect();
    } catch {
      // Already stopped
    }
  }

  return {
    define(tracks: Record<string, MusicTrack>): void {
      for (const [name, config] of Object.entries(tracks)) {
        trackDefs.set(name, config);
      }
    },

    async play(trackName: string, options?: { fade?: number }): Promise<void> {
      // Don't restart if same track is playing
      if (currentTrack?.name === trackName) return;

      const fadeTime = options?.fade ?? 0;

      // Stop helper that handles both types
      const stopCurrentTrack = (track: ActiveTrack, fade: number) => {
        if (fade > 0) {
          fadingOutTrack = track;
          fadeGain(
            track.gainNode,
            track.gainNode.gain.value,
            0,
            fade,
            () => {
              if (fadingOutTrack) {
                if (fadingOutTrack.isProcedural) {
                  stopProceduralTrack(fadingOutTrack);
                } else {
                  stopTrack(fadingOutTrack);
                }
                fadingOutTrack = null;
              }
            }
          );
        } else {
          if (track.isProcedural) {
            stopProceduralTrack(track);
          } else {
            stopTrack(track);
          }
        }
      };

      // Handle currently playing track
      if (currentTrack) {
        stopCurrentTrack(currentTrack, fadeTime);
        currentTrack = null;
      }

      // Check for procedural track
      if (trackName.startsWith('$')) {
        currentTrack = createProceduralTrack(trackName, 1);

        if (fadeTime > 0) {
          currentTrack.gainNode.gain.setValueAtTime(0, ensureContext().currentTime);
          fadeGain(currentTrack.gainNode, 0, 0.15, fadeTime);
        }
        return;
      }

      // Load and play regular track
      const loaded = await loadTrack(trackName);
      if (!loaded) return;

      const actualFadeTime = fadeTime || loaded.config.fadeIn || 0;

      // Start new track
      currentTrack = createTrackSource(loaded, trackName);

      // Fade in if requested
      if (actualFadeTime > 0) {
        const targetVolume = loaded.config.volume ?? 1;
        currentTrack.gainNode.gain.setValueAtTime(0, ensureContext().currentTime);
        fadeGain(currentTrack.gainNode, 0, targetVolume, actualFadeTime);
      }
    },

    stop(options?: { fade?: number }): void {
      if (!currentTrack) return;

      const fadeTime = options?.fade ?? 0;
      const track = currentTrack;
      const isProcedural = track.isProcedural;

      const doStop = () => {
        if (isProcedural) {
          stopProceduralTrack(track);
        } else {
          stopTrack(track);
        }
        if (currentTrack === track) {
          currentTrack = null;
        }
      };

      if (fadeTime > 0) {
        fadeGain(
          track.gainNode,
          track.gainNode.gain.value,
          0,
          fadeTime,
          doStop
        );
      } else {
        doStop();
        currentTrack = null;
      }
    },

    pause(): void {
      if (!currentTrack || !ctx) return;

      currentTrack.pauseTime = ctx.currentTime - currentTrack.startTime;
      stopTrack(currentTrack);
    },

    resume(): void {
      if (!currentTrack || currentTrack.pauseTime === 0) return;

      const loaded = loadedTracks.get(currentTrack.name);
      if (!loaded) return;

      currentTrack = createTrackSource(loaded, currentTrack.name, currentTrack.pauseTime);
    },

    setVolume(volume: number): void {
      masterVolume = Math.max(0, Math.min(1, volume));
      if (masterGain) {
        masterGain.gain.value = masterVolume;
      }
    },

    getVolume(): number {
      return masterVolume;
    },

    getCurrentTrack(): string | null {
      return currentTrack?.name ?? null;
    },

    async preload(tracks: string[]): Promise<void> {
      await Promise.all(tracks.map((name) => loadTrack(name)));
    },
  };
}
