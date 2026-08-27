// One-off helper: crop a captured screenshot to the 1280x800 (1.6:1) aspect
// ratio Chrome Web Store expects, top-anchored (keeps the toolbar + first
// rows of results, which is what matters), then resize to exactly that
// size. Usage: node process-screenshot.mjs <input.png> <output.png>
import sharp from 'sharp';

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('Usage: node process-screenshot.mjs <input.png> <output.png>');
  process.exit(1);
}

const TARGET_W = 1280;
const TARGET_H = 800;
const TARGET_RATIO = TARGET_W / TARGET_H;

const img = sharp(input);
const meta = await img.metadata();
const { width, height } = meta;

// Crop top-anchored to the target aspect ratio using the full width (our
// captures are always taller/narrower than 1.6:1 given the page content).
const cropHeight = Math.round(width / TARGET_RATIO);
const finalCropHeight = Math.min(cropHeight, height);
const finalCropWidth = Math.round(finalCropHeight * TARGET_RATIO);

await sharp(input)
  .extract({ left: 0, top: 0, width: finalCropWidth, height: finalCropHeight })
  .resize(TARGET_W, TARGET_H)
  .flatten({ background: '#0f1218' }) // no alpha channel allowed
  .png()
  .toFile(output);

console.log(`${input} (${width}x${height}) -> ${output} (${TARGET_W}x${TARGET_H})`);
