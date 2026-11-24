/// <reference types="vitest" />
import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { availableParallelism, freemem } from 'node:os'
import { handleProxyError, type ProxyErrorTarget } from './vite-proxy'

/** An unreachable backend answers with the JSON error envelope the offline banner recognizes. */
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

// Backend for the dev and preview proxies; WAVE_BE_URL points at another backend.
const BACKEND_URL =
  process.env.WAVE_BE_URL || process.env.VITE_API_BASE_URL || 'http://localhost:8000'
const BACKEND_WS_URL = BACKEND_URL.replace(/^http/, 'ws')

// Each fork holds a jsdom and its coverage, so free memory bounds the pool like cores do.
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
    // Same-origin proxy keeps Chrome's connection pool clean across backend restarts.
    proxy: {
      '/api': backendProxy(BACKEND_URL, {
        rewrite: (p) => p.replace(/^\/api/, ''),
      }),
      '/ws': backendProxy(BACKEND_WS_URL, { ws: true }),
    },
  },
  preview: {
    port: 3001,
    // Env-driven targets let one bundle serve several previews, each with its own backend.
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
          // XYFlow and resizable-panels: large, stable canvas and layout libraries.
          'vendor-flow': [
            '@xyflow/react',
            '@xyflow/system',
            'react-resizable-panels',
          ],
          // Tree-sitter runtime for expression validation: sizable and stable.
          'vendor-tree-sitter': ['web-tree-sitter'],
          // CodeMirror and its Lezer parsers, kept out of the workbench route chunk.
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
    // A pinned timezone with stable PDT and PST abbreviations across Node ICU versions.
    env: {
      TZ: 'America/Los_Angeles',
    },
    // GitHub Actions runners are CPU-starved; locally the shorter limit still catches slow tests.
    testTimeout: process.env.GITHUB_ACTIONS === 'true' ? 30000 : 10000,
    // Forks isolate test files that reset global singletons such as tree-sitter.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        isolate: true,
      },
    },
    // Match the 4-core GitHub runner; locally, cores and free memory set the cap.
    maxWorkers: process.env.GITHUB_ACTIONS === 'true' ? 4 : LOCAL_TEST_WORKERS,
    minWorkers: process.env.GITHUB_ACTIONS === 'true' ? 2 : LOCAL_TEST_WORKERS,
    // Known Radix UI test warning: https://github.com/radix-ui/primitives/issues/1952
    onConsoleLog(log) {
      if (log.includes('DialogContent') && log.includes('DialogTitle')) {
        return false // Suppress this log
      }
      // React lazy loading notices under waitFor are informational.
      if (log.includes('A suspended resource finished loading inside a test')) {
        return false
      }
      return true // Keep other logs
    },
    coverage: {
      provider: 'v8',
      reporter: [
        // A wide table keeps the uncovered lines column from truncating in CI logs.
        ['text', { maxCols: 400 }],
        'html',
        'json',
        'lcov', // For SonarQube integration
      ],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [],
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
