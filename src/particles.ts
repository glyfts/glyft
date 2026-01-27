/**
 * GPU-driven particle system.
 *
 * Renders visual effects (sparks, bursts, glows) using instanced quads.
 * One draw call for all active particles. Zero draw calls when idle.
 *
 * Ring-buffer pool with pre-allocated typed arrays. No per-frame allocations.
 * CPU writes spawn data once per particle; GPU handles all animation
 * (position via velocity+gravity, size lerp, color lerp, fade).
 */

import { compileShader } from './renderer';
import { particleVertexShader, particleFragmentShader } from './shaders/particle';
import { packColorF32 } from './floattext';
import type { ParticleEmitterDef } from './types';

// Pool limits
const MAX_PARTICLES = 2048;
const FLOATS_PER_PARTICLE = 12;
const BYTES_PER_PARTICLE = FLOATS_PER_PARTICLE * 4;

const DEG_TO_RAD = Math.PI / 180;

interface Particle {
  active: boolean;
  birthTime: number;
  duration: number;
}

export interface ParticleManager {
  /** Register an emitter definition by name. */
  define(name: string, def: ParticleEmitterDef): void;
  /** Emit particles at a world position using a named emitter. */
  emit(name: string, x: number, y: number, time: number): void;
  /** Expire dead particles. */
  update(time: number): void;
  /** Compact active buffer, upload, and draw. */
  render(projection: Float32Array, time: number, cameraX: number, cameraY: number): void;
}

export function createParticleManager(gl: WebGL2RenderingContext): ParticleManager {
  const shader = compileShader(
    gl,
    particleVertexShader,
    particleFragmentShader,
    ['u_projection', 'u_time', 'u_cameraPos'],
    ['a_position', 'a_partPos', 'a_partDyn', 'a_partVis'],
  );

  // --- VAO setup ---
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // Quad buffer (per-vertex, location 0)
  const quadVerts = new Float32Array([
    0, 0, 1, 0, 0, 1,
    1, 0, 1, 1, 0, 1,
  ]);
  const quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Instance buffer (per-instance, locations 1-3)
  const instBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_PARTICLES * BYTES_PER_PARTICLE, gl.DYNAMIC_DRAW);

  // a_partPos (location 1): vec4, stride 48, offset 0
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_PARTICLE, 0);
  gl.vertexAttribDivisor(1, 1);

  // a_partDyn (location 2): vec4, stride 48, offset 16
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_PARTICLE, 16);
  gl.vertexAttribDivisor(2, 1);

  // a_partVis (location 3): vec4, stride 48, offset 32
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, BYTES_PER_PARTICLE, 32);
  gl.vertexAttribDivisor(3, 1);

  gl.bindVertexArray(null);

  // --- Pre-allocated pools ---
  const instancePool = new Float32Array(MAX_PARTICLES * FLOATS_PER_PARTICLE);
  const activeBuffer = new Float32Array(MAX_PARTICLES * FLOATS_PER_PARTICLE);

  const particles: Particle[] = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    particles.push({ active: false, birthTime: 0, duration: 0 });
  }

  const emitters = new Map<string, ParticleEmitterDef>();
  let nextSlot = 0;

  return {
    define(name: string, def: ParticleEmitterDef): void {
      emitters.set(name, def);
    },

    emit(name: string, x: number, y: number, time: number): void {
      const def = emitters.get(name);
      if (!def) {
        console.warn(`[Glyft] Unknown particle emitter: "${name}"`);
        return;
      }

      const count = def.count ?? 10;
      const baseSpeed = def.speed ?? 50;
      const speedVar = def.speedVariance ?? 0;
      const baseAngle = (def.angle ?? -90) * DEG_TO_RAD;
      const spreadRad = (def.spread ?? 360) * DEG_TO_RAD;
      const baseLifetime = def.lifetime ?? 0.5;
      const lifetimeVar = def.lifetimeVariance ?? 0;
      const gravity = def.gravity ?? 0;
      const colorStart = packColorF32(def.color ?? 0xffffff);
      const colorEnd = packColorF32(def.colorEnd ?? def.color ?? 0xffffff);
      const sizeStart = def.size ?? 3;
      const sizeEnd = def.sizeEnd ?? 0;

      for (let i = 0; i < count; i++) {
        const slot = nextSlot;
        nextSlot = (nextSlot + 1) % MAX_PARTICLES;

        // Randomize per-particle
        const angle = baseAngle + (Math.random() - 0.5) * spreadRad;
        const speed = baseSpeed + (Math.random() - 0.5) * 2 * speedVar;
        const lifetime = Math.max(0.05, baseLifetime + (Math.random() - 0.5) * 2 * lifetimeVar);

        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;

        particles[slot].active = true;
        particles[slot].birthTime = time;
        particles[slot].duration = lifetime;

        const off = slot * FLOATS_PER_PARTICLE;

        // a_partPos: spawnX, spawnY, velX, velY
        instancePool[off + 0] = x;
        instancePool[off + 1] = y;
        instancePool[off + 2] = vx;
        instancePool[off + 3] = vy;

        // a_partDyn: birthTime, duration, gravity, (unused)
        instancePool[off + 4] = time;
        instancePool[off + 5] = lifetime;
        instancePool[off + 6] = gravity;
        instancePool[off + 7] = 0;

        // a_partVis: colorStart, colorEnd, sizeStart, sizeEnd
        instancePool[off + 8] = colorStart;
        instancePool[off + 9] = colorEnd;
        instancePool[off + 10] = sizeStart;
        instancePool[off + 11] = sizeEnd;
      }
    },

    update(time: number): void {
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (particles[i].active && time - particles[i].birthTime > particles[i].duration) {
          particles[i].active = false;
        }
      }
    },

    render(projection: Float32Array, time: number, cameraX: number, cameraY: number): void {
      // Compact active particles into contiguous buffer
      let activeCount = 0;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (!particles[i].active) continue;
        const srcOff = i * FLOATS_PER_PARTICLE;
        const dstOff = activeCount * FLOATS_PER_PARTICLE;
        for (let j = 0; j < FLOATS_PER_PARTICLE; j++) {
          activeBuffer[dstOff + j] = instancePool[srcOff + j];
        }
        activeCount++;
      }

      if (activeCount === 0) return;

      gl.bindVertexArray(vao);

      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, activeBuffer, 0, activeCount * FLOATS_PER_PARTICLE);

      gl.useProgram(shader.program);
      gl.uniformMatrix3fv(shader.uniforms['u_projection'], false, projection);
      gl.uniform1f(shader.uniforms['u_time'], time);
      gl.uniform2f(shader.uniforms['u_cameraPos'], cameraX, cameraY);

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, activeCount);
      gl.bindVertexArray(null);
    },
  };
}
