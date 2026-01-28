/**
 * Dialogue System Addon
 *
 * Manages NPC dialogue with proximity detection, key-based advancement,
 * and event callbacks for UI updates. The engine does NOT render dialogue
 * boxes — it emits events for the user to handle.
 *
 * @example
 * ```typescript
 * import { dialogue } from 'glyft/addons/dialogue';
 *
 * game.use(dialogue({
 *   dialogues: {
 *     elder: { lines: ['Welcome, traveler.', 'The forest is dangerous.'], speaker: 'Elder' },
 *   },
 *   advanceKey: 'Space',
 *   proximityRange: 24,
 *   onLine: (id, index, text, speaker) => {
 *     textEl.textContent = text;
 *     dialogueBox.classList.add('visible');
 *   },
 *   onEnd: (id) => {
 *     dialogueBox.classList.remove('visible');
 *   },
 * }));
 *
 * const dlg = game.addon<DialogueAddon>('dialogue')!;
 * dlg.setPlayer(player);
 * dlg.assign(npcSprite, 'elder');
 * ```
 *
 * @packageDocumentation
 */

import type { GlyftAddon } from '../addon';
import type { Glyft, Sprite } from '../types';

/** Dialogue definition */
export interface DialogueDef {
  /** Lines of dialogue text */
  lines: string[];
  /** Speaker name */
  speaker?: string;
  /** Called when all lines have been shown */
  onComplete?: () => void;
}

/** Dialogue addon configuration */
export interface DialogueAddonConfig {
  /** Named dialogue sequences */
  dialogues: Record<string, DialogueDef | string[]>;
  /** Key to advance/start dialogue (default: 'Space') */
  advanceKey?: string;
  /** Proximity range in pixels for NPC interaction (default: 24) */
  proximityRange?: number;
  /** Called when dialogue starts */
  onStart?: (id: string, speaker?: string) => void;
  /** Called on each line change */
  onLine?: (id: string, index: number, text: string, speaker?: string) => void;
  /** Called when dialogue ends */
  onEnd?: (id: string) => void;
}

interface AssignedNPC {
  sprite: Sprite;
  dialogueId: string;
}

/** Dialogue addon public API */
export interface DialogueAddon extends GlyftAddon {
  /** Whether dialogue is currently active */
  readonly active: boolean;
  /** Current NPC being talked to */
  readonly currentNPC: Sprite | null;
  /** Current line text */
  readonly currentLine: string | null;
  /** Current speaker name */
  readonly currentSpeaker: string | null;
  /** Current line index */
  readonly lineIndex: number;
  /** Total lines in current dialogue */
  readonly lineCount: number;
  /** Set the player sprite (used for proximity detection) */
  setPlayer(player: Sprite): void;
  /** Assign a dialogue to an NPC sprite */
  assign(sprite: Sprite, dialogueId: string): void;
  /** Manually start a dialogue */
  start(dialogueId: string, npc?: Sprite): void;
  /** Advance to the next line */
  advance(): void;
  /** Close the current dialogue */
  close(): void;
}

function normalize(defs: Record<string, DialogueDef | string[]>): Record<string, DialogueDef> {
  const result: Record<string, DialogueDef> = {};
  for (const [id, val] of Object.entries(defs)) {
    if (Array.isArray(val)) {
      result[id] = { lines: val };
    } else {
      result[id] = val;
    }
  }
  return result;
}

/**
 * Create the dialogue addon.
 */
export function dialogue(config: DialogueAddonConfig): DialogueAddon {
  let game: Glyft;
  const dialogues = normalize(config.dialogues);
  const npcs: AssignedNPC[] = [];
  let playerSprite: Sprite | null = null;

  // Dialogue state
  let isActive = false;
  let currentId = '';
  let currentDef: DialogueDef | null = null;
  let currentIndex = 0;
  let currentNPC: Sprite | null = null;

  const advanceKey = config.advanceKey ?? 'Space';
  const proximityRange = config.proximityRange ?? 24;

  function _findNearbyNPC(): AssignedNPC | null {
    if (!playerSprite) return null;

    let nearest: AssignedNPC | null = null;
    let nearestDist = Infinity;

    for (const npc of npcs) {
      if (!npc.sprite.exists) continue;
      const dx = npc.sprite.x - playerSprite.x;
      const dy = npc.sprite.y - playerSprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < proximityRange && dist < nearestDist) {
        nearestDist = dist;
        nearest = npc;
      }
    }

    return nearest;
  }

  function _start(dialogueId: string, npc?: Sprite) {
    const def = dialogues[dialogueId];
    if (!def || def.lines.length === 0) return;

    isActive = true;
    currentId = dialogueId;
    currentDef = def;
    currentIndex = 0;
    currentNPC = npc ?? null;

    config.onStart?.(dialogueId, def.speaker);
    config.onLine?.(dialogueId, 0, def.lines[0], def.speaker);
  }

  function _advance() {
    if (!isActive || !currentDef) return;

    currentIndex++;
    if (currentIndex >= currentDef.lines.length) {
      // End dialogue
      const id = currentId;
      const def = currentDef;
      const npc = currentNPC;

      isActive = false;
      currentDef = null;
      currentIndex = 0;
      currentNPC = null;

      // Change quest indicator (! → ?) on NPC
      if (npc && npc.labelIcon === '!') {
        npc.labelIcon = '?';
        npc.labelIconColor = 0x888888;
      }

      config.onEnd?.(id);
      def.onComplete?.();
    } else {
      config.onLine?.(currentId, currentIndex, currentDef.lines[currentIndex], currentDef.speaker);
    }
  }

  return {
    name: 'dialogue',

    init(g: Glyft) {
      game = g;
    },

    preUpdate(_dt: number) {
      if (!game.input.justPressed(advanceKey)) return;

      if (isActive) {
        _advance();
      } else {
        // Try to start dialogue with nearby NPC
        const nearbyNPC = _findNearbyNPC();
        if (nearbyNPC) {
          _start(nearbyNPC.dialogueId, nearbyNPC.sprite);
        }
      }
    },

    get active() {
      return isActive;
    },

    get currentNPC() {
      return currentNPC;
    },

    get currentLine() {
      if (!isActive || !currentDef) return null;
      return currentDef.lines[currentIndex] ?? null;
    },

    get currentSpeaker() {
      return currentDef?.speaker ?? null;
    },

    get lineIndex() {
      return currentIndex;
    },

    get lineCount() {
      return currentDef?.lines.length ?? 0;
    },

    setPlayer(player: Sprite) {
      playerSprite = player;
    },

    assign(sprite: Sprite, dialogueId: string) {
      if (!dialogues[dialogueId]) {
        console.warn(`[Glyft:dialogue] Unknown dialogue '${dialogueId}'`);
        return;
      }
      npcs.push({ sprite, dialogueId });
    },

    start(dialogueId: string, npc?: Sprite) {
      _start(dialogueId, npc);
    },

    advance() {
      _advance();
    },

    close() {
      if (!isActive) return;
      const id = currentId;
      isActive = false;
      currentDef = null;
      currentIndex = 0;
      currentNPC = null;
      config.onEnd?.(id);
    },

    destroy() {
      if (isActive) {
        isActive = false;
        config.onEnd?.(currentId);
      }
      npcs.length = 0;
      playerSprite = null;
      currentDef = null;
      currentNPC = null;
    },
  };
}
