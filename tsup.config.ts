import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  // Zero runtime deps: inline every dev-only import (ts-pattern) into dist.
  noExternal: [/.+/],
});