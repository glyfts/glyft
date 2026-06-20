/**
 * Billboard sprite system for 3D terrain rendering.
 *
 * Renders 2D sprites as camera-facing quads in 3D world space.
 * Uses instanced rendering for performance (thousands of sprites, few draw calls).
 * Compatible with Glyft's existing spritesheet conventions (4dir, 8dir).
 */

import { compileShader } from './renderer';
import { billboardVertexShader, billboardFragmentShader } from './shaders/billboard';
import {
  vec3Normalize,
  vec3Sub,
  vec3Cross,
  type Vec3,
  type Mat4,
} from './math3d';
import type { Camera3D } from './terrain';

// ---- Types ----

export interface BillboardSprite {
  /** World position (x = east, y = height, z = south) */
  x: number;
  y: number;
  z: number;
  /** Facing direction in radians (0 = south, PI/2 = east) */
  facing: number;
  /** Movement velocity (used for animation state) */
  vx: number;
  vy: number;
  vz: number;
  /** Movement speed (length of velocity, drives walk/idle) */
  speed: number;
  /** Scale multiplier */
  scale: number;
  /** Opacity 0..1 */
  alpha: number;
  /** Tint color as packed uint32 (0xRRGGBB) */
  tint: number;
  /** World-space height per pixel (controls sprite size in world) */
  spriteHeight: number;
  /** Vertical anchor offset in world units (positive = push sprite down). Default 0. */
  groundOffset: number;
  /** Terrain normal at sprite position (for slope-conforming shadows). Default [0,1,0]. */
  terrainNormalX: number;
  terrainNormalZ: number;
  /** Sprite sheet frame region in atlas */
  frameX: number;
  frameY: number;
  frameW: number;
  frameH: number;
  /** Animation */
  idleFrames: number;
  walkFrames: number;
  fps: number;
  /** Flip X */
  flipX: boolean;
  /** Animation override: starting frame column (e.g. 5 for sword attack) */
  animOverrideStart: number;
  /** Animation override: number of frames to play */
  animOverrideFrames: number;
  /** Animation override: timestamp when override started (0 = inactive) */
  animOverrideTime: number;
  /** Animation override: fps for the override (default 12) */
  animOverrideFps: number;
}

export interface BillboardAtlas {
  texture: WebGLTexture;
  width: number;
  height: number;
}

export interface BillboardSystem {
  /** Render all billboard sprites */
  render(
    sprites: BillboardSprite[],
    atlas: BillboardAtlas,
    camera: Camera3D,
    vp: Mat4,
    viewportW: number,
    viewportH: number,
    fog?: { color: Vec3; near: number; far: number },
  ): void;
  /** Destroy GPU resources */
  destroy(): void;
}

// ---- Constants ----

// Floats per instance: worldPos(4) + velocity(4) + frame(4) + anim(4) + props(4) + override(4) = 24
const FLOATS_PER_INSTANCE = 24;
const MAX_SPRITES = 4096;

// ---- Create Billboard System ----

export function createBillboardSystem(gl: WebGL2RenderingContext, spriteMode: '4dir' | '8dir' = '4dir'): BillboardSystem {
  const shader = compileShader(
    gl,
    billboardVertexShader,
    billboardFragmentShader,
    [
      'u_viewProj', 'u_cameraPos', 'u_cameraRight', 'u_cameraUp',
      'u_time', 'u_atlasSize', 'u_spriteMode', 'u_atlas',
      'u_fogColor', 'u_fogNear', 'u_fogFar', 'u_shadowPass',
    ],
    ['a_position', 'a_worldPos', 'a_velocity', 'a_frame', 'a_anim', 'a_props', 'a_override'],
  );

  // Quad geometry (two triangles)
  const quadVerts = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
  const quadIndices = new Uint16Array([0, 1, 2, 2, 1, 3]);

  const quadVBO = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

  const quadEBO = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadEBO);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIndices, gl.STATIC_DRAW);

  // Instance buffer
  const instanceBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, MAX_SPRITES * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);

  // VAO
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  // Quad vertices (location 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Instance attributes
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  const stride = FLOATS_PER_INSTANCE * 4;

  // location 1: worldPos (x, y, z, facing)
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);

  // location 2: velocity (vx, vy, vz, speed)
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(2, 1);

  // location 3: frame (u, v, w, h)
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32);
  gl.vertexAttribDivisor(3, 1);

  // location 4: anim (idleFrames, walkFrames, fps, flags)
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 48);
  gl.vertexAttribDivisor(4, 1);

  // location 5: props (scale, alpha, tint, spriteHeight)
  gl.enableVertexAttribArray(5);
  gl.vertexAttribPointer(5, 4, gl.FLOAT, false, stride, 64);
  gl.vertexAttribDivisor(5, 1);

  // location 6: override (startCol, frameCount, fps, elapsed)
  gl.enableVertexAttribArray(6);
  gl.vertexAttribPointer(6, 4, gl.FLOAT, false, stride, 80);
  gl.vertexAttribDivisor(6, 1);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quadEBO);

  gl.bindVertexArray(null);

  // Reusable instance data array
  const instanceData = new Float32Array(MAX_SPRITES * FLOATS_PER_INSTANCE);
  // Reusable view for packing flags
  const flagsView = new DataView(new ArrayBuffer(4));

  let startTime = 0;

  return {
    render(sprites, atlas, camera, vp, _viewportW, _viewportH, fog) {
      if (sprites.length === 0) return;
      if (startTime === 0) startTime = performance.now() / 1000;
      const time = performance.now() / 1000 - startTime;

      const count = Math.min(sprites.length, MAX_SPRITES);

      // Compute camera vectors for billboarding
      const forward = vec3Normalize(vec3Sub(camera.target, camera.position));
      const worldUp: Vec3 = [0, 1, 0];
      const right = vec3Normalize(vec3Cross(forward, worldUp));
      // Use worldUp directly for upright billboards (sprites don't tilt with camera)

      // Pack instance data
      for (let i = 0; i < count; i++) {
        const s = sprites[i];
        const off = i * FLOATS_PER_INSTANCE;

        // worldPos + facing (original terrain height, no offset)
        instanceData[off] = s.x;
        instanceData[off + 1] = s.y;
        instanceData[off + 2] = s.z;
        instanceData[off + 3] = s.facing;

        // velocity slot: pack terrain normal + groundOffset + speed
        // x = terrainNormalX, y = groundOffset, z = terrainNormalZ, w = speed
        instanceData[off + 4] = s.terrainNormalX || 0;
        instanceData[off + 5] = s.groundOffset || 0;
        instanceData[off + 6] = s.terrainNormalZ || 0;
        instanceData[off + 7] = s.speed;

        // frame
        instanceData[off + 8] = s.frameX;
        instanceData[off + 9] = s.frameY;
        instanceData[off + 10] = s.frameW;
        instanceData[off + 11] = s.frameH;

        // anim
        instanceData[off + 12] = s.idleFrames;
        instanceData[off + 13] = s.walkFrames;
        instanceData[off + 14] = s.fps;
        // Pack flags
        let flags = 0;
        if (s.flipX) flags |= 2;
        flagsView.setUint32(0, flags, true);
        instanceData[off + 15] = flagsView.getFloat32(0, true);

        // props
        instanceData[off + 16] = s.scale;
        instanceData[off + 17] = s.alpha;
        // Pack tint
        flagsView.setUint32(0, s.tint, true);
        instanceData[off + 18] = flagsView.getFloat32(0, true);
        instanceData[off + 19] = s.spriteHeight;

        // override
        const overrideActive = s.animOverrideTime > 0 && s.animOverrideFrames > 0;
        if (overrideActive) {
          const elapsed = time - (s.animOverrideTime - startTime);
          const duration = s.animOverrideFrames / (s.animOverrideFps || 12);
          if (elapsed >= 0 && elapsed < duration) {
            instanceData[off + 20] = s.animOverrideStart;
            instanceData[off + 21] = s.animOverrideFrames;
            instanceData[off + 22] = s.animOverrideFps || 12;
            instanceData[off + 23] = elapsed;
          } else {
            // Override expired
            instanceData[off + 20] = 0;
            instanceData[off + 21] = 0;
            instanceData[off + 22] = 0;
            instanceData[off + 23] = 0;
          }
        } else {
          instanceData[off + 20] = 0;
          instanceData[off + 21] = 0;
          instanceData[off + 22] = 0;
          instanceData[off + 23] = 0;
        }
      }

      // Upload
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData, 0, count * FLOATS_PER_INSTANCE);

      // Render
      gl.useProgram(shader.program);

      gl.uniformMatrix4fv(shader.uniforms.u_viewProj, false, vp);
      gl.uniform3fv(shader.uniforms.u_cameraPos, camera.position);
      gl.uniform3fv(shader.uniforms.u_cameraRight, right);
      gl.uniform3fv(shader.uniforms.u_cameraUp, worldUp); // Use world up for upright billboards
      gl.uniform1f(shader.uniforms.u_time, time);
      gl.uniform2f(shader.uniforms.u_atlasSize, atlas.width, atlas.height);
      gl.uniform1i(shader.uniforms.u_spriteMode, spriteMode === '8dir' ? 1 : 0);

      // Fog
      if (fog) {
        gl.uniform3fv(shader.uniforms.u_fogColor, fog.color);
        gl.uniform1f(shader.uniforms.u_fogNear, fog.near);
        gl.uniform1f(shader.uniforms.u_fogFar, fog.far);
      } else {
        gl.uniform3f(shader.uniforms.u_fogColor, 0.6, 0.7, 0.85);
        gl.uniform1f(shader.uniforms.u_fogNear, 1000);
        gl.uniform1f(shader.uniforms.u_fogFar, 1001);
      }

      // Texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
      gl.uniform1i(shader.uniforms.u_atlas, 0);

      gl.bindVertexArray(vao);

      // Pass 1: Shadows (flat ground ellipses)
      gl.uniform1i(shader.uniforms.u_shadowPass, 1);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, count);

      // Pass 2: Sprites (camera-facing quads)
      gl.uniform1i(shader.uniforms.u_shadowPass, 0);
      gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0, count);

      gl.bindVertexArray(null);
    },

    destroy() {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(quadVBO);
      gl.deleteBuffer(quadEBO);
      gl.deleteBuffer(instanceBuffer);
      gl.deleteProgram(shader.program);
    },
  };
}
