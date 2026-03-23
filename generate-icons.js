// Generate PWA icons — run once: node generate-icons.js
const fs = require('fs');
const path = require('path');

// Simple SVG icon with HA logo on green gradient
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#34c759"/>
      <stop offset="100%" stop-color="#248a3d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="108" fill="url(#bg)"/>
  <text x="256" y="290" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="200" font-weight="800" fill="white" text-anchor="middle" dominant-baseline="middle">HA</text>
</svg>`;

const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

// Save SVG
fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svg);

// Try to generate PNGs with sharp
try {
  const sharp = require('sharp');
  const svgBuf = Buffer.from(svg);

  sharp(svgBuf).resize(192, 192).png().toFile(path.join(iconsDir, 'icon-192.png'))
    .then(() => console.log('✅ icon-192.png generated'))
    .catch(e => console.log('⚠️ 192 error:', e.message));

  sharp(svgBuf).resize(512, 512).png().toFile(path.join(iconsDir, 'icon-512.png'))
    .then(() => console.log('✅ icon-512.png generated'))
    .catch(e => console.log('⚠️ 512 error:', e.message));

  // Apple touch icon
  sharp(svgBuf).resize(180, 180).png().toFile(path.join(iconsDir, 'apple-touch-icon.png'))
    .then(() => console.log('✅ apple-touch-icon.png generated'))
    .catch(e => console.log('⚠️ apple error:', e.message));

} catch (e) {
  console.log('⚠️ sharp not available. SVG saved to public/icons/icon.svg');
  console.log('Run: npm install sharp && node generate-icons.js');
}
