// Builds Insanity_Loom's three parts, each for where it runs:
// - main: the layer underneath, in Node.js — windows, files, and everything the page may not touch;
// - preload: the narrow bridge between the two, run inside the page's sandbox;
// - renderer: the page itself, in Chromium.
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {},
  preload: {},
  // Two pages: the program itself, and the Find in Files window that stands beside it (src/main/find-window.ts).
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html',
          find: 'src/renderer/find.html',
        },
      },
    },
  },
});
