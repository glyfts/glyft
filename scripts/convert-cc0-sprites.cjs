#!/usr/bin/env node
/**
 * Convert CC0 sprite sheets to Glyft-compatible format.
 *
 * CC0 Source layout (768x256, 32x32 frames, 24 cols × 8 rows):
 *   Rows 0-1: Down (2 variants)
 *   Rows 2-3: Up (2 variants)
 *   Rows 4-5: Left (2 variants)
 *   Rows 6-7: Right (2 variants)
 *   Columns: [walk 0-5][attack 6-11][other...]
 *
 * Glyft output layout (192x128, 32x32 frames, 6 cols × 4 rows):
 *   Row 0: Down  [idle, walk0-4]
 *   Row 1: Right [idle, walk0-4]
 *   Row 2: Up    [idle, walk0-4]
 *   Row 3: Left  [idle, walk0-4]
 *
 * Usage: node convert-cc0-sprites.js <input.png> <output.png>
 */

const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');

const FRAME_SIZE = 32;
const IDLE_FRAMES = 1;
const WALK_FRAMES = 4;  // 4 walk frames (source frames 1-4), frame 5+ is attack
const TOTAL_FRAMES = IDLE_FRAMES + WALK_FRAMES; // 5 frames per row

// CC0 source rows (using first variant of each direction)
const SOURCE_ROWS = {
  down: 0,   // Row 0
  up: 2,     // Row 2
  left: 4,   // Row 4
  right: 6,  // Row 6
};

// Glyft output rows
const OUTPUT_ROWS = {
  down: 0,
  right: 1,
  up: 2,
  left: 3,
};

async function convertSprite(inputPath, outputPath) {
  const img = await loadImage(inputPath);

  // Output: 6 frames wide, 4 rows
  const outWidth = TOTAL_FRAMES * FRAME_SIZE;   // 192px
  const outHeight = 4 * FRAME_SIZE;              // 128px

  const canvas = createCanvas(outWidth, outHeight);
  const ctx = canvas.getContext('2d');

  // Clear with transparency
  ctx.clearRect(0, 0, outWidth, outHeight);

  // Helper to copy frames from source row to dest row
  function copyFrames(srcRow, dstRow, srcCol, dstCol, count) {
    for (let i = 0; i < count; i++) {
      const sx = (srcCol + i) * FRAME_SIZE;
      const sy = srcRow * FRAME_SIZE;
      const dx = (dstCol + i) * FRAME_SIZE;
      const dy = dstRow * FRAME_SIZE;
      ctx.drawImage(img, sx, sy, FRAME_SIZE, FRAME_SIZE, dx, dy, FRAME_SIZE, FRAME_SIZE);
    }
  }

  // Copy each direction
  // Source has walk animation starting at col 0
  // Output: [idle (col 0)][walk (cols 1-5)]
  // Use frame 0 as idle, frames 1-5 as walk

  for (const [dir, srcRow] of Object.entries(SOURCE_ROWS)) {
    const dstRow = OUTPUT_ROWS[dir];
    // Copy idle frame (source col 0 -> dest col 0)
    copyFrames(srcRow, dstRow, 0, 0, IDLE_FRAMES);
    // Copy walk frames (source cols 1-5 -> dest cols 1-5)
    copyFrames(srcRow, dstRow, 1, IDLE_FRAMES, WALK_FRAMES);
  }

  // Save output
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);

  console.log(`Converted: ${inputPath} -> ${outputPath}`);
  console.log(`Output: ${outWidth}x${outHeight} (${TOTAL_FRAMES} frames × 4 rows)`);
  console.log(`Format: [idle×${IDLE_FRAMES}][walk×${WALK_FRAMES}]`);
  console.log(`Rows: Down(0), Right(1), Up(2), Left(3)`);
}

// Batch convert all sprites in templates folder
async function convertAll() {
  const templatesDir = path.join(__dirname, '..', 'templates');
  const outputDir = path.join(__dirname, '..', 'sprites');

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.png') && !f.startsWith('spritesheet-'));

  for (const file of files) {
    const inputPath = path.join(templatesDir, file);
    const outputPath = path.join(outputDir, file);
    await convertSprite(inputPath, outputPath);
  }

  console.log(`\nDone! Converted ${files.length} sprites to ${outputDir}`);
}

// Main
const args = process.argv.slice(2);
if (args.length === 0) {
  // Batch mode
  convertAll().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
} else if (args.length === 2) {
  // Single file mode
  convertSprite(args[0], args[1]).catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
} else {
  console.log('Usage: node convert-cc0-sprites.js [<input.png> <output.png>]');
  console.log('       Without args: batch convert all templates/*.png');
  process.exit(1);
}
