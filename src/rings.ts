/**
 * GPU-driven ring/shockwave effect system.
 *
 * Renders expanding ring effects with color gradients and fade-out.
 * Perfect for shockwaves, explosions, AoE indicators.
 *
 * One draw call for all active rings. Zero draw calls when idle.
 */

import { compileShader } from './renderer';
import { packColorF32 } from './floattext';

// Pool limits
const MAX_RINGS = 32;
const FLOATS_PER_RING = 12;  // x, y, startRadius, endRadius | colorStart, colorEnd, thickness, gradient | birthTime, duration, fadeStart, unused
const BYTES_PER_RING = FLOATS_PER_RING * 4;

// Ring geometry: 64 segments for smooth circle
const RING_SEGMENTS = 64;
const VERTS_PER_RING = RING_SEGMENTS * 6;

// Gradient types
const GRADIENT_DUO = 0;
const GRADIENT_FIRE = 1;      // Red -> Orange -> Yellow -> White
const GRADIENT_ICE = 2;       // White -> Cyan -> Blue
const GRADIENT_HOLY = 3;      // White -> Gold -> White
const GRADIENT_POISON = 4;    // Green -> Yellow -> Green
const GRADIENT_SHADOW = 5;    // Purple -> Black -> Purple
const GRADIENT_SHOCK = 6;     // Red -> White (user's request!)

export interface RingEffectDef {
  /** Duration in seconds (default: 0.5) */
  duration?: number;
  /** Start radius in pixels (default: 10) */
  startRadius?: number;
  /** End radius in pixels (default: 100) */
  endRadius?: number;
  /** Ring thickness in pixels (default: 8) */
  thickness?: number;
  /** Start color 0xRRGGBB (default: 0xff4444 red) */
  color?: number;
  /** End color 0xRRGGBB (default: 0xffffff white) */
  colorEnd?: number;
  /** Predefined gradient: 'duo' | 'fire' | 'ice' | 'holy' | 'poison' | 'shadow' | 'shock' */
  gradient?: 'duo' | 'fire' | 'ice' | 'holy' | 'poison' | 'shadow' | 'shock';
  /** When to start fading (0-1, default: 0.5) */
  fadeStart?: number;
}

/** Options passed when emitting a ring */
export interface RingEmitOptions {
  /** Callback that returns current position - ring will follow this position each frame */
  follow?: () => { x: number; y: number };
}

interface Ring {
  active: boolean;
  birthTime: number;
  duration: number;
  follow?: () => { x: number; y: number };
}

export interface RingEffectManager {
  define(name: string, def: RingEffectDef): void;
  emit(name: string, x: number, y: number, time?: number, options?: RingEmitOptions): void;
  update(time: number): void;
  render(projection: Float32Array, time: number, cameraX: number, cameraY: number): void;
}

// Vertex shader for ring effects
const ringVertexShader = `#version 300 es
precision highp float;

// Per-vertex: angle t (0-1 around circle), inner/outer (0 or 1)
in vec2 a_vertex;  // x = inner/outer (0 or 1), y = angle t (0-1)

// Per-instance ring data
in vec4 a_posRadius;   // x, y, startRadius, endRadius
in vec4 a_colors;      // colorStart, colorEnd, thickness, gradient
in vec4 a_timing;      // birthTime, duration, fadeStart, unused

uniform mat4 u_projection;
uniform float u_time;
uniform vec2 u_camera;

out float v_progress;  // Animation progress 0-1
out float v_radialT;   // Position along ring thickness 0-1
out float v_alpha;
out float v_gradient;
flat out vec4 v_colorStart;
flat out vec4 v_colorEnd;

vec4 unpackColor(float packed) {
  int c = floatBitsToInt(packed);
  return vec4(
    float((c >> 16) & 0xFF) / 255.0,
    float((c >> 8) & 0xFF) / 255.0,
    float(c & 0xFF) / 255.0,
    1.0
  );
}

void main() {
  float elapsed = u_time - a_timing.x;
  float progress = clamp(elapsed / a_timing.y, 0.0, 1.0);
  v_progress = progress;

  // Current ring radius (expanding outward)
  float currentRadius = mix(a_posRadius.z, a_posRadius.w, progress);
  float thickness = a_colors.z;

  // Inner or outer edge
  float radiusOffset = a_vertex.x * thickness;
  float radius = currentRadius + radiusOffset - thickness * 0.5;

  // Angle around the circle
  float angle = a_vertex.y * 6.283185307;  // 2 * PI
  float cx = cos(angle);
  float cy = sin(angle);

  vec2 worldPos = a_posRadius.xy + vec2(cx, cy) * radius;
  vec2 screenPos = worldPos - u_camera;

  gl_Position = u_projection * vec4(screenPos, 0.0, 1.0);

  // Fade out near the end
  float fadeStart = a_timing.z;
  v_alpha = 1.0 - smoothstep(fadeStart, 1.0, progress);

  v_radialT = a_vertex.x;  // 0 at inner, 1 at outer
  v_gradient = a_colors.w;
  v_colorStart = unpackColor(a_colors.x);
  v_colorEnd = unpackColor(a_colors.y);
}
`;

// Fragment shader for ring effects
const ringFragmentShader = `#version 300 es
precision highp float;

in float v_progress;
in float v_radialT;
in float v_alpha;
in float v_gradient;
flat in vec4 v_colorStart;
flat in vec4 v_colorEnd;

out vec4 fragColor;

// Predefined gradient functions
vec3 fireGradient(float t) {
  // Red -> Orange -> Yellow -> White
  if (t < 0.33) return mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 0.5, 0.0), t * 3.0);
  if (t < 0.66) return mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.33) * 3.0);
  return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 1.0, 1.0), (t - 0.66) * 3.0);
}

vec3 iceGradient(float t) {
  // White -> Cyan -> Blue
  if (t < 0.5) return mix(vec3(1.0, 1.0, 1.0), vec3(0.5, 1.0, 1.0), t * 2.0);
  return mix(vec3(0.5, 1.0, 1.0), vec3(0.2, 0.4, 1.0), (t - 0.5) * 2.0);
}

vec3 holyGradient(float t) {
  // White -> Gold -> White (pulsing)
  float pulse = sin(t * 6.283185307) * 0.5 + 0.5;
  return mix(vec3(1.0, 1.0, 1.0), vec3(1.0, 0.85, 0.4), pulse * 0.5);
}

vec3 poisonGradient(float t) {
  // Green -> Yellow-Green -> Dark Green
  if (t < 0.5) return mix(vec3(0.2, 0.8, 0.2), vec3(0.6, 1.0, 0.2), t * 2.0);
  return mix(vec3(0.6, 1.0, 0.2), vec3(0.1, 0.4, 0.1), (t - 0.5) * 2.0);
}

vec3 shadowGradient(float t) {
  // Purple -> Black -> Purple
  if (t < 0.5) return mix(vec3(0.5, 0.2, 0.8), vec3(0.1, 0.0, 0.1), t * 2.0);
  return mix(vec3(0.1, 0.0, 0.1), vec3(0.5, 0.2, 0.8), (t - 0.5) * 2.0);
}

vec3 shockGradient(float t) {
  // Red -> Orange -> Yellow -> White (the user's request!)
  if (t < 0.25) return mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 0.3, 0.0), t * 4.0);
  if (t < 0.5) return mix(vec3(1.0, 0.3, 0.0), vec3(1.0, 0.6, 0.0), (t - 0.25) * 4.0);
  if (t < 0.75) return mix(vec3(1.0, 0.6, 0.0), vec3(1.0, 1.0, 0.5), (t - 0.5) * 4.0);
  return mix(vec3(1.0, 1.0, 0.5), vec3(1.0, 1.0, 1.0), (t - 0.75) * 4.0);
}

void main() {
  if (v_alpha <= 0.0) discard;

  // Apply gradient based on progress (expanding)
  float t = v_progress;
  vec3 color;

  int grad = int(v_gradient + 0.5);
  if (grad == 1) color = fireGradient(t);
  else if (grad == 2) color = iceGradient(t);
  else if (grad == 3) color = holyGradient(t);
  else if (grad == 4) color = poisonGradient(t);
  else if (grad == 5) color = shadowGradient(t);
  else if (grad == 6) color = shockGradient(t);  // Red -> White shock!
  else color = mix(v_colorStart.rgb, v_colorEnd.rgb, t);

  // Edge glow - brighter at outer edge of ring
  float edgeGlow = smoothstep(0.0, 0.3, v_radialT) * smoothstep(1.0, 0.7, v_radialT);
  float centerGlow = 1.0 - abs(v_radialT - 0.5) * 2.0;

  // Combine glows
  float glow = max(edgeGlow, centerGlow * 0.5) + 0.3;

  fragColor = vec4(color * glow, v_alpha * glow);
}
`;

function generateRingGeometry(): Float32Array {
  const verts = new Float32Array(VERTS_PER_RING * 2);
  let idx = 0;

  for (let i = 0; i < RING_SEGMENTS; i++) {
    const t0 = i / RING_SEGMENTS;
    const t1 = (i + 1) / RING_SEGMENTS;

    // Quad from inner to outer edge
    verts[idx++] = 0; verts[idx++] = t0;  // inner, angle t0
    verts[idx++] = 1; verts[idx++] = t0;  // outer, angle t0
    verts[idx++] = 1; verts[idx++] = t1;  // outer, angle t1

    verts[idx++] = 0; verts[idx++] = t0;  // inner, angle t0
    verts[idx++] = 1; verts[idx++] = t1;  // outer, angle t1
    verts[idx++] = 0; verts[idx++] = t1;  // inner, angle t1
  }

  return verts;
}

export function createRingEffectManager(gl: WebGL2RenderingContext): RingEffectManager {
  const shader = compileShader(
    gl,
    ringVertexShader,
    ringFragmentShader,
    ['u_projection', 'u_time', 'u_camera'],
    ['a_vertex', 'a_posRadius', 'a_colors', 'a_timing']
  );

  // Uniforms
  const u_projection = shader.uniforms.u_projection;
  const u_time = shader.uniforms.u_time;
  const u_camera = shader.uniforms.u_camera;

  // Attributes
  const a_vertex = shader.attributes.a_vertex;
  const a_posRadius = shader.attributes.a_posRadius;
  const a_colors = shader.attributes.a_colors;
  const a_timing = shader.attributes.a_timing;

  // VAO
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // Per-vertex geometry (shared by all instances)
  const geomBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, geomBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, generateRingGeometry(), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(a_vertex);
  gl.vertexAttribPointer(a_vertex, 2, gl.FLOAT, false, 0, 0);

  // Per-instance data
  const instanceData = new Float32Array(MAX_RINGS * FLOATS_PER_RING);
  const instanceBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW);

  // a_posRadius: x, y, startRadius, endRadius (4 floats)
  gl.enableVertexAttribArray(a_posRadius);
  gl.vertexAttribPointer(a_posRadius, 4, gl.FLOAT, false, BYTES_PER_RING, 0);
  gl.vertexAttribDivisor(a_posRadius, 1);

  // a_colors: colorStart, colorEnd, thickness, gradient (4 floats)
  gl.enableVertexAttribArray(a_colors);
  gl.vertexAttribPointer(a_colors, 4, gl.FLOAT, false, BYTES_PER_RING, 16);
  gl.vertexAttribDivisor(a_colors, 1);

  // a_timing: birthTime, duration, fadeStart, unused (4 floats, but we only use 3)
  gl.enableVertexAttribArray(a_timing);
  gl.vertexAttribPointer(a_timing, 4, gl.FLOAT, false, BYTES_PER_RING, 32);
  gl.vertexAttribDivisor(a_timing, 1);

  gl.bindVertexArray(null);

  // Effect definitions
  const definitions = new Map<string, RingEffectDef>();

  // Ring pool
  const rings: Ring[] = [];
  for (let i = 0; i < MAX_RINGS; i++) {
    rings.push({ active: false, birthTime: 0, duration: 0 });
  }

  let activeCount = 0;
  let writeIndex = 0;

  function getGradientType(name?: string): number {
    switch (name) {
      case 'fire': return GRADIENT_FIRE;
      case 'ice': return GRADIENT_ICE;
      case 'holy': return GRADIENT_HOLY;
      case 'poison': return GRADIENT_POISON;
      case 'shadow': return GRADIENT_SHADOW;
      case 'shock': return GRADIENT_SHOCK;
      default: return GRADIENT_DUO;
    }
  }

  return {
    define(name: string, def: RingEffectDef) {
      definitions.set(name, def);
    },

    emit(name: string, x: number, y: number, time?: number, options?: RingEmitOptions) {
      const def = definitions.get(name);
      if (!def) {
        console.warn(`[Glyft Rings] Unknown effect: ${name}`);
        return;
      }

      // Find free slot
      let slot = -1;
      for (let i = 0; i < MAX_RINGS; i++) {
        const idx = (writeIndex + i) % MAX_RINGS;
        if (!rings[idx].active) {
          slot = idx;
          break;
        }
      }

      if (slot === -1) {
        // Overwrite oldest
        slot = writeIndex;
      }

      writeIndex = (slot + 1) % MAX_RINGS;

      const now = time ?? performance.now() / 1000;
      const duration = def.duration ?? 0.5;
      const startRadius = def.startRadius ?? 10;
      const endRadius = def.endRadius ?? 100;
      const thickness = def.thickness ?? 8;
      const colorStart = def.color ?? 0xff4444;
      const colorEnd = def.colorEnd ?? 0xffffff;
      const fadeStart = def.fadeStart ?? 0.5;
      const gradient = getGradientType(def.gradient);

      rings[slot].active = true;
      rings[slot].birthTime = now;
      rings[slot].duration = duration;
      rings[slot].follow = options?.follow;

      const base = slot * FLOATS_PER_RING;
      instanceData[base + 0] = x;
      instanceData[base + 1] = y;
      instanceData[base + 2] = startRadius;
      instanceData[base + 3] = endRadius;
      instanceData[base + 4] = packColorF32(colorStart);
      instanceData[base + 5] = packColorF32(colorEnd);
      instanceData[base + 6] = thickness;
      instanceData[base + 7] = gradient;
      instanceData[base + 8] = now;
      instanceData[base + 9] = duration;
      instanceData[base + 10] = fadeStart;
      instanceData[base + 11] = 0;  // unused

      activeCount++;
    },

    update(time: number) {
      // Mark expired rings as inactive and update following positions
      for (let i = 0; i < MAX_RINGS; i++) {
        if (!rings[i].active) continue;

        const elapsed = time - rings[i].birthTime;
        if (elapsed > rings[i].duration) {
          rings[i].active = false;
          rings[i].follow = undefined;
          activeCount = Math.max(0, activeCount - 1);
          continue;
        }

        // Update position if following
        if (rings[i].follow) {
          const pos = rings[i].follow!();
          const base = i * FLOATS_PER_RING;
          instanceData[base + 0] = pos.x;
          instanceData[base + 1] = pos.y;
        }
      }
    },

    render(projection: Float32Array, time: number, cameraX: number, cameraY: number) {
      if (activeCount === 0) return;

      gl.useProgram(shader.program);
      gl.uniformMatrix4fv(u_projection, false, projection);
      gl.uniform1f(u_time, time);
      gl.uniform2f(u_camera, cameraX, cameraY);

      // Upload instance data
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData);

      // Enable blending for transparency
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);  // Additive blending for glow

      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, VERTS_PER_RING, MAX_RINGS);
      gl.bindVertexArray(null);

      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);  // Restore normal blending
    },
  };
}
