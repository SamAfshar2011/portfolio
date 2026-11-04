# Sam Afshar — portfolio

An interactive portfolio for Sam Afshar: three AI projects (Fiscora, ANKA, Persian ALPR / PlateHunter), presented as rooms inside one continuous 3D space. It is a static site: no server, no API keys, deployable to GitHub Pages as-is.

The site's single physical object is a set of twelve slabs of smoked optical glass. They arrive through the screen and form the opening, become the hero sculpture, carry the story, and reconfigure into each project's own structure: Fiscora's forecast ribbon, ANKA's structural frame, the Persian plate.

## Stack

- **React 19 + TypeScript + Vite**, **Tailwind CSS 4** (tokens and component CSS in `src/styles`)
- **three.js r186**: `WebGPURenderer` with automatic WebGL 2 fallback, materials written in **TSL**, post-processing with `RenderPipeline` (bloom + grain)
- **GSAP** (ScrollTrigger, SplitText, CustomEase) and **Lenis**, on one shared ticker
- **Rapier** (WebAssembly physics) for the GitHub field and ANKA's structural collapse, loaded on demand
- **Web Audio**: a synthesised sound engine — a generative score and object sonification — always off until the visitor turns it on

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm run build        # dist/ (tsc → vite build → postbuild)
npm run preview      # serves dist/
npm run qa:slabs     # numerical collision check of every slab formation
npm run qa:anka      # ANKA simulator scenario checks
```

To build for a repository sub-path the way GitHub Pages serves a project site:

```bash
BASE_PATH=/portfolio/ npm run build && BASE_PATH=/portfolio/ npm run preview
```

`?renderer=webgl2` forces the WebGL 2 backend (useful for testing the fallback).

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and publishes on every push to `main`. In the repository settings choose **Pages → Source: GitHub Actions** once. The workflow reads the base path and URL from `actions/configure-pages`, so the same code works as a user site (`username.github.io`) or a project site (`username.github.io/<repo>/`).

`scripts/postbuild.mjs` turns the single-page build into a static site:

- one `index.html` per route, each with its own title, description, canonical URL, Open Graph/Twitter tags and JSON-LD
- a crawlable HTML summary of each page inside `#root`, replaced when the app starts
- `404.html` (unknown paths still boot the app and show its 404 page), `sitemap.xml`, `robots.txt`, `.nojekyll`

## Architecture

```
src/
  app/            router, shell, document meta, easter eggs
  gl/             the persistent 3D stage
    Stage.ts        renderer, backdrop pass, glass layer pass, post, sonification of the sculptures
    resolution.ts   adaptive resolution that always recovers (see its header)
    stack/          the twelve slabs: geometry, TSL glass material, formations, springs, ANKA's pulse
    text/           SDF text (Canvas 2D + exact distance transform) and the etch atlas
    views/          3D scenes embedded in DOM elements (GitHub field)
    physics.ts      shared, on-demand Rapier loader
  experience/     director (what the stage should do), global state, pointer/key light
  motion/         GSAP setup, Lenis, reveal helpers
  components/     boot (the opening), cursor (the liquid layer), nav, transitions, media, audio
  pages/home/     hero, story, rooms, influences, ambition, GitHub
  projects/       one folder per project; shared room components
    anka/sim/       ground motion and the structural model behind the simulator
```

Key ideas:

- **One stage, many pages.** The canvas lives outside the router and never unmounts. Pages don't touch three.js directly: they write *directives* to the director (formation, room light, position, presence), and the stage springs toward them. That's why moving between pages is a physical morph, not a reload.
- **Collision-free formations.** The opening (`awaken`), the story row (`fan`), Fiscora's timeline (`horizon`) and ANKA's frame (`building`) are pure functions of a continuous parameter: load progress, scroll position, time. They were designed and checked numerically (`npm run qa:slabs`) so that no two slabs ever intersect, at any parameter value, pointer position or scroll velocity. Composite formations turn as rigid bodies.
- **Project sculptures.** Fiscora's `horizon`: seven observation tiles along a ribbon, read and put in order by a passing light, open into a widening emerald fan of forecast periods; every cycle time advances one period and the nearest forecast settles into an observation. ANKA's `building`: a foundation, five floor diaphragms, four columns, a shear wall and a spine, driven by `stack/pulse.ts` — the periodic response of a damped five-storey shear model to a ground impulse, so upper floors answer late and the frame settles before the next pulse.
- **Glass.** The slab material refracts a backdrop pass, and also the farthest slab behind it: a second *glass layer* pass stores the slab ids. It adds Beer–Lambert absorption, Fresnel studio reflections, an arris highlight, faint thin-film colour on the bevels and small float-glass imperfections. Labels and plate characters are etched inside the glass from a shared SDF atlas.
- **Text without Troika.** SDF text is rasterised with Canvas 2D (real web fonts, Persian shaping) and converted with an exact Euclidean distance transform. Troika's shader patching doesn't work with `WebGPURenderer`, and its atlas read back empty on WebKit.
- **Colour** is light, not paint: a neutral charcoal studio, with each room's identity carried by its accents and a restrained rim light (Fiscora champagne and emerald, ANKA ember and a little cyan on mineral charcoal, ALPR optical cyan and cool blue on graphite). Room colours live in `ROOM_LIGHT` (`src/gl/Stage.ts`) and `[data-room]` tokens (`src/styles/tokens.css`).
- **Sound** (`src/components/audio/`): four buses (music, interaction, project, impact) with sends to a generated room and a limiter on the master. The score is generative and original — each room has its own key, mode, tempo, register and bell timbre, and they morph into one another on transitions. Objects are heard: slabs arriving and re-forming, story hand-offs, the cursor's merge, ALPR's scan, Fiscora's reading light and forecast, ANKA's ground shove, and the simulator's resonance, yields and collapse. Every event has a priority and a cooldown within a voice budget. A remembered preference waits for the visitor's first click before fading in; nothing ever starts by itself.
- **The cursor** is a small WebGL 2 canvas drawing a signed-distance field. The cursor, a neck and the controls' "skins" are joined with a smooth minimum, so bridging, absorption and pinch-off are one operation. Touch devices get a separate press effect; reduced motion gets a calm crossfade.

## The ANKA simulator

`src/projects/anka/sim/` is an **explanatory simulation, not an engineering analysis**.

- **Ground motion.** It uses ANKA's own PGA estimate (magnitude, depth, soil factor; site directly above the hypocentre; capped at 2 g). The waveform is a seeded stochastic record: Kanai–Tajimi soil filter, Clough–Penzien high-pass, depth-dependent low-pass, and an envelope for the chosen duration.
- **Structure.** A shear building with Bouc–Wen hysteresis per storey, energy-based stiffness degradation, damage-dependent strength loss, P-Δ, and the Park–Ang damage index.
- **Foundation.** A mat on an elastic half-space (sway, rocking, radiation damping, a sliding limit). Liquefaction builds pore pressure, which softens the foundation and makes the building settle, tilt and slide.
- **Integration.** Everything runs in one coupled system at a fixed 2 kHz step. A failed storey hands everything above it to Rapier.

Parameters are generalised approximations, documented in the code.

## Media

Original captures stay outside the repository (`Assets/`, git-ignored). `npm run media` regenerates the optimised derivatives in `src/assets/media` (AVIF/WebP at several widths, the ANKA loop video, the report render, the ALPR crops) and, via `scripts/fiscora-cockpit.mjs`, the exploded dashboard: each instrument card cut along its own chamfered outline, and a backplate with those cards punched out, so a lifted card leaves a real socket. `npm run icons` rebuilds the favicons from `public/favicon.svg`. Social images live in `public/og/`.

`node scripts/alpr-data.mjs <path to Persian_ALPR_project>` rebuilds the ALPR classifier figures (`src/projects/alpr/classifier.json`) from the repository's saved artifacts; the project repositories are only ever read.

## Adding a project

1. Add an entry to `src/projects/meta.json` (slug, name, awards, repo, room, formation, SEO).
2. Create `src/projects/<slug>/<Name>Page.tsx` and register its loader in `src/projects/registry.ts`.
3. Give the room a light in `ROOM_LIGHT` (`src/gl/Stage.ts`), accents in `src/styles/tokens.css`, a musical identity in `src/components/audio/score.ts`, and a formation in `src/gl/stack/formations.ts` if none of the existing ones fits (then add it to `scripts/qa/slab-collisions.ts`).
4. Add `public/og/<slug>.jpg` (1200 × 630). The postbuild script generates the route, sitemap entry and metadata.

## Accessibility and fallbacks

- `prefers-reduced-motion`: native scrolling, calmer formations, a gentle opening, and a cursor that crossfades into controls instead of stretching.
- Keyboard: skip link, visible focus everywhere, the index menu is a modal dialog with a focus trap.
- No WebGPU: WebGL 2. Neither: a CSS environment and DOM typography. No JavaScript: a static summary of every page.
- The custom cursor only runs with a fine pointer; sound is off until requested.
