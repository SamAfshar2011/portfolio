import { DataTexture, RedFormat, UnsignedByteType, LinearFilter, NoColorSpace } from 'three/webgpu';
import { createSdfText, type SdfTextSpec } from './sdf';
import type { EtchAtlas } from '../stack/slab';

export interface AtlasGroup {
  labels: string[];
  spec: Omit<SdfTextSpec, 'text'>;
  /** Centre each label horizontally in its row (single glyphs) instead of left-aligning. */
  center?: boolean;
}

/**
 * Short labels as one SDF texture, one row per label, all at the same em size
 * (the specs must share `size`) and sitting on a shared baseline, so a shader
 * can pick a row by index and keep lettering consistent between rows.
 */
export async function createSdfAtlas(groups: AtlasGroup[]): Promise<EtchAtlas & { offsets: number[] }> {
  const parts = await Promise.all(
    groups.flatMap((g) => g.labels.map((text) => createSdfText({ ...g.spec, text }).then((r) => ({ r, center: !!g.center })))),
  );
  const size = parts[0].r.size;
  const w = Math.max(...parts.map((p) => p.r.width));
  // Row height fits the tallest label with every label on the same baseline.
  const below = Math.max(...parts.map((p) => p.r.descent));
  const rowH = Math.max(...parts.map((p) => p.r.height - p.r.descent + below));
  const data = new Uint8Array(w * rowH * parts.length);
  parts.forEach(({ r, center }, row) => {
    const src = r.texture.image.data as Uint8Array;
    const x0 = center ? Math.floor((w - r.width) / 2) : 0;
    const y0 = below - r.descent;
    // Rows are stored bottom-up.
    for (let y = 0; y < r.height; y++) {
      const ty = y + y0;
      if (ty < 0 || ty >= rowH) continue;
      data.set(src.subarray(y * r.width, (y + 1) * r.width), (row * rowH + ty) * w + x0);
    }
    r.texture.dispose();
  });
  const texture = new DataTexture(data, w, rowH * parts.length, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = NoColorSpace;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  const offsets: number[] = [];
  let acc = 0;
  for (const g of groups) {
    offsets.push(acc);
    acc += g.labels.length;
  }
  return { texture, rows: parts.length, widthEm: w / size, rowEm: rowH / size, offsets };
}
