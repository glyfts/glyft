import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'examples/rpg/index.html'),
    },
    outDir: 'dist-rpg',
    emptyOutDir: true,
  },
});
