import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相対パスにしておくと dist/ をどこに置いても（GitHub Pages のサブパス等でも）動く
  base: './',
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
