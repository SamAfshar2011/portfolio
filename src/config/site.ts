/**
 * Site-wide facts. Everything here is verified: identity details come from
 * Sam directly; project facts live next to each project in src/projects.
 */
export const site = {
  name: 'Sam Afshar',
  title: 'Sam Afshar — Builder of AI systems',
  description:
    'Sam Afshar builds AI systems: a finance cockpit that forecasts spending, an earthquake-safety assistant that estimates collapse risk, and a pipeline that reads Persian license plates.',
  born: 2011,
  startedProgramming: 2024,
  github: {
    handle: 'SamAfshar2011',
    url: 'https://github.com/SamAfshar2011',
  },
  /** Absolute origin for canonical/OG URLs, injected at build time. */
  url: (import.meta.env.VITE_SITE_URL as string | undefined) ?? '',
} as const;

/** Prefix a public path with the deploy base (GitHub Pages project sites). */
export const withBase = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
