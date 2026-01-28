import { defineConfig } from 'vite';
import { resolve } from 'path';

// Get demo name from env or default to rpg
const demo = process.env.DEMO || 'rpg';

export default defineConfig({
  base: `/demos/${demo}/`,
  build: {
    rollupOptions: {
      input: resolve(__dirname, `examples/${demo}/index.html`),
      output: {
        entryFileNames: `${demo}/[name]-[hash].js`,
        chunkFileNames: `${demo}/[name]-[hash].js`,
        assetFileNames: `${demo}/[name]-[hash].[ext]`,
      },
    },
    outDir: 'dist-demos',
    emptyOutDir: false, // Don't empty so we can build multiple demos
  },
});
