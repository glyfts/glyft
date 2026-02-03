/**
 * GPU-driven arc effect system for melee weapon swings.
 *
 * Renders arc/sweep visuals using instanced triangles.
 * One draw call for all active arcs. Zero draw calls when idle.
 *
 * Supports:
 * - Sweeping animation (arc draws from one side to the other)
 * - Predefined color gradients (fire, ice, holy, poison)
 * - Wave/sine shapes for fancy combo attacks
 *
 * Ring-buffer pool with pre-allocated typed arrays. No per-frame allocations.
 */

import { compileShader } from './renderer';
import { arcVertexShader, arcFragmentShader } from './shaders/arc';
import { packColorF32 } from './floattext';

// Pool limits
const MAX_ARCS = 64;
const FLOATS_PER_ARC = 12;
const BYTES_PER_ARC = FLOATS_PER_ARC * 4;

// Arc geometry: quads forming a truncated arc (no pointy center)
const ARC_SEGMENTS = 16;  // More segments for smoother waves
const VERTS_PER_ARC = ARC_SEGMENTS * 6;
const INNER_RADIUS = 0.15;

// Shape types
const SHAPE_ARC = 0;
const SHAPE_WAVE = 1;
const SHAPE_ZIGZAG = 2;
const SHAPE_AXE = 3;
const SHAPE_SPEAR = 4;

// Gradient types (predefined color ramps in shader)
const GRADIENT_DUO = 0;      // Just use colorStart → colorEnd
const GRADIENT_FIRE = 1;     // Red → Orange → Yellow → White
const GRADIENT_ICE = 2;      // White → Cyan → Blue
const GRADIENT_HOLY = 3;     // White → Gold → White (pulsing)
const GRADIENT_POISON = 4;   // Green → Yellow → Dark Green
const GRADIENT_SHADOW = 5;   // Purple → Black → Purple

export interface ArcEffectDef {
  /** Duration in seconds (default: 0.2) */
  duration?: number;
  /** Start color 0xRRGGBB (default: 0xffffff) - used for 'duo' gradient */
  color?: number;
  /** End color 0xRRGGBB (default: same as color) - used for 'duo' gradient */
  colorEnd?: number;
  /** Predefined gradient: 'duo' | 'fire' | 'ice' | 'holy' | 'poison' | 'shadow' */
  gradient?: 'duo' | 'fire' | 'ice' | 'holy' | 'poison' | 'shadow';
  /** Shape: 'arc' (default) | 'wave' | 'zigzag' | 'axe' | 'spear' */
  shape?: 'arc' | 'wave' | 'zigzag' | 'axe' | 'spear';
  /** Wave amplitude as fraction of range (default: 0, max ~0.3) */
  waveAmp?: number;
  /** Wave frequency - number of waves across the arc (default: 2) */
  waveFreq?: number;
}

interface Arc {
  active: boolean;
  birthTime: number;
  duration: number;
}

export interface ArcEffectManager {
  define(name: string, def: ArcEffectDef): void;
  emit(name: string, x: number, y: number, angle: number, arcDegrees: number, range: number, time: number): void;
  update(time: number): void;
  render(projection: Float32Array, time: number, cameraX: number, cameraY: number): void;
}

function generateArcGeometry(): Float32Array {
  const verts = new Float32Array(VERTS_PER_ARC * 2);
  let idx = 0;

  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const t0 = i / ARC_SEGMENTS;
    const t1 = (i + 1) / ARC_SEGMENTS;

    // Quad from inner to outer edge
    verts[idx++] = INNER_RADIUS; verts[idx++] = t0;
    verts[idx++] = 1;            verts[idx++] = t0;
    verts[idx++] = 1;            verts[idx++] = t1;

    verts[idx++] = INNER_RADIUS; verts[idx++] = t0;
    verts[idx++] = 1;            verts[idx++] = t1;
    verts[idx++] = INNER_RADIUS; verts[idx++] = t1;
  }

  return verts;
}

export function createArcEffectManager(gl: WebGL2RenderingContext): ArcEffectManager {
  const shader = compileShader(
    gl,
    arcVertexShader,
    arcFragmentShader,
    ['u_projection', 'u_time', 'u_cameraPos'],
    ['a_position', 'a_arcPos', 'a_arcDyn', 'a_arcVis'],
  );

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const arcVerts = generateArcGeometry();
  const arcBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, arcBuf);
  gl.bufferData(gl.ARRAY_BUFFER, arcVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const instBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_ARCS * BYTES_PER_ARC, gl.DYNAMIC_DRAW);

  // a_arcPos (location 1): centerX, centerY, angle, arcRadians
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_ARC, 0);
  gl.vertexAttribDivisor(1, 1);

  // a_arcDyn (location 2): range, birthTime, duration, flags
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_ARC, 16);
  gl.vertexAttribDivisor(2, 1);

  // a_arcVis (location 3): colorStart, colorEnd, waveAmp, waveFreq
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, BYTES_PER_ARC, 32);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  const instancePool = new Float32Array(MAX_ARCS * FLOATS_PER_ARC);
  const activeBuffer = new Float32Array(MAX_ARCS * FLOATS_PER_ARC);

  const arcs: Arc[] = [];
  for (let i = 0; i < MAX_ARCS; i++) {
    arcs.push({ active: false, birthTime: 0, duration: 0 });
  }

  const effects = new Map<string, ArcEffectDef>();
  let nextSlot = 0;

  const DEG_TO_RAD = Math.PI / 180;

  const GRADIENT_MAP: Record<string, number> = {
    duo: GRADIENT_DUO,
    fire: GRADIENT_FIRE,
    ice: GRADIENT_ICE,
    holy: GRADIENT_HOLY,
    poison: GRADIENT_POISON,
    shadow: GRADIENT_SHADOW,
  };

  const SHAPE_MAP: Record<string, number> = {
    arc: SHAPE_ARC,
    wave: SHAPE_WAVE,
    zigzag: SHAPE_ZIGZAG,
    axe: SHAPE_AXE,
    spear: SHAPE_SPEAR,
  };

  return {
    define(name: string, def: ArcEffectDef): void {
      effects.set(name, def);
    },

    emit(name: string, x: number, y: number, angle: number, arcDegrees: number, range: number, time: number): void {
      const def = effects.get(name);
      if (!def) {
        console.warn(`[Glyft] Unknown arc effect: "${name}"`);
        return;
      }

      const slot = nextSlot;
      nextSlot = (nextSlot + 1) % MAX_ARCS;

      const duration = def.duration ?? 0.2;
      const colorStart = packColorF32(def.color ?? 0xffffff);
      const colorEnd = packColorF32(def.colorEnd ?? def.color ?? 0xffffff);
      const arcRadians = arcDegrees * DEG_TO_RAD;

      const shapeType = SHAPE_MAP[def.shape ?? 'arc'] ?? SHAPE_ARC;
      const gradientType = GRADIENT_MAP[def.gradient ?? 'duo'] ?? GRADIENT_DUO;
      // Pack shape (0-7) and gradient (0-7) into flags: shape in low 4 bits, gradient in high 4 bits
      const flags = shapeType + (gradientType << 4);

      const waveAmp = def.waveAmp ?? 0;
      const waveFreq = def.waveFreq ?? 2;

      arcs[slot].active = true;
      arcs[slot].birthTime = time;
      arcs[slot].duration = duration;

      const off = slot * FLOATS_PER_ARC;

      // a_arcPos: centerX, centerY, angle, arcRadians
      instancePool[off + 0] = x;
      instancePool[off + 1] = y;
      instancePool[off + 2] = angle;
      instancePool[off + 3] = arcRadians;

      // a_arcDyn: range, birthTime, duration, flags
      instancePool[off + 4] = range;
      instancePool[off + 5] = time;
      instancePool[off + 6] = duration;
      instancePool[off + 7] = flags;

      // a_arcVis: colorStart, colorEnd, waveAmp, waveFreq
      instancePool[off + 8] = colorStart;
      instancePool[off + 9] = colorEnd;
      instancePool[off + 10] = waveAmp;
      instancePool[off + 11] = waveFreq;
    },

    update(time: number): void {
      for (let i = 0; i < MAX_ARCS; i++) {
        if (arcs[i].active && time - arcs[i].birthTime > arcs[i].duration) {
          arcs[i].active = false;
        }
      }
    },

    render(projection: Float32Array, time: number, cameraX: number, cameraY: number): void {
      let activeCount = 0;
      for (let i = 0; i < MAX_ARCS; i++) {
        if (!arcs[i].active) continue;
        const srcOff = i * FLOATS_PER_ARC;
        const dstOff = activeCount * FLOATS_PER_ARC;
        for (let j = 0; j < FLOATS_PER_ARC; j++) {
          activeBuffer[dstOff + j] = instancePool[srcOff + j];
        }
        activeCount++;
      }

      if (activeCount === 0) return;

      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, activeBuffer, 0, activeCount * FLOATS_PER_ARC);

      gl.useProgram(shader.program);
      gl.uniformMatrix3fv(shader.uniforms['u_projection'], false, projection);
      gl.uniform1f(shader.uniforms['u_time'], time);
      gl.uniform2f(shader.uniforms['u_cameraPos'], cameraX, cameraY);

      gl.drawArraysInstanced(gl.TRIANGLES, 0, VERTS_PER_ARC, activeCount);
      gl.bindVertexArray(null);
    },
  };
}
