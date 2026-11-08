/// <reference types="vitest/config" />
/// <reference types="node" />
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const API = 'http://127.0.0.1:8090';

/**
 * `npm run dev` démarre aussi le serveur PHP de l'API (scripts/php-server.mjs), sauf s'il répond
 * déjà (lancé à part par `npm run api`). Sans lui, le proxy /api répond 502.
 */
function phpApi(): Plugin {
  return {
    name: 'renommeur-php-api',
    apply: 'serve',
    async configureServer(server) {
      if (process.env.VITEST) return;
      const running = await fetch(`${API}/settings.php`, { signal: AbortSignal.timeout(800) }).then(
        () => true,
        () => false,
      );
      if (running) return;
      const php = spawn(process.execPath, [join(server.config.root, 'scripts', 'php-server.mjs')], { stdio: 'inherit' });
      const stop = () => php.kill();
      server.httpServer?.once('close', stop);
      process.once('exit', stop);
    },
  };
}

export default defineConfig({
  // Chemins relatifs : l'outil marche à la racine d'un sous-domaine comme dans un sous-dossier.
  base: './',
  plugins: [svelte(), phpApi()],
  // Worker en module ES : les codecs restent des morceaux chargés à la demande, et leurs .wasm
  // sont émis à côté (assets/nom-empreinte.wasm), sans eval ni blob.
  worker: { format: 'es' },
  // Les codecs trouvent leur .wasm par new URL(…, import.meta.url) : pas de pré-bundle en dev.
  optimizeDeps: { exclude: ['@jsquash/jpeg', '@jsquash/webp', '@jsquash/oxipng', 'libimagequant-wasm'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: API,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
