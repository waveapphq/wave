/// <reference types="vitest" />
import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { availableParallelism, freemem } from 'os'
import { handleProxyError, type ProxyErrorTarget } from './vite-proxy'

/**
 * When the BE upstream is unreachable, http-proxy-middleware's default
 * error handler writes a plain "Internal Server Error" body. That bleeds
 * into our toasts. Override it with a clean JSON envelope (matching the
 * BE's error shape) and a status the FE recognizes as a BE-outage signal
 * so the connection-monitor trips and the offline banner appears.
 */
function backendProxy(
  target: string,
  extra: Partial<ProxyOptions> = {},
): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('error', (_err, _req, res) => {
        handleProxyError(target, res as ProxyErrorTarget | undefined)
      })
    },
    ...extra,
  }
}

// Copy WASM files to public directory for runtime loading
const wasmFiles = [
  { src: 'node_modules/web-tree-sitter/tree-sitter.wasm', dest: 'public/wasm/tree-sitter.wasm' },
  {
    src: 'node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm',
    dest: 'public/wasm/tree-sitter-python.wasm',
  },
]

// Ensure wasm directory exists and copy files
const wasmDir = path.resolve(__dirname, 'public/wasm')
if (!existsSync(wasmDir)) {
  mkdirSync(wasmDir, { recursive: true })
}

for (const { src, dest } of wasmFiles) {
  const srcPath = path.resolve(__dirname, src)
  const destPath = path.resolve(__dirname, dest)
  // Refresh a stale copy too, so a dependency bump never pairs old WASM with new JS glue.
  if (
    existsSync(srcPath) &&
    (!existsSync(destPath) || !readFileSync(srcPath).equals(readFileSync(destPath)))
  ) {
    copyFileSync(srcPath, destPath)
  }
}

// Backend target for both dev (`server.proxy`) and preview
// (`preview.proxy`). Override with WAVE_BE_URL when developing against
// a non-default backend (e.g. a second backend on port 8001).
const BACKEND_URL =
  process.env.WAVE_BE_URL || process.env.VITE_API_BASE_URL || 'http://localhost:8000'
const BACKEND_WS_URL = BACKEND_URL.replace(/^http/, 'ws')

// Local vitest worker cap: see the maxWorkers comment in the test block.
// Each fork holds a jsdom and its coverage instrumentation, so free memory
// bounds the pool as tightly as cores do; 1 GiB per fork leaves room for the
// lint and type-check processes that run beside it.
const WORKER_MEMORY_BYTES = 1024 ** 3
const LOCAL_TEST_WORKERS = Math.max(
  2,
  Math.min(
    16,
    availableParallelism() - 2,
    Math.floor(freemem() / WORKER_MEMORY_BYTES) - 2,
  ),
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // A shared cache dir lets a vitest run evict the dev server's prebundles.
  cacheDir: process.env.VITEST ? 'node_modules/.vitest-cache' : 'node_modules/.vite',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    // All FE -> BE traffic is routed through this proxy so the browser
    // only ever opens connections to localhost:3000 (its own origin).
    // That keeps everything inside one Network Isolation Key pool, which
    // can't be poisoned by BE bounces (Chrome's per-NIK pool for cross-
    // origin FE -> BE calls would otherwise accumulate stale state
    // that only browser-process exit can clear).
    //
    // The catch-all `/api` rule strips the `/api` prefix on the way
    // through. BE routes that include `/api` in their own path
    // (/api/backup, /api/v1/...) arrive here as /api/api/<rest>, the
    // rewrite drops one /api, BE sees its real path.
    proxy: {
      '/api': backendProxy(BACKEND_URL, {
        rewrite: (p) => p.replace(/^\/api/, ''),
      }),
      '/ws': backendProxy(BACKEND_WS_URL, { ws: true }),
    },
  },
  preview: {
    port: 3001,
    // Proxy targets are env-driven so one built bundle can be served by
    // multiple preview instances each talking to its own backend. E2E CI
    // spawns N backends on different ports and N previews pointed at them.
    proxy: {
      '/api': backendProxy(BACKEND_URL, {
        rewrite: (p) => p.replace(/^\/api/, ''),
      }),
      '/ws': backendProxy(BACKEND_WS_URL, { ws: true }),
    },
  },
  build: {
    outDir: 'build',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split React core into separate chunk (changes rarely)
          'vendor-react': ['react', 'react-dom'],
          // Split React Router (changes rarely)
          'vendor-router': ['react-router-dom'],
          // Split Radix UI primitives (large, stable vendor code)
          'vendor-radix': [
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-popover',
            '@radix-ui/react-progress',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slot',
            '@radix-ui/react-tooltip',
          ],
          // CodeMirror 6 core + language modes + their Lezer parsers. All
          // get pulled in by the workbench editor stack (JSON/XML/YAML);
          // keeping them in one vendor chunk caches across releases and
          // stops the workbench route chunk from ballooning to ~800 kB.
          // XYFlow + resizable-panels: large canvas/layout libs, stable.
          'vendor-flow': [
            '@xyflow/react',
            '@xyflow/system',
            'react-resizable-panels',
          ],
          // Tree-sitter runtime: WASM-driven parser shipped for expression
          // validation. Its JS shim is sizable and stable across releases.
          'vendor-tree-sitter': ['web-tree-sitter'],
          'vendor-codemirror': [
            'codemirror',
            '@codemirror/autocomplete',
            '@codemirror/commands',
            '@codemirror/lang-json',
            '@codemirror/lang-xml',
            '@codemirror/lang-yaml',
            '@codemirror/language',
            '@codemirror/lint',
            '@codemirror/search',
            '@codemirror/state',
            '@codemirror/theme-one-dark',
            '@codemirror/view',
            '@lezer/common',
            '@lezer/highlight',
            '@lezer/json',
            '@lezer/lr',
            '@lezer/xml',
            '@lezer/yaml',
            'js-yaml',
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
    // Pin host timezone for deterministic timestamp-format tests. America/Los_Angeles
    // gives PDT in summer / PST in winter - both stable abbreviations across Node ICU
    // versions. Tests that need a specific season pick their date accordingly.
    env: {
      TZ: 'America/Los_Angeles',
    },
    // Default vitest timeout is 5000ms which is too tight for complex userEvent
    // interactions (multi-character typing, Radix Select/Combobox flows) running
    // in forked processes inside CI containers with limited CPU. GitHub Actions
    // runners are CPU-starved compared to our local containerized CI, so the
    // same interactions routinely exceed 10s there while finishing well under
    // it locally - bump the default only when GITHUB_ACTIONS is set so local
    // runs still catch genuinely slow tests.
    testTimeout: process.env.GITHUB_ACTIONS === 'true' ? 30000 : 10000,
    // Use forks pool for full process isolation between test files
    // This prevents race conditions when tests reset global singletons (tree-sitter)
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        isolate: true,
      },
    },
    // Cap workers at 16 on dev/container CI. Measured sweet spot on 32 cores:
    // above 16 workers CPU contention slows jsdom creation and per-test
    // execution more than extra parallelism helps (31w=155s vs 16w=141s).
    // Remaining cores are available for concurrent BE CI / Playwright runs.
    //
    // GitHub Actions `ubuntu-latest` runners have only 4 cores. Pinning 16
    // forked Node processes there is 4x oversubscription - each fork pays a
    // multi-second cold-start (jsdom, tree-sitter WASM, setup.ts) and the
    // slowest async tests (lazy <Suspense> chunks, route renders, complex
    // modals) burn most of their 30s timeout budget waiting for CPU before
    // the first assertion. Drop the cap to 4 there to match the runner.
    //
    // Smaller dev hosts hit the same oversubscription (lint + tsc run in
    // parallel with vitest in the CI container), so the local cap derives
    // from the actual cores and free memory, never below 2. Without the
    // memory bound the forks and the lint process are OOM-killed, which
    // surfaces as unrelated tests timing out at random.
    maxWorkers: process.env.GITHUB_ACTIONS === 'true' ? 4 : LOCAL_TEST_WORKERS,
    minWorkers: process.env.GITHUB_ACTIONS === 'true' ? 2 : LOCAL_TEST_WORKERS,
    // Filter known Radix UI warnings that occur in test environment
    // See: https://github.com/radix-ui/primitives/issues/1952
    onConsoleLog(log) {
      if (log.includes('DialogContent') && log.includes('DialogTitle')) {
        return false // Suppress this log
      }
      // Suppress React lazy loading warnings that occur during tests with
      // proper waitFor handling - these are informational, not errors
      if (log.includes('A suspended resource finished loading inside a test')) {
        return false
      }
      return true // Keep other logs
    },
    coverage: {
      provider: 'v8',
      reporter: [
        // maxCols is the overall table width; the uncovered-lines column gets
        // whatever is left. A very wide value keeps that column from
        // truncating to `...16-317,342,405` in CI logs where the whole point
        // is to see which lines to fix.
        ['text', { maxCols: 400 }],
        'html',
        'json',
        'lcov', // For SonarQube integration
      ],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/app/main.tsx',
        'src/vite-env.d.ts',
        '**/*.d.ts',
        '**/*.config.*',
        // Type-only files containing only interfaces/types that compile to nothing
        'src/types/**',
        'src/features/tests/api/types.ts',
        'src/features/dashboard/api/types.ts',
        'src/features/executions/api/types.ts',
        'src/features/profiles/api/types.ts',
        'src/features/settings/api/environments/types.ts',
        'src/features/settings/api/global-variables/types.ts',
        'src/features/suites/api/types.ts',
        'src/features/regressions/api/types.ts',
        'src/features/functions/api/types.ts',
        'src/services/websocket-client/types.ts',
        'src/services/websocket-client/events.ts',
        'src/services/api-client/types.ts',
        'src/components/shared/data-table/types.ts',
        'src/features/workbench/common/element-config/types.ts',
        'src/features/workbench/common/editors/text-editor-modal/types.ts',
        'src/features/workbench/common/canvas/workflow-node/types.ts',
        'src/features/workbench/common/canvas/canvas-action-bar/types.ts',
        'src/features/workbench/common/test-form/types.ts',
        'src/features/workbench/lib/ast-visitor/types.ts',
        'src/features/workbench/lib/expression-validation/types.ts',
        'src/features/workbench/lib/codemirror/index.ts',
        'src/features/workbench/common/index.ts',
        'src/features/workbench/docs/_types.ts',
        // SSR utility contains `typeof window === 'undefined'` checks that
        // cannot be tested in JSDOM where window is always defined
        'src/lib/ssr.ts',
        // shadcn/ui components - vendored third-party code used as-is
        'src/components/ui/command.tsx',
        'src/components/ui/dialog.tsx',
        'src/components/ui/radio-group.tsx',
        'src/components/ui/scroll-area.tsx',
        'src/components/ui/select.tsx',
        'src/components/ui/sheet.tsx',
        'src/components/ui/sidebar.tsx',
        // Barrel export files - just re-exports
        'src/features/dashboard/components/index.ts',
      ],
      all: true,
      thresholds: {
        lines: 100,
        // v8 ignore blocks hide lines, branches and statements, but not functions defined inside them.
        functions: 96,
        branches: 100,
        statements: 100,
      },
    },
  },
})
