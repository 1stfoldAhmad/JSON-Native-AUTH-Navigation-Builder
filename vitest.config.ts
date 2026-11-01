import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@expo-foundation/contracts': path.resolve(__dirname, 'packages/contracts/src/index.ts'),
      '@expo-foundation/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@expo-foundation/auth': path.resolve(__dirname, 'packages/auth/src/index.ts'),
      '@expo-foundation/navigation': path.resolve(__dirname, 'packages/navigation/src/index.ts'),
      '@expo-foundation/integration': path.resolve(__dirname, 'packages/integration/src/index.ts'),
      '@expo-foundation/expo-generator': path.resolve(__dirname, 'packages/expo-generator/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
