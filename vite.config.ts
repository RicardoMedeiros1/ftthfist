import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { describeConfig } from './src/features/account/supabaseKey.ts';

// BASE_PATH permite publicar em subpasta (ex.: GitHub Pages: /ftthfist/).
const base = process.env.BASE_PATH ?? '/';

// Identificação da versão publicada (aparece nas Configurações para conferir se o celular atualizou).
const buildId = (process.env.GITHUB_SHA ?? 'dev').slice(0, 7);

const config = defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    // HTTPS na rede local: geolocalização do celular exige contexto seguro.
    basicSsl(),
    VitePWA({
      registerType: 'prompt',
      // O service worker e nosso (src/sw.ts): alem de abrir offline, envia os dados pendentes com o app fechado.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
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
      injectManifest: {
        // script classico unico (sem import/export): funciona em qualquer navegador que registre service worker
        rollupFormat: 'iife',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true },
  preview: { host: true },
  // supabase/tests: testes do banco; só rodam com TEST_DATABASE_URL (ver supabase/README.md), senão são pulados
  test: { environment: 'node', include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'] },
});

export default defineConfig(({ mode }) => {
  // Trava: se alguem colar a chave SECRETA do Supabase numa variavel, o build FALHA (nada e publicado).
  // (describeConfig tambem lanca se a chave for secreta.) O motivo de o login nao ligar aparece no log do build.
  console.log(`\n${describeConfig(loadEnv(mode, process.cwd(), 'VITE_')).message}\n`);
  return config;
});
