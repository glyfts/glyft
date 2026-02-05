/**
 * Tilemap shaders.
 *
 * Renders entire tilemap in a single draw call using GPU texture lookup.
 */

export const tilemapVertexShader = /*glsl*/ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;  // 0,0 to 1,1 (fullscreen quad)

uniform mat3 u_projection;
uniform vec2 u_mapSize;       // Map size in tiles
uniform vec2 u_tileSize;      // Tile size in pixels
uniform vec2 u_cameraPos;     // Camera position in pixels
uniform vec2 u_viewportSize;  // Viewport size in pixels

out vec2 v_worldPos;  // World position in pixels

void main() {
  // Calculate world position for this fragment
  vec2 viewportPos = a_position * u_viewportSize;
  v_worldPos = viewportPos + u_cameraPos;

  // Position the quad to fill the viewport
  vec2 clipPos = a_position * 2.0 - 1.0;
  gl_Position = vec4(clipPos.x, -clipPos.y, 0.0, 1.0);
}
`;

export const tilemapFragmentShader = /*glsl*/ `#version 300 es
precision highp float;

uniform sampler2D u_mapTexture;   // Tilemap data (R=tileIndex, G=flags, B=anim, A=reserved)
uniform sampler2D u_atlasTexture; // Tile atlas
uniform vec2 u_mapSize;           // Map size in tiles
uniform vec2 u_tileSize;          // Tile size in pixels
uniform vec2 u_atlasSize;         // Atlas size in pixels
uniform int u_tilesPerRow;        // Tiles per row in atlas
uniform float u_time;             // Current time for animated tiles

in vec2 v_worldPos;

out vec4 fragColor;

void main() {
  // Calculate tile coordinates
  vec2 tileCoord = floor(v_worldPos / u_tileSize);

  // Bounds check
  if (tileCoord.x < 0.0 || tileCoord.x >= u_mapSize.x ||
      tileCoord.y < 0.0 || tileCoord.y >= u_mapSize.y) {
    fragColor = vec4(0.0);
    return;
  }

  // Sample map texture to get tile data
  vec2 mapUV = (tileCoord + 0.5) / u_mapSize;
  vec4 tileData = texture(u_mapTexture, mapUV);

  // Decode tile index (R channel, stored as index+1 so 0 means empty)
  int rawIndex = int(tileData.r * 255.0);

  // Empty tile (0 = no tile)
  if (rawIndex == 0) {
    fragColor = vec4(0.0);
    return;
  }

  // Convert back to 0-based tile index
  int tileIndex = rawIndex - 1;

  // Calculate tile position in atlas
  int tileX = tileIndex % u_tilesPerRow;
  int tileY = tileIndex / u_tilesPerRow;

  // Calculate UV within the tile
  vec2 tileUV = fract(v_worldPos / u_tileSize);

  // Calculate final UV in atlas
  vec2 atlasPos = vec2(float(tileX), float(tileY)) * u_tileSize;
  vec2 uv = (atlasPos + tileUV * u_tileSize) / u_atlasSize;

  // Sample atlas
  fragColor = texture(u_atlasTexture, uv);
}
`;
