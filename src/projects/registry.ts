import type { ComponentType } from 'react';
import type { ProjectMeta, ProjectSlug } from './types';
import meta from './meta.json';

/**
 * The project data layer. Home navigation, routes, the index menu, page
 * transitions, SEO and the post-build static pages all read from meta.json —
 * adding a project means adding one entry there, one loader here, and one
 * page module.
 */
const loaders: Record<ProjectSlug, () => Promise<{ default: ComponentType }>> = {
  fiscora: () => import('./fiscora/FiscoraPage'),
  anka: () => import('./anka/AnkaPage'),
  'persian-alpr': () => import('./alpr/AlprPage'),
};

export const projects: ProjectMeta[] = (meta as Omit<ProjectMeta, 'load'>[]).map((m) => ({
  ...m,
  load: loaders[m.slug],
}));

export const projectBySlug = (slug: string | undefined) => projects.find((p) => p.slug === slug) as ProjectMeta | undefined;

export const projectPath = (slug: ProjectSlug) => `/projects/${slug}/`;

export function neighbours(slug: ProjectSlug) {
  const i = projects.findIndex((p) => p.slug === slug);
  return {
    prev: projects[(i - 1 + projects.length) % projects.length],
    next: projects[(i + 1) % projects.length],
  };
}
