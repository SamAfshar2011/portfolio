/**
 * How the video tracker keeps one physical plate on one track ID, as the
 * repository README describes it: a constant-velocity Kalman state, three
 * rounds of Hungarian assignment over five cues, and a short dormant memory
 * that lets a plate that disappears come back under its old ID.
 */
const CUES = ['Box overlap (IoU)', 'Centre-distance consistency', 'Size similarity', 'Plate appearance', 'Detection confidence'];

const ROUNDS: [string, string][] = [
  ['Confirmed tracks', 'high-confidence detections'],
  ['Tentative tracks', 'the high-confidence detections left'],
  ['Tracks still unmatched', 'lower-confidence detections'],
];

const LIFE: [string, string][] = [
  ['Tentative', 'a new detection'],
  ['Confirmed', 'seen consistently'],
  ['Dormant', 'missing for a moment, kept in memory'],
  ['Reactivated', 'appearance and size match again'],
];

export function Tracking() {
  return (
    <div className="track" data-reveal>
      <div className="track-state">
        <p className="t-meta">Kalman state, constant velocity</p>
        <p className="track-vec t-mono">
          [ <b>cx</b>, <b>cy</b>, <b>w</b>, <b>h</b>, v<sub>x</sub>, v<sub>y</sub>, v<sub>w</sub>, v<sub>h</sub> ]
        </p>
        <p className="t-meta">measured: cx, cy, w, h</p>
        <p className="track-fine">Variable time step · Joseph-form covariance update · Mahalanobis gating</p>
      </div>
      <div className="track-assign">
        <p className="t-meta">Hungarian assignment, in three rounds</p>
        <ol className="track-rounds">
          {ROUNDS.map(([a, b]) => (
            <li key={a}>
              <span>{a}</span>
              <span className="track-link" aria-hidden="true" />
              <span>{b}</span>
            </li>
          ))}
        </ol>
        <p className="t-meta">scored on</p>
        <ul className="track-cues">
          {CUES.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <ol className="track-life" aria-label="Track lifecycle">
        {LIFE.map(([k, d]) => (
          <li key={k}>
            <b>{k}</b>
            <span>{d}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
