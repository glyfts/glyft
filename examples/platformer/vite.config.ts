import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  base: '/demos/platformer/',
  build: {
    outDir: resolve(__dirname, '../../dist-demos/platformer'),
    emptyOutDir: true,
  },
});
