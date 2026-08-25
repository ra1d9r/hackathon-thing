import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
    globals: false,
    
    
    
    fileParallelism: false,
    
    
    
    
    
    
    
    testTimeout: 90_000,
    hookTimeout: 90_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
  },
});
