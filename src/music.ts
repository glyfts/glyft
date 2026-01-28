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
  /** Cleanup function for melody/procedural tracks (stops all oscillators, timers) */
  _cleanup?: () => void;
}

// ---------------------------------------------------------------------------
// Note name → frequency conversion
// ---------------------------------------------------------------------------

const NOTE_NAMES: Record<string, number> = {
  'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
};

/**
 * Parse a note name (e.g. 'C4', 'D#4', 'Eb3') to frequency in Hz.
 * Returns the number directly if given a number.
 */
function noteToFreq(note: string | number): number {
  if (typeof note === 'number') return note;

  // Parse: note letter + optional # or b + octave number
  const match = note.match(/^([A-Ga-g])(#|b)?(\d)$/);
  if (!match) return 440; // fallback to A4

  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const octave = parseInt(match[3], 10);

  let semitone = NOTE_NAMES[letter] ?? 0;
  if (accidental === '#') semitone++;
  if (accidental === 'b') semitone--;

  // A4 = 440Hz = MIDI 69 = semitone 9 in octave 4
  const midiNote = (octave + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midiNote - 69) / 12);
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

  // Deferred playback: stored when context is suspended (autoplay policy)
  let pendingPlay: { trackName: string; options?: { fade?: number } } | null = null;

  // Ensure audio context exists
  function ensureContext(): AudioContext {
    if (!ctx) {
      ctx = new AudioContext();
      masterGain = ctx.createGain();
      masterGain.gain.value = masterVolume;
      masterGain.connect(ctx.destination);

      // When context resumes after user interaction, replay deferred music
      ctx.addEventListener('statechange', () => {
        if (ctx?.state === 'running' && pendingPlay) {
          const { trackName, options } = pendingPlay;
          pendingPlay = null;
          manager.play(trackName, options);
        }
      });
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
    if (!def || !def.track) {
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

  // Stop procedural track (all oscillators + cleanup)
  function stopProceduralTrack(track: ActiveTrack): void {
    try {
      if (track._cleanup) {
        track._cleanup();
      } else {
        const mainOsc = track.source as OscillatorNode & { _allOscs?: OscillatorNode[] };
        const allOscs = mainOsc._allOscs ?? [mainOsc];
        for (const osc of allOscs) {
          osc.stop();
          osc.disconnect();
        }
      }
      track.gainNode.disconnect();
    } catch {
      // Already stopped
    }
  }

  // Create a declarative melody track from MusicTrack config
  function createMelodyTrack(def: MusicTrack): ActiveTrack {
    const context = ensureContext();
    if (!masterGain) throw new Error('No master gain');

    const vol = def.volume ?? 1;
    const bpm = def.bpm ?? 120;
    const wave = def.wave ?? 'sine';
    const rawNotes = def.notes ?? [];
    const defaultNoteLen = def.noteLength ?? 1;
    const looping = def.loop !== false;

    // Base beat duration in seconds
    const beatDur = 60 / bpm;

    // Parse notes: each entry is either 'C4', 440, or ['C4', 0.5]
    const parsed: { freq: number; dur: number }[] = rawNotes.map(n => {
      if (Array.isArray(n)) {
        return { freq: noteToFreq(n[0]), dur: beatDur * n[1] };
      }
      return { freq: noteToFreq(n), dur: beatDur * defaultNoteLen };
    });

    // Total loop duration
    const loopDur = parsed.reduce((sum, n) => sum + n.dur, 0);

    // Master gain for the whole track
    const trackGain = context.createGain();
    trackGain.gain.value = vol * 0.15;
    trackGain.connect(masterGain);

    // Track all active oscillators for cleanup
    const activeOscs: OscillatorNode[] = [];
    let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    // Schedule one iteration of the melody
    function scheduleLoop(startTime: number) {
      if (stopped) return;

      let offset = 0;
      for (let i = 0; i < parsed.length; i++) {
        const { freq, dur: noteDur } = parsed[i];
        const noteStart = startTime + offset;
        offset += noteDur;
        // Fade envelope: attack 10%, sustain 60%, release 30%
        const attack = noteDur * 0.1;
        const sustain = noteDur * 0.6;
        const release = noteDur * 0.3;

        const osc = context.createOscillator();
        osc.type = wave;
        osc.frequency.value = freq;

        const noteGain = context.createGain();
        noteGain.gain.setValueAtTime(0.001, noteStart);
        noteGain.gain.exponentialRampToValueAtTime(0.3, noteStart + attack);
        noteGain.gain.setValueAtTime(0.3, noteStart + attack + sustain);
        noteGain.gain.exponentialRampToValueAtTime(0.001, noteStart + attack + sustain + release);

        osc.connect(noteGain);
        noteGain.connect(trackGain);

        osc.start(noteStart);
        osc.stop(noteStart + noteDur);

        activeOscs.push(osc);
        // Clean up reference when done
        osc.onended = () => {
          const idx = activeOscs.indexOf(osc);
          if (idx >= 0) activeOscs.splice(idx, 1);
        };
      }

      // Schedule next loop
      if (looping && !stopped) {
        const msUntilNext = (startTime + loopDur - context.currentTime) * 1000 - 200;
        scheduleTimer = setTimeout(() => {
          scheduleLoop(startTime + loopDur);
        }, Math.max(0, msUntilNext));
      }
    }

    // --- Optional pad (sustained drone) ---
    const padOscs: OscillatorNode[] = [];
    if (def.pad) {
      const padWave = def.pad.wave ?? 'sine';
      const padFreq = def.pad.freq;
      const padVol = (def.pad.volume ?? 0.3) * vol * 0.15;

      const padGain = context.createGain();
      padGain.gain.value = padVol;
      padGain.connect(trackGain);

      // Root + fifth + octave for a soft chord
      const padFreqs = [padFreq, padFreq * 1.5, padFreq * 2];
      for (const f of padFreqs) {
        const osc = context.createOscillator();
        osc.type = padWave;
        osc.frequency.value = f;
        osc.detune.value = (Math.random() - 0.5) * 8;

        const oscGain = context.createGain();
        oscGain.gain.value = 0.3;
        osc.connect(oscGain);
        oscGain.connect(padGain);
        osc.start();
        padOscs.push(osc);
      }
    }

    // Start the melody
    scheduleLoop(context.currentTime + 0.05);

    // Use a dummy oscillator as the "source" for the ActiveTrack interface
    const dummyOsc = context.createOscillator();
    dummyOsc.frequency.value = 0;
    dummyOsc.connect(context.createGain()); // connect to dead-end
    dummyOsc.start();

    return {
      name: '',
      source: dummyOsc,
      gainNode: trackGain,
      startTime: context.currentTime,
      pauseTime: 0,
      isProcedural: true,
      _cleanup() {
        stopped = true;
        if (scheduleTimer) clearTimeout(scheduleTimer);
        for (const osc of activeOscs) {
          try { osc.stop(); osc.disconnect(); } catch { /* ok */ }
        }
        for (const osc of padOscs) {
          try { osc.stop(); osc.disconnect(); } catch { /* ok */ }
        }
        try { dummyOsc.stop(); dummyOsc.disconnect(); } catch { /* ok */ }
        activeOscs.length = 0;
        padOscs.length = 0;
      },
    };
  }

  const manager: MusicManager = {
    define(tracks: Record<string, MusicTrack>): void {
      for (const [name, config] of Object.entries(tracks)) {
        trackDefs.set(name, config);
      }
    },

    async play(trackName: string, options?: { fade?: number }): Promise<void> {
      // Don't restart if same track is playing
      if (currentTrack?.name === trackName) return;

      const context = ensureContext();

      // Defer playback until user interaction resumes the context
      if (context.state === 'suspended') {
        pendingPlay = { trackName, options };
        return;
      }

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

      const def = trackDefs.get(trackName);

      // Declarative melody — if the track definition has notes
      if (def?.notes && def.notes.length > 0) {
        currentTrack = createMelodyTrack(def);
        currentTrack.name = trackName;

        if (fadeTime > 0) {
          const targetGain = currentTrack.gainNode.gain.value;
          currentTrack.gainNode.gain.setValueAtTime(0, ensureContext().currentTime);
          fadeGain(currentTrack.gainNode, 0, targetGain, fadeTime);
        }
        return;
      }

      // Legacy procedural preset — $name directly or via track field
      const proceduralName = trackName.startsWith('$')
        ? trackName
        : (def?.track?.startsWith('$') ? def.track : null);

      if (proceduralName) {
        const vol = def?.volume ?? 1;
        currentTrack = createProceduralTrack(proceduralName, vol);
        currentTrack.name = trackName;

        if (fadeTime > 0) {
          const targetGain = vol * 0.15;
          currentTrack.gainNode.gain.setValueAtTime(0, ensureContext().currentTime);
          fadeGain(currentTrack.gainNode, 0, targetGain, fadeTime);
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

  return manager;
}
