import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH permite publicar em subpasta (ex.: GitHub Pages: /ftthfist/).
const base = process.env.BASE_PATH ?? '/';

// Identificação da versão publicada (aparece nas Configurações para conferir se o celular atualizou).
const buildId = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);

export default defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    // HTTPS na rede local: geolocalização do celular exige contexto seguro.
    basicSsl(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'RotaFibra',
        short_name: 'RotaFibra',
        description: 'Documentação de rotas de fibra em campo',
        lang: 'pt-BR',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Tiles de mapa já visitados ficam disponíveis offline, com limite de entradas.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('tile.openstreetmap.org') ||
              url.hostname === 'server.arcgisonline.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 2000, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true },
  preview: { host: true },
  // supabase/tests: testes do banco; só rodam com TEST_DATABASE_URL (ver supabase/README.md), senão são pulados
  test: { environment: 'node', include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'] },
});
