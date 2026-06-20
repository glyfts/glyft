/**
 * Billboard sprite shaders for 3D rendering.
 *
 * Renders 2D sprites as camera-facing quads positioned in 3D world space.
 * Supports shadow pass (flat ground ellipses beneath sprites).
 * Uses the same spritesheet convention as the 2D sprite shader:
 * - Rows = directions
 * - Columns = frames (idle first, then walk)
 */

export const billboardVertexShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

// Per-vertex (quad: 0,0 to 1,1)
layout(location = 0) in vec2 a_position;

// Per-instance
layout(location = 1) in vec4 a_worldPos;    // x, y, z, facing (radians)
layout(location = 2) in vec4 a_velocity;    // terrainNormalX, groundOffset, terrainNormalZ, speed
layout(location = 3) in vec4 a_frame;       // u, v, w, h (base frame in atlas)
layout(location = 4) in vec4 a_anim;        // idleFrames, walkFrames, fps, flags
layout(location = 5) in vec4 a_props;       // scale, alpha, tint (packed), spriteHeight
layout(location = 6) in vec4 a_override;    // startCol, frameCount, fps, elapsed (0 = inactive)

uniform mat4 u_viewProj;
uniform vec3 u_cameraPos;
uniform vec3 u_cameraRight;
uniform vec3 u_cameraUp;
uniform float u_time;
uniform vec2 u_atlasSize;
uniform int u_spriteMode;  // 0=4dir, 1=8dir
uniform int u_shadowPass;  // 0=normal, 1=shadow

out vec2 v_texCoord;
out float v_alpha;
out vec3 v_tint;
out float v_fogDist;
out vec2 v_localUV;

vec3 unpackTint(float packed) {
  uint p = floatBitsToUint(packed);
  return vec3(
    float((p >> 16u) & 0xFFu) / 255.0,
    float((p >> 8u) & 0xFFu) / 255.0,
    float(p & 0xFFu) / 255.0
  );
}

int getDirection4(float angle) {
  float a = mod(angle + 6.28318530, 6.28318530) / 6.28318530;
  int idx = int(a * 4.0 + 0.5) % 4;
  return idx;
}

int getDirection8(float angle) {
  float a = mod(angle + 6.28318530, 6.28318530) / 6.28318530;
  int idx = int(a * 8.0 + 0.5) % 8;
  return idx;
}

void main() {
  vec3 worldPos = a_worldPos.xyz;
  float facing = a_worldPos.w;
  float speed = a_velocity.w;
  float groundOffset = a_velocity.y;
  vec3 terrainNormal = normalize(vec3(a_velocity.x, 1.0, a_velocity.z));
  vec2 frameSize = a_frame.zw;
  float scale = a_props.x;
  v_alpha = a_props.y;
  v_tint = unpackTint(a_props.z);
  float spriteHeight = a_props.w;
  v_localUV = a_position;

  int idleFrames = int(a_anim.x);
  int walkFrames = int(a_anim.y);
  float fps = a_anim.z;
  uint flags = floatBitsToUint(a_anim.w);
  bool flipX = (flags & 2u) != 0u;
  float bobAmplitude = float((flags >> 12u) & 0xFFu) * 0.01;
  float bobSpeed = float((flags >> 20u) & 0xFFu) * 0.1;

  // Direction
  vec3 toCamera = u_cameraPos - worldPos;
  float cameraAngle = atan(toCamera.x, toCamera.z);
  float relAngle = facing - cameraAngle;

  int direction;
  if (u_spriteMode == 1) {
    direction = getDirection8(relAngle);
  } else {
    direction = getDirection4(relAngle);
  }

  // Animation frame
  int col;
  int row = direction;

  float overrideFrames = a_override.y;
  if (overrideFrames > 0.0) {
    float overrideStart = a_override.x;
    float overrideFps = a_override.z;
    float overrideElapsed = a_override.w;
    int frame = int(mod(overrideElapsed * overrideFps, overrideFrames));
    col = int(overrideStart) + frame;
  } else {
    bool isMoving = speed > 0.5;
    bool useWalk = isMoving && walkFrames > 0;
    int numFrames = useWalk ? walkFrames : idleFrames;
    int frameOffset = useWalk ? idleFrames : 0;
    float actualFps = useWalk ? fps : fps * 0.5;
    int frame = int(mod(u_time * actualFps, float(max(numFrames, 1))));
    col = frameOffset + frame;
  }

  vec2 baseFramePos = a_frame.xy;
  vec2 framePos = baseFramePos + vec2(float(col) * frameSize.x, float(row) * frameSize.y);

  vec2 uv = a_position;
  if (flipX) uv.x = 1.0 - uv.x;
  v_texCoord = (framePos + uv * frameSize) / u_atlasSize;

  if (u_shadowPass == 1) {
    // Shadow: ellipse on the terrain surface, oriented to slope
    float shadowW = frameSize.x * scale * spriteHeight * 0.8;
    float shadowD = shadowW * 0.4;
    vec2 local = a_position - vec2(0.5, 0.5);

    // Build tangent frame from terrain normal
    vec3 up = terrainNormal;
    vec3 tangentX = normalize(cross(up, vec3(0.0, 0.0, 1.0)));
    vec3 tangentZ = normalize(cross(tangentX, up));

    // Shadow conforms to terrain slope
    vec3 shadowPos = worldPos
      + tangentX * (local.x * shadowW)
      + tangentZ * (local.y * shadowD)
      + up * 0.05; // Tiny offset along normal to avoid z-fight

    v_alpha = 0.35;
    v_fogDist = distance(worldPos, u_cameraPos);
    gl_Position = u_viewProj * vec4(shadowPos, 1.0);
  } else {
    // Normal billboard: camera-facing quad, offset down by groundOffset + bob
    float bobOffset = 0.0;
    if (bobAmplitude > 0.0) {
      bobOffset = sin(u_time * bobSpeed * 6.28318) * bobAmplitude;
    }
    vec3 spriteOrigin = worldPos - vec3(0.0, groundOffset, 0.0) + vec3(0.0, bobOffset, 0.0);
    vec2 local = a_position - vec2(0.5, 1.0);
    local *= frameSize * scale * spriteHeight;

    vec3 billboardPos = spriteOrigin
      + u_cameraRight * local.x
      + u_cameraUp * (-local.y);

    v_fogDist = distance(worldPos, u_cameraPos);
    gl_Position = u_viewProj * vec4(billboardPos, 1.0);
  }
}
`;

export const billboardFragmentShader = /*glsl*/ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_atlas;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform int u_shadowPass;

in vec2 v_texCoord;
in float v_alpha;
in vec3 v_tint;
in float v_fogDist;
in vec2 v_localUV;

out vec4 fragColor;

void main() {
  if (u_shadowPass == 1) {
    // Shadow: dark ellipse
    vec2 p = (v_localUV - 0.5) * 2.0;
    float dist = length(p);
    if (dist > 1.0) discard;
    float alpha = smoothstep(1.0, 0.4, dist) * v_alpha;

    // Apply fog to shadow too
    float fogFactor = clamp((v_fogDist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
    alpha *= (1.0 - fogFactor);

    fragColor = vec4(0.0, 0.0, 0.0, alpha);
    return;
  }

  vec4 texColor = texture(u_atlas, v_texCoord);
  if (texColor.a < 0.01) discard;

  vec3 color = texColor.rgb * v_tint;

  float fogFactor = clamp((v_fogDist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
  color = mix(color, u_fogColor, fogFactor);

  fragColor = vec4(color, texColor.a * v_alpha);
}
`;
