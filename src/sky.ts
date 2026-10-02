/**
 * Procedural sky system: day/night cycle with stars, sun, moon, clouds.
 *
 * timeOfDay: 0.0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1.0 = midnight
 */

import type { Vec3 } from './math3d';

// ---- Sky gradient ----

const skyVS = /*glsl*/ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.999, 1.0);
}`;

const skyFS = /*glsl*/ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_nadir;
out vec4 fragColor;
void main() {
  float t = v_uv.y;
  vec3 col;
  if (t > 0.5) {
    float f = (t - 0.5) * 2.0;
    col = mix(u_horizon, u_zenith, f * f);
  } else {
    float f = (0.5 - t) * 2.0;
    col = mix(u_horizon, u_nadir, f);
  }
  fragColor = vec4(col, 1.0);
}`;

// ---- Stars ----

const starVS = /*glsl*/ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_color;
layout(location = 2) in float a_size;
uniform mat4 u_vp;
uniform vec3 u_camPos;
uniform float u_alpha;
out vec3 v_color;
out float v_alpha;
void main() {
  v_color = a_color;
  v_alpha = u_alpha;
  vec3 worldPos = a_pos + u_camPos;
  gl_Position = u_vp * vec4(worldPos, 1.0);
  gl_PointSize = a_size;
}`;

const starFS = /*glsl*/ `#version 300 es
precision highp float;
in vec3 v_color;
in float v_alpha;
out vec4 fragColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c);
  if (r > 0.25) discard;
  float brightness = 1.0 - smoothstep(0.0, 0.25, r);
  fragColor = vec4(v_color * brightness, brightness * v_alpha);
}`;

// ---- Sun/Moon glow ----

const glowVS = /*glsl*/ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
uniform mat4 u_vp;
uniform vec3 u_camPos;
uniform vec3 u_bodyDir;
uniform float u_bodySize;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  vec3 worldPos = u_camPos + u_bodyDir * 400.0;
  vec3 offset = u_camRight * a_pos.x * u_bodySize + u_camUp * a_pos.y * u_bodySize;
  gl_Position = u_vp * vec4(worldPos + offset, 1.0);
}`;

const glowFS = /*glsl*/ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3 u_bodyColor;
uniform float u_bodyAlpha;
out vec4 fragColor;
void main() {
  float dist = length(v_uv);
  float core = smoothstep(0.15, 0.0, dist);
  float glow = exp(-dist * 3.0) * 0.6;
  float haze = exp(-dist * 1.5) * 0.15;
  float total = (core + glow + haze) * u_bodyAlpha;
  fragColor = vec4(u_bodyColor * total, total);
}`;

// ---- Clouds ----

const cloudVS = /*glsl*/ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_pos;
uniform mat4 u_vp;
uniform vec3 u_camPos;
uniform vec3 u_cloudPos;
uniform float u_cloudSize;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  vec3 worldPos = u_cloudPos + u_camPos;
  vec3 offset = u_camRight * a_pos.x * u_cloudSize + u_camUp * a_pos.y * u_cloudSize * 0.4;
  gl_Position = u_vp * vec4(worldPos + offset, 1.0);
}`;

const cloudFS = /*glsl*/ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_time;
uniform float u_seed;
uniform float u_opacity;
uniform vec3 u_cloudColor;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p + u_seed, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1,0)), f.x),
    mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.1;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 center = v_uv - 0.5;
  float dist = length(center);
  float circle = 1.0 - smoothstep(0.15, 0.45, dist);
  float n = fbm(v_uv * 3.0 + vec2(u_time * 0.01, u_time * 0.008));
  float n2 = fbm(v_uv * 5.0 - vec2(u_time * 0.015, u_time * 0.005));
  float cloud = n * 0.6 + n2 * 0.4;
  cloud = smoothstep(0.3, 0.65, cloud);
  float alpha = circle * cloud * u_opacity;
  if (alpha < 0.005) discard;
  fragColor = vec4(u_cloudColor, alpha);
}`;

// ---- Colour presets for time of day ----

interface SkyColors {
  zenith: Vec3;
  horizon: Vec3;
  nadir: Vec3;
  sunColor: Vec3;
  cloudColor: Vec3;
  starAlpha: number;
  fogColor: Vec3;
  ambientColor: Vec3;  // ambient light tint
  lightColor: Vec3;    // directional light tint
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function getSkyColors(tod: number): SkyColors {
  // Key frames: midnight(0), sunrise(0.25), noon(0.5), sunset(0.75), midnight(1)
  const frames: { t: number; c: SkyColors }[] = [
    { t: 0.0, c: {
      zenith: [0.02, 0.02, 0.08], horizon: [0.05, 0.05, 0.12], nadir: [0.02, 0.02, 0.06],
      sunColor: [0, 0, 0], cloudColor: [0.15, 0.15, 0.2], starAlpha: 1.0,
      fogColor: [0.05, 0.05, 0.1], ambientColor: [0.08, 0.08, 0.15], lightColor: [0.1, 0.1, 0.2],
    }},
    { t: 0.2, c: {
      zenith: [0.05, 0.05, 0.15], horizon: [0.15, 0.1, 0.12], nadir: [0.05, 0.04, 0.08],
      sunColor: [0.8, 0.3, 0.1], cloudColor: [0.3, 0.2, 0.2], starAlpha: 0.6,
      fogColor: [0.15, 0.1, 0.12], ambientColor: [0.15, 0.12, 0.15], lightColor: [0.5, 0.3, 0.2],
    }},
    { t: 0.27, c: {
      zenith: [0.2, 0.3, 0.55], horizon: [0.85, 0.5, 0.3], nadir: [0.4, 0.25, 0.2],
      sunColor: [1.0, 0.6, 0.2], cloudColor: [0.95, 0.7, 0.5], starAlpha: 0.0,
      fogColor: [0.7, 0.5, 0.4], ambientColor: [0.35, 0.25, 0.2], lightColor: [1.0, 0.65, 0.3],
    }},
    { t: 0.35, c: {
      zenith: [0.18, 0.35, 0.65], horizon: [0.6, 0.7, 0.8], nadir: [0.35, 0.45, 0.55],
      sunColor: [1.0, 0.95, 0.8], cloudColor: [0.95, 0.93, 0.9], starAlpha: 0.0,
      fogColor: [0.6, 0.7, 0.82], ambientColor: [0.35, 0.35, 0.4], lightColor: [1.0, 0.95, 0.85],
    }},
    { t: 0.5, c: {
      zenith: [0.18, 0.32, 0.60], horizon: [0.55, 0.65, 0.78], nadir: [0.35, 0.45, 0.55],
      sunColor: [1.0, 0.97, 0.85], cloudColor: [0.95, 0.93, 0.90], starAlpha: 0.0,
      fogColor: [0.6, 0.72, 0.85], ambientColor: [0.35, 0.35, 0.4], lightColor: [1.0, 0.95, 0.85],
    }},
    { t: 0.65, c: {
      zenith: [0.18, 0.32, 0.58], horizon: [0.6, 0.65, 0.72], nadir: [0.35, 0.4, 0.5],
      sunColor: [1.0, 0.9, 0.7], cloudColor: [0.95, 0.9, 0.85], starAlpha: 0.0,
      fogColor: [0.6, 0.65, 0.75], ambientColor: [0.35, 0.32, 0.35], lightColor: [1.0, 0.9, 0.75],
    }},
    { t: 0.73, c: {
      zenith: [0.15, 0.18, 0.4], horizon: [0.9, 0.45, 0.2], nadir: [0.4, 0.2, 0.15],
      sunColor: [1.0, 0.5, 0.15], cloudColor: [0.95, 0.6, 0.35], starAlpha: 0.0,
      fogColor: [0.7, 0.4, 0.3], ambientColor: [0.3, 0.2, 0.18], lightColor: [1.0, 0.55, 0.2],
    }},
    { t: 0.8, c: {
      zenith: [0.05, 0.06, 0.18], horizon: [0.2, 0.12, 0.15], nadir: [0.08, 0.06, 0.1],
      sunColor: [0.6, 0.2, 0.05], cloudColor: [0.25, 0.15, 0.15], starAlpha: 0.4,
      fogColor: [0.15, 0.1, 0.12], ambientColor: [0.12, 0.1, 0.15], lightColor: [0.4, 0.2, 0.15],
    }},
    { t: 1.0, c: {
      zenith: [0.02, 0.02, 0.08], horizon: [0.05, 0.05, 0.12], nadir: [0.02, 0.02, 0.06],
      sunColor: [0, 0, 0], cloudColor: [0.15, 0.15, 0.2], starAlpha: 1.0,
      fogColor: [0.05, 0.05, 0.1], ambientColor: [0.08, 0.08, 0.15], lightColor: [0.1, 0.1, 0.2],
    }},
  ];

  // Find surrounding keyframes
  let a = frames[0], b = frames[1];
  for (let i = 0; i < frames.length - 1; i++) {
    if (tod >= frames[i].t && tod <= frames[i + 1].t) {
      a = frames[i]; b = frames[i + 1]; break;
    }
  }

  const range = b.t - a.t;
  const t = range > 0 ? (tod - a.t) / range : 0;

  return {
    zenith: lerpVec3(a.c.zenith, b.c.zenith, t),
    horizon: lerpVec3(a.c.horizon, b.c.horizon, t),
    nadir: lerpVec3(a.c.nadir, b.c.nadir, t),
    sunColor: lerpVec3(a.c.sunColor, b.c.sunColor, t),
    cloudColor: lerpVec3(a.c.cloudColor, b.c.cloudColor, t),
    starAlpha: a.c.starAlpha + (b.c.starAlpha - a.c.starAlpha) * t,
    fogColor: lerpVec3(a.c.fogColor, b.c.fogColor, t),
    ambientColor: lerpVec3(a.c.ambientColor, b.c.ambientColor, t),
    lightColor: lerpVec3(a.c.lightColor, b.c.lightColor, t),
  };
}

// ---- Types ----

export interface SkySystem {
  render(camPos: Vec3, camTarget: Vec3, vp: Float32Array, time: number): void;
  /** Direction toward the sun, or the moon at night (for scene lighting) */
  getLightDir(): Vec3;
  /** Set time of day: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset */
  setTimeOfDay(t: number): void;
  /** Set storm darkness overlay (0 = clear, 1 = full storm) */
  setStormDarkness(d: number): void;
  /** Get current fog colour for terrain to match */
  getFogColor(): Vec3;
  /** Get current ambient light colour */
  getAmbientColor(): Vec3;
  /** Get current directional light colour */
  getLightColor(): Vec3;
  destroy(): void;
}

// ---- Create ----

export function createSkySystem(gl: WebGL2RenderingContext, options: { stars?: boolean; clouds?: boolean } = {}): SkySystem {
  const showStars = options.stars ?? true;
  const showClouds = options.clouds ?? true;
  function compile(vs: string, fs: string) {
    const v = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(v, vs); gl.compileShader(v);
    const f = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(f, fs); gl.compileShader(f);
    const p = gl.createProgram()!;
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    gl.deleteShader(v); gl.deleteShader(f);
    return p;
  }

  function loc(prog: WebGLProgram, name: string) {
    return gl.getUniformLocation(prog, name)!;
  }

  // Fullscreen quad (shared)
  const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]);

  // Sky gradient
  const skyProg = compile(skyVS, skyFS);
  const skyVAO = gl.createVertexArray()!;
  gl.bindVertexArray(skyVAO);
  const skyBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Stars
  const starProg = compile(starVS, starFS);
  const STAR_COUNT = 2000;
  const starDataArr = new Float32Array(STAR_COUNT * 7);
  const spectral = [
    { w: 0.05, r: 0.7, g: 0.75, b: 1.0 },
    { w: 0.15, r: 0.85, g: 0.88, b: 1.0 },
    { w: 0.25, r: 1.0, g: 0.95, b: 0.85 },
    { w: 0.30, r: 1.0, g: 0.90, b: 0.7 },
    { w: 0.15, r: 1.0, g: 0.75, b: 0.5 },
    { w: 0.10, r: 1.0, g: 0.55, b: 0.4 },
  ];
  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 300 + Math.random() * 200;
    const j = i * 7;
    starDataArr[j] = r * Math.sin(phi) * Math.cos(theta);
    starDataArr[j + 1] = r * Math.sin(phi) * Math.sin(theta);
    starDataArr[j + 2] = r * Math.cos(phi);
    let roll = Math.random();
    let sc = spectral[spectral.length - 1];
    for (const s of spectral) { roll -= s.w; if (roll <= 0) { sc = s; break; } }
    starDataArr[j + 3] = sc.r + (Math.random() - 0.5) * 0.1;
    starDataArr[j + 4] = sc.g + (Math.random() - 0.5) * 0.1;
    starDataArr[j + 5] = sc.b + (Math.random() - 0.5) * 0.1;
    starDataArr[j + 6] = 1.0 + Math.random() * 2.0;
  }
  const starVAO = gl.createVertexArray()!;
  gl.bindVertexArray(starVAO);
  const starBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
  gl.bufferData(gl.ARRAY_BUFFER, starDataArr, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
  gl.bindVertexArray(null);

  // Sun/Moon glow
  const glowProg = compile(glowVS, glowFS);
  const glowVAO = gl.createVertexArray()!;
  gl.bindVertexArray(glowVAO);
  const glowBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, glowBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Clouds
  const cloudProg = compile(cloudVS, cloudFS);
  const cloudVAO = gl.createVertexArray()!;
  gl.bindVertexArray(cloudVAO);
  const cloudBufGl = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, cloudBufGl);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const clouds: { pos: Vec3; size: number; seed: number; opacity: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const elevation = 0.15 + Math.random() * 0.25;
    const dist = 150 + Math.random() * 100;
    clouds.push({
      pos: [Math.cos(angle) * dist, elevation * dist, Math.sin(angle) * dist],
      size: 30 + Math.random() * 50,
      seed: Math.random() * 100,
      opacity: 0.15 + Math.random() * 0.2,
    });
  }

  // State
  let timeOfDay = 0.5; // noon
  let stormDarkness = 0;
  let currentColors = getSkyColors(timeOfDay);

  // Sun/moon orbit: sun at timeOfDay 0.5 is overhead, moon at 0.0
  function getSunDir(tod: number): Vec3 {
    const angle = (tod - 0.25) * Math.PI * 2; // sunrise at 0.25 = angle 0
    const x = Math.cos(angle) * 0.8;
    const y = Math.sin(angle);
    const z = -0.4;
    const len = Math.sqrt(x * x + y * y + z * z);
    return [x / len, y / len, z / len];
  }

  function getMoonDir(tod: number): Vec3 {
    // Moon opposite the sun
    const s = getSunDir(tod);
    const len = Math.sqrt(s[0] * s[0] + s[1] * s[1] + s[2] * s[2]);
    return [-s[0] / len, -s[1] / len, -s[2] / len];
  }

  return {
    setTimeOfDay(t: number) {
      timeOfDay = ((t % 1) + 1) % 1;
      currentColors = getSkyColors(timeOfDay);
    },

    setStormDarkness(d: number) {
      stormDarkness = Math.max(0, Math.min(1, d));
    },

    getFogColor(): Vec3 { return currentColors.fogColor; },
    getAmbientColor(): Vec3 { return currentColors.ambientColor; },
    getLightColor(): Vec3 { return currentColors.lightColor; },
    getLightDir(): Vec3 {
      const sun = getSunDir(timeOfDay);
      const dir = sun[1] > 0 ? sun : getMoonDir(timeOfDay);
      // Keep a little elevation so night light still shades slopes
      const y = Math.max(dir[1], 0.25);
      const len = Math.sqrt(dir[0] * dir[0] + y * y + dir[2] * dir[2]);
      return [dir[0] / len, y / len, dir[2] / len];
    },

    render(camPos, camTarget, vp, time) {
      // Apply storm darkness to sky colours
      const sd = stormDarkness;
      const stormZenith: Vec3 = [0.08, 0.08, 0.1];
      const stormHorizon: Vec3 = [0.15, 0.15, 0.18];
      const stormNadir: Vec3 = [0.08, 0.08, 0.1];
      const colors = {
        ...currentColors,
        zenith: lerpVec3(currentColors.zenith, stormZenith, sd) as Vec3,
        horizon: lerpVec3(currentColors.horizon, stormHorizon, sd) as Vec3,
        nadir: lerpVec3(currentColors.nadir, stormNadir, sd) as Vec3,
        starAlpha: currentColors.starAlpha * (1 - sd), // stars hidden in storm
        cloudColor: lerpVec3(currentColors.cloudColor, [0.25, 0.25, 0.28], sd) as Vec3,
      };

      // Camera basis for billboarding
      const fwd: Vec3 = [
        camTarget[0] - camPos[0], camTarget[1] - camPos[1], camTarget[2] - camPos[2],
      ];
      const fLen = Math.sqrt(fwd[0] ** 2 + fwd[1] ** 2 + fwd[2] ** 2) || 1;
      fwd[0] /= fLen; fwd[1] /= fLen; fwd[2] /= fLen;
      const right: Vec3 = [
        fwd[1] * 0 - fwd[2] * 1,
        fwd[2] * 0 - fwd[0] * 0,
        fwd[0] * 1 - fwd[1] * 0,
      ];
      // right = cross(fwd, up)
      right[0] = fwd[1] * 0 - fwd[2] * 1; // fwd.y*up.z - fwd.z*up.y... up=(0,1,0)
      right[0] = -fwd[2];
      right[1] = 0;
      right[2] = fwd[0];
      const rLen = Math.sqrt(right[0] ** 2 + right[2] ** 2) || 1;
      right[0] /= rLen; right[2] /= rLen;
      const camUp: Vec3 = [
        right[1] * fwd[2] - right[2] * fwd[1],
        right[2] * fwd[0] - right[0] * fwd[2],
        right[0] * fwd[1] - right[1] * fwd[0],
      ];

      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);

      // ---- Sky gradient ----
      gl.useProgram(skyProg);
      gl.uniform3fv(loc(skyProg, 'u_zenith'), colors.zenith);
      gl.uniform3fv(loc(skyProg, 'u_horizon'), colors.horizon);
      gl.uniform3fv(loc(skyProg, 'u_nadir'), colors.nadir);
      gl.bindVertexArray(skyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.enable(gl.BLEND);

      // ---- Sun glow ----
      const sunDir = getSunDir(timeOfDay);
      if (sunDir[1] > -0.1) { // above horizon
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.useProgram(glowProg);
        gl.uniformMatrix4fv(loc(glowProg, 'u_vp'), false, vp);
        gl.uniform3fv(loc(glowProg, 'u_camPos'), camPos);
        gl.uniform3fv(loc(glowProg, 'u_bodyDir'), sunDir);
        gl.uniform1f(loc(glowProg, 'u_bodySize'), 30.0);
        gl.uniform3fv(loc(glowProg, 'u_camRight'), right);
        gl.uniform3fv(loc(glowProg, 'u_camUp'), camUp);
        gl.uniform3fv(loc(glowProg, 'u_bodyColor'), colors.sunColor);
        gl.uniform1f(loc(glowProg, 'u_bodyAlpha'), Math.min(1, sunDir[1] + 0.3));
        gl.bindVertexArray(glowVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      // ---- Moon glow ----
      const moonDir = getMoonDir(timeOfDay);
      if (moonDir[1] > -0.1) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.useProgram(glowProg);
        gl.uniformMatrix4fv(loc(glowProg, 'u_vp'), false, vp);
        gl.uniform3fv(loc(glowProg, 'u_camPos'), camPos);
        gl.uniform3fv(loc(glowProg, 'u_bodyDir'), moonDir);
        gl.uniform1f(loc(glowProg, 'u_bodySize'), 18.0);
        gl.uniform3fv(loc(glowProg, 'u_camRight'), right);
        gl.uniform3fv(loc(glowProg, 'u_camUp'), camUp);
        gl.uniform3f(loc(glowProg, 'u_bodyColor'), 0.7, 0.75, 0.9);
        gl.uniform1f(loc(glowProg, 'u_bodyAlpha'), Math.min(1, moonDir[1] + 0.3) * Math.min(1, colors.starAlpha + 0.3));
        gl.bindVertexArray(glowVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      // ---- Stars ----
      if (showStars && colors.starAlpha > 0.01) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.useProgram(starProg);
        gl.uniformMatrix4fv(loc(starProg, 'u_vp'), false, vp);
        gl.uniform3fv(loc(starProg, 'u_camPos'), camPos);
        gl.uniform1f(loc(starProg, 'u_alpha'), colors.starAlpha);
        gl.bindVertexArray(starVAO);
        gl.drawArrays(gl.POINTS, 0, STAR_COUNT);
      }

      // ---- Clouds ----
      if (showClouds) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(cloudProg);
      gl.uniformMatrix4fv(loc(cloudProg, 'u_vp'), false, vp);
      gl.uniform3fv(loc(cloudProg, 'u_camPos'), camPos);
      gl.uniform3fv(loc(cloudProg, 'u_camRight'), right);
      gl.uniform3fv(loc(cloudProg, 'u_camUp'), camUp);
      gl.uniform1f(loc(cloudProg, 'u_time'), time);
      gl.uniform3fv(loc(cloudProg, 'u_cloudColor'), colors.cloudColor);
      gl.bindVertexArray(cloudVAO);

      for (const c of clouds) {
        gl.uniform3fv(loc(cloudProg, 'u_cloudPos'), c.pos);
        gl.uniform1f(loc(cloudProg, 'u_cloudSize'), c.size);
        gl.uniform1f(loc(cloudProg, 'u_seed'), c.seed);
        gl.uniform1f(loc(cloudProg, 'u_opacity'), c.opacity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      }

      // Restore
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
    },

    destroy() {
      gl.deleteProgram(skyProg);
      gl.deleteProgram(starProg);
      gl.deleteProgram(glowProg);
      gl.deleteProgram(cloudProg);
      gl.deleteVertexArray(skyVAO);
      gl.deleteVertexArray(starVAO);
      gl.deleteVertexArray(glowVAO);
      gl.deleteVertexArray(cloudVAO);
      gl.deleteBuffer(skyBuf);
      gl.deleteBuffer(starBuf);
      gl.deleteBuffer(glowBuf);
      gl.deleteBuffer(cloudBufGl);
    },
  };
}
