import { useEffect } from 'react';
import { site } from '../config/site';
import { projectBySlug } from '../projects/registry';

function setMeta(selector: string, attr: 'content' | 'href', value: string) {
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

/**
 * Keeps title/description/canonical in sync during client-side navigation.
 * (Crawlers get the same values from the per-route HTML files generated at
 * build time by scripts/postbuild.mjs.)
 */
export function useDocumentMeta(pathname: string) {
  useEffect(() => {
    const project = projectBySlug(pathname.match(/^\/projects\/([^/]+)/)?.[1]);
    const known = project || pathname === '/' || pathname === '';
    if (!known) {
      // Anything else renders the 404 page.
      document.title = `Not found — ${site.name}`;
      return;
    }
    const title = project ? project.seo.title : site.title;
    const description = project ? project.seo.description : site.description;
    document.title = title;
    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:title"]', 'content', title);
    setMeta('meta[property="og:description"]', 'content', description);
    if (site.url) {
      const url = new URL(pathname.replace(/^\//, ''), site.url.replace(/\/?$/, '/')).toString();
      setMeta('link[rel="canonical"]', 'href', url);
      setMeta('meta[property="og:url"]', 'content', url);
    }
  }, [pathname]);
}
