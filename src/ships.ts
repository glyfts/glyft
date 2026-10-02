/**
 * Procedural sailing ship generator and renderer.
 *
 * Generates ship geometry from parameters: hull length, beam, mast count,
 * cannon ports, etc. Every ship class is a different parameter set.
 * Sails use a separate shader with wind-driven vertex displacement.
 */

import { compileShader } from './renderer';
import { vec3Normalize, type Vec3, type Mat4 } from './math3d';
import type { Camera3D, Lighting } from './terrain';

// ---- Mesh Shader (lit textured geometry) ----

const meshVertexShader = /*glsl*/ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_viewProj;
uniform mat4 u_model;
out vec3 v_normal;
out vec2 v_uv;
out vec3 v_worldPos;
void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_normal = mat3(u_model) * a_normal;
  v_uv = a_uv;
  gl_Position = u_viewProj * worldPos;
}`;

const meshFragmentShader = /*glsl*/ `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec3 u_lightDir;
uniform vec3 u_ambientColor;
uniform vec3 u_lightColor;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform vec3 u_cameraPos;
in vec3 v_normal;
in vec2 v_uv;
in vec3 v_worldPos;
out vec4 fragColor;
void main() {
  vec4 texColor = texture(u_texture, v_uv);
  if (texColor.a < 0.01) discard;
  vec3 normal = normalize(v_normal);
  float diffuse = max(dot(normal, u_lightDir), 0.0);
  if (!gl_FrontFacing) diffuse = max(dot(-normal, u_lightDir), 0.0);
  vec3 lighting = u_ambientColor + u_lightColor * diffuse;
  vec3 color = texColor.rgb * lighting;
  float dist = distance(v_worldPos, u_cameraPos);
  float fogFactor = clamp((dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
  color = mix(color, u_fogColor, fogFactor);
  fragColor = vec4(color, texColor.a);
}`;

// ---- Sail Shader (wind-driven vertex displacement) ----

const sailVertexShader = /*glsl*/ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_viewProj;
uniform mat4 u_model;
uniform vec2 u_windDir;
uniform float u_time;
out vec3 v_normal;
out vec2 v_uv;
out vec3 v_worldPos;
void main() {
  vec3 pos = a_position;
  float modelRot = atan(u_model[0][2], u_model[0][0]);
  float cr = cos(-modelRot);
  float sr = sin(-modelRot);
  vec2 localWind = vec2(
    u_windDir.x * cr - u_windDir.y * sr,
    u_windDir.x * sr + u_windDir.y * cr
  );
  float windStrength = length(localWind);
  float xFalloff = sin(a_uv.x * 3.14159);
  float yFalloff = smoothstep(0.0, 0.15, a_uv.y);
  float falloff = xFalloff * yFalloff;
  float billow = falloff * windStrength * 1.8;
  pos.x += localWind.x * billow;
  pos.z += localWind.y * billow;
  float ripple = sin(a_uv.y * 4.0 - u_time * 3.0) * 0.1 * windStrength * falloff;
  pos.x += localWind.x * ripple;
  pos.z += localWind.y * ripple;
  float flutter = sin(a_uv.x * 8.0 + a_uv.y * 4.0 + u_time * 5.0) * 0.03 * windStrength * falloff;
  pos.x += localWind.x * flutter;
  pos.z += localWind.y * flutter;
  vec3 norm = a_normal;
  float dispMag = (billow + ripple + flutter) * 0.5;
  norm = normalize(norm + vec3(localWind.x * dispMag, 0.0, localWind.y * dispMag));
  vec4 worldPos = u_model * vec4(pos, 1.0);
  v_worldPos = worldPos.xyz;
  v_normal = mat3(u_model) * norm;
  v_uv = a_uv;
  gl_Position = u_viewProj * worldPos;
}`;

const sailFragmentShader = meshFragmentShader;

// ---- Types ----

export interface ShipConfig {
  /** Ship class name */
  name: string;
  /** Hull length along Z axis */
  hullLength: number;
  /** Maximum beam (width) at midships */
  hullBeam: number;
  /** Depth below waterline (Y=0) */
  hullDraft: number;
  /** Freeboard: hull height above waterline */
  hullFreeboard: number;
  /** Bow sharpness: 0 = blunt, 1 = very pointed */
  bowSharpness: number;
  /** Stern width as fraction of beam: 0 = pointed, 1 = full width */
  sternWidth: number;
  /** Stern castle height (0 = none) */
  sternCastle: number;
  /** Forecastle height (0 = none) */
  foreCastle: number;
  /** Number of masts (1-3) */
  mastCount: number;
  /** Mast height multiplier (1.0 = standard) */
  mastHeight?: number;
  /** Sails per mast (default: [2] for each) */
  sailsPerMast?: number[];
  /** Cannon ports per side */
  cannonsPerSide: number;
  /** Whether ship has a bowsprit */
  bowsprit: boolean;
}

export interface ShipInstance {
  configId: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** Pitch in radians (fore/aft tilt, positive = bow up) */
  pitch?: number;
  /** Roll in radians (side tilt, positive = starboard down) */
  roll?: number;
  /** Tint multiplier [r, g, b] for faction colours (default: [1,1,1]) */
  tint?: [number, number, number];
}

export interface ShipTextures {
  hull: WebGLTexture;
  deck: WebGLTexture;
  sail: WebGLTexture;
  sailDirty: WebGLTexture;
  metal: WebGLTexture;
  cannon: WebGLTexture;
  rope: WebGLTexture;
  flag: WebGLTexture;
  windows: WebGLTexture;
  hatch: WebGLTexture;
  door: WebGLTexture;
}

export interface ShipSystem {
  defineShip(config: ShipConfig): void;
  setInstances(instances: ShipInstance[]): void;
  setWind(dirX: number, dirZ: number): void;
  render(camera: Camera3D, vp: Mat4, time: number, lighting: Lighting): void;
  destroy(): void;
}

// ---- Presets ----

export const SHIP_PRESETS: Record<string, ShipConfig> = {
  sloop: {
    name: 'Sloop',
    hullLength: 8,
    hullBeam: 2.4,
    hullDraft: 1.0,
    hullFreeboard: 0.8,
    bowSharpness: 0.7,
    sternWidth: 0.5,
    sternCastle: 0,
    foreCastle: 0,
    mastCount: 1,
    mastHeight: 1.0,
    sailsPerMast: [2],
    cannonsPerSide: 3,
    bowsprit: true,
  },
  brig: {
    name: 'Brigantine',
    hullLength: 12,
    hullBeam: 3.2,
    hullDraft: 1.4,
    hullFreeboard: 1.0,
    bowSharpness: 0.6,
    sternWidth: 0.55,
    sternCastle: 1.2,
    foreCastle: 0.4,
    mastCount: 2,
    mastHeight: 1.1,
    sailsPerMast: [2, 2],
    cannonsPerSide: 6,
    bowsprit: true,
  },
  frigate: {
    name: 'Frigate',
    hullLength: 18,
    hullBeam: 4.0,
    hullDraft: 1.8,
    hullFreeboard: 1.2,
    bowSharpness: 0.5,
    sternWidth: 0.6,
    sternCastle: 1.8,
    foreCastle: 0.6,
    mastCount: 3,
    mastHeight: 1.2,
    sailsPerMast: [3, 3, 2],
    cannonsPerSide: 12,
    bowsprit: true,
  },
  galleon: {
    name: 'Galleon',
    hullLength: 24,
    hullBeam: 5.5,
    hullDraft: 2.2,
    hullFreeboard: 1.6,
    bowSharpness: 0.4,
    sternWidth: 0.7,
    sternCastle: 3.0,
    foreCastle: 1.2,
    mastCount: 3,
    mastHeight: 1.4,
    sailsPerMast: [3, 3, 2],
    cannonsPerSide: 18,
    bowsprit: true,
  },
  cutter: {
    name: 'Cutter',
    hullLength: 6,
    hullBeam: 2.0,
    hullDraft: 0.8,
    hullFreeboard: 0.6,
    bowSharpness: 0.8,
    sternWidth: 0.4,
    sternCastle: 0,
    foreCastle: 0,
    mastCount: 1,
    mastHeight: 0.9,
    sailsPerMast: [1],
    cannonsPerSide: 2,
    bowsprit: false,
  },
};

// ---- Geometry Constants ----

const FLOATS_PER_VERTEX = 8; // pos(3) + normal(3) + uv(2)
const HULL_RIBS = 16;        // cross-sections along hull length
// Hull is mirrored: port side profile points are generated then mirrored for starboard

// ---- Hull Profile ----

/**
 * Returns the half-width of the hull at position t (0=bow, 1=stern).
 * Uses a sine-based curve widest at ~45% from bow.
 */
function hullHalfWidth(t: number, config: ShipConfig): number {
  const beam = config.hullBeam / 2;
  const peak = 0.45; // widest point

  if (t < peak) {
    // Bow section: narrows toward front
    const bowT = t / peak;
    return beam * Math.pow(bowT, 0.5 + config.bowSharpness);
  } else {
    // Stern section: gentler narrowing
    const sternT = (t - peak) / (1 - peak);
    const minWidth = beam * config.sternWidth;
    return beam - (beam - minWidth) * Math.pow(sternT, 1.5);
  }
}

/**
 * Returns the draft depth at position t (0=bow, 1=stern).
 * Shallower at bow and stern, deepest at midships.
 */
function hullDepth(t: number, config: ShipConfig): number {
  // Sine curve: deepest at middle
  return config.hullDraft * Math.sin(t * Math.PI) * 0.7 + config.hullDraft * 0.3;
}

/**
 * Generate cross-section points for one rib of the hull (port side only).
 * Returns points from keel (bottom) to gunwale (top).
 * Points are in local space: X = width, Y = height, Z = 0.
 */
const PROFILE_STEPS = 10; // points per half-profile for smooth hull curve

/**
 * Generate cross-section points for one rib of the hull (port side only).
 * ALWAYS returns PROFILE_STEPS+1 points regardless of width.
 * When the hull narrows at bow/stern, points converge toward the centerline.
 */
function ribProfile(t: number, config: ShipConfig): Vec3[] {
  const hw = hullHalfWidth(t, config);
  const draft = hullDepth(t, config);
  const fb = config.hullFreeboard;

  // Generate a smooth hull cross-section using parametric curve.
  // The curve extends from keel (-draft) through the waterline (0)
  // to the gunwale (+freeboard). The widest point (max beam) is
  // slightly ABOVE the waterline so the hull curvature is visible.
  const points: Vec3[] = [];

  // The curve transition from rounded to straight happens at 60% of the profile,
  // which is above the waterline: this makes the belly visible.
  const curveEnd = 0.65;

  for (let i = 0; i <= PROFILE_STEPS; i++) {
    const p = i / PROFILE_STEPS;

    if (p <= curveEnd) {
      // Curved section: keel to slightly above waterline
      const angle = (p / curveEnd) * (Math.PI / 2); // 0 to PI/2
      const x = -hw * Math.sin(angle);
      // Map the curve from -draft to above waterline
      const yRange = draft + fb * 0.3; // total vertical range of curved section
      const y = -draft + yRange * (1.0 - Math.cos(angle));
      points.push([x, y, 0]);
    } else {
      // Straight section: upper topsides to gunwale with tumblehome
      const aboveT = (p - curveEnd) / (1.0 - curveEnd); // 0 to 1
      const tumblehome = 1.0 - aboveT * 0.05;
      const x = -hw * tumblehome;
      const yStart = fb * 0.3; // where curve section ended
      const y = yStart + (fb - yStart) * aboveT;
      points.push([x, y, 0]);
    }
  }

  return points;
}

// ---- Geometry Helpers ----

function pushQuad(
  verts: number[],
  p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3,
  normal: Vec3,
  u0: number, v0: number, u1: number, v1: number,
) {
  verts.push(p0[0], p0[1], p0[2], normal[0], normal[1], normal[2], u0, v1);
  verts.push(p1[0], p1[1], p1[2], normal[0], normal[1], normal[2], u1, v1);
  verts.push(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], u1, v0);
  verts.push(p0[0], p0[1], p0[2], normal[0], normal[1], normal[2], u0, v1);
  verts.push(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], u1, v0);
  verts.push(p3[0], p3[1], p3[2], normal[0], normal[1], normal[2], u0, v0);
}

/** Like pushQuad but UVs are NOT flipped: uv maps directly to vertex order. */
function pushQuadDirect(
  verts: number[],
  p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3,
  normal: Vec3,
  u0: number, v0: number, u1: number, v1: number,
) {
  // p0=BL(u0,v0), p1=BR(u1,v0), p2=TR(u1,v1), p3=TL(u0,v1)
  verts.push(p0[0], p0[1], p0[2], normal[0], normal[1], normal[2], u0, v0);
  verts.push(p1[0], p1[1], p1[2], normal[0], normal[1], normal[2], u1, v0);
  verts.push(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], u1, v1);
  verts.push(p0[0], p0[1], p0[2], normal[0], normal[1], normal[2], u0, v0);
  verts.push(p2[0], p2[1], p2[2], normal[0], normal[1], normal[2], u1, v1);
  verts.push(p3[0], p3[1], p3[2], normal[0], normal[1], normal[2], u0, v1);
}

function calcNormal(p0: Vec3, p1: Vec3, p2: Vec3): Vec3 {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  return vec3Normalize([
    ay * bz - az * by,
    az * bx - ax * bz,
    ax * by - ay * bx,
  ]);
}

// ---- Ship Geometry Generation ----

interface MeshGroup {
  verts: Float32Array;
  vertexCount: number;
}

interface GeneratedShip {
  hull: MeshGroup;       // hull planking
  deck: MeshGroup;       // deck surface + castles
  masts: MeshGroup;      // masts, yards, bowsprit (wood/rope texture)
  cannons: MeshGroup;    // cannon barrels
  sails: MeshGroup;      // sails (rendered with wind shader)
  windows: MeshGroup;    // stern gallery windows
  hatch: MeshGroup;      // deck hatch
  door: MeshGroup;       // cabin door
}

function toMeshGroup(verts: number[]): MeshGroup {
  return { verts: new Float32Array(verts), vertexCount: verts.length / FLOATS_PER_VERTEX };
}

function generateShip(config: ShipConfig): GeneratedShip {
  const hullVerts: number[] = [];
  const deckVerts: number[] = [];
  const mastVerts: number[] = [];
  const cannonVerts: number[] = [];
  const sailVerts: number[] = [];
  const halfLen = config.hullLength / 2;

  // ---- Hull ----
  // Generate ribs along the length
  const ribs: Vec3[][] = [];
  for (let i = 0; i <= HULL_RIBS; i++) {
    const t = i / HULL_RIBS;
    const z = halfLen - t * config.hullLength; // bow at +Z, stern at -Z
    const profile = ribProfile(t, config);
    // Position profile points in world space (set Z)
    const rib = profile.map(p => [p[0], p[1], z] as Vec3);
    ribs.push(rib);
  }

  // Connect adjacent ribs with quads (port side)
  for (let i = 0; i < ribs.length - 1; i++) {
    const ribA = ribs[i];
    const ribB = ribs[i + 1];
    const segCount = Math.min(ribA.length, ribB.length) - 1;

    for (let j = 0; j < segCount; j++) {
      const a0 = ribA[j], a1 = ribA[j + 1];
      const b0 = ribB[j], b1 = ribB[j + 1];
      const normal = calcNormal(a0, b0, a1);
      const uLen = 1 / HULL_RIBS;
      const vSeg = 1 / segCount;
      pushQuad(hullVerts, a0, b0, b1, a1, normal,
        i * uLen, j * vSeg, (i + 1) * uLen, (j + 1) * vSeg);
    }
  }

  // Starboard side (mirror X)
  for (let i = 0; i < ribs.length - 1; i++) {
    const ribA = ribs[i];
    const ribB = ribs[i + 1];
    const segCount = Math.min(ribA.length, ribB.length) - 1;

    for (let j = 0; j < segCount; j++) {
      // Mirror: negate X
      const a0: Vec3 = [-ribA[j][0], ribA[j][1], ribA[j][2]];
      const a1: Vec3 = [-ribA[j + 1][0], ribA[j + 1][1], ribA[j + 1][2]];
      const b0: Vec3 = [-ribB[j][0], ribB[j][1], ribB[j][2]];
      const b1: Vec3 = [-ribB[j + 1][0], ribB[j + 1][1], ribB[j + 1][2]];
      // Flip winding order for correct facing
      const normal = calcNormal(a0, a1, b0);
      const uLen = 1 / HULL_RIBS;
      const vSeg = 1 / segCount;
      pushQuad(hullVerts, a1, b1, b0, a0, normal,
        i * uLen, j * vSeg, (i + 1) * uLen, (j + 1) * vSeg);
    }
  }

  // ---- Stern transom (flat back panel) ----
  // The stern doesn't taper to a point: it needs a flat closing face.
  // Build as a fan of triangles from keel to gunwale, both port and starboard,
  // then quads connecting port to starboard across the back.
  const sternRib = ribs[ribs.length - 1];

  for (let j = 0; j < sternRib.length - 1; j++) {
    const pPort0 = sternRib[j];
    const pPort1 = sternRib[j + 1];
    const pStar0: Vec3 = [-pPort0[0], pPort0[1], pPort0[2]];
    const pStar1: Vec3 = [-pPort1[0], pPort1[1], pPort1[2]];

    // Quad across the back: port-bottom, starboard-bottom, starboard-top, port-top
    pushQuad(hullVerts, pStar0, pPort0, pPort1, pStar1,
      [0, 0, -1], 0, j / sternRib.length, 1, (j + 1) / sternRib.length);
  }

  // ---- Deck (sunken below bulwarks) ----
  // Deck sits below the gunwale, creating raised bulwark walls around the edge.
  const bulwarkHeight = config.hullFreeboard * 0.2;
  const deckY = config.hullFreeboard - bulwarkHeight;

  for (let i = 0; i < ribs.length - 1; i++) {
    const ribA = ribs[i];
    const ribB = ribs[i + 1];
    const topA = ribA[ribA.length - 1];
    const topB = ribB[ribB.length - 1];

    // Deck surface at lowered Y
    const dPA: Vec3 = [topA[0], deckY, topA[2]];
    const dPB: Vec3 = [topB[0], deckY, topB[2]];
    const dSA: Vec3 = [-topA[0], deckY, topA[2]];
    const dSB: Vec3 = [-topB[0], deckY, topB[2]];

    const deckScale = 4.0;
    const uLen = deckScale / HULL_RIBS;
    pushQuad(deckVerts, dSA, dSB, dPB, dPA, [0, 1, 0],
      i * uLen, 0, (i + 1) * uLen, deckScale);

    // Inner bulwark walls (port side: faces inward)
    const gA = topA; // gunwale
    const gB = topB;
    pushQuad(hullVerts,
      [gA[0], deckY, gA[2]], [gB[0], deckY, gB[2]],
      [gB[0], gB[1], gB[2]], [gA[0], gA[1], gA[2]],
      [1, 0, 0], i * 0.5, 0, (i + 1) * 0.5, 1);
    // Inner bulwark walls (starboard: faces inward)
    pushQuad(hullVerts,
      [-gB[0], deckY, gB[2]], [-gA[0], deckY, gA[2]],
      [-gA[0], gA[1], gA[2]], [-gB[0], gB[1], gB[2]],
      [-1, 0, 0], i * 0.5, 0, (i + 1) * 0.5, 1);

    // Bulwark cap (thin horizontal strip along top)
    const capW = 0.04;
    pushQuad(deckVerts,
      [gA[0] + capW, gA[1], gA[2]], [gB[0] + capW, gB[1], gB[2]],
      [gB[0] - capW, gB[1], gB[2]], [gA[0] - capW, gA[1], gA[2]],
      [0, 1, 0], 0, 0, 0.1, 0.1);
    pushQuad(deckVerts,
      [-gA[0] - capW, gA[1], gA[2]], [-gB[0] - capW, gB[1], gB[2]],
      [-gB[0] + capW, gB[1], gB[2]], [-gA[0] + capW, gA[1], gA[2]],
      [0, 1, 0], 0, 0, 0.1, 0.1);
  }

  // ---- Stern Castle (follows hull shape) ----
  const windowVerts: number[] = [];
  if (config.sternCastle > 0) {
    // Build castle walls that follow the hull curvature at each rib position.
    // The castle spans from ~75% to 100% of hull length (stern quarter).
    const castleStartT = 0.75;
    const castleH = config.sternCastle;
    const castleBaseY = deckY;
    const castleTopY = castleBaseY + castleH;

    // Find ribs within the castle region
    for (let i = 0; i < ribs.length - 1; i++) {
      const tA = i / HULL_RIBS;
      const tB = (i + 1) / HULL_RIBS;
      if (tA < castleStartT) continue;

      const ribA = ribs[i];
      const ribB = ribs[i + 1];
      const wA = hullHalfWidth(tA, config);
      const wB = hullHalfWidth(tB, config);
      const zA = ribA[0][2]; // Z position of this rib
      const zB = ribB[0][2];

      // Port side wall (hull texture, faces outward)
      pushQuad(hullVerts,
        [-wA, castleBaseY, zA], [-wB, castleBaseY, zB],
        [-wB, castleTopY, zB], [-wA, castleTopY, zA],
        [-1, 0, 0], 0, 0, 0.5, 1);
      // Starboard side wall
      pushQuad(hullVerts,
        [wB, castleBaseY, zB], [wA, castleBaseY, zA],
        [wA, castleTopY, zA], [wB, castleTopY, zB],
        [1, 0, 0], 0, 0, 0.5, 1);

      // Castle deck (top surface)
      pushQuad(deckVerts,
        [-wA, castleTopY, zA], [-wB, castleTopY, zB],
        [wB, castleTopY, zB], [wA, castleTopY, zA],
        [0, 1, 0], 0, 0, 0.5, 0.5);
    }

    // Front wall of castle (faces forward, hull texture)
    const castleFrontT = castleStartT;
    const castleFrontW = hullHalfWidth(castleFrontT, config);
    const castleFrontZ = halfLen - castleFrontT * config.hullLength;
    pushQuad(hullVerts,
      [castleFrontW, castleBaseY, castleFrontZ], [-castleFrontW, castleBaseY, castleFrontZ],
      [-castleFrontW, castleTopY, castleFrontZ], [castleFrontW, castleTopY, castleFrontZ],
      [0, 0, 1], 0, 0, 1, 1);

    // Stern castle back wall (hull texture: window box sits on top of this)
    const sternCastleW = hullHalfWidth(1.0, config);
    pushQuad(hullVerts,
      [-sternCastleW, castleBaseY, -halfLen], [sternCastleW, castleBaseY, -halfLen],
      [sternCastleW, castleTopY, -halfLen], [-sternCastleW, castleTopY, -halfLen],
      [0, 0, -1], 0, 0, 1, 1);

    // Stern gallery windows: a separate box set into the stern castle wall
    const sternW = hullHalfWidth(1.0, config);
    const winW = sternW * 0.75;   // narrower than the hull
    const winH = castleH * 0.45;  // less tall than the castle
    const winBaseY = castleBaseY + castleH * 0.25; // centered-ish vertically
    const winTopY = winBaseY + winH;
    const winZ = -halfLen;
    const winDepth = 0.08; // how far the window box protrudes

    // Back face (windows texture)
    pushQuad(windowVerts,
      [-winW, winBaseY, winZ - winDepth], [winW, winBaseY, winZ - winDepth],
      [winW, winTopY, winZ - winDepth], [-winW, winTopY, winZ - winDepth],
      [0, 0, -1], 0, 0, 2, 1);
    // Top lip
    pushQuad(hullVerts,
      [-winW, winTopY, winZ], [winW, winTopY, winZ],
      [winW, winTopY, winZ - winDepth], [-winW, winTopY, winZ - winDepth],
      [0, 1, 0], 0, 0, 1, 0.1);
    // Bottom lip
    pushQuad(hullVerts,
      [-winW, winBaseY, winZ - winDepth], [winW, winBaseY, winZ - winDepth],
      [winW, winBaseY, winZ], [-winW, winBaseY, winZ],
      [0, -1, 0], 0, 0, 1, 0.1);
    // Left side
    pushQuad(hullVerts,
      [-winW, winBaseY, winZ - winDepth], [-winW, winBaseY, winZ],
      [-winW, winTopY, winZ], [-winW, winTopY, winZ - winDepth],
      [-1, 0, 0], 0, 0, 0.1, 1);
    // Right side
    pushQuad(hullVerts,
      [winW, winBaseY, winZ], [winW, winBaseY, winZ - winDepth],
      [winW, winTopY, winZ - winDepth], [winW, winTopY, winZ],
      [1, 0, 0], 0, 0, 0.1, 1);
  }

  // ---- Forecastle (follows hull shape) ----
  if (config.foreCastle > 0) {
    const fcEndT = 0.25; // forecastle covers bow quarter
    const fcH = config.foreCastle;
    const fcBaseY = deckY;
    const fcTopY = fcBaseY + fcH;

    for (let i = 0; i < ribs.length - 1; i++) {
      const tA = i / HULL_RIBS;
      const tB = (i + 1) / HULL_RIBS;
      if (tB > fcEndT) continue;

      const ribA = ribs[i];
      const ribB = ribs[i + 1];
      const wA = hullHalfWidth(tA, config);
      const wB = hullHalfWidth(tB, config);
      const zA = ribA[0][2];
      const zB = ribB[0][2];

      // Port side wall
      pushQuad(hullVerts,
        [-wB, fcBaseY, zB], [-wA, fcBaseY, zA],
        [-wA, fcTopY, zA], [-wB, fcTopY, zB],
        [-1, 0, 0], 0, 0, 0.5, 1);
      // Starboard side wall
      pushQuad(hullVerts,
        [wA, fcBaseY, zA], [wB, fcBaseY, zB],
        [wB, fcTopY, zB], [wA, fcTopY, zA],
        [1, 0, 0], 0, 0, 0.5, 1);

      // Forecastle deck
      pushQuad(deckVerts,
        [-wB, fcTopY, zB], [-wA, fcTopY, zA],
        [wA, fcTopY, zA], [wB, fcTopY, zB],
        [0, 1, 0], 0, 0, 0.5, 0.5);
    }

    // Back wall of forecastle (faces aft, hull texture)
    const fcBackT = fcEndT;
    const fcBackW = hullHalfWidth(fcBackT, config);
    const fcBackZ = halfLen - fcBackT * config.hullLength;
    pushQuad(hullVerts,
      [-fcBackW, fcBaseY, fcBackZ], [fcBackW, fcBaseY, fcBackZ],
      [fcBackW, fcTopY, fcBackZ], [-fcBackW, fcTopY, fcBackZ],
      [0, 0, -1], 0, 0, 1, 1);
  }

  // ---- Masts (octagonal, tapered) ----
  const mastPositions: number[] = [];
  const baseMastH = config.hullLength * 0.6 * (config.mastHeight ?? 1.0);
  const MAST_SIDES = 8;
  const mastBaseR = 0.1;

  if (config.mastCount === 1) {
    mastPositions.push(0.4);
  } else if (config.mastCount === 2) {
    mastPositions.push(0.3, 0.65);
  } else {
    mastPositions.push(0.25, 0.5, 0.75);
  }

  const sailsPerMast = config.sailsPerMast ?? mastPositions.map(() => 2);

  function pushOctPrism(
    buf: number[], cx: number, cz: number,
    y0: number, y1: number,
    r0: number, r1: number,
  ) {
    for (let s = 0; s < MAST_SIDES; s++) {
      const a0 = (s / MAST_SIDES) * Math.PI * 2;
      const a1 = ((s + 1) / MAST_SIDES) * Math.PI * 2;
      const cos0 = Math.cos(a0), sin0 = Math.sin(a0);
      const cos1 = Math.cos(a1), sin1 = Math.sin(a1);

      const bx0 = cx + cos0 * r0, bz0 = cz + sin0 * r0;
      const bx1 = cx + cos1 * r0, bz1 = cz + sin1 * r0;
      const tx0 = cx + cos0 * r1, tz0 = cz + sin0 * r1;
      const tx1 = cx + cos1 * r1, tz1 = cz + sin1 * r1;

      const nx = (cos0 + cos1) / 2, nz = (sin0 + sin1) / 2;
      const nl = Math.sqrt(nx * nx + nz * nz) || 1;
      const norm: Vec3 = [nx / nl, 0, nz / nl];

      pushQuad(buf,
        [bx0, y0, bz0], [bx1, y0, bz1], [tx1, y1, tz1], [tx0, y1, tz0],
        norm, s / MAST_SIDES, 0, (s + 1) / MAST_SIDES, 1);
    }
  }

  for (let m = 0; m < config.mastCount; m++) {
    const t = mastPositions[m];
    const mz = halfLen - t * config.hullLength;
    const mastH = baseMastH * (m === 1 ? 1.0 : 0.85);
    const my = deckY;

    // Mast: octagonal prism, tapers to 40% radius at top
    pushOctPrism(mastVerts, 0, mz, my, my + mastH, mastBaseR, mastBaseR * 0.4);

    // Fighting top (platform) at 60% height
    const topY = my + mastH * 0.6;
    const topR = mastBaseR * 3.5;
    const topH = 0.06;
    pushOctPrism(mastVerts, 0, mz, topY, topY + topH, topR, topR);

    // ---- Yards + individual sails ----
    const numYards = sailsPerMast[m] ?? 2;
    const yardSpacing = mastH / (numYards + 0.5);
    const yr = 0.035;

    for (let s = 0; s < numYards; s++) {
      const yardY = my + yardSpacing * (s + 1);
      // Yards get narrower higher up
      const yardHalfW = hullHalfWidth(t, config) * (1.3 - s * 0.2);

      // Yard: octagonal prism (horizontal, along X axis)
      // Simplified as a box: yards are thin enough
      pushQuad(mastVerts,
        [-yardHalfW, yardY - yr, mz - yr], [yardHalfW, yardY - yr, mz - yr],
        [yardHalfW, yardY + yr, mz - yr], [-yardHalfW, yardY + yr, mz - yr],
        [0, 0, -1], 0, 0, 1, 0.1);
      pushQuad(mastVerts,
        [yardHalfW, yardY - yr, mz + yr], [-yardHalfW, yardY - yr, mz + yr],
        [-yardHalfW, yardY + yr, mz + yr], [yardHalfW, yardY + yr, mz + yr],
        [0, 0, 1], 0, 0, 1, 0.1);
      pushQuad(mastVerts,
        [-yardHalfW, yardY - yr, mz + yr], [yardHalfW, yardY - yr, mz + yr],
        [yardHalfW, yardY - yr, mz - yr], [-yardHalfW, yardY - yr, mz - yr],
        [0, -1, 0], 0, 0, 1, 0.1);
      pushQuad(mastVerts,
        [-yardHalfW, yardY + yr, mz - yr], [yardHalfW, yardY + yr, mz - yr],
        [yardHalfW, yardY + yr, mz + yr], [-yardHalfW, yardY + yr, mz + yr],
        [0, 1, 0], 0, 0, 1, 0.1);

      // ---- Sail: one per yard, wider than tall ----
      // Hangs from the yard down to ~80% of spacing to next yard below
      const sailTop = yardY;
      const sailH = yardSpacing * 0.75; // sail height
      const sailHW = yardHalfW * 0.92;
      // Lower edge slightly narrower (foot of sail gathers inward)
      const sailBottomHW = sailHW * 0.85;

      const sailDivsX = 8;
      const sailDivsY = 6; // fewer vertical divs since each sail is wider than tall

      // Build sail grid using pushQuadDirect (no UV flipping).
      // UV (0,0) = top-left of sail (lashed to yard), (1,1) = bottom-right (free edge).
      for (let sy = 0; sy < sailDivsY; sy++) {
        const topT = sy / sailDivsY;       // 0 at top of sail
        const botT = (sy + 1) / sailDivsY; // 1 at bottom
        const topY = sailTop - topT * sailH;
        const botY = sailTop - botT * sailH;
        const topHW = sailHW + (sailBottomHW - sailHW) * topT;
        const botHW = sailHW + (sailBottomHW - sailHW) * botT;

        for (let sx = 0; sx < sailDivsX; sx++) {
          const u0 = sx / sailDivsX;
          const u1 = (sx + 1) / sailDivsX;

          const tl: Vec3 = [-topHW + u0 * topHW * 2, topY, mz];
          const tr: Vec3 = [-topHW + u1 * topHW * 2, topY, mz];
          const bl: Vec3 = [-botHW + u0 * botHW * 2, botY, mz];
          const br: Vec3 = [-botHW + u1 * botHW * 2, botY, mz];

          // Front face: BL, BR, TR, TL
          pushQuadDirect(sailVerts, bl, br, tr, tl,
            [0, 0, 1], u0, botT, u1, topT);
          // Back face: BR, BL, TL, TR
          pushQuadDirect(sailVerts, br, bl, tl, tr,
            [0, 0, -1], u1, botT, u0, topT);
        }
      }
    }
  }

  // ---- Bowsprit (octagonal, angled up) ----
  if (config.bowsprit) {
    const bLen = config.hullLength * 0.25;
    const br = 0.06;
    const bz0 = halfLen;
    const by0 = deckY + bulwarkHeight * 0.5;
    const angle = 0.25; // upward angle in radians

    // Build as segments along the bowsprit
    const bSegs = 4;
    for (let i = 0; i < bSegs; i++) {
      const t0 = i / bSegs, t1 = (i + 1) / bSegs;
      const z0 = bz0 + t0 * bLen * Math.cos(angle);
      const z1 = bz0 + t1 * bLen * Math.cos(angle);
      const y0 = by0 + t0 * bLen * Math.sin(angle);
      const y1 = by0 + t1 * bLen * Math.sin(angle);
      const r0 = br * (1 - t0 * 0.4); // taper
      const r1 = br * (1 - t1 * 0.4);

      for (let s = 0; s < 6; s++) {
        const a0 = (s / 6) * Math.PI * 2;
        const a1 = ((s + 1) / 6) * Math.PI * 2;
        const cos0 = Math.cos(a0), sin0 = Math.sin(a0);
        const cos1 = Math.cos(a1), sin1 = Math.sin(a1);

        pushQuad(mastVerts,
          [cos0 * r0, y0 + sin0 * r0, z0],
          [cos1 * r0, y0 + sin1 * r0, z0],
          [cos1 * r1, y1 + sin1 * r1, z1],
          [cos0 * r1, y1 + sin0 * r1, z1],
          vec3Normalize([(cos0 + cos1) / 2, (sin0 + sin1) / 2, 0]),
          0, 0, 0.2, 0.2);
      }
    }
  }

  // ---- Cannon Ports (dark opening + barrel inside) ----
  if (config.cannonsPerSide > 0) {
    const cannonSpacing = config.hullLength * 0.6 / config.cannonsPerSide;
    const startZ = halfLen - config.hullLength * 0.2;
    const portW = 0.2;  // gun port width
    const portH = 0.18; // gun port height
    const barrelR = 0.04;
    const barrelLen = 0.35;

    for (let c = 0; c < config.cannonsPerSide; c++) {
      const cz = startZ - c * cannonSpacing;
      const ct = (halfLen - cz) / config.hullLength;
      const hw = hullHalfWidth(ct, config);
      const cy = config.hullFreeboard * 0.35;

      // For each side (port=-1, starboard=+1)
      for (const side of [-1, 1]) {
        const sx = side * hw;
        const nx = side;

        // Dark gun port opening (recessed quad flush with hull)
        // Sits just inside the hull surface
        const inset = 0.01;
        const px = sx - nx * inset;
        pushQuad(cannonVerts,
          [px, cy - portH / 2, cz - portW / 2],
          [px, cy - portH / 2, cz + portW / 2],
          [px, cy + portH / 2, cz + portW / 2],
          [px, cy + portH / 2, cz - portW / 2],
          [nx, 0, 0] as Vec3,
          0, 0, 0.3, 0.3);

        // Cannon barrel poking out
        const bStart = sx;
        const bEnd = sx + nx * barrelLen;
        // Top face of barrel
        pushQuad(cannonVerts,
          [bStart, cy + barrelR, cz - barrelR],
          [bStart, cy + barrelR, cz + barrelR],
          [bEnd, cy + barrelR, cz + barrelR],
          [bEnd, cy + barrelR, cz - barrelR],
          [0, 1, 0], 0, 0, 0.15, 0.15);
        // Bottom
        pushQuad(cannonVerts,
          [bStart, cy - barrelR, cz + barrelR],
          [bStart, cy - barrelR, cz - barrelR],
          [bEnd, cy - barrelR, cz - barrelR],
          [bEnd, cy - barrelR, cz + barrelR],
          [0, -1, 0], 0, 0, 0.15, 0.15);
        // Sides
        pushQuad(cannonVerts,
          [bStart, cy - barrelR, cz - barrelR],
          [bStart, cy + barrelR, cz - barrelR],
          [bEnd, cy + barrelR, cz - barrelR],
          [bEnd, cy - barrelR, cz - barrelR],
          [0, 0, -1], 0, 0, 0.15, 0.15);
        pushQuad(cannonVerts,
          [bStart, cy + barrelR, cz + barrelR],
          [bStart, cy - barrelR, cz + barrelR],
          [bEnd, cy - barrelR, cz + barrelR],
          [bEnd, cy + barrelR, cz + barrelR],
          [0, 0, 1], 0, 0, 0.15, 0.15);
        // Muzzle cap
        pushQuad(cannonVerts,
          [bEnd, cy - barrelR, cz - barrelR],
          [bEnd, cy + barrelR, cz - barrelR],
          [bEnd, cy + barrelR, cz + barrelR],
          [bEnd, cy - barrelR, cz + barrelR],
          [nx, 0, 0] as Vec3, 0, 0, 0.1, 0.1);
      }
    }
  }

  // ---- Deck Hatch (flat on deck, near midships) ----
  const hatchVerts: number[] = [];
  {
    const hatchT = 0.5; // midships
    const hatchZ = halfLen - hatchT * config.hullLength;
    const hatchHW = config.hullBeam * 0.15; // width
    const hatchHD = config.hullBeam * 0.12; // depth (fore-aft)
    const hatchY = deckY + 0.01; // just above deck to avoid z-fight
    const frameH = 0.06; // raised frame height

    // Hatch grating (top face, texture mapped 1:1)
    pushQuad(hatchVerts,
      [-hatchHW, hatchY + frameH, hatchZ - hatchHD],
      [hatchHW, hatchY + frameH, hatchZ - hatchHD],
      [hatchHW, hatchY + frameH, hatchZ + hatchHD],
      [-hatchHW, hatchY + frameH, hatchZ + hatchHD],
      [0, 1, 0], 0, 0, 1, 1);
    // Frame sides
    pushQuad(hatchVerts,
      [-hatchHW, hatchY, hatchZ - hatchHD],
      [hatchHW, hatchY, hatchZ - hatchHD],
      [hatchHW, hatchY + frameH, hatchZ - hatchHD],
      [-hatchHW, hatchY + frameH, hatchZ - hatchHD],
      [0, 0, -1], 0, 0, 1, 0.2);
    pushQuad(hatchVerts,
      [hatchHW, hatchY, hatchZ + hatchHD],
      [-hatchHW, hatchY, hatchZ + hatchHD],
      [-hatchHW, hatchY + frameH, hatchZ + hatchHD],
      [hatchHW, hatchY + frameH, hatchZ + hatchHD],
      [0, 0, 1], 0, 0, 1, 0.2);
    pushQuad(hatchVerts,
      [-hatchHW, hatchY, hatchZ + hatchHD],
      [-hatchHW, hatchY, hatchZ - hatchHD],
      [-hatchHW, hatchY + frameH, hatchZ - hatchHD],
      [-hatchHW, hatchY + frameH, hatchZ + hatchHD],
      [-1, 0, 0], 0, 0, 0.2, 0.2);
    pushQuad(hatchVerts,
      [hatchHW, hatchY, hatchZ - hatchHD],
      [hatchHW, hatchY, hatchZ + hatchHD],
      [hatchHW, hatchY + frameH, hatchZ + hatchHD],
      [hatchHW, hatchY + frameH, hatchZ - hatchHD],
      [1, 0, 0], 0, 0, 0.2, 0.2);
  }

  // ---- Cabin Door (on front wall of stern castle) ----
  const doorVerts: number[] = [];
  if (config.sternCastle > 0) {
    const castleStartT = 0.75;
    const doorZ = halfLen - castleStartT * config.hullLength + 0.02; // slightly forward of castle wall
    const doorW = 0.25;
    const doorH = config.sternCastle * 0.7;
    const doorBaseY = deckY;
    const doorTopY = doorBaseY + doorH;

    // Door face (full texture, single image)
    pushQuad(doorVerts,
      [doorW, doorBaseY, doorZ], [-doorW, doorBaseY, doorZ],
      [-doorW, doorTopY, doorZ], [doorW, doorTopY, doorZ],
      [0, 0, 1], 0, 0, 1, 1);
  }

  return {
    hull: toMeshGroup(hullVerts),
    deck: toMeshGroup(deckVerts),
    masts: toMeshGroup(mastVerts),
    cannons: toMeshGroup(cannonVerts),
    sails: toMeshGroup(sailVerts),
    windows: toMeshGroup(windowVerts),
    hatch: toMeshGroup(hatchVerts),
    door: toMeshGroup(doorVerts),
  };
}

// ---- Model Matrix ----

function shipModelMatrix(x: number, y: number, z: number, rotation: number, pitch = 0, roll = 0): Mat4 {
  // Yaw (Y-axis rotation)
  const cy = Math.cos(rotation), sy = Math.sin(rotation);
  // Pitch (X-axis rotation)
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  // Roll (Z-axis rotation)
  const cr = Math.cos(roll), sr = Math.sin(roll);

  // Combined rotation: Yaw * Pitch * Roll
  const m = new Float32Array(16);
  m[0] = cy * cr + sy * sp * sr;
  m[1] = cp * sr;
  m[2] = -sy * cr + cy * sp * sr;
  m[4] = -cy * sr + sy * sp * cr;
  m[5] = cp * cr;
  m[6] = sy * sr + cy * sp * cr;
  m[8] = sy * cp;
  m[9] = -sp;
  m[10] = cy * cp;
  m[12] = x; m[13] = y; m[14] = z;
  m[15] = 1;
  return m;
}

// ---- Compiled Ship Data ----

interface CompiledGroup {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
  buffer: WebGLBuffer;
}

interface CompiledShip {
  hull: CompiledGroup;
  deck: CompiledGroup;
  masts: CompiledGroup;
  cannons: CompiledGroup;
  sails: CompiledGroup;
  windows: CompiledGroup;
  hatch: CompiledGroup;
  door: CompiledGroup;
}

// ---- Create Ship System ----

export function createShipSystem(
  gl: WebGL2RenderingContext,
  textures: ShipTextures,
): ShipSystem {
  // Hull uses standard mesh shader
  const hullShader = compileShader(gl, meshVertexShader, meshFragmentShader,
    ['u_viewProj', 'u_model', 'u_texture', 'u_lightDir', 'u_ambientColor', 'u_lightColor', 'u_fogColor', 'u_fogNear', 'u_fogFar', 'u_cameraPos'],
    ['a_position', 'a_normal', 'a_uv'],
  );

  // Sails use the wind displacement shader
  const sailShader = compileShader(gl, sailVertexShader, sailFragmentShader,
    ['u_viewProj', 'u_model', 'u_texture', 'u_lightDir', 'u_ambientColor', 'u_lightColor', 'u_fogColor', 'u_fogNear', 'u_fogFar', 'u_cameraPos', 'u_windDir', 'u_time'],
    ['a_position', 'a_normal', 'a_uv'],
  );

  const ships = new Map<string, CompiledShip>();
  let instances: ShipInstance[] = [];
  let windDir: [number, number] = [0.3, 0.7]; // default gentle NE wind

  function compileGroup(group: MeshGroup): CompiledGroup {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, group.verts, gl.STATIC_DRAW);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.bindVertexArray(null);
    return { vao, vertexCount: group.vertexCount, buffer };
  }

  function compileShipGeometry(data: GeneratedShip): CompiledShip {
    return {
      hull: compileGroup(data.hull),
      deck: compileGroup(data.deck),
      masts: compileGroup(data.masts),
      cannons: compileGroup(data.cannons),
      sails: compileGroup(data.sails),
      windows: compileGroup(data.windows),
      hatch: compileGroup(data.hatch),
      door: compileGroup(data.door),
    };
  }

  function setLighting(shader: ReturnType<typeof compileShader>, camera: Camera3D, lighting: Lighting) {
    gl.uniform3fv(shader.uniforms.u_lightDir, lighting.lightDir);
    gl.uniform3fv(shader.uniforms.u_ambientColor, lighting.ambient);
    gl.uniform3fv(shader.uniforms.u_lightColor, lighting.light);
    gl.uniform3fv(shader.uniforms.u_fogColor, lighting.fogColor);
    gl.uniform1f(shader.uniforms.u_fogNear, lighting.fogNear);
    gl.uniform1f(shader.uniforms.u_fogFar, lighting.fogFar);
    gl.uniform3fv(shader.uniforms.u_cameraPos, camera.position);
  }

  return {
    defineShip(config: ShipConfig) {
      const data = generateShip(config);
      const compiled = compileShipGeometry(data);
      ships.set(config.name, compiled);
    },

    setInstances(insts: ShipInstance[]) {
      instances = insts;
    },

    setWind(dirX: number, dirZ: number) {
      windDir = [dirX, dirZ];
    },

    render(camera: Camera3D, vp: Mat4, time: number, lighting: Lighting) {
      if (instances.length === 0) return;

      // ---- Solid geometry (mesh shader) ----
      gl.useProgram(hullShader.program);
      gl.uniformMatrix4fv(hullShader.uniforms.u_viewProj, false, vp);
      setLighting(hullShader, camera, lighting);
      gl.uniform1i(hullShader.uniforms.u_texture, 0);
      gl.activeTexture(gl.TEXTURE0);

      // Draw each material group per instance
      const groups: { key: keyof CompiledShip; tex: WebGLTexture }[] = [
        { key: 'hull', tex: textures.hull },
        { key: 'deck', tex: textures.deck },
        { key: 'masts', tex: textures.rope },
        { key: 'cannons', tex: textures.cannon },
        { key: 'hatch', tex: textures.hatch },
        { key: 'door', tex: textures.door },
      ];

      for (const { key, tex } of groups) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        for (const inst of instances) {
          const ship = ships.get(inst.configId);
          if (!ship) continue;
          const grp = ship[key] as CompiledGroup;
          if (grp.vertexCount === 0) continue;

          const model = shipModelMatrix(inst.x, inst.y, inst.z, inst.rotation, inst.pitch, inst.roll);
          gl.uniformMatrix4fv(hullShader.uniforms.u_model, false, model);
          gl.bindVertexArray(grp.vao);
          gl.drawArrays(gl.TRIANGLES, 0, grp.vertexCount);
        }
      }

      // ---- Windows (separate protruding box, no z-fighting) ----
      gl.bindTexture(gl.TEXTURE_2D, textures.windows);
      for (const inst of instances) {
        const ship = ships.get(inst.configId);
        if (!ship || ship.windows.vertexCount === 0) continue;
        const model = shipModelMatrix(inst.x, inst.y, inst.z, inst.rotation, inst.pitch, inst.roll);
        gl.uniformMatrix4fv(hullShader.uniforms.u_model, false, model);
        gl.bindVertexArray(ship.windows.vao);
        gl.drawArrays(gl.TRIANGLES, 0, ship.windows.vertexCount);
      }

      // ---- Sails (sail shader with wind displacement) ----
      gl.useProgram(sailShader.program);
      gl.uniformMatrix4fv(sailShader.uniforms.u_viewProj, false, vp);
      setLighting(sailShader, camera, lighting);
      gl.uniform2fv(sailShader.uniforms.u_windDir, windDir);
      gl.uniform1f(sailShader.uniforms.u_time, time);
      gl.uniform1i(sailShader.uniforms.u_texture, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures.sail);

      for (const inst of instances) {
        const ship = ships.get(inst.configId);
        if (!ship || ship.sails.vertexCount === 0) continue;

        const model = shipModelMatrix(inst.x, inst.y, inst.z, inst.rotation, inst.pitch, inst.roll);
        gl.uniformMatrix4fv(sailShader.uniforms.u_model, false, model);
        gl.bindVertexArray(ship.sails.vao);
        gl.drawArrays(gl.TRIANGLES, 0, ship.sails.vertexCount);
      }

      gl.bindVertexArray(null);
    },

    destroy() {
      for (const [, s] of ships) {
        for (const key of ['hull', 'deck', 'masts', 'cannons', 'sails', 'windows', 'hatch', 'door'] as const) {
          gl.deleteVertexArray(s[key].vao);
          gl.deleteBuffer(s[key].buffer);
        }
      }
      gl.deleteProgram(hullShader.program);
      gl.deleteProgram(sailShader.program);
    },
  };
}
