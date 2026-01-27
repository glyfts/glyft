/**
 * Sprite shaders for instanced rendering with velocity-driven animation.
 *
 * The GPU automatically determines:
 * 1. Direction (from velocity vector)
 * 2. Animation state (idle if velocity ≈ 0, walk otherwise)
 * 3. Current frame (based on time and fps)
 *
 * Spritesheet convention:
 * - Rows = directions (down, right, up, left for 4dir)
 * - Columns = frames (idle frames first, then walk frames)
 */

export const spriteVertexShader = /*glsl*/ `#version 300 es
precision highp float;

// Per-vertex (quad geometry)
layout(location = 0) in vec2 a_position;  // 0,0 to 1,1

// Per-instance
layout(location = 1) in vec4 a_posVel;    // x, y, vx, vy
layout(location = 2) in vec4 a_frame;     // u, v, w, h (base frame in atlas)
layout(location = 3) in vec4 a_props;     // rotation, scale, alpha, tint (packed)
layout(location = 4) in vec4 a_anim;      // idleFrames, walkFrames, fps, flags

// Uniforms
uniform mat3 u_projection;
uniform float u_time;
uniform vec2 u_atlasSize;
uniform vec2 u_cameraPos;
uniform int u_spriteMode;  // 0=4dir, 1=8dir, 2=2dir-side, 3=2dir-top, 4=1dir

out vec2 v_texCoord;
out float v_alpha;
out vec3 v_tint;

// Unpack tint from float (RGB packed into 32 bits)
vec3 unpackTint(float packed) {
  uint p = floatBitsToUint(packed);
  return vec3(
    float((p >> 16u) & 0xFFu) / 255.0,
    float((p >> 8u) & 0xFFu) / 255.0,
    float(p & 0xFFu) / 255.0
  );
}

// Get direction index from velocity (4dir mode)
int getDirection4(vec2 vel) {
  if (length(vel) < 0.1) return -1;  // No movement, keep last direction

  // Determine primary direction
  if (abs(vel.x) > abs(vel.y)) {
    return vel.x > 0.0 ? 1 : 3;  // Right or Left
  } else {
    return vel.y > 0.0 ? 0 : 2;  // Down or Up
  }
}

// Get direction index from velocity (8dir mode)
int getDirection8(vec2 vel) {
  if (length(vel) < 0.1) return -1;

  float angle = atan(vel.y, vel.x);
  // Convert to 0-8 range (8 directions)
  int dir = int(mod(floor((angle + 3.14159265) / 0.7853981634 + 0.5), 8.0));
  // Remap to our order: down, down-right, right, up-right, up, up-left, left, down-left
  int remap[8] = int[8](3, 4, 1, 5, 2, 6, 0, 7);
  return remap[dir];
}

void main() {
  // Extract instance data
  vec2 pos = a_posVel.xy;
  vec2 vel = a_posVel.zw;
  vec2 baseFramePos = a_frame.xy;
  vec2 frameSize = a_frame.zw;
  float rotation = a_props.x;
  float scale = a_props.y;
  v_alpha = a_props.z;
  v_tint = unpackTint(a_props.w);

  // Animation parameters
  int idleFrames = int(a_anim.x);
  int walkFrames = int(a_anim.y);
  float fps = a_anim.z;
  float flags = a_anim.w;

  // Decode flags
  bool hasOverride = (int(flags) & 1) != 0;
  bool flipX = (int(flags) & 2) != 0;
  bool flipY = (int(flags) & 4) != 0;
  int lastDir = (int(flags) >> 8) & 0xF;

  // Determine direction based on velocity and sprite mode
  int direction = 0;
  bool isMoving = length(vel) > 0.5;

  if (u_spriteMode == 0) {
    // 4dir mode
    int velDir = getDirection4(vel);
    direction = velDir >= 0 ? velDir : lastDir;
  } else if (u_spriteMode == 1) {
    // 8dir mode
    int velDir = getDirection8(vel);
    direction = velDir >= 0 ? velDir : lastDir;
  } else if (u_spriteMode == 2) {
    // 2dir-side: left/right only, flip for left
    direction = 0;
    if (vel.x < -0.1) flipX = true;
  } else if (u_spriteMode == 3) {
    // 2dir-top: up/down only
    direction = vel.y < 0.0 ? 1 : 0;
  } else {
    // 1dir: single direction, use rotation for facing
    direction = 0;
  }

  // Calculate animation frame
  int numFrames = isMoving ? walkFrames : idleFrames;
  int frameOffset = isMoving ? idleFrames : 0;

  // Use slower fps for idle
  float actualFps = isMoving ? fps : fps * 0.5;
  int frame = int(mod(u_time * actualFps, float(numFrames)));

  // Calculate frame position in atlas
  // Rows = directions, Columns = frames
  int col = frameOffset + frame;
  int row = direction;

  vec2 framePos = baseFramePos + vec2(float(col) * frameSize.x, float(row) * frameSize.y);

  // UV mapping with flip support
  vec2 uv = a_position;
  if (flipX) uv.x = 1.0 - uv.x;
  if (flipY) uv.y = 1.0 - uv.y;

  // Calculate texture coordinates
  v_texCoord = (framePos + uv * frameSize) / u_atlasSize;

  // Transform vertex - sprite position is TOP-LEFT corner
  vec2 localPos = a_position * frameSize * scale;

  // For rotation, rotate around sprite center
  vec2 center = frameSize * scale * 0.5;
  vec2 centered = localPos - center;
  float c = cos(rotation);
  float s = sin(rotation);
  vec2 rotatedPos = vec2(
    centered.x * c - centered.y * s,
    centered.x * s + centered.y * c
  ) + center;

  // World position (subtract camera)
  vec2 worldPos = pos + rotatedPos - u_cameraPos;

  // Project to clip space
  vec3 projected = u_projection * vec3(worldPos, 1.0);
  gl_Position = vec4(projected.xy, 0.0, 1.0);
}
`;

export const spriteFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform sampler2D u_atlas;

in vec2 v_texCoord;
in float v_alpha;
in vec3 v_tint;

out vec4 fragColor;

void main() {
  vec4 texColor = texture(u_atlas, v_texCoord);

  // Discard transparent pixels
  if (texColor.a < 0.01) discard;

  // Apply tint and alpha
  fragColor = vec4(texColor.rgb * v_tint, texColor.a * v_alpha);
}
`;
