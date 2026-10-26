import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'node:path'

// The `@/…` import alias lives in tsconfig.json. Without this config vitest
// can't resolve it, so every test that imports a lib file which itself uses
// `@/` (chat-intake-*, intake-*) fails to even load. `server-only` throws by
// design outside a Server Component, so tests get a no-op stub.
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: { alias: { 'server-only': path.resolve(__dirname, 'tests/stubs/server-only.ts') } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
})
