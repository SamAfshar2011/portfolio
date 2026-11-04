/**
 * Derives the exploded-cockpit assets from the original Fiscora dashboard
 * capture (which is never modified):
 *
 *   fiscora/module-<name>  each instrument card, cut along its own chamfered
 *                          gold outline (alpha outside the card)
 *   fiscora/cockpit-plate  the dashboard with those cards removed: real holes,
 *                          so a lifted card leaves an empty socket, not a copy
 *
 * Card outlines are measured from the capture itself (the 1–2 px gold border
 * and its cut corners), and the geometry is written to
 * src/projects/fiscora/cockpit.json so the page places every module exactly
 * over its hole. Each module extends a few pixels past its outline and each
 * hole only one, so at rest the module overlaps identical background pixels
 * and the seam is invisible.
 *
 * Usage: node scripts/fiscora-cockpit.mjs   (also run by `npm run media`)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'Assets', 'Images:Videos', 'Fiscora', 'Screenshot 2026-09-22 at 05.30.07.png');
const OUT = join(root, 'src', 'assets', 'media');
const MANIFEST = join(OUT, 'manifest.json');
const GEOMETRY = join(root, 'src', 'projects', 'fiscora', 'cockpit.json');

/** Modules: a search box around each card (source px) and what the card is. */
const MODULES = [
  { name: 'header', search: [0, 0, 3002, 200], label: 'Navigation', depth: 40, strip: true },
  { name: 'balance', search: [266, 498, 1066, 980], label: 'Balance & runway', depth: 150 },
  { name: 'spent', search: [1090, 498, 1894, 980], label: 'Month-end projection', depth: 210 },
  { name: 'health', search: [1918, 498, 2718, 980], label: 'Financial Health Score', depth: 270 },
  { name: 'chart', search: [266, 1004, 1894, 1640], label: 'Last 30 days', depth: 120 },
  { name: 'category', search: [1918, 1004, 2718, 1640], label: 'Category mix', depth: 180 },
];
const MODULE_PAD = 3; // module image extends past the outline (px)
const HOLE_PAD = 1; // hole extends past the outline (px)

const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width;
const H = info.height;
const lum = (x, y) => {
  const i = (y * W + x) * 3;
  return (data[i] + data[i + 1] + data[i + 2]) / 3;
};
const BORDER = 48; // the gold outline is well above the carbon texture (~25) and card fill (~13)
const median = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

/** Scans inward from outside the search box and returns the first border pixel. */
function edge(fixed, from, to, horizontal) {
  const step = from < to ? 1 : -1;
  for (let v = from; v !== to; v += step) {
    const l = horizontal ? lum(v, fixed) : lum(fixed, v);
    if (l > BORDER) return v;
  }
  return null;
}

function measureCard([x0, y0, x1, y1]) {
  const rows = [0.3, 0.4, 0.5, 0.6, 0.7].map((f) => Math.round(y0 + (y1 - y0) * f));
  const cols = [0.3, 0.4, 0.5, 0.6, 0.7].map((f) => Math.round(x0 + (x1 - x0) * f));
  const left = median(rows.map((y) => edge(y, x0 - 16, x0 + 60, true)));
  const right = median(rows.map((y) => edge(y, x1 + 16, x1 - 60, true)));
  const top = median(cols.map((x) => edge(x, y0 - 16, y0 + 60, false)));
  const bottom = median(cols.map((x) => edge(x, y1 + 16, y1 - 60, false)));
  // Cut corners: how far along the top and bottom border lines the gold starts.
  const topRow = top + 1;
  const botRow = bottom - 1;
  const tl = edge(topRow, left, right, true) - left;
  const tr = right - edge(topRow, right, left, true);
  const bl = edge(botRow, left, right, true) - left;
  const br = right - edge(botRow, right, left, true);
  const snap = (c) => (c > 6 ? c : 0);
  return { left, top, right: right + 1, bottom: bottom + 1, cut: { tl: snap(tl), tr: snap(tr), br: snap(br), bl: snap(bl) } };
}

function measureStrip([x0, y0, x1, y1]) {
  // The navigation bar ends at a full-width hairline.
  const ys = [200, 800, 1500, 2200, 2800].map((x) => edge(x, y1, y0 + 100, false));
  return { left: x0, top: y0, right: x1, bottom: median(ys) + 1, cut: { tl: 0, tr: 0, br: 0, bl: 0 } };
}

/** Outline polygon of a card, grown by `g` px (cut corners stay 45°). */
function polygon(c, g) {
  const l = c.left - g;
  const t = c.top - g;
  const r = c.right + g;
  const b = c.bottom + g;
  const k = Math.tan(Math.PI / 8) * g; // a grown 45° corner moves by g·tan(22.5°)
  const cut = (v) => (v > 0 ? v + k : 0);
  const { tl, tr, br, bl } = c.cut;
  return [
    [l + cut(tl), t],
    [r - cut(tr), t],
    [r, t + cut(tr)],
    [r, b - cut(br)],
    [r - cut(br), b],
    [l + cut(bl), b],
    [l, b - cut(bl)],
    [l, t + cut(tl)],
  ];
}
const svgPath = (pts, dx = 0, dy = 0) => 'M' + pts.map(([x, y]) => `${(x - dx).toFixed(2)},${(y - dy).toFixed(2)}`).join('L') + 'Z';

async function encode(key, buf, widths, quality = 84) {
  mkdirSync(join(OUT, dirname(key)), { recursive: true });
  const meta = await sharp(buf).metadata();
  const usable = [...new Set(widths.map((w) => Math.min(w, meta.width)))];
  for (const w of usable) {
    const img = sharp(buf).resize({ width: w, withoutEnlargement: true });
    const stem = join(OUT, `${key}-${w}`);
    await img.clone().avif({ quality: quality - 18, effort: 6 }).toFile(`${stem}.avif`);
    await img.clone().webp({ quality, alphaQuality: 100, effort: 6 }).toFile(`${stem}.webp`);
  }
  return { width: meta.width, height: meta.height, widths: usable };
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const geometry = { source: { w: W, h: H }, modules: [] };
const holes = [];

for (const m of MODULES) {
  const c = m.strip ? measureStrip(m.search) : measureCard(m.search);
  const outer = polygon(c, MODULE_PAD);
  holes.push(polygon(c, HOLE_PAD));
  const x0 = Math.max(0, Math.floor(Math.min(...outer.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...outer.map((p) => p[1]))));
  const x1 = Math.min(W, Math.ceil(Math.max(...outer.map((p) => p[0]))));
  const y1 = Math.min(H, Math.ceil(Math.max(...outer.map((p) => p[1]))));
  const w = x1 - x0;
  const h = y1 - y0;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="${svgPath(outer, x0, y0)}" fill="#fff"/></svg>`);
  const buf = await sharp(SRC)
    .extract({ left: x0, top: y0, width: w, height: h })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const key = `fiscora/module-${m.name}`;
  manifest[key] = await encode(key, buf, [720, 1400]);
  geometry.modules.push({
    id: key,
    name: m.name,
    label: m.label,
    depth: m.depth,
    box: [x0, y0, x1, y1],
    outline: { left: c.left, top: c.top, right: c.right, bottom: c.bottom, cut: c.cut },
  });
  console.log(`module ${m.name.padEnd(9)} outline ${c.left},${c.top} → ${c.right},${c.bottom}  cuts`, c.cut, ` image ${w}×${h}`);
}

// The backplate: every card punched out of the capture.
const holeSvg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${holes.map((p) => `<path d="${svgPath(p)}" fill="#fff"/>`).join('')}</svg>`,
);
const plate = await sharp(SRC).ensureAlpha().composite([{ input: holeSvg, blend: 'dest-out' }]).png().toBuffer();
manifest['fiscora/cockpit-plate'] = await encode('fiscora/cockpit-plate', plate, [1280, 2400], 82);

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
writeFileSync(GEOMETRY, JSON.stringify(geometry, null, 1) + '\n');
console.log('cockpit geometry →', GEOMETRY.slice(root.length + 1));
