import '@fontsource-variable/vazirmatn/wght.css';
import { stageRef } from './stageRef';
import { director } from '../experience/director';
import type { AtlasGroup } from './text/atlas';

/**
 * What gets etched inside the glass, and in which lettering. Pages register
 * their groups; the stage keeps one atlas for all of them (see Stage.registerEtch).
 */
const SIZE = 96;

/** Beat labels along the bottom of the story slabs: the site's meta lettering. */
export function etchStory(labels: string[]) {
  register('story', {
    labels: labels.map((l) => l.toUpperCase()),
    spec: { family: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace", weight: 430, size: SIZE, tracking: 0.14, radius: 14 },
  });
}

/**
 * The eight characters of a real plate, one per chamber of the plate
 * formation, in Vazirmatn (the face the pipeline itself draws Persian with).
 * `set` names the plate so a page can say which one its glass should carry.
 */
export function etchPlate(set: string, glyphs: string[]) {
  register(`plate:${set}`, {
    labels: glyphs,
    center: true,
    spec: { family: "'Vazirmatn Variable', Vazirmatn, sans-serif", weight: 560, size: SIZE, radius: 14 },
  });
  director.channels.plateSet = set;
}

function register(name: string, group: AtlasGroup) {
  stageRef.ready().then((s) => s?.registerEtch(name, group));
}
