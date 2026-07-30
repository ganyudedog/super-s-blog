// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';

const useCloudflareAdapter = process.env.NODE_ENV === 'production';

// https://astro.build/config
export default defineConfig({
  adapter: useCloudflareAdapter ? cloudflare() : undefined,
  output: 'static',
  integrations: [react()],

  vite: {
    plugins: [tailwindcss(), glsl()],
    optimizeDeps: {
      force: true,
      include: ['three', 'react', 'react-dom', 'react-dom/client'],
    },
  },
});
