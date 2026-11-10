// Draws the app icon (a weight stack with the pin in the yellow plate) and writes
// every size the manifest and iOS ask for into public/. Run with: npm run icons

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const INK = '#17212B', LIGHT = '#E9ECEE', ACCENT = '#F5B800';

// The drawing on a 512 canvas, centered, before any background or scaling.
const art = `
  <rect x="287" y="92" width="14" height="50" rx="5" fill="${LIGHT}"/>
  <rect x="173" y="135" width="242" height="62" rx="9" fill="${LIGHT}"/>
  <circle cx="203" cy="166" r="9" fill="#9AA7B3"/>
  <rect x="173" y="209" width="242" height="62" rx="9" fill="${LIGHT}"/>
  <circle cx="203" cy="240" r="9" fill="#9AA7B3"/>
  <rect x="173" y="283" width="242" height="62" rx="9" fill="${ACCENT}"/>
  <rect x="173" y="357" width="242" height="62" rx="9" fill="#34414D"/>
  <circle cx="203" cy="388" r="9" fill="#51606D"/>
  <rect x="112" y="305" width="108" height="18" rx="9" fill="${LIGHT}"/>
  <circle cx="116" cy="314" r="23" fill="${LIGHT}"/>
`;

const svg = ({ radius = 0, scale = 1 }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="${radius}" fill="${INK}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${art}</g>
</svg>`;

const rounded = svg({ radius: 112 });
const square = svg({});
const maskable = svg({ scale: 0.74 }); // keeps the drawing inside the safe circle launchers crop to

const png = (source, size, name) => sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toFile(join(out, name));

writeFileSync(join(out, 'favicon.svg'), rounded);
await Promise.all([
  png(rounded, 192, 'icon-192.png'),
  png(rounded, 512, 'icon-512.png'),
  png(maskable, 512, 'icon-maskable-512.png'),
  png(square, 180, 'apple-touch-icon.png'),
]);
console.log('Icons written to public/');
