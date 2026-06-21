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
import { waterVertexShader, waterFragmentShader } from './shaders/water';

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
  /** Water surface height in world units. Set to render a water plane. */
  waterHeight?: number;
  /** Hard texture transitions (no blending). Good for dungeons. */
  hardBlend?: boolean;
  /** Stepped terrain: flat cells with vertical walls between heights. No slopes. */
  stepped?: boolean;
  /** Water/lava style. Defaults to blue water. */
  waterStyle?: {
    deepColor?: [number, number, number];
    shallowColor?: [number, number, number];
    alpha?: number;
    speed?: number;
    emissive?: number; // 0 = water, 1 = full lava glow
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
  /** Get terrain normal at world position (for slope-conforming shadows) */
  getNormal(worldX: number, worldZ: number): Vec3;
  /** Check if a world position is underwater */
  isWater(worldX: number, worldZ: number): boolean;
  /** Get the current MVP matrix (for projecting sprites) */
  getMVP(): Mat4;
  /** Get the current view-projection matrix */
  getVP(): Mat4;
  /** Project a 3D world position to 2D screen coords */
  projectToScreen(pos: Vec3, viewportW: number, viewportH: number): [number, number, number] | null;
  /** Update water/lava visual style at runtime */
  setWaterStyle(style: TerrainConfig['waterStyle']): void;
  /** Swap splatmap textures at runtime (for dungeon themes) */
  setSplatTextures(textures: TerrainConfig['splatTextures']): void;
  /** Toggle hard texture blending (sharp cutoffs for dungeons) */
  setHardBlend(enabled: boolean): void;
  /** Toggle stepped terrain (flat cells with vertical walls, no slopes) */
  setStepped(enabled: boolean): void;
  /** Get terrain dimensions in world units */
  getWorldSize(): [number, number];
  /** Modify heightmap and rebuild mesh. Callback receives the heightmap array for mutation. */
  modifyHeightmap(fn: (heightmap: number[][]) => void): void;
  /** Get the raw heightmap data (for export) */
  getHeightmap(): number[][];
  /** Destroy GPU resources */
  destroy(): void;
}

// ---- Terrain Mesh Generation ----

interface TerrainMesh {
  vao: WebGLVertexArrayObject;
  indexCount: number;
  vertexCount: number;
  vertexBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer | null;
  stepped: boolean;
}

function generateTerrainVertices(
  heightmap: number[][], cellSize: number, maxHeight: number, textureRepeat: number,
): Float32Array {
  const rows = heightmap.length;
  const cols = heightmap[0].length;
  const vertices = new Float32Array(rows * cols * 8);

  for (let z = 0; z < rows; z++) {
    for (let x = 0; x < cols; x++) {
      const idx = (z * cols + x) * 8;
      const worldX = x * cellSize;
      const worldZ = z * cellSize;
      const height = heightmap[z][x] * maxHeight;
      vertices[idx] = worldX;
      vertices[idx + 1] = height;
      vertices[idx + 2] = worldZ;
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
      vertices[idx + 6] = (x / (cols - 1)) * textureRepeat;
      vertices[idx + 7] = (z / (rows - 1)) * textureRepeat;
    }
  }
  return vertices;
}

/**
 * Stepped terrain: each cell is a flat quad at its own height.
 * No shared vertices = no slopes. Vertical walls between different heights.
 * 6 verts per cell top + up to 24 for side walls = 30 verts per cell.
 */
function generateSteppedVertices(
  heightmap: number[][], cellSize: number, maxHeight: number, textureRepeat: number,
): { vertices: Float32Array; vertexCount: number } {
  const rows = heightmap.length;
  const cols = heightmap[0].length;
  // Worst case: each cell has top quad (6 verts) + 4 side walls (6 verts each) = 30
  const maxVerts = rows * cols * 30;
  const verts = new Float32Array(maxVerts * 8);
  let vi = 0;

  function pushVert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    const i = vi * 8;
    verts[i] = x; verts[i+1] = y; verts[i+2] = z;
    verts[i+3] = nx; verts[i+4] = ny; verts[i+5] = nz;
    verts[i+6] = u; verts[i+7] = v;
    vi++;
  }

  function pushQuad(
    x0: number, y0: number, z0: number,
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    x3: number, y3: number, z3: number,
    nx: number, ny: number, nz: number,
    u0: number, v0: number, u1: number, v1: number,
  ) {
    pushVert(x0, y0, z0, nx, ny, nz, u0, v1);
    pushVert(x1, y1, z1, nx, ny, nz, u1, v1);
    pushVert(x2, y2, z2, nx, ny, nz, u1, v0);
    pushVert(x0, y0, z0, nx, ny, nz, u0, v1);
    pushVert(x2, y2, z2, nx, ny, nz, u1, v0);
    pushVert(x3, y3, z3, nx, ny, nz, u0, v0);
  }

  for (let z = 0; z < rows - 1; z++) {
    for (let x = 0; x < cols - 1; x++) {
      const h = heightmap[z][x] * maxHeight;
      const wx = x * cellSize;
      const wz = z * cellSize;
      const wx1 = (x + 1) * cellSize;
      const wz1 = (z + 1) * cellSize;
      const u0 = (x / (cols - 1)) * textureRepeat;
      const u1 = ((x + 1) / (cols - 1)) * textureRepeat;
      const v0 = (z / (rows - 1)) * textureRepeat;
      const v1 = ((z + 1) / (rows - 1)) * textureRepeat;

      // Top face (flat quad at cell height)
      pushQuad(wx, h, wz1, wx1, h, wz1, wx1, h, wz, wx, h, wz, 0, 1, 0, u0, v0, u1, v1);

      // Side walls — UVs: 1 tile per cell width, scale height to match
      const wallTile = 0.5; // Half a texture repeat per cell = bigger bricks
      // East neighbor
      if (x + 1 < cols) {
        const hE = heightmap[z][x + 1] * maxHeight;
        if (hE < h) {
          const wallH = (h - hE) / cellSize * wallTile;
          pushQuad(wx1, h, wz, wx1, h, wz1, wx1, hE, wz1, wx1, hE, wz, 1, 0, 0, 0, 0, wallTile, wallH);
        }
      }
      // West
      if (x > 0) {
        const hW = heightmap[z][x - 1] * maxHeight;
        if (hW < h) {
          const wallH = (h - hW) / cellSize * wallTile;
          pushQuad(wx, h, wz1, wx, h, wz, wx, hW, wz, wx, hW, wz1, -1, 0, 0, 0, 0, wallTile, wallH);
        }
      }
      // South
      if (z + 1 < rows) {
        const hS = heightmap[z + 1][x] * maxHeight;
        if (hS < h) {
          const wallH = (h - hS) / cellSize * wallTile;
          pushQuad(wx1, h, wz1, wx, h, wz1, wx, hS, wz1, wx1, hS, wz1, 0, 0, 1, 0, 0, wallTile, wallH);
        }
      }
      // North
      if (z > 0) {
        const hN = heightmap[z - 1][x] * maxHeight;
        if (hN < h) {
          const wallH = (h - hN) / cellSize * wallTile;
          pushQuad(wx, h, wz, wx1, h, wz, wx1, hN, wz, wx, hN, wz, 0, 0, -1, 0, 0, wallTile, wallH);
        }
      }
    }
  }

  return { vertices: verts.subarray(0, vi * 8), vertexCount: vi };
}

function buildTerrainMesh(
  gl: WebGL2RenderingContext,
  heightmap: number[][],
  cellSize: number,
  maxHeight: number,
  textureRepeat: number,
  stepped = false,
): TerrainMesh {
  const rows = heightmap.length;
  const cols = heightmap[0].length;

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const vertexBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

  let indexCount = 0;
  let vertexCount = 0;
  let indexBuffer: WebGLBuffer | null = null;

  if (stepped) {
    // Stepped: each cell = flat quad + vertical side walls. No shared vertices.
    const result = generateSteppedVertices(heightmap, cellSize, maxHeight, textureRepeat);
    gl.bufferData(gl.ARRAY_BUFFER, result.vertices, gl.DYNAMIC_DRAW);
    vertexCount = result.vertexCount;
  } else {
    // Smooth: shared vertices, indexed triangles
    const vertices = generateTerrainVertices(heightmap, cellSize, maxHeight, textureRepeat);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

    const cellRows = rows - 1;
    const cellCols = cols - 1;
    indexCount = cellRows * cellCols * 6;
    const indices = new Uint32Array(indexCount);
    let idx = 0;
    for (let z = 0; z < cellRows; z++) {
      for (let x = 0; x < cellCols; x++) {
        const topLeft = z * cols + x;
        const topRight = topLeft + 1;
        const bottomLeft = (z + 1) * cols + x;
        const bottomRight = bottomLeft + 1;
        indices[idx++] = topLeft;
        indices[idx++] = bottomLeft;
        indices[idx++] = topRight;
        indices[idx++] = topRight;
        indices[idx++] = bottomLeft;
        indices[idx++] = bottomRight;
      }
    }
    indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  }

  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);

  gl.bindVertexArray(null);

  return { vao, indexCount, vertexCount, vertexBuffer, indexBuffer, stepped };
}

// ---- Height Query ----

function sampleHeight(heightmap: number[][], cellSize: number, maxHeight: number, worldX: number, worldZ: number, stepped = false): number {
  const cols = heightmap[0].length;
  const rows = heightmap.length;

  const gx = worldX / cellSize;
  const gz = worldZ / cellSize;

  const x0 = Math.max(0, Math.min(Math.floor(gx), cols - 2));
  const z0 = Math.max(0, Math.min(Math.floor(gz), rows - 2));

  if (stepped) {
    // Snap to cell height — no interpolation
    return heightmap[z0][x0] * maxHeight;
  }

  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const fx = gx - x0;
  const fz = gz - z0;

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
  const { heightmap, cellSize, maxHeight, texture, textureRepeat = 8, waterHeight } = config;

  const shader = compileShader(
    gl,
    terrainVertexShader,
    terrainFragmentShader,
    [
      'u_mvp', 'u_texture', 'u_lightDir', 'u_ambientColor', 'u_lightColor',
      'u_fogColor', 'u_fogNear', 'u_fogFar', 'u_cameraPos', 'u_maxHeight',
      'u_texLow', 'u_texMid', 'u_texSteep', 'u_texHigh', 'u_useSplatmap', 'u_waterHeightNorm', 'u_hardBlend',
    ],
    ['a_position', 'a_normal', 'a_uv'],
  );

  // splatTextures read from config.splatTextures at render time (can be swapped)

  const mesh = buildTerrainMesh(gl, heightmap, cellSize, maxHeight, textureRepeat);

  const rows = heightmap.length;
  const cols = heightmap[0].length;
  const worldWidth = (cols - 1) * cellSize;
  const worldDepth = (rows - 1) * cellSize;

  // Water plane setup
  let waterShader: ReturnType<typeof compileShader> | null = null;
  let waterVAO: WebGLVertexArrayObject | null = null;
  let waterVBO: WebGLBuffer | null = null;

  if (waterHeight != null) {
    waterShader = compileShader(gl, waterVertexShader, waterFragmentShader,
      ['u_mvp', 'u_worldSize', 'u_waterHeight', 'u_time', 'u_cameraPos', 'u_fogColor', 'u_fogNear', 'u_fogFar', 'u_deepColor', 'u_shallowColor', 'u_alpha', 'u_speed', 'u_emissive'],
      ['a_position'],
    );
    const quadVerts = new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]);
    waterVAO = gl.createVertexArray()!;
    gl.bindVertexArray(waterVAO);
    waterVBO = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, waterVBO);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  let startTime = 0;

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
      if (config.splatTextures) {
        gl.uniform1i(shader.uniforms.u_useSplatmap, 1);
        gl.uniform1i(shader.uniforms.u_hardBlend, config.hardBlend ? 1 : 0);
        gl.uniform1f(shader.uniforms.u_waterHeightNorm, waterHeight != null ? waterHeight / maxHeight : 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(shader.uniforms.u_texture, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, config.splatTextures.low);
        gl.uniform1i(shader.uniforms.u_texLow, 1);

        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, config.splatTextures.mid);
        gl.uniform1i(shader.uniforms.u_texMid, 2);

        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, config.splatTextures.steep);
        gl.uniform1i(shader.uniforms.u_texSteep, 3);

        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, config.splatTextures.high);
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
      if (mesh.stepped) {
        gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
      } else {
        gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
      }
      gl.bindVertexArray(null);

      // Draw water plane
      if (waterShader && waterVAO && waterHeight != null) {
        if (startTime === 0) startTime = performance.now() / 1000;
        const time = performance.now() / 1000 - startTime;

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.useProgram(waterShader.program);
        gl.uniformMatrix4fv(waterShader.uniforms.u_mvp, false, vp);
        gl.uniform2f(waterShader.uniforms.u_worldSize, worldWidth, worldDepth);
        gl.uniform1f(waterShader.uniforms.u_waterHeight, waterHeight);
        gl.uniform1f(waterShader.uniforms.u_time, time);
        gl.uniform3fv(waterShader.uniforms.u_cameraPos, camera.position);
        gl.uniform3f(waterShader.uniforms.u_fogColor, 0.6, 0.7, 0.85);
        gl.uniform1f(waterShader.uniforms.u_fogNear, camera.far * 0.5);
        gl.uniform1f(waterShader.uniforms.u_fogFar, camera.far);

        // Water style (defaults to blue water)
        const ws = config.waterStyle;
        gl.uniform3fv(waterShader.uniforms.u_deepColor, ws?.deepColor ?? [0.1, 0.25, 0.45]);
        gl.uniform3fv(waterShader.uniforms.u_shallowColor, ws?.shallowColor ?? [0.2, 0.4, 0.6]);
        gl.uniform1f(waterShader.uniforms.u_alpha, ws?.alpha ?? 0.7);
        gl.uniform1f(waterShader.uniforms.u_speed, ws?.speed ?? 1.0);
        gl.uniform1f(waterShader.uniforms.u_emissive, ws?.emissive ?? 0.0);

        gl.bindVertexArray(waterVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.bindVertexArray(null);
      }
    },

    getHeight(worldX: number, worldZ: number): number {
      return sampleHeight(heightmap, cellSize, maxHeight, worldX, worldZ, mesh.stepped);
    },

    getNormal(worldX: number, worldZ: number): Vec3 {
      const d = cellSize;
      const hL = sampleHeight(heightmap, cellSize, maxHeight, worldX - d, worldZ);
      const hR = sampleHeight(heightmap, cellSize, maxHeight, worldX + d, worldZ);
      const hD = sampleHeight(heightmap, cellSize, maxHeight, worldX, worldZ - d);
      const hU = sampleHeight(heightmap, cellSize, maxHeight, worldX, worldZ + d);
      const nx = hL - hR;
      const nz = hD - hU;
      const ny = 2 * d;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      return [nx / len, ny / len, nz / len];
    },

    modifyHeightmap(fn: (hm: number[][]) => void) {
      fn(heightmap);
      gl.bindVertexArray(mesh.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
      if (mesh.stepped) {
        const result = generateSteppedVertices(heightmap, cellSize, maxHeight, textureRepeat);
        gl.bufferData(gl.ARRAY_BUFFER, result.vertices, gl.DYNAMIC_DRAW);
        mesh.vertexCount = result.vertexCount;
      } else {
        const newVerts = generateTerrainVertices(heightmap, cellSize, maxHeight, textureRepeat);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, newVerts);
      }
      gl.bindVertexArray(null);
    },

    getHeightmap(): number[][] {
      return heightmap;
    },

    setWaterStyle(style: TerrainConfig['waterStyle']) {
      config.waterStyle = style;
    },

    setSplatTextures(textures: TerrainConfig['splatTextures']) {
      config.splatTextures = textures;
    },

    setHardBlend(enabled: boolean) {
      config.hardBlend = enabled;
    },

    setStepped(enabled: boolean) {
      if (mesh.stepped === enabled) return;
      mesh.stepped = enabled;
      // Rebuild mesh in new mode
      this.modifyHeightmap(() => {}); // Triggers rebuild with current data
    },

    isWater(worldX: number, worldZ: number): boolean {
      if (waterHeight == null) return false;
      return sampleHeight(heightmap, cellSize, maxHeight, worldX, worldZ, mesh.stepped) < waterHeight;
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
      if (waterVAO) gl.deleteVertexArray(waterVAO);
      if (waterVBO) gl.deleteBuffer(waterVBO);
      if (waterShader) gl.deleteProgram(waterShader.program);
    },
  };
}
