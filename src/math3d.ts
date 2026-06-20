/**
 * Minimal 3D math utilities for Glyft's terrain subsystem.
 *
 * Only what's needed: mat4 (perspective, view, MVP), vec3 operations.
 * No classes — plain Float32Arrays for zero-alloc GPU upload.
 */

// ---- Vec3 ----

export type Vec3 = [number, number, number];

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3Length(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function vec3Normalize(v: Vec3): Vec3 {
  const len = vec3Length(v);
  if (len < 1e-8) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

// ---- Mat4 (column-major Float32Array, WebGL-ready) ----

export type Mat4 = Float32Array;

export function mat4Create(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const m = new Float32Array(16);
  const f = 1.0 / Math.tan(fovY / 2);
  const rangeInv = 1.0 / (near - far);

  m[0] = f / aspect;
  m[5] = f;
  m[10] = (near + far) * rangeInv;
  m[11] = -1;
  m[14] = 2 * near * far * rangeInv;
  return m;
}

export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = vec3Normalize(vec3Sub(eye, target));
  const x = vec3Normalize(vec3Cross(up, z));
  const y = vec3Cross(z, x);

  const m = new Float32Array(16);
  m[0] = x[0]; m[1] = y[0]; m[2] = z[0];
  m[4] = x[1]; m[5] = y[1]; m[6] = z[1];
  m[8] = x[2]; m[9] = y[2]; m[10] = z[2];
  m[12] = -vec3Dot(x, eye);
  m[13] = -vec3Dot(y, eye);
  m[14] = -vec3Dot(z, eye);
  m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const m = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      m[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return m;
}

export function mat4Identity(): Mat4 {
  return mat4Create();
}

/**
 * Project a 3D world position to 2D screen coordinates.
 * Returns [screenX, screenY, depth] where depth is 0..1 (near..far).
 * Returns null if behind camera.
 */
export function project(pos: Vec3, mvp: Mat4, viewportW: number, viewportH: number): [number, number, number] | null {
  const x = pos[0], y = pos[1], z = pos[2];
  const w = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
  if (w <= 0) return null; // Behind camera

  const invW = 1 / w;
  const ndcX = (mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]) * invW;
  const ndcY = (mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]) * invW;
  const ndcZ = (mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14]) * invW;

  return [
    (ndcX * 0.5 + 0.5) * viewportW,
    (1 - (ndcY * 0.5 + 0.5)) * viewportH,
    ndcZ * 0.5 + 0.5,
  ];
}
