/**
 * 3D model rendering system for loaded meshes.
 *
 * Renders glTF models at world positions with per-instance transforms.
 * Uses the same vertex format and lighting as the mesh system.
 */

import { compileShader } from './renderer';
import { meshVertexShader, meshFragmentShader } from './shaders/mesh';
import { vec3Normalize, type Mat4 } from './math3d';
import type { Camera3D } from './terrain';
import type { GltfModel, GltfPrimitive } from './loaders/gltf';

// ---- Public Types ----

export interface ModelInstance {
  modelId: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale?: number;
}

export interface ModelSystem {
  /** Upload a loaded model to the GPU */
  addModel(id: string, model: GltfModel): void;
  /** Remove a model and free its GPU resources */
  removeModel(id: string): void;
  /** Set instance placements for rendering */
  setInstances(instances: ModelInstance[]): void;
  /** Render all model instances */
  render(camera: Camera3D, vp: Mat4, viewportW: number, viewportH: number): void;
  /** Clean up all GPU resources */
  destroy(): void;
}

// ---- Internal Types ----

interface CompiledPrimitive {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
  indexCount: number;
  indexType: number; // gl.UNSIGNED_SHORT or gl.UNSIGNED_INT
  indexed: boolean;
  texture: WebGLTexture | null;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer | null;
}

interface CompiledModel {
  primitives: CompiledPrimitive[];
}

// ---- Model Matrix ----

function modelMatrix(x: number, y: number, z: number, rotation: number, scale: number): Mat4 {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const m = new Float32Array(16);
  m[0] = c * scale;  m[2] = s * scale;
  m[5] = scale;
  m[8] = -s * scale; m[10] = c * scale;
  m[12] = x; m[13] = y; m[14] = z;
  m[15] = 1;
  return m;
}

// ---- Create Model System ----

/**
 * Create a system for rendering loaded 3D models.
 *
 * Models are registered with `addModel()` then placed in the world
 * via `setInstances()`. Uses Lambert diffuse lighting and distance fog.
 *
 * @param gl - WebGL2 context (must have depth buffer enabled)
 * @param options - Optional texture filtering mode
 */
export function createModelSystem(
  gl: WebGL2RenderingContext,
  options?: { filter?: 'nearest' | 'linear' },
): ModelSystem {
  const shader = compileShader(gl, meshVertexShader, meshFragmentShader,
    ['u_viewProj', 'u_model', 'u_texture', 'u_lightDir', 'u_ambientColor', 'u_lightColor', 'u_fogColor', 'u_fogNear', 'u_fogFar', 'u_cameraPos'],
    ['a_position', 'a_normal', 'a_uv'],
  );

  const filterMode = options?.filter === 'linear' ? gl.LINEAR : gl.NEAREST;
  const models = new Map<string, CompiledModel>();
  let instances: ModelInstance[] = [];

  // 1x1 white texture for untextured primitives
  const whiteTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, whiteTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));

  function compilePrimitive(prim: GltfPrimitive): CompiledPrimitive {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, prim.vertices, gl.STATIC_DRAW);

    const stride = 8 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);

    let ibo: WebGLBuffer | null = null;
    let indexType: number = gl.UNSIGNED_SHORT;
    if (prim.indices) {
      ibo = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, prim.indices, gl.STATIC_DRAW);
      indexType = prim.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }

    gl.bindVertexArray(null);

    let texture: WebGLTexture | null = null;
    if (prim.texture) {
      texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, prim.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterMode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterMode);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }

    return {
      vao, vertexCount: prim.vertexCount, indexCount: prim.indexCount,
      indexType, indexed: prim.indices !== null, texture, vbo, ibo,
    };
  }

  function freePrimitive(prim: CompiledPrimitive) {
    gl.deleteVertexArray(prim.vao);
    gl.deleteBuffer(prim.vbo);
    if (prim.ibo) gl.deleteBuffer(prim.ibo);
    if (prim.texture) gl.deleteTexture(prim.texture);
  }

  return {
    addModel(id: string, model: GltfModel) {
      // Free existing model with same id
      const existing = models.get(id);
      if (existing) {
        for (const p of existing.primitives) freePrimitive(p);
      }
      models.set(id, {
        primitives: model.primitives.map(compilePrimitive),
      });
    },

    removeModel(id: string) {
      const model = models.get(id);
      if (model) {
        for (const p of model.primitives) freePrimitive(p);
        models.delete(id);
      }
    },

    setInstances(insts: ModelInstance[]) {
      instances = insts;
    },

    render(camera: Camera3D, vp: Mat4, _viewportW: number, _viewportH: number) {
      if (instances.length === 0) return;

      gl.useProgram(shader.program);
      gl.uniformMatrix4fv(shader.uniforms.u_viewProj, false, vp);

      const lightDir = vec3Normalize([0.3, 1.0, 0.5]);
      gl.uniform3fv(shader.uniforms.u_lightDir, lightDir);
      gl.uniform3f(shader.uniforms.u_ambientColor, 0.35, 0.35, 0.4);
      gl.uniform3f(shader.uniforms.u_lightColor, 1.0, 0.95, 0.85);
      gl.uniform3f(shader.uniforms.u_fogColor, 0.6, 0.7, 0.85);
      gl.uniform1f(shader.uniforms.u_fogNear, camera.far * 0.5);
      gl.uniform1f(shader.uniforms.u_fogFar, camera.far);
      gl.uniform3fv(shader.uniforms.u_cameraPos, camera.position);

      for (const inst of instances) {
        const model = models.get(inst.modelId);
        if (!model) continue;

        const mat = modelMatrix(inst.x, inst.y, inst.z, inst.rotation, inst.scale ?? 1);
        gl.uniformMatrix4fv(shader.uniforms.u_model, false, mat);

        for (const prim of model.primitives) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, prim.texture ?? whiteTex);
          gl.uniform1i(shader.uniforms.u_texture, 0);

          gl.bindVertexArray(prim.vao);

          if (prim.indexed) {
            gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.indexType, 0);
          } else {
            gl.drawArrays(gl.TRIANGLES, 0, prim.vertexCount);
          }
        }
      }

      gl.bindVertexArray(null);
    },

    destroy() {
      for (const [, model] of models) {
        for (const p of model.primitives) freePrimitive(p);
      }
      models.clear();
      gl.deleteTexture(whiteTex);
      gl.deleteProgram(shader.program);
    },
  };
}
