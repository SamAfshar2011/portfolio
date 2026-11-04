import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * GitHub Pages serves project sites from /<repo>/ and user sites from /.
 * The deploy workflow passes the path reported by actions/configure-pages as
 * BASE_PATH, so the same source works for either without editing paths.
 */
function normalizeBase(input?: string) {
  if (!input || input === '/') return '/';
  return `/${input.replace(/^\/+|\/+$/g, '')}/`;
}

export default defineConfig({
  base: normalizeBase(process.env.BASE_PATH),
  plugins: [react(), tailwindcss()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 2048,
    // The largest chunk is Rapier's WebAssembly (inlined by the -compat
    // build). It is only requested when the GitHub section approaches, so
    // the warning threshold sits above it on purpose.
    chunkSizeWarningLimit: 3000,
    // Lazy chunks share code with the entry; the entry is already running,
    // so preloading it again is wasted (WebKit warns about the unused hint).
    modulePreload: {
      resolveDependencies: (_file, deps) => deps.filter((d) => !/(^|\/)index-[\w-]+\.js$/.test(d)),
    },
  },
  // PORT lets a launcher assign a free port when the default is taken by
  // another project's dev server.
  server: { port: Number(process.env.PORT) || 5173, host: true },
  preview: { port: Number(process.env.PORT) || 4173, host: true },
});
