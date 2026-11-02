import { resolve } from 'node:path';
import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const LIB_NO_REACT =
  'lib/ must contain pure data and logic - no React. Move hooks to hooks/ and markup to components/.';
const LIB_NO_COMPONENTS =
  'lib/ must not import from components/. Move a type or constant into lib/, or move the whole module into components/.';
const LIB_NO_PAGES =
  'lib/ must not import a page module. Pages are React components; move the shared value down into lib/ instead.';
const LIB_NO_JSX = 'lib/ must not contain JSX. Move the markup into components/.';

const COMPONENTS_SPECIFIER = '/(^|\\/)components(\\/|$)/';
const PAGE_SPECIFIER = '/(^|\\/)([^/]*-)?page(\\/|$)/';

// no-restricted-imports only sees static imports and re-exports, so the
// dynamic and type-position forms of the same import need AST selectors.
function nonStaticImportsOf(specifier) {
  return [
    `ImportExpression > Literal[value=${specifier}]`,
    `TSImportType > Literal[value=${specifier}]`,
    `ImportExpression TemplateElement[value.raw=${specifier}]`,
  ].join(', ');
}

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Allow underscore-prefixed unused vars (standard convention used throughout codebase)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // Disable base rule (typescript-eslint handles it)
      'no-unused-vars': 'off',
    },
  },
  // ============================================================================
  // Unhandled-promise enforcement. These two rules need the type checker, so
  // this block is the only one that turns on the type-aware parser. A promise
  // nobody awaits swallows its rejection, which is why every failure must be
  // awaited by a caller that reports it or carry its own reporting catch.
  // ============================================================================
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ignoreVoid: false - `void doThing()` discards the rejection just as
      // silently as no operator at all.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          ignoreVoid: false,
          // Router navigation and viewport animation resolve when the gesture
          // finishes; neither promise can carry a failure to report.
          allowForKnownSafeCalls: [
            { from: 'package', package: 'react-router', name: 'NavigateFunction' },
            { from: 'package', package: '@xyflow/system', name: 'SetCenter' },
            { from: 'package', package: '@xyflow/react', name: 'FitView' },
          ],
        },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksConditionals: true, checksSpreads: true, checksVoidReturn: true },
      ],
    },
  },
  // ============================================================================
  // lib/ purity: lib/ holds pure data and logic, so it contains no JSX and
  // imports neither React nor any React component module. The dependency runs
  // one way: components/ -> lib/, never the reverse.
  // ============================================================================
  {
    files: ['src/**/lib/**/*.ts', 'src/**/lib/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: LIB_NO_REACT },
          { name: 'react-dom', message: LIB_NO_REACT },
        ],
        patterns: [
          { group: ['react/*', 'react-dom/*'], message: LIB_NO_REACT },
          { group: ['**/components', '**/components/**'], message: LIB_NO_COMPONENTS },
          { group: ['**/page', '**/page/**', '**/*-page'], message: LIB_NO_PAGES },
        ],
      }],
      'no-restricted-syntax': [
        'error',
        { selector: 'JSXElement, JSXFragment', message: LIB_NO_JSX },
        { selector: nonStaticImportsOf(COMPONENTS_SPECIFIER), message: LIB_NO_COMPONENTS },
        { selector: nonStaticImportsOf(PAGE_SPECIFIER), message: LIB_NO_PAGES },
      ],
    },
  },
  // ============================================================================
  // Boundary enforcement: feature isolation + API layer direction
  // ============================================================================
  {
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*'],
      'boundaries/root-path': resolve(import.meta.dirname),
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
        },
      },
      'boundaries/elements': [
        {
          mode: 'full',
          type: 'shared',
          pattern: [
            'src/components/**/*',
            'src/hooks/**/*',
            'src/lib/**/*',
            'src/services/**/*',
            'src/stores/**/*',
            'src/design-system/**/*',
            'src/types/**/*',
          ],
        },
        // feature-api is a separate element type so we can restrict what it imports.
        // API modules define types and fetch data - they must never import from
        // components, containers, hooks, or stores within their feature.
        {
          mode: 'full',
          type: 'feature-api',
          capture: ['featureName'],
          pattern: ['src/features/*/api/**/*'],
        },
        {
          mode: 'full',
          type: 'feature',
          capture: ['featureName'],
          pattern: ['src/features/*/**/*'],
        },
        {
          mode: 'full',
          type: 'app',
          pattern: ['src/app/**/*'],
        },
        {
          mode: 'full',
          type: 'root',
          pattern: ['src/*'],
        },
      ],
    },
    rules: {
      'boundaries/no-unknown': 'error',
      'boundaries/no-unknown-files': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: [
            {
              from: { type: 'shared' },
              allow: [{ to: { type: 'shared' } }],
            },
            // Shared hooks import from feature APIs for cross-cutting concerns:
            // - use-environments.ts imports from settings/api/environments
            {
              from: { type: 'shared' },
              allow: [
                { to: { type: 'feature-api', captured: { featureName: 'tests' } } },
                { to: { type: 'feature-api', captured: { featureName: 'settings' } } },
              ],
            },
            // feature-api can only import from shared and its own feature's api.
            // This prevents the inverted dependency: api/ must never reach into
            // components/, container/, hooks/, or stores/.
            {
              from: { type: 'feature-api' },
              allow: [
                { to: { type: 'shared' } },
                { to: { type: 'feature-api', captured: { featureName: '{{ from.captured.featureName }}' } } },
              ],
            },
            // feature (non-api) can import from shared, own feature, and own feature-api
            {
              from: { type: 'feature' },
              allow: [
                { to: { type: 'shared' } },
                { to: { type: 'feature', captured: { featureName: '{{ from.captured.featureName }}' } } },
                { to: { type: 'feature-api', captured: { featureName: '{{ from.captured.featureName }}' } } },
              ],
            },
            // Tests feature embeds the workbench canvas for test create/edit pages,
            // imports suite names for the suite filter dropdown, and triggers
            // tracked executions via the executions API from the run dialog.
            {
              from: { type: 'feature', captured: { featureName: 'tests' } },
              allow: [
                { to: { type: 'feature', captured: { featureName: 'workbench' } } },
                { to: { type: 'feature', captured: { featureName: 'suites' } } },
                { to: { type: 'feature-api', captured: { featureName: 'workbench' } } },
                { to: { type: 'feature-api', captured: { featureName: 'suites' } } },
                { to: { type: 'feature-api', captured: { featureName: 'executions' } } },
              ],
            },
            // Suites feature imports suite names from tests for filter dropdowns
            // and starts tracked executions from the Run dialog via the
            // executions API (mirrors the tests feature's use of executions).
            {
              from: { type: 'feature', captured: { featureName: 'suites' } },
              allow: [
                { to: { type: 'feature', captured: { featureName: 'tests' } } },
                { to: { type: 'feature-api', captured: { featureName: 'tests' } } },
                { to: { type: 'feature-api', captured: { featureName: 'executions' } } },
              ],
            },
            // Regressions feature composes suites, so the regression detail
            // page needs to read the suite catalog (name/tag lookups for the
            // suite picker modal and column filters). Mirrors suites -> tests.
            // Also starts tracked executions from the Run dialog.
            {
              from: { type: 'feature', captured: { featureName: 'regressions' } },
              allow: [
                { to: { type: 'feature', captured: { featureName: 'suites' } } },
                { to: { type: 'feature-api', captured: { featureName: 'suites' } } },
                { to: { type: 'feature-api', captured: { featureName: 'executions' } } },
              ],
            },
            // Reports rows are finished executions, so the reports list
            // reuses the executions user facet (triggered_by values).
            {
              from: { type: 'feature', captured: { featureName: 'reports' } },
              allow: [
                { to: { type: 'feature-api', captured: { featureName: 'executions' } } },
              ],
            },
            // Suites feature reads regression names for the detail header
            // breadcrumb (suite-detail-page must render `<reg> / <suite>`
            // when the user arrived via a regression URL).
            {
              from: { type: 'feature', captured: { featureName: 'suites' } },
              allow: [
                { to: { type: 'feature-api', captured: { featureName: 'regressions' } } },
              ],
            },
            // Profiles feature reuses the workbench's shared variable value cell
            // + "Edit value" sheet (VariableValueCell / ValueEditorSheet) for
            // profile parameter value editing.
            {
              from: { type: 'feature', captured: { featureName: 'profiles' } },
              allow: [
                { to: { type: 'feature', captured: { featureName: 'workbench' } } },
                { to: { type: 'feature-api', captured: { featureName: 'workbench' } } },
              ],
            },
            // Entity-scope variable editing (Suite / Regression / System
            // variables) reuses the workbench's shared value cell
            // (EntityVariableValueCell -> VariableValueCell + the "Edit value"
            // sheet), injected into the shared VariableEditor via renderValueCell -
            // the same cross-feature reuse profiles uses above.
            {
              from: { type: 'feature', captured: { featureName: 'suites' } },
              allow: [{ to: { type: 'feature', captured: { featureName: 'workbench' } } }],
            },
            {
              from: { type: 'feature', captured: { featureName: 'regressions' } },
              allow: [{ to: { type: 'feature', captured: { featureName: 'workbench' } } }],
            },
            {
              from: { type: 'feature', captured: { featureName: 'settings' } },
              allow: [{ to: { type: 'feature', captured: { featureName: 'workbench' } } }],
            },
            // Functions/canvas helpers (use-drill-handler, use-function-scope,
            // inner-workflow, function-scope-vars) live under
            // features/functions/ because they encapsulate Function-entity
            // canvas behavior, but the drill stack itself is per-Test state
            // owned by the workbench's workflow store. The helpers therefore
            // depend on `features/workbench/stores/workflow-store`.
            {
              from: { type: 'feature', captured: { featureName: 'functions' } },
              allow: [
                { to: { type: 'feature', captured: { featureName: 'workbench' } } },
                { to: { type: 'feature-api', captured: { featureName: 'workbench' } } },
              ],
            },
            // Workbench imports API types from features whose data it operates on:
            // tests (workflow CRUD), suites (suite selector), profiles (profile
            // binding), settings (global variables for test lifecycle),
            // executions (parent status short-circuit when following the next
            // child session of a sequential suite/regression run),
            // regressions (breadcrumb-context fetches the parent regression
            // name when the workbench is opened with `?regressionId=...`),
            // and functions (Function nodes + library modal on the canvas).
            {
              from: { type: 'feature', captured: { featureName: 'workbench' } },
              allow: [
                { to: { type: 'feature', captured: { featureName: 'tests' } } },
                { to: { type: 'feature', captured: { featureName: 'suites' } } },
                { to: { type: 'feature', captured: { featureName: 'profiles' } } },
                { to: { type: 'feature', captured: { featureName: 'settings' } } },
                { to: { type: 'feature', captured: { featureName: 'functions' } } },
                { to: { type: 'feature-api', captured: { featureName: 'tests' } } },
                { to: { type: 'feature-api', captured: { featureName: 'suites' } } },
                { to: { type: 'feature-api', captured: { featureName: 'profiles' } } },
                { to: { type: 'feature-api', captured: { featureName: 'settings' } } },
                { to: { type: 'feature-api', captured: { featureName: 'executions' } } },
                { to: { type: 'feature-api', captured: { featureName: 'regressions' } } },
                { to: { type: 'feature-api', captured: { featureName: 'functions' } } },
              ],
            },
            // Executions detail reuses the Workbench ConsolePanel - the
            // execution_id doubles as the workbench session_id by design.
            // The execution-toolbar's Re-run flow also reuses the run-dialog
            // hooks from suites and regressions so Re-run surfaces the same
            // subset panel, duplicate badges, and pre-populated selection.
            {
              from: { type: 'feature', captured: { featureName: 'executions' } },
              allow: [
                { to: { type: 'feature', captured: { featureName: 'workbench' } } },
                { to: { type: 'feature', captured: { featureName: 'suites' } } },
                { to: { type: 'feature', captured: { featureName: 'regressions' } } },
              ],
            },
            {
              from: { type: 'app' },
              allow: [
                { to: { type: 'shared' } },
                { to: { type: 'feature' } },
                { to: { type: 'feature-api' } },
                { to: { type: 'app' } },
              ],
            },
            {
              from: { type: 'root' },
              allow: [
                { to: { type: 'shared' } },
                { to: { type: 'feature' } },
                { to: { type: 'feature-api' } },
                { to: { type: 'app' } },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      'tests/**',
      'coverage/**',
      'build/**',
      'public/**',
      '*.config.*',
      'postcss.config.js',
    ],
  },
];
