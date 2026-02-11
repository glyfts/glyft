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
precision highp int;

// Per-vertex (quad geometry)
layout(location = 0) in vec2 a_position;  // 0,0 to 1,1

// Per-instance
layout(location = 1) in vec4 a_posVel;    // x, y, vx, vy
layout(location = 2) in vec4 a_frame;     // u, v, w, h (base frame in atlas)
layout(location = 3) in vec4 a_props;     // rotation, scale, alpha, tint (packed)
layout(location = 4) in vec4 a_anim;      // idleFrames, walkFrames, fps, flags
layout(location = 5) in vec4 a_glow;      // intensity, color (packed), radius, shadowOffsetY

// Uniforms
uniform mat3 u_projection;
uniform float u_time;
uniform vec2 u_atlasSize;
uniform vec2 u_cameraPos;
uniform int u_spriteMode;  // 0=4dir, 1=8dir, 2=2dir-side, 3=2dir-top, 4=1dir
uniform int u_shadowPass;

out vec2 v_texCoord;
out float v_alpha;
out vec3 v_tint;
out vec2 v_localUV;
out float v_hasShadow;
out float v_glowIntensity;
out vec3 v_glowColor;

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

  // Glow parameters
  v_glowIntensity = a_glow.x;
  v_glowColor = unpackTint(a_glow.y);
  float glowRadius = a_glow.z;

  // Animation parameters
  int idleFrames = int(a_anim.x);
  int walkFrames = int(a_anim.y);
  float fps = a_anim.z;
  float flags = a_anim.w;

  // Decode flags (bit-cast uint32 packed as float)
  uint uflags = floatBitsToUint(flags);
  bool hasOverride = (uflags & 1u) != 0u;
  bool flipX = (uflags & 2u) != 0u;
  bool flipY = (uflags & 4u) != 0u;
  bool hasShadow = (uflags & 8u) != 0u;
  int rowOffset = int((uflags >> 4u) & 0xFu);  // Bits 4-7: row offset for state switching
  int lastDir = int((uflags >> 8u) & 0xFu);
  float bobAmplitude = float((uflags >> 12u) & 0xFFu);
  float bobSpeed = float((uflags >> 20u) & 0xFFu) * 0.1;

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
  // If walkFrames = 0, always use idle animation (for sprites without walk cycle)
  bool useWalk = isMoving && walkFrames > 0;
  int numFrames = useWalk ? walkFrames : idleFrames;
  int frameOffset = useWalk ? idleFrames : 0;

  // Use slower fps for idle
  float actualFps = useWalk ? fps : fps * 0.5;
  int frame = int(mod(u_time * actualFps, float(numFrames)));

  // Calculate frame position in atlas
  // Rows = directions, Columns = frames
  int col = frameOffset + frame;
  int row = direction + rowOffset;  // Apply row offset for state switching (e.g., swimming)

  vec2 framePos = baseFramePos + vec2(float(col) * frameSize.x, float(row) * frameSize.y);

  // UV mapping with flip support
  vec2 uv = a_position;
  if (flipX) uv.x = 1.0 - uv.x;
  if (flipY) uv.y = 1.0 - uv.y;

  // Calculate texture coordinates
  v_texCoord = (framePos + uv * frameSize) / u_atlasSize;
  v_localUV = a_position;
  v_hasShadow = hasShadow ? 1.0 : 0.0;

  if (u_shadowPass == 2) {
    // Glow pass: expanded sprite with glow color, rendered with additive blending
    if (v_glowIntensity <= 0.0) {
      v_alpha = 0.0;
      gl_Position = vec4(0.0);
      return;
    }

    // Expand the quad by glowRadius
    float expandedScale = scale * glowRadius;
    vec2 localPos = a_position * frameSize * expandedScale;
    vec2 center = frameSize * expandedScale * 0.5;
    vec2 centered = localPos - center;
    float c = cos(rotation);
    float s = sin(rotation);
    vec2 rotatedPos = vec2(
      centered.x * c - centered.y * s,
      centered.x * s + centered.y * c
    ) + center;

    // Offset to center the expanded quad on the original sprite
    vec2 expandOffset = frameSize * scale * 0.5 - frameSize * expandedScale * 0.5;

    float bobOffset = 0.0;
    if (bobAmplitude > 0.0) {
      bobOffset = sin(u_time * bobSpeed * 6.28318) * bobAmplitude;
    }

    vec2 worldPos = pos + expandOffset + rotatedPos - u_cameraPos;
    worldPos.y -= bobOffset;

    // Remap UV for glow fade calculation (0,0 to 1,1 -> -0.5,-0.5 to 0.5,0.5)
    v_localUV = a_position;
    v_alpha = v_glowIntensity;

    vec3 projected = u_projection * vec3(worldPos, 1.0);
    gl_Position = vec4(projected.xy, 0.0, 1.0);
  } else if (u_shadowPass == 1) {
    // Shadow pass: flat ellipse at sprite base, scales with bob height
    if (!hasShadow) {
      v_alpha = 0.0;
      gl_Position = vec4(0.0);
      return;
    }
    // Compute current bob offset (same formula as normal pass)
    float bobOffset = 0.0;
    if (bobAmplitude > 0.0) {
      bobOffset = sin(u_time * bobSpeed * 6.28318) * bobAmplitude;
    }
    // Shadow expands when sprite is higher, shrinks when lower
    float shadowExpand = 1.0 + bobOffset * 0.04;
    float shadowW = frameSize.x * scale * 0.8 * shadowExpand;
    float shadowH = frameSize.x * scale * 0.25 * shadowExpand;
    vec2 shadowLocal = a_position * vec2(shadowW, shadowH);
    // Center shadow under sprite base (top of shadow aligns with sprite bottom)
    // shadowOffsetY allows adjusting shadow position for sprites where feet aren't at frame bottom
    float shadowOffsetY = a_glow.w;
    float offsetX = (frameSize.x * scale - shadowW) * 0.5;
    float offsetY = frameSize.y * scale + shadowOffsetY;
    vec2 worldPos = pos + vec2(offsetX, offsetY) + shadowLocal - u_cameraPos;
    // Fade shadow when sprite is high (farther from ground)
    v_alpha = clamp(1.0 - bobOffset * 0.03, 0.5, 1.0);
    vec3 projected = u_projection * vec3(worldPos, 1.0);
    gl_Position = vec4(projected.xy, 0.0, 1.0);
  } else {
    // Normal pass: sprite with rotation and bob offset
    vec2 localPos = a_position * frameSize * scale;
    vec2 center = frameSize * scale * 0.5;
    vec2 centered = localPos - center;
    float c = cos(rotation);
    float s = sin(rotation);
    vec2 rotatedPos = vec2(
      centered.x * c - centered.y * s,
      centered.x * s + centered.y * c
    ) + center;

    float bobOffset = 0.0;
    if (bobAmplitude > 0.0) {
      bobOffset = sin(u_time * bobSpeed * 6.28318) * bobAmplitude;
    }

    vec2 worldPos = pos + rotatedPos - u_cameraPos;
    worldPos.y -= bobOffset;

    vec3 projected = u_projection * vec3(worldPos, 1.0);
    gl_Position = vec4(projected.xy, 0.0, 1.0);
  }
}
`;

export const spriteFragmentShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_atlas;
uniform int u_shadowPass;

in vec2 v_texCoord;
in float v_alpha;
in vec3 v_tint;
in vec2 v_localUV;
in float v_hasShadow;
in float v_glowIntensity;
in vec3 v_glowColor;

out vec4 fragColor;

void main() {
  // Glow pass: render soft radial glow
  if (u_shadowPass == 2) {
    if (v_glowIntensity <= 0.0) discard;

    // Sample the texture to only glow where sprite has pixels
    vec4 texColor = texture(u_atlas, v_texCoord);
    if (texColor.a < 0.01) discard;

    // Calculate distance from center for soft falloff
    vec2 p = (v_localUV - 0.5) * 2.0;
    float dist = length(p);

    // Soft radial falloff
    float glow = smoothstep(1.0, 0.0, dist) * v_glowIntensity * 0.6;

    // Pulsing effect (optional, subtle)
    // glow *= 0.8 + 0.2 * sin(u_time * 3.0);

    fragColor = vec4(v_glowColor * glow, glow);
    return;
  }

  // Shadow pass: render dark ellipse
  if (u_shadowPass == 1) {
    if (v_hasShadow < 0.5) discard;
    vec2 p = (v_localUV - 0.5) * 2.0;
    float dist = length(p);
    if (dist > 1.0) discard;
    float alpha = smoothstep(1.0, 0.5, dist) * 0.35 * v_alpha;
    fragColor = vec4(0.0, 0.0, 0.0, alpha);
    return;
  }

  vec4 texColor = texture(u_atlas, v_texCoord);

  // Discard transparent pixels
  if (texColor.a < 0.01) discard;

  // Apply tint and alpha
  fragColor = vec4(texColor.rgb * v_tint, texColor.a * v_alpha);
}
`;
