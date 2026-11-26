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

const COMPONENTS_SPECIFIER = String.raw`/(^|\/)components(\/|$)/`;
const PAGE_SPECIFIER = String.raw`/(^|\/)([^/]*-)?page(\/|$)/`;

// no-restricted-imports sees only static imports, so dynamic and type imports need selectors.
function nonStaticImportsOf(specifier) {
  return [
    `ImportExpression > Literal[value=${specifier}]`,
    `TSImportType > Literal[value=${specifier}]`,
    `ImportExpression TemplateElement[value.raw=${specifier}]`,
  ].join(', ');
}

const UNSAFE_VOID =
  '`void` may only mark a navigate call, a viewport move (fitView, fitBounds, setCenter, setViewport), an import(), or a chain that ends in .catch() or a two-argument .then().';

// Navigation, viewport moves and preload imports have no failure to report; the chains handle theirs.
const SAFE_VOID_ARGUMENTS = [
  '[argument.type="ImportExpression"]',
  String.raw`[argument.callee.name=/^(navigate|setCenter|setViewport|fitView|fitBounds|\w+FitView)$/]`,
  '[argument.callee.property.name=/^(setCenter|setViewport|fitView|fitBounds)$/]',
  '[argument.callee.property.name="catch"]',
  '[argument.callee.property.name="then"][argument.arguments.1]',
];
const SAFE_VOID_EXCLUSIONS = SAFE_VOID_ARGUMENTS.map((form) => `:not(${form})`).join('');
const UNSAFE_VOID_SELECTOR = `UnaryExpression[operator="void"]${SAFE_VOID_EXCLUSIONS}`;

const OWN_FEATURE = { featureName: '{{ from.captured.featureName }}' };

const APP_LAYER_ALLOW = ['shared', 'feature', 'feature-api', 'app'].map((type) => ({ to: { type } }));

// Cross-feature imports a feature may make: its feature modules first, then feature APIs.
const CROSS_FEATURE_IMPORTS = [
  // Test pages embed the canvas, filter by suite and start runs.
  { from: 'tests', features: ['workbench', 'suites'], apis: ['workbench', 'suites', 'executions'] },
  // Suite filters read Test data; the Run dialog starts runs.
  { from: 'suites', features: ['tests'], apis: ['tests', 'executions'] },
  // Regressions compose suites and start runs from the Run dialog.
  { from: 'regressions', features: ['suites'], apis: ['suites', 'executions'] },
  // Report rows are finished executions and reuse their user facet.
  { from: 'reports', features: [], apis: ['executions'] },
  // The suite detail breadcrumb shows the parent regression name.
  { from: 'suites', features: [], apis: ['regressions'] },
  // Profiles reuse the workbench value cell and "Edit value" sheet.
  { from: 'profiles', features: ['workbench'], apis: ['workbench'] },
  // Suite, Regression and System variables reuse the workbench value cell.
  { from: 'suites', features: ['workbench'], apis: [] },
  { from: 'regressions', features: ['workbench'], apis: [] },
  { from: 'settings', features: ['workbench'], apis: [] },
  // Function canvas helpers use the drill stack in the workbench workflow store.
  { from: 'functions', features: ['workbench'], apis: ['workbench'] },
  // The workbench imports the API types of the data it works on.
  {
    from: 'workbench',
    features: ['tests', 'suites', 'profiles', 'settings', 'functions'],
    apis: ['tests', 'suites', 'profiles', 'settings', 'executions', 'regressions', 'functions'],
  },
  // Execution detail reuses the workbench console and the suite and regression run dialog hooks.
  { from: 'executions', features: ['workbench', 'suites', 'regressions'], apis: [] },
];

function featureImportRule({ from, features, apis }) {
  return {
    from: { type: 'feature', captured: { featureName: from } },
    allow: [
      ...features.map((featureName) => ({ to: { type: 'feature', captured: { featureName } } })),
      ...apis.map((featureName) => ({ to: { type: 'feature-api', captured: { featureName } } })),
    ],
  };
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
  // Unhandled promises: the only block with the type-aware parser.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `void` marks a promise nothing should handle; no-restricted-syntax limits where it may go.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksConditionals: true, checksSpreads: true, checksVoidReturn: true },
      ],
      'no-restricted-syntax': ['error', { selector: UNSAFE_VOID_SELECTOR, message: UNSAFE_VOID }],
    },
  },
  // lib/ holds pure data and logic: no JSX, React or component imports.
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
        // Flat config replaces rule options per block, so lib/ repeats the void guard.
        { selector: UNSAFE_VOID_SELECTOR, message: UNSAFE_VOID },
      ],
    },
  },
  // Boundary enforcement: feature isolation and API layer direction.
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
        // A separate element type, so API modules never import their feature's UI or stores.
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
            // Shared hooks may read the tests and settings feature APIs.
            {
              from: { type: 'shared' },
              allow: [
                { to: { type: 'feature-api', captured: { featureName: 'tests' } } },
                { to: { type: 'feature-api', captured: { featureName: 'settings' } } },
              ],
            },
            // feature-api imports only shared code and its own feature's API.
            {
              from: { type: 'feature-api' },
              allow: [
                { to: { type: 'shared' } },
                { to: { type: 'feature-api', captured: OWN_FEATURE } },
              ],
            },
            // feature (non-api) can import from shared, own feature, and own feature-api
            {
              from: { type: 'feature' },
              allow: [
                { to: { type: 'shared' } },
                { to: { type: 'feature', captured: OWN_FEATURE } },
                { to: { type: 'feature-api', captured: OWN_FEATURE } },
              ],
            },
            ...CROSS_FEATURE_IMPORTS.map(featureImportRule),
            { from: { type: 'app' }, allow: APP_LAYER_ALLOW },
            { from: { type: 'root' }, allow: APP_LAYER_ALLOW },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      'coverage/**',
      'build/**',
      'public/**',
      '*.config.*',
      'postcss.config.js',
    ],
  },
];
