#!/usr/bin/env node
/**
 * Generate PNG icons from the SVG source
 * Run: npm install sharp && node scripts/generate-icons.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, '../public/icon.svg');
const outputDir = path.join(__dirname, '../public');

const sizes = [192, 512];

async function generateIcons() {
  const svgBuffer = fs.readFileSync(svgPath);

  for (const size of sizes) {
    const outputPath = path.join(outputDir, `icon-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`Generated: icon-${size}.png`);
  }

  // Also generate a 180x180 for apple-touch-icon
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(path.join(outputDir, 'apple-touch-icon.png'));
  console.log('Generated: apple-touch-icon.png');

  console.log('Done!');
}

generateIcons().catch(console.error);
