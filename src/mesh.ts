/**
 * Simple 3D mesh system for buildings and props.
 *
 * Renders textured box and roof primitives from a tile atlas.
 * Each face maps to a tile index in the atlas. Buildings are
 * defined as JSON and instanced at world positions.
 */

import { compileShader } from './renderer';
import { meshVertexShader, meshFragmentShader } from './shaders/mesh';
import { vec3Normalize, type Vec3, type Mat4 } from './math3d';
import type { Camera3D } from './terrain';

// ---- Types ----

export interface MeshPart {
  type: 'box' | 'roof' | 'wedge';
  position: [number, number, number];
  size: [number, number, number]; // width(x), height(y), depth(z)
  rotation?: number;
  faces: Record<string, number>; // face name → tile index
  /** For wedge: which direction the ramp descends toward. 'north'|'south'|'east'|'west' */
  direction?: 'north' | 'south' | 'east' | 'west';
}

export interface BuildingDef {
  id: string;
  parts: MeshPart[];
}

export interface BuildingInstance {
  defId: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
}

export interface MeshSystem {
  defineBuilding(id: string, parts: MeshPart[]): void;
  placeBuildings(instances: BuildingInstance[]): void;
  render(camera: Camera3D, vp: Mat4, viewportW: number, viewportH: number): void;
  /** Check if a world position is inside any building footprint */
  isBlocked(worldX: number, worldZ: number): boolean;
  destroy(): void;
}

// ---- Mesh Generation ----

const FLOATS_PER_VERTEX = 8; // pos(3) + normal(3) + uv(2)

function tileUV(tileIndex: number, tilesPerRow: number, tileSize: number, atlasSize: number): [number, number, number, number] {
  const col = tileIndex % tilesPerRow;
  const row = Math.floor(tileIndex / tilesPerRow);
  const u0 = (col * tileSize) / atlasSize;
  const v0 = (row * tileSize) / atlasSize;
  const u1 = ((col + 1) * tileSize) / atlasSize;
  const v1 = ((row + 1) * tileSize) / atlasSize;
  return [u0, v0, u1, v1];
}

function pushQuad(
  verts: number[],
  p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3,
  normal: Vec3,
  uv: [number, number, number, number],
) {
  const [u0, v0, u1, v1] = uv;
  // Triangle 1: p0, p1, p2
  verts.push(p0[0], p0[1], p0[2], normal[0], normal[1], normal[2], u0, v1);
  verts.push(p1[0], p1[1], p1[2], normal[0], normal[1], normal[2], u1, v1);
  verts.push(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], u1, v0);
  // Triangle 2: p0, p2, p3
  verts.push(p0[0], p0[1], p0[2], normal[0], normal[1], normal[2], u0, v1);
  verts.push(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], u1, v0);
  verts.push(p3[0], p3[1], p3[2], normal[0], normal[1], normal[2], u0, v0);
}

function pushTriangle(
  verts: number[],
  p0: Vec3, p1: Vec3, p2: Vec3,
  normal: Vec3,
  uv: [number, number, number, number],
) {
  const [u0, v0, u1, v1] = uv;
  const uMid = (u0 + u1) / 2;
  verts.push(p0[0], p0[1], p0[2], normal[0], normal[1], normal[2], uMid, v0);
  verts.push(p1[0], p1[1], p1[2], normal[0], normal[1], normal[2], u0, v1);
  verts.push(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], u1, v1);
}

function generateBox(
  verts: number[],
  ox: number, oy: number, oz: number,
  w: number, h: number, d: number,
  faces: Record<string, number>,
  tilesPerRow: number, tileSize: number, atlasSize: number,
) {
  const hw = w / 2, hd = d / 2;
  const x0 = ox - hw, x1 = ox + hw;
  const y0 = oy, y1 = oy + h;
  const z0 = oz - hd, z1 = oz + hd;

  const getUV = (face: string) => tileUV(faces[face] ?? 0, tilesPerRow, tileSize, atlasSize);

  // North face (negative Z)
  pushQuad(verts, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], getUV('north'));
  // South face (positive Z)
  pushQuad(verts, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], getUV('south'));
  // East face (positive X)
  pushQuad(verts, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], getUV('east'));
  // West face (negative X)
  pushQuad(verts, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], getUV('west'));
  // Top face
  pushQuad(verts, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], getUV('top'));
  // Bottom face
  pushQuad(verts, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], getUV('bottom'));
}

function generateRoof(
  verts: number[],
  ox: number, oy: number, oz: number,
  w: number, h: number, d: number,
  faces: Record<string, number>,
  tilesPerRow: number, tileSize: number, atlasSize: number,
) {
  const hw = w / 2, hd = d / 2;
  const x0 = ox - hw, x1 = ox + hw;
  const y0 = oy;
  const z0 = oz - hd, z1 = oz + hd;
  const apex = y0 + h;

  const getUV = (face: string) => tileUV(faces[face] ?? 0, tilesPerRow, tileSize, atlasSize);

  // Slope 1 (west-facing slope from ridge to west edge)
  const slopeNormW = vec3Normalize([-(h), hw, 0]);
  pushQuad(verts, [x0, y0, z0], [x0, y0, z1], [(x0 + x1) / 2, apex, z1], [(x0 + x1) / 2, apex, z0], slopeNormW, getUV('slope1'));

  // Slope 2 (east-facing slope from ridge to east edge)
  const slopeNormE = vec3Normalize([h, hw, 0]);
  pushQuad(verts, [x1, y0, z1], [x1, y0, z0], [(x0 + x1) / 2, apex, z0], [(x0 + x1) / 2, apex, z1], slopeNormE, getUV('slope2'));

  // Gable 1 (north triangle)
  pushTriangle(verts, [(x0 + x1) / 2, apex, z0], [x0, y0, z0], [x1, y0, z0], [0, 0, -1], getUV('gable1'));

  // Gable 2 (south triangle)
  pushTriangle(verts, [(x0 + x1) / 2, apex, z1], [x1, y0, z1], [x0, y0, z1], [0, 0, 1], getUV('gable2'));
}

// ---- Model Matrix ----

function generateWedge(
  verts: number[],
  ox: number, oy: number, oz: number,
  w: number, h: number, d: number,
  faces: Record<string, number>,
  direction: string,
  tilesPerRow: number, tileSize: number, atlasSize: number,
) {
  const hw = w / 2, hd = d / 2;
  const x0 = ox - hw, x1 = ox + hw;
  const y0 = oy;
  const y1 = oy + h;
  const z0 = oz - hd, z1 = oz + hd;

  const getUV = (face: string) => tileUV(faces[face] ?? 0, tilesPerRow, tileSize, atlasSize);

  // The wedge has full height on the "high" side and zero on the "low" side
  // direction = which way the ramp goes down
  // Default 'south': high side at north (z0), ramp descends toward south (z1)

  if (direction === 'south' || !direction) {
    // High wall at north (z0), ramp descends to south (z1)
    const slopeNorm = vec3Normalize([0, d, h]);
    // Ramp surface
    pushQuad(verts, [x0, y0, z1], [x1, y0, z1], [x1, y1, z0], [x0, y1, z0], slopeNorm, getUV('slope'));
    // High wall (north)
    pushQuad(verts, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], getUV('front'));
    // Left side triangle
    pushTriangle(verts, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [-1, 0, 0], getUV('side'));
    // Right side triangle
    pushTriangle(verts, [x1, y1, z0], [x1, y0, z1], [x1, y0, z0], [1, 0, 0], getUV('side'));
    // Bottom
    pushQuad(verts, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], getUV('bottom'));
  } else if (direction === 'north') {
    const slopeNorm = vec3Normalize([0, d, -h]);
    pushQuad(verts, [x1, y0, z0], [x0, y0, z0], [x0, y1, z1], [x1, y1, z1], slopeNorm, getUV('slope'));
    pushQuad(verts, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], getUV('front'));
    pushTriangle(verts, [x0, y1, z1], [x0, y0, z1], [x0, y0, z0], [-1, 0, 0], getUV('side'));
    pushTriangle(verts, [x1, y1, z1], [x1, y0, z0], [x1, y0, z1], [1, 0, 0], getUV('side'));
    pushQuad(verts, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], getUV('bottom'));
  } else if (direction === 'east') {
    const slopeNorm = vec3Normalize([-h, w, 0]);
    pushQuad(verts, [x0, y0, z0], [x0, y0, z1], [x1, y1, z1], [x1, y1, z0], slopeNorm, getUV('slope'));
    pushQuad(verts, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], getUV('front'));
    pushTriangle(verts, [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1], getUV('side'));
    pushTriangle(verts, [x1, y1, z1], [x0, y0, z1], [x1, y0, z1], [0, 0, 1], getUV('side'));
    pushQuad(verts, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], getUV('bottom'));
  } else if (direction === 'west') {
    const slopeNorm = vec3Normalize([h, w, 0]);
    pushQuad(verts, [x1, y0, z1], [x1, y0, z0], [x0, y1, z0], [x0, y1, z1], slopeNorm, getUV('slope'));
    pushQuad(verts, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], getUV('front'));
    pushTriangle(verts, [x0, y1, z0], [x0, y0, z0], [x1, y0, z0], [0, 0, -1], getUV('side'));
    pushTriangle(verts, [x0, y1, z1], [x1, y0, z1], [x0, y0, z1], [0, 0, 1], getUV('side'));
    pushQuad(verts, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0], getUV('bottom'));
  }
}

function modelMatrix(x: number, y: number, z: number, rotation: number): Mat4 {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  const m = new Float32Array(16);
  m[0] = c;  m[2] = s;
  m[5] = 1;
  m[8] = -s; m[10] = c;
  m[12] = x; m[13] = y; m[14] = z;
  m[15] = 1;
  return m;
}

// ---- Create Mesh System ----

interface CompiledBuilding {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
  buffer: WebGLBuffer;
  footprint: { hw: number; hd: number }; // Half-width and half-depth for collision
}

export function createMeshSystem(
  gl: WebGL2RenderingContext,
  atlas: { texture: WebGLTexture; width: number; height: number },
  tileSize = 16,
): MeshSystem {
  const shader = compileShader(gl, meshVertexShader, meshFragmentShader,
    ['u_viewProj', 'u_model', 'u_texture', 'u_lightDir', 'u_ambientColor', 'u_lightColor', 'u_fogColor', 'u_fogNear', 'u_fogFar', 'u_cameraPos'],
    ['a_position', 'a_normal', 'a_uv'],
  );

  const tilesPerRow = Math.floor(atlas.width / tileSize);
  const buildings = new Map<string, CompiledBuilding>();
  let instances: BuildingInstance[] = [];

  return {
    defineBuilding(id: string, parts: MeshPart[]) {
      const verts: number[] = [];
      let maxHW = 0, maxHD = 0;

      for (const part of parts) {
        const [px, py, pz] = part.position;
        const [w, h, d] = part.size;
        if (part.type === 'box') {
          generateBox(verts, px, py, pz, w, h, d, part.faces, tilesPerRow, tileSize, atlas.width);
        } else if (part.type === 'roof') {
          generateRoof(verts, px, py, pz, w, h, d, part.faces, tilesPerRow, tileSize, atlas.width);
        } else if (part.type === 'wedge') {
          generateWedge(verts, px, py, pz, w, h, d, part.faces, part.direction || 'south', tilesPerRow, tileSize, atlas.width);
        }
        maxHW = Math.max(maxHW, Math.abs(px) + w / 2);
        maxHD = Math.max(maxHD, Math.abs(pz) + d / 2);
      }

      const data = new Float32Array(verts);
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);

      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

      const stride = FLOATS_PER_VERTEX * 4;
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);

      gl.bindVertexArray(null);

      buildings.set(id, { vao, vertexCount: verts.length / FLOATS_PER_VERTEX, buffer, footprint: { hw: maxHW, hd: maxHD } });
    },

    placeBuildings(insts: BuildingInstance[]) {
      instances = insts;
    },

    render(camera: Camera3D, vp: Mat4, _viewportW: number, _viewportH: number) {
      if (instances.length === 0) return;

      gl.useProgram(shader.program);
      gl.uniformMatrix4fv(shader.uniforms.u_viewProj, false, vp);

      // Lighting (match terrain)
      const lightDir = vec3Normalize([0.3, 1.0, 0.5]);
      gl.uniform3fv(shader.uniforms.u_lightDir, lightDir);
      gl.uniform3f(shader.uniforms.u_ambientColor, 0.35, 0.35, 0.4);
      gl.uniform3f(shader.uniforms.u_lightColor, 1.0, 0.95, 0.85);
      gl.uniform3f(shader.uniforms.u_fogColor, 0.6, 0.7, 0.85);
      gl.uniform1f(shader.uniforms.u_fogNear, camera.far * 0.5);
      gl.uniform1f(shader.uniforms.u_fogFar, camera.far);
      gl.uniform3fv(shader.uniforms.u_cameraPos, camera.position);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, atlas.texture);
      gl.uniform1i(shader.uniforms.u_texture, 0);

      for (const inst of instances) {
        const building = buildings.get(inst.defId);
        if (!building) continue;

        const model = modelMatrix(inst.x, inst.y, inst.z, inst.rotation);
        gl.uniformMatrix4fv(shader.uniforms.u_model, false, model);

        gl.bindVertexArray(building.vao);
        gl.drawArrays(gl.TRIANGLES, 0, building.vertexCount);
      }

      gl.bindVertexArray(null);
    },

    isBlocked(worldX: number, worldZ: number): boolean {
      for (const inst of instances) {
        const building = buildings.get(inst.defId);
        if (!building) continue;

        // Transform world point into building's local space
        const c = Math.cos(-inst.rotation);
        const s = Math.sin(-inst.rotation);
        const dx = worldX - inst.x;
        const dz = worldZ - inst.z;
        const localX = dx * c - dz * s;
        const localZ = dx * s + dz * c;

        if (Math.abs(localX) < building.footprint.hw && Math.abs(localZ) < building.footprint.hd) {
          return true;
        }
      }
      return false;
    },

    destroy() {
      for (const [, b] of buildings) {
        gl.deleteVertexArray(b.vao);
        gl.deleteBuffer(b.buffer);
      }
      gl.deleteProgram(shader.program);
    },
  };
}
