/**
 * Real outputs of the PlateHunter pipeline on eight photographs supplied with
 * the project. Boxes come from the green detections in the annotated outputs
 * (see scripts/analyze-alpr-media.py); text and confidence are the labels the
 * pipeline drew on each image.
 */
export interface PlateRead {
  /** Box in source-image pixels: x0, y0, x1, y1. */
  box: [number, number, number, number];
  /** Pipeline output, Latin transliteration, grouped DD L DDD DD. */
  latin: string;
  /** The same plate in Persian script. */
  persian: string;
  /** Final combined confidence as printed by the pipeline. */
  confidence: string;
  crop: string;
}

export interface Scene {
  n: number;
  title: string;
  alt: string;
  size: [number, number];
  plates: PlateRead[];
}

export const SCENES: Scene[] = [
  {
    n: 5,
    title: 'Headlights, no street light',
    alt: 'Two dark cars at night with bright headlights; the plate of the right car is barely lit',
    size: [6000, 4000],
    plates: [{ box: [3593, 2114, 4272, 2286], latin: '52 Gh 462 11', persian: '۵۲ ق ۴۶۲ ۱۱', confidence: '0.80', crop: 'alpr/plates/5-plate_01' }],
  },
  {
    n: 4,
    title: 'Wet street, two cars',
    alt: 'A wet, leaf-covered residential street with parked cars; two plates are read',
    size: [3840, 5760],
    plates: [
      { box: [1202, 3208, 1375, 3268], latin: '42 M 683 11', persian: '۴۲ م ۶۸۳ ۱۱', confidence: '0.73', crop: 'alpr/plates/4-plate_02' },
      { box: [2215, 3114, 2358, 3156], latin: '17 Y 496 10', persian: '۱۷ ی ۴۹۶ ۱۰', confidence: '0.54', crop: 'alpr/plates/4-plate_01' },
    ],
  },
  {
    n: 6,
    title: 'Two taxis, one frame',
    alt: 'Two yellow Tehran taxis in front of a metro station; both taxi plates are read',
    size: [749, 489],
    plates: [
      { box: [8, 420, 66, 456], latin: '47 Taxi 612 22', persian: '۴۷ ت ۶۱۲ ۲۲', confidence: '0.81', crop: 'alpr/plates/6-plate_01' },
      { box: [545, 442, 655, 484], latin: '48 Taxi 115 22', persian: '۴۸ ت ۱۱۵ ۲۲', confidence: '≥ 0.80', crop: 'alpr/plates/6-plate_02' },
    ],
  },
  {
    n: 7,
    title: 'Sodium light, low angle',
    alt: 'A white car at night under orange street light, photographed from a low angle',
    size: [960, 1280],
    plates: [{ box: [422, 507, 531, 536], latin: '37 J 656 66', persian: '۳۷ ج ۶۵۶ ۶۶', confidence: '0.85', crop: 'alpr/plates/7-plate_01' }],
  },
  {
    n: 8,
    title: 'A different plate type',
    alt: 'The rear of a black sedan with a blue plate bearing the letter D',
    size: [788, 496],
    plates: [{ box: [261, 237, 524, 310], latin: '11 D 243 11', persian: '۱۱ D ۲۴۳ ۱۱', confidence: '0.83', crop: 'alpr/plates/8-plate_01' }],
  },
];

/** The hero pipeline scene: the BMW plate, character by character. */
export const HERO = {
  /** alpr/hero is a crop of scene 5 starting at (1800, 900), 4200 × 2800. */
  crop: { x: 1800, y: 900, w: 4200, h: 2800 },
  /** The saved plate crop (716 × 197) covers the detection plus padding. */
  plateCrop: { box: [3573, 2100, 4292, 2300] as [number, number, number, number], w: 716, h: 197 },
  detection: [3593, 2114, 4272, 2286] as [number, number, number, number],
  /** Character crops located inside the plate crop by template matching. */
  chars: [
    [56, 22, 142, 178],
    [124, 19, 211, 178],
    [205, 18, 327, 180],
    [320, 15, 407, 177],
    [391, 15, 477, 177],
    [461, 12, 548, 175],
    [558, 38, 632, 175],
    [628, 36, 700, 173],
  ] as [number, number, number, number][],
  glyphs: ['۵', '۲', 'ق', '۴', '۶', '۲', '۱', '۱'],
  classes: ['5', '2', 'Gh', '4', '6', '2', '1', '1'],
  latin: '52 Gh 462 11',
  confidence: '0.80',
};
