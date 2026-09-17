import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  // Emit `.js`/`.d.ts` (not `.mjs`/`.d.mts`) so `main`/`types` and the bundle's
  // `files` list stay extension-stable.
  fixedExtension: false,
  // The host harness supplies its own version-matched instances.
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
})
