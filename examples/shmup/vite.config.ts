import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: __dirname,
  base: '/demos/shmup/',
  build: {
    outDir: resolve(__dirname, '../../dist-demos/shmup'),
    emptyOutDir: true,
  },
});
