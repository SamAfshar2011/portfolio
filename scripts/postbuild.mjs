/**
 * Post-build: turn the single-page build into a static site GitHub Pages can
 * serve directly.
 *
 *  - one index.html per route (/, /projects/<slug>/) with its own title,
 *    description, canonical URL, Open Graph/Twitter tags and JSON-LD, plus a
 *    crawlable, semantic HTML summary inside #root (replaced once React loads)
 *  - 404.html, so unknown paths still boot the app and show its 404 page
 *  - sitemap.xml and robots.txt
 *
 * SITE_URL is the absolute URL of the deployed site (the deploy workflow
 * passes the value reported by actions/configure-pages).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const projects = JSON.parse(readFileSync(join(root, 'src/projects/meta.json'), 'utf8'));

const basePath = normalizeBase(process.env.BASE_PATH);
const siteUrl = (process.env.SITE_URL || `https://samafshar2011.github.io${basePath}`).replace(/\/?$/, '/');
const github = 'https://github.com/SamAfshar2011';

function normalizeBase(input) {
  if (!input || input === '/') return '/';
  return `/${input.replace(/^\/+|\/+$/g, '')}/`;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const abs = (path) => new URL(path.replace(/^\//, ''), siteUrl).toString();
const rel = (path) => `${basePath}${path.replace(/^\//, '')}`;

const template = readFileSync(join(dist, 'index.html'), 'utf8');

const person = {
  '@type': 'Person',
  name: 'Sam Afshar',
  url: siteUrl,
  sameAs: [github],
  birthDate: '2011-12',
  knowsAbout: ['Artificial intelligence', 'Machine learning', 'Computer vision', 'Python', 'Software engineering'],
};

function render({ path, title, description, image, jsonld, body }) {
  const url = abs(path);
  const seo = [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Sam Afshar" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${abs(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${abs(image)}" />`,
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...jsonld })}</script>`,
  ].join('\n    ');
  return template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(description)}" />`)
    .replace('<!--seo-->', seo)
    .replace('<!--prerender-->', `<div id="prerender">${body}</div>`);
}

function write(path, html) {
  const file = join(dist, path, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

const awardText = (a) => `${a.title} — ${a.event}${a.where ? `, ${a.where}` : ''}`;
const nav = `<nav aria-label="Projects"><ul>${projects
  .map((p) => `<li><a href="${rel(`/projects/${p.slug}/`)}">${esc(p.name)}</a> — ${esc(p.kicker)}</li>`)
  .join('')}</ul><p><a href="${github}">GitHub: SamAfshar2011</a></p></nav>`;

// ------------------------------------------------------------------- home
const homeTitle = 'Sam Afshar — Builder of AI systems';
const homeDescription =
  'Sam Afshar builds AI systems: a finance cockpit that forecasts spending, an earthquake-safety assistant that estimates collapse risk, and a pipeline that reads Persian license plates.';
const homeBody = `<main>
  <h1>Sam Afshar</h1>
  <p>I build AI systems that turn raw signal into something people can act on. Born in 2011; writing code since 2024, starting with Python.</p>
  <h2>Selected work</h2>
  ${projects
    .map(
      (p) =>
        `<article><h3><a href="${rel(`/projects/${p.slug}/`)}">${esc(p.name)}</a></h3><p>${esc(p.summary)}</p>${
          p.awards.length ? `<p>${p.awards.map((a) => esc(awardText(a))).join(' · ')}</p>` : ''
        }</article>`,
    )
    .join('\n  ')}
  <h2>Next</h2>
  <p>The long-term plan is to found a startup and grow it into a technology company that matters.</p>
  ${nav}
</main>`;
write(
  '',
  render({
    path: '/',
    title: homeTitle,
    description: homeDescription,
    image: 'og/home.jpg',
    jsonld: { '@graph': [{ '@type': 'WebSite', name: 'Sam Afshar', url: siteUrl }, person] },
    body: homeBody,
  }),
);

// --------------------------------------------------------------- projects
for (const p of projects) {
  const body = `<main>
  <p>${esc(p.kicker)}</p>
  <h1>${esc(p.name)}${p.alias ? ` (${esc(p.alias)})` : ''}</h1>
  <p>${esc(p.summary)}</p>
  ${p.awards.length ? `<ul>${p.awards.map((a) => `<li>${esc(awardText(a))}</li>`).join('')}</ul>` : ''}
  <p>Built with ${esc(p.tech.join(', '))}.</p>
  <p><a href="${p.repo}">Source code on GitHub</a> · <a href="${rel('/')}">Back to the index</a></p>
  ${nav}
</main>`;
  write(
    `projects/${p.slug}`,
    render({
      path: `/projects/${p.slug}/`,
      title: p.seo.title,
      description: p.seo.description,
      image: `og/${p.slug}.jpg`,
      jsonld: {
        '@type': 'SoftwareSourceCode',
        name: p.alias ? `${p.name} (${p.alias})` : p.name,
        description: p.seo.description,
        codeRepository: p.repo,
        programmingLanguage: 'Python',
        author: person,
        ...(p.awards.length ? { award: p.awards.map(awardText) } : {}),
        url: abs(`/projects/${p.slug}/`),
      },
      body,
    }),
  );
}

// ------------------------------------------------------------ 404 + extras
writeFileSync(
  join(dist, '404.html'),
  render({
    path: '/',
    title: 'Not found — Sam Afshar',
    description: homeDescription,
    image: 'og/home.jpg',
    jsonld: { '@type': 'WebPage', name: 'Not found' },
    body: `<main><h1>Not found</h1><p><a href="${rel('/')}">Back to the index</a></p>${nav}</main>`,
  }).replace('<link rel="canonical"', '<meta name="robots" content="noindex" />\n    <link rel="canonical"'),
);

const urls = ['/', ...projects.map((p) => `/projects/${p.slug}/`)];
writeFileSync(
  join(dist, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${abs(u)}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
);
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`);
// GitHub Pages: serve files and folders starting with "_" as-is.
writeFileSync(join(dist, '.nojekyll'), '');

for (const f of ['og/home.jpg', ...projects.map((p) => `og/${p.slug}.jpg`)]) {
  if (!existsSync(join(dist, f))) console.warn(`[postbuild] missing social image: ${f}`);
}
console.log(`[postbuild] ${urls.length} routes · base ${basePath} · ${siteUrl}`);
