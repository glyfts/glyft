/**
 * GPU-driven arc effect system for melee weapon swings.
 *
 * Renders arc/sweep visuals using instanced triangles.
 * One draw call for all active arcs. Zero draw calls when idle.
 *
 * Ring-buffer pool with pre-allocated typed arrays. No per-frame allocations.
 * CPU writes spawn data once per arc; GPU handles all animation
 * (position, fade, color lerp).
 */

import { compileShader } from './renderer';
import { arcVertexShader, arcFragmentShader } from './shaders/arc';
import { packColorF32 } from './floattext';

// Pool limits
const MAX_ARCS = 64;
const FLOATS_PER_ARC = 12;
const BYTES_PER_ARC = FLOATS_PER_ARC * 4;

// Arc geometry: fan of triangles from center
// More segments = smoother arc
const ARC_SEGMENTS = 12;
const VERTS_PER_ARC = ARC_SEGMENTS * 3;  // 3 verts per triangle

export interface ArcEffectDef {
  /** Duration in seconds (default: 0.2) */
  duration?: number;
  /** Start color 0xRRGGBB (default: 0xffffff) */
  color?: number;
  /** End color 0xRRGGBB (default: same as color) */
  colorEnd?: number;
}

interface Arc {
  active: boolean;
  birthTime: number;
  duration: number;
}

export interface ArcEffectManager {
  /** Register an arc effect definition by name. */
  define(name: string, def: ArcEffectDef): void;
  /** Emit an arc effect at a world position. */
  emit(name: string, x: number, y: number, angle: number, arcDegrees: number, range: number, time: number): void;
  /** Expire dead arcs. */
  update(time: number): void;
  /** Compact active buffer, upload, and draw. */
  render(projection: Float32Array, time: number, cameraX: number, cameraY: number): void;
}

/**
 * Generate arc geometry vertices.
 * Creates a fan of triangles from center to edge.
 * Each vertex has (dist, angleT) where dist is 0-1 and angleT is 0-1.
 */
function generateArcGeometry(): Float32Array {
  const verts = new Float32Array(VERTS_PER_ARC * 2);
  let idx = 0;

  for (let i = 0; i < ARC_SEGMENTS; i++) {
    const t0 = i / ARC_SEGMENTS;
    const t1 = (i + 1) / ARC_SEGMENTS;

    // Triangle: center, edge0, edge1
    // Center vertex (dist=0, angleT=0.5 - doesn't matter for center)
    verts[idx++] = 0;    // dist
    verts[idx++] = 0.5;  // angleT (center)

    // Edge vertex 0
    verts[idx++] = 1;    // dist (at edge)
    verts[idx++] = t0;   // angleT

    // Edge vertex 1
    verts[idx++] = 1;    // dist (at edge)
    verts[idx++] = t1;   // angleT
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

  // --- VAO setup ---
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // Arc geometry buffer (per-vertex, location 0)
  const arcVerts = generateArcGeometry();
  const arcBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, arcBuf);
  gl.bufferData(gl.ARRAY_BUFFER, arcVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Instance buffer (per-instance, locations 1-3)
  const instBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_ARCS * BYTES_PER_ARC, gl.DYNAMIC_DRAW);

  // a_arcPos (location 1): vec4, stride 48, offset 0
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_ARC, 0);
  gl.vertexAttribDivisor(1, 1);

  // a_arcDyn (location 2): vec4, stride 48, offset 16
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_ARC, 16);
  gl.vertexAttribDivisor(2, 1);

  // a_arcVis (location 3): vec4, stride 48, offset 32
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, BYTES_PER_ARC, 32);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  // --- Pre-allocated pools ---
  const instancePool = new Float32Array(MAX_ARCS * FLOATS_PER_ARC);
  const activeBuffer = new Float32Array(MAX_ARCS * FLOATS_PER_ARC);

  const arcs: Arc[] = [];
  for (let i = 0; i < MAX_ARCS; i++) {
    arcs.push({ active: false, birthTime: 0, duration: 0 });
  }

  const effects = new Map<string, ArcEffectDef>();
  let nextSlot = 0;

  const DEG_TO_RAD = Math.PI / 180;

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

      arcs[slot].active = true;
      arcs[slot].birthTime = time;
      arcs[slot].duration = duration;

      const off = slot * FLOATS_PER_ARC;

      // a_arcPos: centerX, centerY, angle (radians), arcRadians
      instancePool[off + 0] = x;
      instancePool[off + 1] = y;
      instancePool[off + 2] = angle;  // Already in radians from server
      instancePool[off + 3] = arcRadians;

      // a_arcDyn: range, birthTime, duration, (unused)
      instancePool[off + 4] = range;
      instancePool[off + 5] = time;
      instancePool[off + 6] = duration;
      instancePool[off + 7] = 0;

      // a_arcVis: colorStart, colorEnd, (unused), (unused)
      instancePool[off + 8] = colorStart;
      instancePool[off + 9] = colorEnd;
      instancePool[off + 10] = 0;
      instancePool[off + 11] = 0;
    },

    update(time: number): void {
      for (let i = 0; i < MAX_ARCS; i++) {
        if (arcs[i].active && time - arcs[i].birthTime > arcs[i].duration) {
          arcs[i].active = false;
        }
      }
    },

    render(projection: Float32Array, time: number, cameraX: number, cameraY: number): void {
      // Compact active arcs into contiguous buffer
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
