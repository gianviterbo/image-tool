import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build: everything (JS, CSS, icons, JSZip) is inlined into one
// dist/index.html that runs from file:// with no server and no network.
const root = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]+$/, '');

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      '@': root,
    },
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
  },
});
