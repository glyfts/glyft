/**
 * glTF 2.0 / GLB loader.
 *
 * Parses glTF JSON or GLB binary into mesh geometry and texture images.
 * Extracts positions, normals, UVs, indices, and diffuse textures.
 * No skeleton or animation support.
 */

// ---- glTF JSON Types (subset we need) ----

interface GltfJson {
  asset: { version: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{
    mesh?: number;
    children?: number[];
    translation?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    matrix?: number[];
  }>;
  meshes?: Array<{
    primitives: Array<{
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
    }>;
  }>;
  accessors?: Array<{
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    min?: number[];
    max?: number[];
  }>;
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  buffers?: Array<{
    uri?: string;
    byteLength: number;
  }>;
  materials?: Array<{
    pbrMetallicRoughness?: {
      baseColorTexture?: { index: number };
      baseColorFactor?: [number, number, number, number];
    };
  }>;
  textures?: Array<{
    source?: number;
  }>;
  images?: Array<{
    uri?: string;
    bufferView?: number;
    mimeType?: string;
  }>;
}

// ---- Public Types ----

export interface GltfPrimitive {
  /** Interleaved vertex data: position(3) + normal(3) + uv(2) per vertex */
  vertices: Float32Array;
  /** Index buffer, or null for non-indexed geometry */
  indices: Uint16Array | Uint32Array | null;
  vertexCount: number;
  indexCount: number;
  /** Diffuse texture image, or null if untextured */
  texture: HTMLImageElement | null;
  /** Base color factor from material */
  baseColor: [number, number, number, number];
}

export interface GltfModel {
  primitives: GltfPrimitive[];
}

// ---- Constants ----

const COMP_UNSIGNED_BYTE = 5121;
const COMP_UNSIGNED_SHORT = 5123;
const COMP_UNSIGNED_INT = 5125;

const GLB_MAGIC = 0x46546C67;
const GLB_CHUNK_JSON = 0x4E4F534A;
const GLB_CHUNK_BIN = 0x004E4942;

function typeComponentCount(type: string): number {
  switch (type) {
    case 'SCALAR': return 1;
    case 'VEC2': return 2;
    case 'VEC3': return 3;
    case 'VEC4': return 4;
    case 'MAT4': return 16;
    default: return 1;
  }
}

// ---- GLB Parsing ----

function parseGlb(data: ArrayBuffer): { json: GltfJson; bin: ArrayBuffer | null } {
  const view = new DataView(data);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('Not a valid GLB file');
  }

  let offset = 12;
  let json: GltfJson | null = null;
  let bin: ArrayBuffer | null = null;

  while (offset < data.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;

    if (chunkType === GLB_CHUNK_JSON) {
      const text = new TextDecoder().decode(new Uint8Array(data, offset, chunkLength));
      json = JSON.parse(text);
    } else if (chunkType === GLB_CHUNK_BIN) {
      bin = data.slice(offset, offset + chunkLength);
    }

    offset += chunkLength;
  }

  if (!json) throw new Error('GLB file missing JSON chunk');
  return { json, bin };
}

// ---- Buffer Resolution ----

async function resolveBuffers(
  json: GltfJson,
  glbBin: ArrayBuffer | null,
  baseUrl: string,
): Promise<ArrayBuffer[]> {
  if (!json.buffers) return [];

  const results: ArrayBuffer[] = [];

  for (const buf of json.buffers) {
    if (!buf.uri) {
      if (!glbBin) throw new Error('Buffer has no URI and no GLB binary chunk');
      results.push(glbBin);
    } else if (buf.uri.startsWith('data:')) {
      const raw = atob(buf.uri.split(',')[1]);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      results.push(bytes.buffer);
    } else {
      const url = new URL(buf.uri, baseUrl).href;
      const res = await fetch(url);
      results.push(await res.arrayBuffer());
    }
  }

  return results;
}

// ---- Accessor Reading ----

function readFloats(
  json: GltfJson,
  buffers: ArrayBuffer[],
  accessorIndex: number,
): Float32Array {
  const acc = json.accessors![accessorIndex];
  const bv = json.bufferViews![acc.bufferView ?? 0];
  const buffer = buffers[bv.buffer];
  const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const components = typeComponentCount(acc.type);
  const stride = bv.byteStride ?? (components * 4);
  const count = acc.count;

  const result = new Float32Array(count * components);
  const view = new DataView(buffer);

  for (let i = 0; i < count; i++) {
    const src = byteOffset + i * stride;
    for (let c = 0; c < components; c++) {
      result[i * components + c] = view.getFloat32(src + c * 4, true);
    }
  }

  return result;
}

function readIndices(
  json: GltfJson,
  buffers: ArrayBuffer[],
  accessorIndex: number,
): Uint16Array | Uint32Array {
  const acc = json.accessors![accessorIndex];
  const bv = json.bufferViews![acc.bufferView ?? 0];
  const buffer = buffers[bv.buffer];
  const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const count = acc.count;
  const view = new DataView(buffer);

  if (acc.componentType === COMP_UNSIGNED_INT) {
    const result = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = view.getUint32(byteOffset + i * 4, true);
    }
    return result;
  }

  const result = new Uint16Array(count);
  if (acc.componentType === COMP_UNSIGNED_SHORT) {
    for (let i = 0; i < count; i++) {
      result[i] = view.getUint16(byteOffset + i * 2, true);
    }
  } else if (acc.componentType === COMP_UNSIGNED_BYTE) {
    for (let i = 0; i < count; i++) {
      result[i] = view.getUint8(byteOffset + i);
    }
  }

  return result;
}

// ---- Normal Generation ----

function generateNormals(
  positions: Float32Array,
  indices: Uint16Array | Uint32Array | null,
): Float32Array {
  const normals = new Float32Array(positions.length);

  const addTriNormal = (i0: number, i1: number, i2: number) => {
    const ax = positions[i1 * 3] - positions[i0 * 3];
    const ay = positions[i1 * 3 + 1] - positions[i0 * 3 + 1];
    const az = positions[i1 * 3 + 2] - positions[i0 * 3 + 2];
    const bx = positions[i2 * 3] - positions[i0 * 3];
    const by = positions[i2 * 3 + 1] - positions[i0 * 3 + 1];
    const bz = positions[i2 * 3 + 2] - positions[i0 * 3 + 2];

    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) { nx /= len; ny /= len; nz /= len; }

    for (const idx of [i0, i1, i2]) {
      normals[idx * 3] += nx;
      normals[idx * 3 + 1] += ny;
      normals[idx * 3 + 2] += nz;
    }
  };

  if (indices) {
    for (let i = 0; i < indices.length; i += 3) {
      addTriNormal(indices[i], indices[i + 1], indices[i + 2]);
    }
  } else {
    for (let i = 0; i < positions.length / 3; i += 3) {
      addTriNormal(i, i + 1, i + 2);
    }
  }

  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.sqrt(normals[i] ** 2 + normals[i + 1] ** 2 + normals[i + 2] ** 2);
    if (len > 0) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    }
  }

  return normals;
}

// ---- Image Loading ----

function loadImage(
  json: GltfJson,
  buffers: ArrayBuffer[],
  imageIndex: number,
  baseUrl: string,
): Promise<HTMLImageElement> {
  const def = json.images![imageIndex];

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load glTF image ${imageIndex}`));

    if (def.bufferView !== undefined) {
      const bv = json.bufferViews![def.bufferView];
      const data = new Uint8Array(buffers[bv.buffer], bv.byteOffset ?? 0, bv.byteLength);
      const blob = new Blob([data], { type: def.mimeType ?? 'image/png' });
      img.src = URL.createObjectURL(blob);
    } else if (def.uri) {
      img.src = def.uri.startsWith('data:') ? def.uri : new URL(def.uri, baseUrl).href;
    } else {
      reject(new Error(`Image ${imageIndex} has no data source`));
    }
  });
}

// ---- Node Transform ----

type GltfNode = NonNullable<GltfJson['nodes']>[number];

/** Build a 4x4 transform matrix from a glTF node's TRS or matrix */
function nodeTransform(node: GltfNode): Float32Array {
  if (node.matrix) {
    return new Float32Array(node.matrix);
  }

  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;

  // Scale
  if (node.scale) {
    const [sx, sy, sz] = node.scale;
    m[0] = sx; m[5] = sy; m[10] = sz;
  }

  // Rotation (quaternion → matrix, applied to current)
  if (node.rotation) {
    const [qx, qy, qz, qw] = node.rotation;
    const r = new Float32Array(16);
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;
    r[0] = 1 - (yy + zz); r[1] = xy + wz;       r[2] = xz - wy;
    r[4] = xy - wz;       r[5] = 1 - (xx + zz); r[6] = yz + wx;
    r[8] = xz + wy;       r[9] = yz - wx;       r[10] = 1 - (xx + yy);
    r[15] = 1;
    // Multiply R * S (scale is already in m)
    const rs = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        rs[col * 4 + row] =
          r[row] * m[col * 4] + r[4 + row] * m[col * 4 + 1] +
          r[8 + row] * m[col * 4 + 2] + r[12 + row] * m[col * 4 + 3];
      }
    }
    rs.forEach((v, i) => m[i] = v);
  }

  // Translation
  if (node.translation) {
    m[12] = node.translation[0];
    m[13] = node.translation[1];
    m[14] = node.translation[2];
  }

  return m;
}

/** Apply a 4x4 matrix to position and normal arrays in-place */
function applyTransform(
  positions: Float32Array,
  normals: Float32Array,
  matrix: Float32Array,
) {
  const count = positions.length / 3;

  for (let i = 0; i < count; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    positions[i * 3]     = matrix[0] * px + matrix[4] * py + matrix[8]  * pz + matrix[12];
    positions[i * 3 + 1] = matrix[1] * px + matrix[5] * py + matrix[9]  * pz + matrix[13];
    positions[i * 3 + 2] = matrix[2] * px + matrix[6] * py + matrix[10] * pz + matrix[14];
  }

  // Normals use the upper-left 3x3 (no translation), then renormalize
  for (let i = 0; i < count; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    let tnx = matrix[0] * nx + matrix[4] * ny + matrix[8]  * nz;
    let tny = matrix[1] * nx + matrix[5] * ny + matrix[9]  * nz;
    let tnz = matrix[2] * nx + matrix[6] * ny + matrix[10] * nz;
    const len = Math.sqrt(tnx * tnx + tny * tny + tnz * tnz);
    if (len > 0) { tnx /= len; tny /= len; tnz /= len; }
    normals[i * 3] = tnx; normals[i * 3 + 1] = tny; normals[i * 3 + 2] = tnz;
  }
}

// ---- Main Loader ----

/**
 * Load a glTF 2.0 or GLB file and extract mesh geometry and textures.
 *
 * Returns interleaved vertex data in Glyft's format: position(3) + normal(3) + uv(2).
 * Applies node transforms (translation, rotation, scale) to vertex positions.
 * Generates normals if the model doesn't include them.
 * Only triangle primitives are supported.
 *
 * @param url - Path to .gltf or .glb file
 * @returns Parsed model with geometry and texture data
 */
export async function loadGltf(url: string): Promise<GltfModel> {
  const response = await fetch(url);
  const baseUrl = new URL(url, window.location.href).href;

  let json: GltfJson;
  let glbBin: ArrayBuffer | null = null;

  if (url.endsWith('.glb')) {
    const parsed = parseGlb(await response.arrayBuffer());
    json = parsed.json;
    glbBin = parsed.bin;
  } else {
    json = await response.json() as GltfJson;
  }

  const buffers = await resolveBuffers(json, glbBin, baseUrl);

  // Pre-load all images
  const images: (HTMLImageElement | null)[] = [];
  if (json.images) {
    for (let i = 0; i < json.images.length; i++) {
      try {
        images.push(await loadImage(json, buffers, i, baseUrl));
      } catch {
        images.push(null);
      }
    }
  }

  // Build mesh-to-node-transform map by walking the node tree
  const meshTransforms = new Map<number, Float32Array>();
  if (json.nodes) {
    for (const node of json.nodes) {
      if (node.mesh !== undefined) {
        meshTransforms.set(node.mesh, nodeTransform(node));
      }
    }
  }

  // Extract mesh primitives
  const primitives: GltfPrimitive[] = [];

  if (json.meshes) {
    for (let meshIdx = 0; meshIdx < json.meshes.length; meshIdx++) {
      const mesh = json.meshes[meshIdx];
      const transform = meshTransforms.get(meshIdx);

      for (const prim of mesh.primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue; // triangles only

        const posIdx = prim.attributes.POSITION;
        if (posIdx === undefined) continue;

        const positions = readFloats(json, buffers, posIdx);
        const vertexCount = json.accessors![posIdx].count;

        // Indices
        let indices: Uint16Array | Uint32Array | null = null;
        let indexCount = 0;
        if (prim.indices !== undefined) {
          indices = readIndices(json, buffers, prim.indices);
          indexCount = indices.length;
        }

        // Normals
        const normals = prim.attributes.NORMAL !== undefined
          ? readFloats(json, buffers, prim.attributes.NORMAL)
          : generateNormals(positions, indices);

        // Apply node transform to positions and normals
        if (transform) {
          applyTransform(positions, normals, transform);
        }

        // UVs
        const uvs = prim.attributes.TEXCOORD_0 !== undefined
          ? readFloats(json, buffers, prim.attributes.TEXCOORD_0)
          : new Float32Array(vertexCount * 2);

        // Interleave: pos(3) + normal(3) + uv(2)
        const vertices = new Float32Array(vertexCount * 8);
        for (let i = 0; i < vertexCount; i++) {
          const dst = i * 8;
          vertices[dst] = positions[i * 3];
          vertices[dst + 1] = positions[i * 3 + 1];
          vertices[dst + 2] = positions[i * 3 + 2];
          vertices[dst + 3] = normals[i * 3];
          vertices[dst + 4] = normals[i * 3 + 1];
          vertices[dst + 5] = normals[i * 3 + 2];
          vertices[dst + 6] = uvs[i * 2];
          vertices[dst + 7] = uvs[i * 2 + 1];
        }

        // Material
        let texture: HTMLImageElement | null = null;
        let baseColor: [number, number, number, number] = [1, 1, 1, 1];

        if (prim.material !== undefined && json.materials) {
          const mat = json.materials[prim.material];
          const pbr = mat.pbrMetallicRoughness;
          if (pbr) {
            if (pbr.baseColorFactor) baseColor = pbr.baseColorFactor;
            if (pbr.baseColorTexture && json.textures) {
              const tex = json.textures[pbr.baseColorTexture.index];
              if (tex.source !== undefined) {
                texture = images[tex.source] ?? null;
              }
            }
          }
        }

        primitives.push({ vertices, indices, vertexCount, indexCount, texture, baseColor });
      }
    }
  }

  return { primitives };
}
