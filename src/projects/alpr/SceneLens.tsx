import { useRef, useState } from 'react';
import { Picture } from '../../components/media/Picture';
import { SCENES } from './scenes';
import { device } from '../../lib/device';
import { audio } from '../../components/audio/engine';

/**
 * Real photographs and the pipeline's own annotated outputs, stacked. A lens
 * follows the pointer and shows what the model drew; on touch (or with the
 * toggle) the whole output is revealed. Nothing here is re-rendered — the
 * boxes and labels are the pipeline's.
 */
function PlateText({ text }: { text: string }) {
  return (
    <span className="plate-text" dir="ltr" lang="fa">
      {text.split(' ').map((g, i) => (
        <span key={i}>{g}</span>
      ))}
    </span>
  );
}

export function SceneLens() {
  const [i, setI] = useState(0);
  const [pos, setPos] = useState({ x: 50, y: 50, on: false });
  const [full, setFull] = useState(false);
  const view = useRef<HTMLDivElement>(null);
  const s = SCENES[i];
  const [w, h] = s.size;
  const mask = full
    ? 'none'
    : pos.on
      ? `radial-gradient(circle min(22vmin, 150px) at ${pos.x}% ${pos.y}%, #000 70%, transparent 72%)`
      : 'radial-gradient(circle 0px at 50% 50%, #000, transparent)';

  return (
    <div className="lens" data-reveal>
      <div className="lens-main">
        <div
          ref={view}
          className="lens-view m-media"
          style={{ aspectRatio: `${w} / ${h}`, ['--ar' as string]: w / h }}
          data-cursor={device.touch ? undefined : 'Look'}
          onPointerMove={(e) => {
            if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
            const r = view.current!.getBoundingClientRect();
            setPos({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100, on: true });
          }}
          onPointerLeave={() => setPos((p) => ({ ...p, on: false }))}
          onClick={(e) => {
            if ((e.nativeEvent as PointerEvent).pointerType === 'mouse') return;
            setFull((f) => !f);
          }}
        >
          <Picture id={`alpr/scene-${s.n}`} alt={s.alt} className="lens-raw" sizes="(min-width: 1000px) 60vw, 100vw" />
          <Picture
            id={`alpr/scene-${s.n}-annotated`}
            alt=""
            aria-hidden="true"
            className="lens-ann"
            style={{ WebkitMaskImage: mask, maskImage: mask }}
            sizes="(min-width: 1000px) 60vw, 100vw"
          />
        </div>
        <button type="button" className="btn lens-toggle" aria-pressed={full} onClick={() => setFull((f) => !f)}>
          {full ? 'Show the photograph' : 'Show the pipeline’s output'}
        </button>
      </div>
      <div className="lens-side">
        <p className="t-meta">
          Scene {String(i + 1).padStart(2, '0')} / {String(SCENES.length).padStart(2, '0')}
        </p>
        <h3 className="lens-title t-subtitle">{s.title}</h3>
        <ul className="lens-reads">
          {s.plates.map((p) => (
            <li key={p.latin}>
              <div className="lens-crop m-media">
                <Picture id={p.crop} alt={`Plate crop read as ${p.latin}`} pixelated />
              </div>
              <PlateText text={p.persian} />
              <span className="lens-latin t-num">
                {p.latin} <em>· {p.confidence}</em>
              </span>
            </li>
          ))}
        </ul>
        <div className="lens-thumbs" role="tablist" aria-label="Scenes">
          {SCENES.map((sc, k) => (
            <button
              key={sc.n}
              type="button"
              role="tab"
              aria-selected={k === i}
              aria-label={sc.title}
              className="lens-thumb"
              onClick={(e) => {
                setI(k);
                setFull(false);
                audio.scan(k, e.clientX);
              }}
            >
              <Picture id={`alpr/scene-${sc.n}`} alt="" sizes="6rem" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export { PlateText };
