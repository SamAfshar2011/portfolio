import type { ComponentType } from 'react';
import type { RoomId } from '../experience/state';
import type { FormationId } from '../experience/director';

export type ProjectSlug = 'fiscora' | 'anka' | 'persian-alpr';

export interface Award {
  /** e.g. "Second Place" / "Gold Award" */
  title: string;
  /** e.g. "Innoverse" */
  event: string;
  /** e.g. "United States" */
  where?: string;
}

export interface ProjectMeta {
  slug: ProjectSlug;
  index: string;
  name: string;
  /** Internal/codename shown as secondary label. */
  alias?: string;
  kicker: string;
  /** One sentence, used on the home page and in the index. */
  summary: string;
  awards: Award[];
  repo: string;
  room: Exclude<RoomId, 'home'>;
  formation: FormationId;
  /** Accent used by DOM surfaces in this room. */
  accent: string;
  tech: string[];
  seo: { title: string; description: string };
  load: () => Promise<{ default: ComponentType }>;
}
