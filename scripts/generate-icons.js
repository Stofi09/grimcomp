#!/usr/bin/env node
/* eslint-disable */
// Generates the App Store icon and Android adaptive-icon foreground from a single
// SVG. Run via `npm run icons`. Requires `sharp` (dev dep).
//
// The mark is the same "G" that appears on the rail brand block in-app: italic
// IM Fell English glyph on a parchment ivory tile, brass border, two brass
// diamond accents recalling the section dividers in styles.css.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ASSETS = path.join(__dirname, '..', 'assets');
fs.mkdirSync(ASSETS, { recursive: true });

// Palette mirrors src/theme/colors.ts.
const C = {
  parchment: '#ece2d0',
  ivory: '#fbf3df',
  bone: '#f3e8d0',
  brass: '#8a6f1c',
  brassSoft: '#c9a227',
  ink: '#1f1812',
  empire: '#7d1f1f',
  borderStrong: '#8d7a5b',
};

// Square SVG suitable for both iOS (1024) and Android adaptive foreground (432
// safe zone in 1024 image — we keep our content well within the centre).
function svgIcon({ size = 1024, withBackground = true } = {}) {
  const cx = size / 2;
  const cy = size / 2;
  const ringInner = size * 0.40;
  const ringOuter = size * 0.46;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="parchment" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.ivory}"/>
      <stop offset="1" stop-color="${C.bone}"/>
    </linearGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.brassSoft}"/>
      <stop offset="1" stop-color="${C.brass}"/>
    </linearGradient>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.7">
      <stop offset="0.6" stop-color="rgba(0,0,0,0)"/>
      <stop offset="1" stop-color="rgba(60,40,15,0.18)"/>
    </radialGradient>
  </defs>

  ${withBackground ? `<rect width="${size}" height="${size}" fill="url(#parchment)"/>
  <rect width="${size}" height="${size}" fill="url(#vignette)"/>` : ''}

  <!-- outer thin border -->
  ${withBackground ? `<rect x="${size * 0.04}" y="${size * 0.04}" width="${size * 0.92}" height="${size * 0.92}" rx="${size * 0.10}"
        fill="none" stroke="${C.borderStrong}" stroke-width="${size * 0.006}" />` : ''}

  <!-- brass medallion ring -->
  <circle cx="${cx}" cy="${cy}" r="${ringOuter}" fill="none" stroke="url(#brass)" stroke-width="${size * 0.020}" />
  <circle cx="${cx}" cy="${cy}" r="${ringInner}" fill="none" stroke="url(#brass)" stroke-width="${size * 0.010}" />

  <!-- The italic "G" — IM Fell English. We use Georgia italic as a fallback that
       Apple's renderer is happy with; the visual character is similar enough at
       icon scale. -->
  <text x="${cx}" y="${cy + size * 0.13}"
        text-anchor="middle"
        font-family="Georgia, 'Times New Roman', serif"
        font-style="italic"
        font-weight="400"
        font-size="${size * 0.62}"
        fill="${C.ink}">G</text>

  <!-- Two brass diamonds recalling the section dividers -->
  <g fill="${C.brass}">
    <rect x="${cx - size * 0.36}" y="${cy - size * 0.020}" width="${size * 0.040}" height="${size * 0.040}" transform="rotate(45 ${cx - size * 0.34} ${cy})"/>
    <rect x="${cx + size * 0.32}" y="${cy - size * 0.020}" width="${size * 0.040}" height="${size * 0.040}" transform="rotate(45 ${cx + size * 0.34} ${cy})"/>
  </g>

  <!-- empire-red ribbon dot at the top, echoing the rail ribbon -->
  <rect x="${cx - size * 0.020}" y="${size * 0.08}" width="${size * 0.040}" height="${size * 0.10}"
        fill="${C.empire}"/>
</svg>`;
}

async function pngFromSvg(svg, outPath, { size = 1024 } = {}) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`  → ${path.relative(process.cwd(), outPath)}`);
}

async function main() {
  console.log('Generating icons…');

  // iOS / launcher icon — 1024x1024 with background
  const ios = svgIcon({ size: 1024, withBackground: true });
  await pngFromSvg(ios, path.join(ASSETS, 'icon.png'), { size: 1024 });

  // Splash mark — same as icon but rendered against bg colour at runtime
  await pngFromSvg(ios, path.join(ASSETS, 'splash-icon.png'), { size: 1024 });

  // Android adaptive icon — foreground only (no parchment background; that's
  // supplied by `adaptiveIcon.backgroundColor` in app.json). Keep content in
  // the centre safe zone (66% of the canvas).
  const fg = svgIcon({ size: 1024, withBackground: false });
  await pngFromSvg(fg, path.join(ASSETS, 'adaptive-icon.png'), { size: 1024 });

  // Favicon
  await pngFromSvg(ios, path.join(ASSETS, 'favicon.png'), { size: 256 });

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
