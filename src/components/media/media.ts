import manifest from '../../assets/media/manifest.json';

/**
 * Every derived media file is imported through Vite (hashed, cache-safe URLs,
 * build fails on a missing file). The manifest written by
 * scripts/process-media.mjs provides intrinsic sizes and available widths.
 */
const files = import.meta.glob('../../assets/media/**/*.{avif,webp,png,mp4,webm}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

export interface MediaEntry {
  width: number;
  height: number;
  widths: number[];
  png?: boolean;
  video?: boolean;
}

const entries = manifest as unknown as Record<string, MediaEntry>;

export function mediaEntry(id: string): MediaEntry {
  const e = entries[id];
  if (!e) throw new Error(`Unknown media id: ${id}`);
  return e;
}

export function mediaUrl(id: string, width?: number, ext: 'avif' | 'webp' | 'png' | 'mp4' | 'webm' = 'webp') {
  const key = width ? `../../assets/media/${id}-${width}.${ext}` : `../../assets/media/${id}.${ext}`;
  const url = files[key];
  if (!url) throw new Error(`Missing media file: ${key}`);
  return url;
}

export function srcSet(id: string, ext: 'avif' | 'webp') {
  const e = mediaEntry(id);
  return e.widths.map((w) => `${mediaUrl(id, w, ext)} ${w}w`).join(', ');
}
