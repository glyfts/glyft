/**
 * Ocean wave system: shared between GLSL (vertex displacement) and JS (ship positioning).
 *
 * Uses Gerstner (trochoidal) waves: vertices move in circular orbits,
 * creating peaked crests and flat troughs like real ocean waves.
 *
 * The same wave parameters are used in both the shader and the JS sampler
 * so ships ride the exact same surface the water renders.
 */

// ---- Wave definitions ----
// Each wave: [dirX, dirZ, frequency, amplitude, speed]

export interface WaveDef {
  dirX: number;
  dirZ: number;
  freq: number;
  amp: number;
  speed: number;
}

/** Default ocean wave set: 4 overlapping waves at different scales */
export const DEFAULT_WAVES: WaveDef[] = [
  { dirX: 0.6, dirZ: 0.8, freq: 0.08, amp: 0.35, speed: 1.2 },   // big slow swell
  { dirX: -0.4, dirZ: 0.9, freq: 0.15, amp: 0.15, speed: 1.8 },   // medium cross-wave
  { dirX: 0.9, dirZ: -0.3, freq: 0.25, amp: 0.08, speed: 2.5 },   // chop
  { dirX: -0.7, dirZ: -0.7, freq: 0.5, amp: 0.03, speed: 3.2 },   // small ripple
];

// ---- GLSL wave function (injected into water vertex shader) ----

export function waveGLSL(waves: WaveDef[]): string {
  // Generate the GLSL code for the wave displacement function
  const waveCalcs = waves.map((w, i) => {
    const len = Math.sqrt(w.dirX * w.dirX + w.dirZ * w.dirZ);
    const dx = w.dirX / len, dz = w.dirZ / len;
    return `
    // Wave ${i}
    {
      float d = ${dx.toFixed(4)} * pos.x + ${dz.toFixed(4)} * pos.z;
      float phase = d * ${w.freq.toFixed(4)} + u_time * ${w.speed.toFixed(4)} * u_waveSpeedMul;
      float s = sin(phase);
      float c = cos(phase);
      pos.y += ${w.amp.toFixed(4)} * s;
      pos.x += ${(dx * w.amp * 0.5).toFixed(4)} * c;
      pos.z += ${(dz * w.amp * 0.5).toFixed(4)} * c;
    }`;
  }).join('\n');

  return `
  void applyWaves(inout vec3 pos) {
    ${waveCalcs}
  }
  `;
}

// ---- JS wave sampler (for ship positioning) ----

/** Runtime wave parameters: set these to match the shader uniforms */
export const waveParams = {
  scale: 1.0,
  speedMul: 1.0,
};

/**
 * Sample the wave height at a world position.
 * Returns the Y displacement from the base water height.
 */
export function sampleWaveHeight(x: number, z: number, time: number, waves: WaveDef[] = DEFAULT_WAVES): number {
  let y = 0;
  for (const w of waves) {
    const len = Math.sqrt(w.dirX * w.dirX + w.dirZ * w.dirZ);
    const dx = w.dirX / len, dz = w.dirZ / len;
    const d = dx * x + dz * z;
    const phase = d * w.freq + time * w.speed * waveParams.speedMul;
    y += w.amp * Math.sin(phase);
  }
  return y * waveParams.scale;
}

/**
 * Sample the wave surface normal at a world position.
 * Uses finite differences to compute the slope.
 * Returns [nx, ny, nz] normalized.
 */
export function sampleWaveNormal(x: number, z: number, time: number, waves: WaveDef[] = DEFAULT_WAVES): [number, number, number] {
  const eps = 0.5;
  const hC = sampleWaveHeight(x, z, time, waves);
  const hR = sampleWaveHeight(x + eps, z, time, waves);
  const hF = sampleWaveHeight(x, z + eps, time, waves);

  // Tangent vectors
  const tx = eps, ty = hR - hC, tz = 0;
  const fx = 0, fy = hF - hC, fz = eps;

  // Cross product (tangentX × tangentZ)
  let nx = ty * fz - tz * fy;
  let ny = tz * fx - tx * fz;
  let nz = tx * fy - ty * fx;

  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / len, ny / len, nz / len];
}
