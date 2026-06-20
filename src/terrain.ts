/**
 * Heightmap terrain subsystem for Glyft.
 *
 * Renders a 3D terrain mesh from height data with perspective projection.
 * Designed to coexist with Glyft's 2D rendering — sprites and effects
 * project into 3D space via world-to-screen mapping.
 */

import { compileShader } from './renderer';
import {
  mat4Perspective,
  mat4LookAt,
  mat4Multiply,
  project,
  vec3,
  vec3Normalize,
  type Vec3,
  type Mat4,
} from './math3d';
import { terrainVertexShader, terrainFragmentShader } from './shaders/terrain';

// ---- Types ----

export interface TerrainConfig {
  /** Heightmap data: 2D array of heights (0..1 normalized) */
  heightmap: number[][];
  /** World-space size of each grid cell */
  cellSize: number;
  /** Maximum terrain height in world units */
  maxHeight: number;
  /** Primary texture (used when no splatmap textures provided) */
  texture: WebGLTexture;
  /** Texture dimensions for UV calculation */
  textureRepeat?: number;
  /** Splatmap textures — blended by height and slope when provided */
  splatTextures?: {
    /** Flat lowlands (default: sand) */
    low: WebGLTexture;
    /** Flat midlands (default: grass) */
    mid: WebGLTexture;
    /** Steep surfaces (default: rock) */
    steep: WebGLTexture;
    /** High elevations (default: snow) */
    high: WebGLTexture;
  };
}

export interface Camera3D {
  /** Camera position in world space */
  position: Vec3;
  /** Point the camera looks at */
  target: Vec3;
  /** Field of view in radians */
  fov: number;
  /** Near clip plane */
  near: number;
  /** Far clip plane */
  far: number;
}

export interface TerrainSystem {
  /** Render the terrain */
  render(camera: Camera3D, viewportW: number, viewportH: number): void;
  /** Get terrain height at world position (bilinear interpolation) */
  getHeight(worldX: number, worldZ: number): number;
  /** Get the current MVP matrix (for projecting sprites) */
  getMVP(): Mat4;
  /** Get the current view-projection matrix */
  getVP(): Mat4;
  /** Project a 3D world position to 2D screen coords */
  projectToScreen(pos: Vec3, viewportW: number, viewportH: number): [number, number, number] | null;
  /** Get terrain dimensions in world units */
  getWorldSize(): [number, number];
  /** Destroy GPU resources */
  destroy(): void;
}

// ---- Terrain Mesh Generation ----

interface TerrainMesh {
  vao: WebGLVertexArrayObject;
  indexCount: number;
  vertexBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
}

function buildTerrainMesh(
  gl: WebGL2RenderingContext,
  heightmap: number[][],
  cellSize: number,
  maxHeight: number,
  textureRepeat: number,
): TerrainMesh {
  const rows = heightmap.length;
  const cols = heightmap[0].length;

  // Vertex layout: position (3) + normal (3) + uv (2) = 8 floats per vertex
  const vertexCount = rows * cols;
  const vertices = new Float32Array(vertexCount * 8);

  // Generate vertices
  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const idx = (z * cols + x) * 8;
      const worldX = x * cellSize;
      const worldZ = z * cellSize;
      const height = heightmap[z][x] * maxHeight;

      // Position
      vertices[idx] = worldX;
      vertices[idx + 1] = height;
      vertices[idx + 2] = worldZ;

      // Normal (computed from finite differences)
      const hL = x > 0 ? heightmap[z][x - 1] * maxHeight : height;
      const hR = x < cols - 1 ? heightmap[z][x + 1] * maxHeight : height;
      const hD = z > 0 ? heightmap[z - 1][x] * maxHeight : height;
      const hU = z < rows - 1 ? heightmap[z + 1][x] * maxHeight : height;
      const nx = hL - hR;
      const nz = hD - hU;
      const ny = 2.0 * cellSize;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      vertices[idx + 3] = nx / len;
      vertices[idx + 4] = ny / len;
      vertices[idx + 5] = nz / len;

      // UV (tiled)
      vertices[idx + 6] = (x / (cols - 1)) * textureRepeat;
      vertices[idx + 7] = (z / (rows - 1)) * textureRepeat;
    }
  }

  // Generate indices (two triangles per cell)
  const cellRows = rows - 1;
  const cellCols = cols - 1;
  const indexCount = cellRows * cellCols * 6;
  const indices = new Uint32Array(indexCount);
  let idx = 0;

  for (let z = 0; z < cellRows; z++) {
    for (let x = 0; x < cellCols; x++) {
      const topLeft = z * cols + x;
      const topRight = topLeft + 1;
      const bottomLeft = (z + 1) * cols + x;
      const bottomRight = bottomLeft + 1;

      // Triangle 1
      indices[idx++] = topLeft;
      indices[idx++] = bottomLeft;
      indices[idx++] = topRight;

      // Triangle 2
      indices[idx++] = topRight;
      indices[idx++] = bottomLeft;
      indices[idx++] = bottomRight;
    }
  }

  // Upload to GPU
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const vertexBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  // Position (location 0)
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);

  // Normal (location 1)
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);

  // UV (location 2)
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);

  const indexBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  return { vao, indexCount, vertexBuffer, indexBuffer };
}

// ---- Height Query ----

function sampleHeight(heightmap: number[][], cellSize: number, maxHeight: number, worldX: number, worldZ: number): number {
  const cols = heightmap[0].length;
  const rows = heightmap.length;

  // Convert world pos to grid pos
  const gx = worldX / cellSize;
  const gz = worldZ / cellSize;

  // Clamp to grid bounds
  const x0 = Math.max(0, Math.min(Math.floor(gx), cols - 2));
  const z0 = Math.max(0, Math.min(Math.floor(gz), rows - 2));
  const x1 = x0 + 1;
  const z1 = z0 + 1;

  // Fractional part for interpolation
  const fx = gx - x0;
  const fz = gz - z0;

  // Bilinear interpolation
  const h00 = heightmap[z0][x0];
  const h10 = heightmap[z0][x1];
  const h01 = heightmap[z1][x0];
  const h11 = heightmap[z1][x1];

  const h0 = h00 + (h10 - h00) * fx;
  const h1 = h01 + (h11 - h01) * fx;
  const h = h0 + (h1 - h0) * fz;

  return h * maxHeight;
}

// ---- Create Terrain System ----

export function createTerrainSystem(gl: WebGL2RenderingContext, config: TerrainConfig): TerrainSystem {
  const { heightmap, cellSize, maxHeight, texture, textureRepeat = 8, splatTextures } = config;

  const shader = compileShader(
    gl,
    terrainVertexShader,
    terrainFragmentShader,
    [
      'u_mvp', 'u_texture', 'u_lightDir', 'u_ambientColor', 'u_lightColor',
      'u_fogColor', 'u_fogNear', 'u_fogFar', 'u_cameraPos', 'u_maxHeight',
      'u_texLow', 'u_texMid', 'u_texSteep', 'u_texHigh', 'u_useSplatmap',
    ],
    ['a_position', 'a_normal', 'a_uv'],
  );

  const useSplatmap = !!splatTextures;

  const mesh = buildTerrainMesh(gl, heightmap, cellSize, maxHeight, textureRepeat);

  const rows = heightmap.length;
  const cols = heightmap[0].length;
  const worldWidth = (cols - 1) * cellSize;
  const worldDepth = (rows - 1) * cellSize;

  // Cached matrices
  let cachedMVP: Mat4 = new Float32Array(16);
  let cachedVP: Mat4 = new Float32Array(16);

  return {
    render(camera: Camera3D, viewportW: number, viewportH: number) {
      const aspect = viewportW / viewportH;
      const proj = mat4Perspective(camera.fov, aspect, camera.near, camera.far);
      const view = mat4LookAt(camera.position, camera.target, vec3(0, 1, 0));
      const vp = mat4Multiply(proj, view);

      cachedMVP = vp; // No model transform (terrain at origin)
      cachedVP = vp;

      // Enable depth testing for 3D rendering
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      gl.useProgram(shader.program);

      // MVP matrix
      gl.uniformMatrix4fv(shader.uniforms.u_mvp, false, vp);

      // Height uniform for splatmap blending
      gl.uniform1f(shader.uniforms.u_maxHeight, maxHeight);

      // Textures
      if (useSplatmap && splatTextures) {
        gl.uniform1i(shader.uniforms.u_useSplatmap, 1);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(shader.uniforms.u_texture, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, splatTextures.low);
        gl.uniform1i(shader.uniforms.u_texLow, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, splatTextures.mid);
        gl.uniform1i(shader.uniforms.u_texMid, 2);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, splatTextures.steep);
        gl.uniform1i(shader.uniforms.u_texSteep, 3);

        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, splatTextures.high);
        gl.uniform1i(shader.uniforms.u_texHigh, 4);
      } else {
        gl.uniform1i(shader.uniforms.u_useSplatmap, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(shader.uniforms.u_texture, 0);
      }

      // Directional light (sun from above-right)
      const lightDir = vec3Normalize(vec3(0.3, 1.0, 0.5));
      gl.uniform3fv(shader.uniforms.u_lightDir, lightDir);
      gl.uniform3f(shader.uniforms.u_ambientColor, 0.3, 0.3, 0.35);
      gl.uniform3f(shader.uniforms.u_lightColor, 1.0, 0.95, 0.85);

      // Fog
      gl.uniform3f(shader.uniforms.u_fogColor, 0.6, 0.7, 0.85);
      gl.uniform1f(shader.uniforms.u_fogNear, camera.far * 0.5);
      gl.uniform1f(shader.uniforms.u_fogFar, camera.far);
      gl.uniform3fv(shader.uniforms.u_cameraPos, camera.position);

      // Draw terrain
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    },

    getHeight(worldX: number, worldZ: number): number {
      return sampleHeight(heightmap, cellSize, maxHeight, worldX, worldZ);
    },

    getMVP(): Mat4 {
      return cachedMVP;
    },

    getVP(): Mat4 {
      return cachedVP;
    },

    projectToScreen(pos: Vec3, viewportW: number, viewportH: number) {
      return project(pos, cachedMVP, viewportW, viewportH);
    },

    getWorldSize(): [number, number] {
      return [worldWidth, worldDepth];
    },

    destroy() {
      gl.deleteVertexArray(mesh.vao);
      gl.deleteBuffer(mesh.vertexBuffer);
      gl.deleteBuffer(mesh.indexBuffer);
      gl.deleteProgram(shader.program);
    },
  };
}
