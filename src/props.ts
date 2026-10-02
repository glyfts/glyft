/**
 * Built-in 3D props: low-poly, vertex-coloured trees, rocks and cave dressing.
 *
 * Each kind is generated once and drawn instanced (one draw call per kind).
 * Trees and bushes sway in the wind in the vertex shader; crystals and
 * mushrooms glow (unlit). Props are placed by world rules (world.scatter).
 */

import { compileShader } from './renderer';
import type { Mat4, Vec3 } from './math3d';
import type { Camera3D, Lighting } from './terrain';

export const PROP_KINDS = ['pine', 'oak', 'bush', 'rock', 'boulder', 'stalagmite', 'crystal', 'mushroom', 'grass'] as const;
export type PropKind = typeof PROP_KINDS[number];

/** Blocking radius in world units at scale 1 (0 = walk through) and default placement area. */
export const PROP_INFO: Record<PropKind, { radius: number; sway: number; glow: number }> = {
  pine: { radius: 0.35, sway: 1, glow: 0 },
  oak: { radius: 0.4, sway: 1, glow: 0 },
  bush: { radius: 0, sway: 1, glow: 0 },
  rock: { radius: 0.45, sway: 0, glow: 0 },
  boulder: { radius: 1.0, sway: 0, glow: 0 },
  stalagmite: { radius: 0.45, sway: 0, glow: 0 },
  crystal: { radius: 0.4, sway: 0, glow: 1 },
  mushroom: { radius: 0, sway: 0, glow: 0.7 },
  grass: { radius: 0, sway: 1, glow: 0.35 },
};

type RGB = [number, number, number];
const hex = (c: number): RGB => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Mesh builder: flat-shaded triangles with per-vertex colour. */
class Builder {
  readonly v: number[] = []; // pos(3) normal(3) color(3)

  tri(a: Vec3, b: Vec3, c: Vec3, col: RGB): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) this.v.push(p[0], p[1], p[2], nx, ny, nz, col[0], col[1], col[2]);
  }

  /** Cone or frustum around Y from y0 (radius r0) to y1 (radius r1). */
  cone(y0: number, r0: number, y1: number, r1: number, sides: number, col: RGB, shade = 0.85, ox = 0, oz = 0): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const c = i % 2 ? col : [col[0] * shade, col[1] * shade, col[2] * shade] as RGB;
      const p0: Vec3 = [ox + Math.cos(a0) * r0, y0, oz + Math.sin(a0) * r0];
      const p1: Vec3 = [ox + Math.cos(a1) * r0, y0, oz + Math.sin(a1) * r0];
      const q0: Vec3 = [ox + Math.cos(a0) * r1, y1, oz + Math.sin(a0) * r1];
      const q1: Vec3 = [ox + Math.cos(a1) * r1, y1, oz + Math.sin(a1) * r1];
      this.tri(p0, q0, p1, c);
      if (r1 > 0.001) this.tri(p1, q0, q1, c);
    }
  }

  /** Lumpy low-poly blob (octahedron subdivided once, jittered). */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: RGB, jitter: number, seed: number, flatBottom = false): void {
    const r = rng(seed);
    const base: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const faces = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    const cache = new Map<string, Vec3>();
    const norm = (p: Vec3): Vec3 => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; };
    const place = (p: Vec3): Vec3 => {
      const key = p.map((n) => n.toFixed(3)).join(',');
      let out = cache.get(key);
      if (!out) {
        const k = 1 + (r() - 0.5) * jitter;
        const y = flatBottom ? Math.max(p[1], -0.15) : p[1];
        out = [cx + p[0] * rx * k, cy + y * ry * k, cz + p[2] * rz * k];
        cache.set(key, out);
      }
      return out;
    };
    for (const [a, b, c] of faces) {
      const A = base[a], B = base[b], C = base[c];
      const ab = norm([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]);
      const bc = norm([(B[0] + C[0]) / 2, (B[1] + C[1]) / 2, (B[2] + C[2]) / 2]);
      const ca = norm([(C[0] + A[0]) / 2, (C[1] + A[1]) / 2, (C[2] + A[2]) / 2]);
      for (const [p, q, s] of [[A, ab, ca], [ab, B, bc], [ca, bc, C], [ab, bc, ca]] as Vec3[][]) {
        const v = 0.92 + r() * 0.16;
        this.tri(place(p), place(q), place(s), [col[0] * v, col[1] * v, col[2] * v]);
      }
    }
  }
}

function buildKind(kind: PropKind): number[] {
  const b = new Builder();
  switch (kind) {
    case 'pine':
      b.cone(0, 0.14, 0.9, 0.1, 6, hex(0x6b4524));
      b.cone(0.6, 0.95, 1.7, 0, 7, hex(0x2f6b35));
      b.cone(1.2, 0.75, 2.3, 0, 7, hex(0x37803f));
      b.cone(1.8, 0.5, 2.8, 0, 7, hex(0x419149));
      break;
    case 'oak':
      b.cone(0, 0.18, 1.2, 0.13, 6, hex(0x6b4524));
      b.blob(0, 1.75, 0, 0.95, 0.8, 0.95, hex(0x4d8a3a), 0.25, 11);
      b.blob(0.45, 1.55, 0.25, 0.55, 0.5, 0.55, hex(0x5d9c45), 0.3, 12);
      b.blob(-0.4, 1.6, -0.3, 0.55, 0.5, 0.55, hex(0x447a33), 0.3, 13);
      break;
    case 'bush':
      b.blob(0, 0.32, 0, 0.55, 0.4, 0.55, hex(0x4f8f3d), 0.35, 21, true);
      b.blob(0.3, 0.25, 0.2, 0.32, 0.28, 0.32, hex(0x5fa64a), 0.35, 22, true);
      break;
    case 'rock':
      b.blob(0, 0.2, 0, 0.5, 0.38, 0.45, hex(0x8a857e), 0.45, 31, true);
      break;
    case 'boulder':
      b.blob(0, 0.6, 0, 1.15, 0.95, 1.05, hex(0x7d7973), 0.4, 41, true);
      b.blob(0.6, 0.35, 0.5, 0.5, 0.4, 0.45, hex(0x8f8a83), 0.4, 42, true);
      break;
    case 'stalagmite':
      b.cone(0, 0.5, 1.6, 0.05, 6, hex(0x7a6b5c));
      b.cone(0, 0.28, 0.8, 0.04, 5, hex(0x8c7d6c), 0.85, 0.45, 0.2);
      break;
    case 'crystal':
      for (const [x, z, h, r, c] of [[0, 0, 1.4, 0.22, 0x6fe3ff], [0.28, 0.12, 0.9, 0.15, 0x9a7dff], [-0.22, 0.18, 0.75, 0.13, 0x6fe3ff]] as [number, number, number, number, number][]) {
        b.cone(0, r, h * 0.75, r, 5, hex(c), 0.8, x, z);
        b.cone(h * 0.75, r, h, 0, 5, hex(c), 0.8, x, z);
      }
      break;
    case 'mushroom':
      b.cone(0, 0.07, 0.35, 0.06, 5, hex(0xe8e0d0));
      b.cone(0.3, 0.3, 0.5, 0.0, 7, hex(0x4fb8ff));
      b.cone(0, 0.05, 0.22, 0.04, 5, hex(0xe8e0d0), 0.85, 0.25, 0.1);
      b.cone(0.18, 0.17, 0.3, 0.0, 6, hex(0x4fb8ff), 0.85, 0.25, 0.1);
      break;
    case 'grass':
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, d = 0.12 + (i % 3) * 0.08;
        const x = Math.cos(a) * d, z = Math.sin(a) * d, h = 0.35 + (i % 3) * 0.12;
        b.tri([x - 0.05, 0, z], [x + 0.05, 0, z], [x * 1.4, h, z * 1.4], hex(i % 2 ? 0x6fae4f : 0x5c9a40));
      }
      break;
  }
  return b.v;
}

const VS = /*glsl*/ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_color;
layout(location = 3) in vec4 a_inst;   // x, y, z, rotation
layout(location = 4) in vec2 a_inst2;  // scale, phase
uniform mat4 u_viewProj;
uniform float u_time;
uniform float u_sway;
uniform vec2 u_wind;
out vec3 v_normal;
out vec3 v_color;
out vec3 v_world;
void main() {
  float c = cos(a_inst.w), s = sin(a_inst.w);
  vec3 p = a_pos * a_inst2.x;
  // Sway: higher parts move more, each instance on its own phase
  float bend = u_sway * p.y * p.y * 0.035 * sin(u_time * 1.7 + a_inst2.y);
  p.x += u_wind.x * bend;
  p.z += u_wind.y * bend;
  vec3 world = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c) + a_inst.xyz;
  v_normal = vec3(a_normal.x * c - a_normal.z * s, a_normal.y, a_normal.x * s + a_normal.z * c);
  v_color = a_color;
  v_world = world;
  gl_Position = u_viewProj * vec4(world, 1.0);
}`;

const FS = /*glsl*/ `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_color;
in vec3 v_world;
uniform vec3 u_lightDir;
uniform vec3 u_ambient;
uniform vec3 u_light;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform vec3 u_cameraPos;
uniform float u_glow;
out vec4 fragColor;
void main() {
  vec3 n = normalize(v_normal);
  float diffuse = max(dot(n, u_lightDir), 0.0);
  vec3 lit = v_color * (u_ambient + u_light * diffuse);
  vec3 color = mix(lit, v_color * 1.15, u_glow);
  float fog = clamp((distance(v_world, u_cameraPos) - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
  fragColor = vec4(mix(color, u_fogColor, fog * (1.0 - u_glow * 0.6)), 1.0);
}`;

export interface PropInstance { kind: PropKind; x: number; y: number; z: number; rotation: number; scale: number }

export interface PropSystem {
  /** Replace all instances (world units) */
  setInstances(list: PropInstance[]): void;
  render(camera: Camera3D, vp: Mat4, lighting: Lighting, time: number, wind: number): void;
  destroy(): void;
}

export function createPropSystem(gl: WebGL2RenderingContext): PropSystem {
  const shader = compileShader(gl, VS, FS,
    ['u_viewProj', 'u_time', 'u_sway', 'u_wind', 'u_lightDir', 'u_ambient', 'u_light', 'u_fogColor', 'u_fogNear', 'u_fogFar', 'u_cameraPos', 'u_glow'],
    ['a_pos', 'a_normal', 'a_color', 'a_inst', 'a_inst2']);

  const kinds = new Map<PropKind, { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; verts: number; count: number }>();
  for (const kind of PROP_KINDS) {
    const data = new Float32Array(buildKind(kind));
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i);
      gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 36, i * 12);
    }
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, ibo);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
    kinds.set(kind, { vao, vbo, ibo, verts: data.length / 9, count: 0 });
  }

  return {
    setInstances(list) {
      const byKind = new Map<PropKind, number[]>();
      for (const p of list) {
        const arr = byKind.get(p.kind) ?? [];
        arr.push(p.x, p.y, p.z, p.rotation, p.scale, (p.x * 12.9898 + p.z * 78.233) % 6.283);
        byKind.set(p.kind, arr);
      }
      for (const [kind, k] of kinds) {
        const arr = byKind.get(kind) ?? [];
        gl.bindBuffer(gl.ARRAY_BUFFER, k.ibo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
        k.count = arr.length / 6;
      }
    },

    render(camera, vp, lighting, time, wind) {
      gl.useProgram(shader.program);
      gl.uniformMatrix4fv(shader.uniforms.u_viewProj, false, vp);
      gl.uniform1f(shader.uniforms.u_time, time);
      gl.uniform2f(shader.uniforms.u_wind, Math.sin(wind), Math.cos(wind));
      gl.uniform3fv(shader.uniforms.u_lightDir, lighting.lightDir);
      gl.uniform3fv(shader.uniforms.u_ambient, lighting.ambient);
      gl.uniform3fv(shader.uniforms.u_light, lighting.light);
      gl.uniform3fv(shader.uniforms.u_fogColor, lighting.fogColor);
      gl.uniform1f(shader.uniforms.u_fogNear, lighting.fogNear);
      gl.uniform1f(shader.uniforms.u_fogFar, lighting.fogFar);
      gl.uniform3fv(shader.uniforms.u_cameraPos, camera.position);
      gl.disable(gl.CULL_FACE);
      for (const [kind, k] of kinds) {
        if (k.count === 0) continue;
        gl.uniform1f(shader.uniforms.u_sway, PROP_INFO[kind].sway);
        gl.uniform1f(shader.uniforms.u_glow, PROP_INFO[kind].glow);
        gl.bindVertexArray(k.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, k.verts, k.count);
      }
      gl.bindVertexArray(null);
    },

    destroy() {
      for (const k of kinds.values()) {
        gl.deleteVertexArray(k.vao); gl.deleteBuffer(k.vbo); gl.deleteBuffer(k.ibo);
      }
      gl.deleteProgram(shader.program);
    },
  };
}
