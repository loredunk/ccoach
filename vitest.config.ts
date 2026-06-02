import { defineConfig } from 'vitest/config'

// 固定 TZ=UTC：窗口判定按"本机本地日期"，统一到 UTC 让 fixture/断言在任何机器与 CI 上确定。
process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: { TZ: 'UTC' },
  },
})
