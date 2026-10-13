import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['db/**/*.test.ts'],
    globalSetup: ['./src/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Testler ortak veritabanını paylaşır; her test kendi şirketlerini ve kullanıcılarını oluşturur.
    fileParallelism: false,
  },
});
