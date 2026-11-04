import { Picture } from '../../components/media/Picture';
import type { ProjectSlug } from '../../projects/types';
import { director } from '../../experience/director';

/**
 * The plate in the ALPR teaser (scene 8: "11 D 243 11"), character by
 * character as the pipeline read it. The glass plate beside it carries the
 * same eight characters etched in its chambers.
 */
export const TEASER_PLATE = ['۱', '۱', 'D', '۲', '۴', '۳', '۱', '۱'];

/**
 * A fragment of the real project, floating in front of the glass: one
 * instrument panel from Fiscora, the sealed report from ANKA, and one plate
 * split into the eight crops the ALPR classifier actually saw.
 */
export function RoomTeaser({ slug }: { slug: ProjectSlug }) {
  if (slug === 'fiscora') {
    return (
      <figure className="room-teaser teaser-fiscora">
        <div className="m-media teaser-frame">
          <Picture id="fiscora/panel-health" alt="" sizes="(min-width: 900px) 26rem, 70vw" />
        </div>
        <figcaption className="t-meta">Financial Health Score · four weighted components</figcaption>
      </figure>
    );
  }
  if (slug === 'anka') {
    return (
      <figure className="room-teaser teaser-anka">
        <div className="m-media teaser-frame teaser-report">
          <Picture id="anka/report" alt="" sizes="(min-width: 900px) 20rem, 60vw" />
        </div>
        <figcaption className="t-meta">A generated report · sealed with HMAC-SHA256</figcaption>
      </figure>
    );
  }
  return (
    <figure className="room-teaser teaser-alpr">
      <div className="m-media teaser-frame teaser-plate">
        <Picture id="alpr/plates/8-plate_01" alt="" />
      </div>
      <ol className="teaser-chars">
        {Array.from({ length: 8 }, (_, i) => (
          // Pointing at a crop lights the chamber holding the same character.
          <li
            key={i}
            className="m-media"
            onPointerEnter={() => (director.channels.plateFocus = i)}
            onPointerLeave={() => (director.channels.plateFocus = -1)}
          >
            <Picture id={`alpr/chars/8-plate_01-${i + 1}`} alt="" pixelated />
          </li>
        ))}
      </ol>
      <figcaption className="t-meta">One plate · eight crops · 32 possible classes each</figcaption>
    </figure>
  );
}
