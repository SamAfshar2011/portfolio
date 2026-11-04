/** Renders the SVG mark into the PNG icon sizes browsers and home screens use. */
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/favicon.svg'));
const out = join(root, 'public/icons');
mkdirSync(out, { recursive: true });
for (const [name, size] of [
  ['icon-32.png', 32],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(svg, { density: 512 }).resize(size, size).png().toFile(join(out, name));
}
// Maskable icon: the mark with extra safe-zone padding on a full-bleed ground.
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b0b0c' } })
  .composite([{ input: await sharp(svg, { density: 512 }).resize(360, 360).png().toBuffer(), gravity: 'center' }])
  .png()
  .toFile(join(out, 'icon-maskable-512.png'));
console.log('icons written');
