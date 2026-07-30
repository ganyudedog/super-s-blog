// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  prefetch: false,
  integrations: [react()],

  vite: {
    plugins: [tailwindcss(), glsl()],
    optimizeDeps: {
      force: true,
      include: ['three', 'react', 'react-dom', 'react-dom/client'],
    },
  },
});
