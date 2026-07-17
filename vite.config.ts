import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/crypto-lab-quantum-entropy/',
  build: {
    outDir: 'dist',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
