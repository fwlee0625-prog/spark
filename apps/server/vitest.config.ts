import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 用例会真实 spawn 进程并调用 pgrep/lsof,并行会互相干扰
    fileParallelism: false,
    testTimeout: 15000,
  },
});
