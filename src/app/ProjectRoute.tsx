import { lazy, Suspense, useMemo, type ComponentType, type LazyExoticComponent } from 'react';
import { useParams } from 'react-router';
import { projectBySlug } from '../projects/registry';
import { NotFound } from '../pages/NotFound';

const cache = new Map<string, LazyExoticComponent<ComponentType>>();

/** Resolves /projects/:slug to its lazily loaded page module. */
export function ProjectRoute() {
  const { slug } = useParams();
  const project = projectBySlug(slug);
  const Page = useMemo(() => {
    if (!project) return null;
    if (!cache.has(project.slug)) cache.set(project.slug, lazy(project.load));
    return cache.get(project.slug)!;
  }, [project]);
  if (!project || !Page) return <NotFound />;
  return (
    <Suspense fallback={<div className="min-h-[100svh]" aria-busy="true" />}>
      <Page />
    </Suspense>
  );
}
