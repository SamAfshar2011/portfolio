/**
 * Builds web-ready derivatives from the original project media in /Assets.
 * The originals are never modified. Output goes to src/assets/media and a
 * manifest (dimensions + variants) is written next to it so components can
 * render correctly-sized <picture> elements without layout shift.
 *
 * Requires: sharp (devDependency), ffmpeg and pdftoppm on PATH.
 * Usage: npm run media
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'Assets', 'Images:Videos');
const OUT = join(root, 'src', 'assets', 'media');
const manifest = {};

const ensure = (p) => mkdirSync(p, { recursive: true });

/**
 * Encodes one image (optionally cropped) into AVIF + WebP at several widths.
 * `key` becomes the manifest id and the file stem.
 */
async function picture(key, file, { crop, widths = [960, 1920], quality = 78, sharpen = false } = {}) {
  const dir = join(OUT, dirname(key));
  ensure(dir);
  let base = sharp(file, { limitInputPixels: false });
  if (crop) base = base.extract({ left: crop[0], top: crop[1], width: crop[2] - crop[0], height: crop[3] - crop[1] });
  const buf = await base.png().toBuffer();
  const meta = await sharp(buf).metadata();
  const usable = [...new Set(widths.map((w) => Math.min(w, meta.width)))];
  for (const w of usable) {
    let img = sharp(buf).resize({ width: w, withoutEnlargement: true });
    if (sharpen) img = img.sharpen({ sigma: 0.6 });
    const stem = join(OUT, `${key}-${w}`);
    await img.clone().avif({ quality: quality - 18, effort: 6 }).toFile(`${stem}.avif`);
    await img.clone().webp({ quality, effort: 6 }).toFile(`${stem}.webp`);
  }
  manifest[key] = { width: meta.width, height: meta.height, widths: usable };
  console.log('image', key, meta.width, 'x', meta.height, usable.join(','));
}

/** Copies a small PNG verbatim (character crops: their low resolution is the point). */
async function raw(key, file) {
  const dest = join(OUT, `${key}.png`);
  ensure(dirname(dest));
  copyFileSync(file, dest);
  const meta = await sharp(file).metadata();
  manifest[key] = { width: meta.width, height: meta.height, widths: [], png: true };
}

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
}

// ---------------------------------------------------------------- Fiscora
const F = join(SRC, 'Fiscora');
const fDash = join(F, 'Screenshot 2026-09-22 at 05.30.07.png');
const fTx = join(F, 'Screenshot 2026-09-22 at 05.30.22.png');
const fIns = join(F, 'Screenshot 2026-09-22 at 05.30.28.png');
await picture('fiscora/dashboard', fDash, { widths: [1280, 2400] });
await picture('fiscora/transactions', fTx, { widths: [1280, 2400] });
await picture('fiscora/insights', fIns, { widths: [1280, 2400] });
// UI decomposition: individual instrument panels, cropped from the 3002x1722 captures.
const panels = {
  header: [fDash, [0, 0, 3002, 176]],
  balance: [fDash, [266, 498, 1066, 980]],
  spent: [fDash, [1090, 498, 1894, 980]],
  health: [fDash, [1918, 498, 2718, 980]],
  chart: [fDash, [266, 1004, 1894, 1640]],
  category: [fDash, [1918, 1004, 2718, 1640]],
  transactions: [fTx, [1296, 176, 2718, 1722]],
  whatif: [fIns, [1710, 172, 2718, 1024]],
  insights: [fIns, [266, 172, 1688, 1024]],
  recurring: [fIns, [1504, 1052, 2718, 1690]],
};
for (const [name, [file, crop]] of Object.entries(panels)) {
  await picture(`fiscora/panel-${name}`, file, { crop, widths: [720, 1400], quality: 82 });
}

// ------------------------------------------------------------------- ANKA
const A = join(SRC, 'Anka');
await picture('anka/predictor', join(A, 'Screenshot 2026-09-22 at 05.23.17.png'), { widths: [1280, 2400] });
await picture('anka/predictor-card', join(A, 'Screenshot 2026-09-22 at 05.23.44.png'), { widths: [800, 1600] });
{
  const tmp = join(tmpdir(), 'anka-report');
  execFileSync('pdftoppm', ['-r', '220', '-png', '-singlefile', join(A, 'report_05_25_05.pdf'), tmp]);
  await picture('anka/report', `${tmp}.png`, { widths: [900, 1600], quality: 84 });
}
{
  // The recording is 240fps HiDPI. Cut it into a short, speed-ramped loop:
  // form entry at 3x, then the result reveal at real time.
  const mov = join(A, 'Screen Recording 2026-09-22 at 05.24.52.mov');
  const dir = join(OUT, 'anka');
  const filter =
    '[0:v]trim=0:11,setpts=(PTS-STARTPTS)/3[a];' +
    '[0:v]trim=11:15.8,setpts=PTS-STARTPTS[b];' +
    '[a][b]concat=n=2:v=1:a=0,fps=30,crop=1760:1722:621:0,scale=1100:-2:flags=lanczos,format=yuv420p[v]';
  ffmpeg(['-i', mov, '-filter_complex', filter, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow',
    '-crf', '26', '-profile:v', 'high', '-movflags', '+faststart', join(dir, 'predictor-loop.mp4')]);
  ffmpeg(['-i', mov, '-filter_complex', filter, '-map', '[v]', '-an', '-c:v', 'libvpx-vp9', '-b:v', '0',
    '-crf', '38', '-row-mt', '1', join(dir, 'predictor-loop.webm')]);
  const posterTmp = join(tmpdir(), 'anka-poster.png');
  ffmpeg(['-ss', '15.4', '-i', mov, '-frames:v', '1', '-vf', 'crop=1760:1722:621:0', posterTmp]);
  await picture('anka/predictor-poster', posterTmp, { widths: [1100], quality: 80 });
  manifest['anka/predictor-loop'] = { width: 1100, height: 1076, video: true };
}
{
  const logo = join(root, 'scripts', 'source', 'anka-logo.png');
  if (existsSync(logo)) await picture('anka/logo', logo, { widths: [256, 512], quality: 86 });
}

// ------------------------------------------------------------------- ALPR
const C = join(SRC, 'CLPR');
const scenes = {
  4: '03_dark_wet_street_multicar',
  5: '02_extreme_dark_bmw',
  6: 'commons_008_02_Tehran_Metro_Line_3_1',
  7: 'night (735)_extra',
  8: '9991519_594',
};
for (const [n, stem] of Object.entries(scenes)) {
  const dir = join(C, `Image_${n}`);
  await picture(`alpr/scene-${n}`, join(dir, `${stem}.jpg`), { widths: [960, 1920], quality: 76 });
  await picture(`alpr/scene-${n}-annotated`, join(dir, `${stem}_annotated.png`), { widths: [960, 1920], quality: 76 });
}
// Hero pipeline scene: a wide crop around the BMW's front, where the plate sits.
await picture('alpr/hero', join(C, 'Image_5', '02_extreme_dark_bmw.jpg'), {
  crop: [1800, 900, 6000, 3700],
  widths: [1280, 2400],
  quality: 80,
});
const plates = { 4: ['plate_01', 'plate_02'], 5: ['plate_01'], 6: ['plate_01', 'plate_02'], 7: ['plate_01'], 8: ['plate_01'] };
for (const [n, list] of Object.entries(plates)) {
  for (const p of list) {
    const dir = join(C, `Image_${n}`, p);
    await raw(`alpr/plates/${n}-${p}`, join(dir, 'plate_crop.png'));
    for (let i = 1; i <= 8; i++) {
      await raw(`alpr/chars/${n}-${p}-${i}`, join(dir, `char_0${i}.png`));
    }
  }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log('manifest entries:', Object.keys(manifest).length);
