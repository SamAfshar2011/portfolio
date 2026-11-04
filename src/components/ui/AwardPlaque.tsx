import type { Award } from '../../projects/types';

/**
 * Awards are presented as small engraved plaques, not badges: a metal token,
 * the distinction, and the event set in the editorial serif.
 */
export function AwardPlaque({ award, size = 'md' }: { award: Award; size?: 'md' | 'lg' }) {
  const metal = /gold/i.test(award.title) ? 'gold' : /silver|second/i.test(award.title) ? 'silver' : 'bronze';
  return (
    <figure className={`plaque plaque-${size}`} data-metal={metal}>
      <span className="plaque-token" aria-hidden="true">
        {''}
      </span>
      <figcaption className="plaque-text">
        <span className="plaque-title t-meta">{award.title}</span>
        <span className="plaque-event t-serif">{award.event}</span>
        {award.where && <span className="plaque-where t-meta">{award.where}</span>}
      </figcaption>
    </figure>
  );
}
