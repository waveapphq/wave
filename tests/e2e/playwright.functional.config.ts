/** Functional Playwright config; run specs with ./scripts/e2e-targeted-local.sh functional/<suite>/<spec>.spec.ts */

import { defineConfig, devices } from '@playwright/test'
import os from 'os'
import path from 'path'

const projectRoot = path.resolve(__dirname, '../..')
const isCI = !!process.env.CI

const externalServices = process.env.WAVE_E2E_EXTERNAL_SERVICES === '1'

// N parallel stacks in host mode; a container shard runs one.
const N_STACKS = externalServices
  ? 1
  : Number(process.env.WAVE_E2E_N_STACKS || '4')
const FRONTEND_BASE_PORT = Number(process.env.WAVE_E2E_FRONTEND_PORT || '3000')
const BACKEND_BASE_PORT = Number(process.env.WAVE_E2E_BACKEND_PORT || '8000')
const SSH_MAIN_PORT = Number(process.env.SSH_MAIN_PORT || '9445')

const desktopChrome = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
}

export default defineConfig({
  testDir: './functional',
  forbidOnly: isCI,
  // No retries - flaky tests must be fixed at the source, not papered over.
  retries: 0,
  workers: N_STACKS,
  reporter: [
    ['html', { open: 'never', outputFolder: './playwright-artifacts/functional-report' }],
    ['list'],
  ],

  globalSetup: './setup/global-setup.ts',

  outputDir: './playwright-artifacts/functional-results',

  // Longer timeouts for execution tests (10 nodes + config + 2 runs)
  timeout: 300_000,
  expect: { timeout: 10_000 },

  use: {
    ...desktopChrome,
    // playwright-fixtures.ts sets baseURL per worker; this is the fallback.
    baseURL: `http://localhost:${FRONTEND_BASE_PORT}`,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Allow self-signed certs from the stack's HTTPS services
    ignoreHTTPSErrors: true,
  },

  // Host mode spawns N backend and frontend pairs; container shards start their own.
  webServer: externalServices
    ? undefined
    : [
        ...Array.from({ length: N_STACKS }).flatMap((_, i) => {
          const fePort = FRONTEND_BASE_PORT + i
          const bePort = BACKEND_BASE_PORT + i
          const dataDir = path.join(os.tmpdir(), `wave-e2e-stack-${i}`)
          const configFile = `${dataDir}.config.yaml`
          // The data folder outlives the run, so its key is kept in a file beside it.
          const keyFile = `${dataDir}.secret-key`
          const cors = `http://localhost:${fePort},http://127.0.0.1:${fePort}`
          return [
            {
              // A WAVE_SECRET_KEY from the developer's shell would override the copied config's key.
              command:
                `../scripts/e2e-config-with-key.sh ${configFile} ${keyFile} && ` +
                `env -u WAVE_SECRET_KEY ` +
                `WAVE_CONFIG_FILE=${configFile} ` +
                `WAVE_ADMIN_ALLOWED=true ` +
                `WAVE_STORAGE_BASE_PATH=${dataDir} ` +
                `WAVE_SECURITY_CORS_ORIGINS=${cors} ` +
                `poetry run uvicorn wavecore.api.app:app --port ${bePort}`,
              cwd: path.join(projectRoot, 'backend'),
              url: `http://localhost:${bePort}/health`,
              reuseExistingServer: !isCI,
              timeout: 120_000,
              // Don't mix server logs into the Playwright output.
              stdout: 'ignore' as const,
              stderr: 'ignore' as const,
            },
            {
              // Preview the build-<i> bundle that ci-playwright-local.sh built for this port.
              command: `npx vite preview --outDir build-${i} --port ${fePort} --strictPort`,
              cwd: path.join(projectRoot, 'frontend'),
              url: `http://localhost:${fePort}`,
              reuseExistingServer: !isCI,
              timeout: 120_000,
              stdout: 'ignore' as const,
              stderr: 'ignore' as const,
            },
          ]
        }),
        // The compose service stack; container shards start it in the CI script instead.
        {
          command: `${path.join(projectRoot, 'scripts/e2e-stack.sh')} run`,
          port: SSH_MAIN_PORT,
          reuseExistingServer: !isCI,
          timeout: 180_000,
          stdout: 'ignore' as const,
          stderr: 'ignore' as const,
        },
      ],

  projects: [
    // Step 1: destructive tests, parallel across stacks, serial within a file.
    {
      name: 'functional-destructive',
      testMatch: [
        'backup-restore/**/*.spec.ts',
        'global-variables/**/*.spec.ts',
        'suite-management/**/*.spec.ts',
        'suite-variable-collision/**/*.spec.ts',
        'suite-namespace-autocomplete/**/*.spec.ts',
        'variable-isolation/**/*.spec.ts',
        'import-export/**/*.spec.ts',
        'import-export-env/**/*.spec.ts',
        'import-export-profile/**/*.spec.ts',
        'import-export-suite/**/*.spec.ts',
        'import-export-regression/**/*.spec.ts',
        // System Variables export and import through the shared dialogs.
        'import-export-global-variables/**/*.spec.ts',
        // Per-export Secret values choice and the foreign-encrypted import warning.
        'export-secrets/**/*.spec.ts',
        'regression-management/**/*.spec.ts',
        'regression-variable-collision/**/*.spec.ts',
        'regression-namespace-autocomplete/**/*.spec.ts',
        // Pure CRUD: suite delete cascades out of regressions
        'suite-delete-cascade/**/*.spec.ts',
        // Admin endpoint inspection/teardown of the workbench session map
        'admin-workbench-session/**/*.spec.ts',
        // Profiles: usage tracking, structural lock, env cascade, alias and namespace rules.
        'profile-bugs/**/*.spec.ts',
        // Profile value editor: per-type edit and persist, secrets, per-env isolation.
        'profile-value-editor/**/*.spec.ts',
        // Suite, System and Regression variable value editing on the shared bodies.
        'entity-variable-editor/**/*.spec.ts',
        // Suite and regression secret grids: masked re-save and un-secure confirm.
        'secret-entity-grid/**/*.spec.ts',
        // Storage directories: deletes backend data files, so never beside the workflow project.
        'storage-directory-follow/**/*.spec.ts',
        // Settings saved into the config file (REQ-4.7.15 to REQ-4.7.18); changes stack-wide settings.
        'instance-config/**/*.spec.ts',
        // The number rule on stack-wide state (REQ-3.1.3.14).
        'number-rule-global/**/*.spec.ts',
      ],
      use: desktopChrome,
    },
    // Step 2: workflow tests import their own fixtures, so no dependency on step 1.
    {
      name: 'functional-workflow',
      testMatch: [
        'assert-control/**/*.spec.ts',
        'delay-control/**/*.spec.ts',
        'http-plugin/**/*.spec.ts',
        // HTTP TLS matrix against the tls-lab nginx service.
        'http-tls/**/*.spec.ts',
        // One-shot recipe authoring through the live MCP endpoint.
        'recipe-authoring/**/*.spec.ts',
        // Single active session ownership, live mirroring and take-over.
        'session-ownership/**/*.spec.ts',
        // Watch-mode authoring, Focus Current and live MCP builds mirrored in every tab.
        'watch-mode/**/*.spec.ts',
        // Browser sessions as terminable connections: roster, roles and admin disconnect.
        'wave-server-sessions/**/*.spec.ts',
        // Live execution mirroring of person and MCP runs to watchers.
        'run-mirror/**/*.spec.ts',
        // A split fail_current_scope assert in a loop body fails the run.
        'scope-fail-loop/**/*.spec.ts',
        // Recipe readback is faithful or refuses amendment.
        'mcp-readback-integrity/**/*.spec.ts',
        // Declare-empty profile secrets over MCP come back as manual action items.
        'mcp-profile-actions/**/*.spec.ts',
        // Declare-empty Test secrets are valid and show as pending action items.
        'mcp-declare-empty-secrets/**/*.spec.ts',
        // Test Data over MCP: the five tools, run-time refusals and testdata:// warnings.
        'mcp-testdata/**/*.spec.ts',
        // Run report over MCP: Block paths, branch order and the tool description.
        'mcp-report/**/*.spec.ts',
        // Control Block fields on the one value field, driven in the window and run end to end.
        'control-block-fields/**/*.spec.ts',
        // One spec per MCP tool for Suites, Regressions and the list tools.
        'mcp-suites/**/*.spec.ts',
        'mcp-regressions/**/*.spec.ts',
        'mcp-lists/**/*.spec.ts',
        // SSH Session Open, Execute and Close against the asyncssh simulator.
        'ssh-session/**/*.spec.ts',
        // SSH Tunnel Open and Close riding a session.
        'ssh-tunnel/**/*.spec.ts',
        // K8s Connect against the real kwok clusters.
        'k8s-connect/**/*.spec.ts',
        // The four K8s read Blocks; needs kwok and k8s-stub (functional/k8s-read/README.md).
        'k8s-read/**/*.spec.ts',
        // The four K8s write Blocks; needs kwok (functional/k8s-write/README.md).
        'k8s-write/**/*.spec.ts',
        // The three K8s exec-channel Blocks; needs kwok (functional/k8s-exec/README.md).
        'k8s-exec/**/*.spec.ts',
        // K8s across an SSH tunnel and a direct session (functional/k8s-tunnel/README.md).
        'k8s-tunnel/**/*.spec.ts',
        // K8s Blocks inside Remote Execution (functional/k8s-remote-exec/README.md).
        'k8s-remote-exec/**/*.spec.ts',
        // The six Helm Blocks; needs kwok, tls-lab and sshd (functional/helm/README.md).
        'helm/**/*.spec.ts',
        // Block Timeout as a wall-clock bound (functional/block-timeout/README.md).
        'block-timeout/**/*.spec.ts',
        // The output binding name gate on the Block sheet and the Function modal.
        'output-binding-name-gate/**/*.spec.ts',
        // The pre-run check validates the canvas about to run, not the saved copy.
        'prerun-dirty-gate/**/*.spec.ts',
        // Tables in the run console: aligned columns, caps and masking.
        'console-table-render/**/*.spec.ts',
        // A declared variable with no value holds and reads null.
        'null-start-value/**/*.spec.ts',
        // Null values in real runs (REQ-3.1.3.20 to REQ-3.1.3.23).
        'null-values/**/*.spec.ts',
        // The one value field on every Block (REQ-3.1.1.5).
        'one-value-field/**/*.spec.ts',
        // Map, list and table entry editors: entry {x}, null, nested levels, type change and the row look.
        'entry-editors/**/*.spec.ts',
        // One number rule for every numeric field (REQ-3.1.3.14).
        'number-rule/**/*.spec.ts',
        // Checks on null (REQ-3.1.3.25): is null / not null, the holds-nothing rule.
        'null-checks/**/*.spec.ts',
        // SSH Session Script over stdin (functional/ssh-session-script/README.md).
        'ssh-session-script/**/*.spec.ts',
        // Remote Execution on the real sshd host (functional/remote-exec/README.md).
        'remote-exec/**/*.spec.ts',
        'ssh-session-via-parent/**/*.spec.ts',
        // Settings > Network trusted hosts and certificates (REQ-4.5.14, REQ-4.5.16).
        'network-ssh-hosts/**/*.spec.ts',
        'network-certificates/**/*.spec.ts',
        'network-certificates-consumers/**/*.spec.ts',
        // Settings > Network > Proxy through the tinyproxy pair (REQ-4.7.14).
        'network-proxy/**/*.spec.ts',
        // Settings page shell, leave prompt and nav group state (NET-1).
        'network-settings-pages/**/*.spec.ts',
        'settings-sections/**/*.spec.ts',
        'remote-standalone/**/*.spec.ts',
        'remote-lifecycle/**/*.spec.ts',
        'ssh-secrets/**/*.spec.ts',
        // Marked Shell Script and Python output masks on every output surface.
        'shell-python-secrets/**/*.spec.ts',
        'console-log-level/**/*.spec.ts',
        'remote-real-harness/**/*.spec.ts',
        // HTTP Headers, Query and Body params through the shared Edit value sheet.
        'element-config-value-editor/**/*.spec.ts',
        // A single-line url param through Template, Expression and Literal kinds.
        'param-template-trim/**/*.spec.ts',
        // File I/O artifact:// round trip and the session artifacts API (REQ-3.7.1.4).
        'file-io-artifacts/**/*.spec.ts',
        // File I/O: the eight operations and three abort fixtures.
        'file-io-operations/**/*.spec.ts',
        // File I/O inside Remote Execution (functional/file-io-remote/README.md).
        'file-io-remote/**/*.spec.ts',
        // The Test Data sheet end to end (functional/testdata-sheet/README.md).
        'testdata-sheet/**/*.spec.ts',
        // The file-reference picker in all four modes (functional/file-picker/README.md).
        'file-picker/**/*.spec.ts',
        // Shell Script and Shell Exec on the WAVE host (functional/shell-blocks/README.md).
        'shell-blocks/**/*.spec.ts',
        // The Python Block on the WAVE host and sshd (functional/python-block/README.md).
        'python-block/**/*.spec.ts',
        // Netcat against netcat-echo and sshd (functional/netcat/README.md).
        'netcat/**/*.spec.ts',
        // Netcat inside Remote Execution (functional/netcat-remote/README.md).
        'netcat-remote/**/*.spec.ts',
        // Netcat through an SSH tunnel, NETCAT-9 and NETCAT-18 (functional/netcat-tunnel/README.md).
        'netcat-tunnel/**/*.spec.ts',
        // Ping on the WAVE host and inside Remote Execution (functional/ping/README.md).
        'ping/**/*.spec.ts',
        // The SQL Block, SQL-1 to SQL-15 (functional/sql-run/README.md and its siblings).
        'sql-run/**/*.spec.ts',
        'sql-load/**/*.spec.ts',
        'sql-procedure/**/*.spec.ts',
        'sql-editor/**/*.spec.ts',
        // UTF-8 text on every surface and the non-UTF-8 start refusal (REQ-4.6.9).
        'text-encoding/**/*.spec.ts',
        // A failed request keeps its request line and one request id in the server log.
        'request-logging/**/*.spec.ts',
        // The engine names a block by its Name on every surface (EXEC-26).
        'block-name/**/*.spec.ts',
        // The OpenSearch Block, OS-1 to OS-16 (functional/opensearch-search/README.md).
        'opensearch-search/**/*.spec.ts',
        'opensearch-aggregate/**/*.spec.ts',
        'opensearch-editor/**/*.spec.ts',
        // The SFTP Block on real OpenSSH servers (functional/sftp/README.md).
        'sftp/**/*.spec.ts',
        // Every lane of every control built on the canvas (functional/canvas-lanes/README.md).
        'canvas-lanes/**/*.spec.ts',
        // Only the lanes a run went through stay highlighted (functional/canvas-run-wires/README.md).
        'canvas-run-wires/**/*.spec.ts',
        // Profile modal field errors, FIELDERR-1 to FIELDERR-3.
        'profile-field-errors/**/*.spec.ts',
        // Every container in every slot kind, at depth (functional/nesting/README.md).
        'nesting/**/*.spec.ts',
        // On-demand report generation (REQ-3.7.2.1 to REQ-3.7.2.8).
        'report-generation/**/*.spec.ts',
        // Artifact browser: grouping, downloads, soft delete and the delete cascade.
        'artifact-browser/**/*.spec.ts',
        // An inline HTML or SVG artifact runs its script outside WAVE's origin.
        'artifact-inline-page/**/*.spec.ts',
        'halt-control/**/*.spec.ts',
        'if-else-control/**/*.spec.ts',
        // Switch/Case end to end: break, fall-through, default and the then egress.
        'switch-case-control/**/*.spec.ts',
        // Parallel end to end: joins, first-to-finish, time limits and the debug cursor.
        'parallel-control/**/*.spec.ts',
        // Wait Until end to end against the real http-echo service.
        'wait-until-control/**/*.spec.ts',
        // The shared variable picker on every condition surface.
        'variable-picker/**/*.spec.ts',
        'json-parser/**/*.spec.ts',
        // json_content as literal, expression and template in every output mode.
        'json-parser-content-kinds/**/*.spec.ts',
        'log-plugin/**/*.spec.ts',
        'try-catch-control/**/*.spec.ts',
        'debug-run/**/*.spec.ts',
        'debug-step/**/*.spec.ts',
        'for-control/**/*.spec.ts',
        'for-each-control/**/*.spec.ts',
        'while-control/**/*.spec.ts',
        'break-control/**/*.spec.ts',
        'continue-control/**/*.spec.ts',
        // A run passes a Note on inside every body, section, case and lane.
        'note-control/**/*.spec.ts',
        'variable-setter/**/*.spec.ts',
        // The Variable Setter assigns one value of each type, plus expression and template rows.
        'variable-setter-types/**/*.spec.ts',
        // A Variable Setter supersedes a pending expression variable without realizing it.
        'variable-setter-expression/**/*.spec.ts',
        // Profile values bind at run time with exact numbers and table dicts.
        'profile-value-runtime/**/*.spec.ts',
        // Bound HTTP and Custom profile fields read as alias.field; a secret field prints masked.
        'profile-binding/**/*.spec.ts',
        // Float Decimal pipeline stays exact end to end (REQ-3.1.3.14).
        'float-precision/**/*.spec.ts',
        'xml-parser/**/*.spec.ts',
        // CSV Parser end to end: typing, schema mapping, transforms and SERIALIZE.
        'csv-parser/**/*.spec.ts',
        // Secret masking through CSV and Log: scrub before truncate, escaped forms.
        'csv-secret-masking/**/*.spec.ts',
        // Both runtime forms of a table reach every consumer.
        'table-runtime-forms/**/*.spec.ts',
        // Excel Parser end to end: round trip, sheets, ranges and refusals.
        'excel-parser/**/*.spec.ts',
        // Read-only field expressions, table queries and the save-time sandbox scan.
        'table-expression-guards/**/*.spec.ts',
        'tracked-execution/**/*.spec.ts',
        'tracked-termination-yaml-unsafe/**/*.spec.ts',
        'dashboard-live-refresh/**/*.spec.ts',
        'execution-detail/**/*.spec.ts',
        'executions-list/**/*.spec.ts',
        // Executions export: detail dialog downloads and bulk ZIP.
        'executions-export/**/*.spec.ts',
        'tests-create/**/*.spec.ts',
        'historical-test-canvas/**/*.spec.ts',
        'run-suite/**/*.spec.ts',
        'run-regression/**/*.spec.ts',
        // Imports a delay fixture and starts tracked executions to exercise the entity-delete 409 guard
        'entity-delete-active-execution/**/*.spec.ts',
        // Ad-hoc Run/Debug end-to-end coverage (REQ-3.2.1.5)
        'run-adhoc/**/*.spec.ts',
        // Console source-column resize guard
        'console/**/*.spec.ts',
        // EntityPickerModal cross-page selection; seeds and cleans up its own fixture.
        'entity-picker/**/*.spec.ts',
        // Workbench undo/redo (post-state baseline model)
        'workbench-undo-redo/**/*.spec.ts',
        // Save-spec sanitization (selected/dragging/hasNewerVersion)
        'workbench-save-sanitize/**/*.spec.ts',
        // A workflow whose wires repeat an id: every save, import, restore, run and the Fix refuse it.
        'edge-identity/**/*.spec.ts',
        // Tests-list switch dialog timing for clean-but-executed workbench
        'tests-list-switch-dialog/**/*.spec.ts',
        // Tests page New Test and Open in Workbench gates over an artifact session.
        'tests-page-artifact-gates/**/*.spec.ts',
        // BE outage detection + dataEpoch-driven content remount
        'connection-recovery/**/*.spec.ts',
        // Settings > Environments page list endpoint must not redirect
        'environments-page/**/*.spec.ts',
        // Blocked pages and cards on failed reads (LIST-10, LIST-13 to LIST-23, PICKER-4).
        'page-blocked/**/*.spec.ts',
        // Runtime enum validator: anchored error format and 50-char truncation.
        'validation-runtime-enum/**/*.spec.ts',
        // Var Manager cycle gates and rename preservation.
        'variable-self-reference/**/*.spec.ts',
        'variable-rename-preserves/**/*.spec.ts',
        // A variable rename refactors every reference.
        'variable-rename-refactor/**/*.spec.ts',
        'variable-create-cycle/**/*.spec.ts',
        'variable-edit-cycle-blur/**/*.spec.ts',
        // V-VMGR-06-EDIT: edit variables in the inspect modal, rename with refactoring.
        'var-inspect-edit/**/*.spec.ts',
        // V-TABLE-VALIDATION: the shared table-schema validator gates Save in both views.
        'table-type-validation/**/*.spec.ts',
        // V-VMGR-CURRENT-EDIT: runtime variable overrides while paused or stopped.
        'var-current-edit/**/*.spec.ts',
        'var-current-edit-exec/**/*.spec.ts',
        // V-VMGR-TEMPLATE: a template variable renders lazily on reference.
        'template-variable/**/*.spec.ts',
        // V-VMGR-03: Variable Manager panel functional behavior.
        'var-manager-panel/**/*.spec.ts',
        // V-NATIVE-LANDMARKS: native elements and sizes on the variable manager and console.
        'native-landmarks/**/*.spec.ts',
        // V-VMGR-CREATE: the create modal end to end; seeds its own Tests.
        'variable-create-modal/**/*.spec.ts',
        // The one variable window for Add and Edit (VMGR-106 to VMGR-114).
        'variable-window/**/*.spec.ts',
        // Runtime secret masking across console, WS, variables and report.
        'secret-masking/**/*.spec.ts',
        'secret-namespace-injection/**/*.spec.ts',
        'secret-ui-guards/**/*.spec.ts',
        // Encrypt at rest: sealed envelopes on disk, real values at run time.
        'secrets-at-rest/**/*.spec.ts',
        // A masked re-save never clobbers the stored sealed secret.
        'secret-save-roundtrip/**/*.spec.ts',
        // A Variable Setter secret literal and a plugin output bound to a secret both mask.
        'secret-new-carriers/**/*.spec.ts',
        // Per-block Secret masking against the cookie simulator (REQ-3.1.3.16).
        'secret-field-masking/**/*.spec.ts',
        // Leak canary across storage, logs, WS, debugger, report and every export.
        'secret-leak-canary/**/*.spec.ts',
        // Controlled secret reveal: the per-block control and the system reveal toggles.
        'secret-reveal-controls/**/*.spec.ts',
        // Mask specific fields: unmask, run, re-mask and run again.
        'secret-field-cycle/**/*.spec.ts',
        // V-FN-PALETTE-FUNCTIONAL: New Function and library drags, then validation.
        'function-palette/**/*.spec.ts',
        // V-CANVAS-FN-*: drill-down, inner-canvas editing and the schema editor.
        'function-canvas-drill/**/*.spec.ts',
        'function-canvas-edit/**/*.spec.ts',
        'function-canvas-schema/**/*.spec.ts',
        'function-canvas-inner-config/**/*.spec.ts',
        'function-canvas-inner-delete/**/*.spec.ts',
        'function-canvas-inner-mutations/**/*.spec.ts',
        'function-canvas-param-persist/**/*.spec.ts',
        'function-canvas-param-edit/**/*.spec.ts',
        'function-canvas-scope-autocomplete/**/*.spec.ts',
        'function-canvas-param-delete/**/*.spec.ts',
        'function-canvas-param-delete-refs/**/*.spec.ts',
        'root-var-delete-confirm/**/*.spec.ts',
        'function-canvas-unresolved-ref-dialog/**/*.spec.ts',
        // Function runs and Halt, scope-fail and Try/Catch propagation.
        'function-execution/v-canvas-fn-exec-01.spec.ts',
        'function-execution/v-canvas-fn-run-scoped-01.spec.ts',
        'function-execution/v-canvas-fn-halt-01.spec.ts',
        'function-execution/v-canvas-fn-assert-scope-fail-01.spec.ts',
        'function-execution/v-canvas-fn-assert-in-trycatch-01.spec.ts',
        // V-FN-*: publish and detach lifecycle; each spec seeds its own data.
        'function-lifecycle/**/*.spec.ts',
        // V-FN-*: edit mode, version pinning, scoped runs and nested Functions.
        'edit-mode-publish/**/*.spec.ts',
        'edit-mode-drop/**/*.spec.ts',
        // V-FN-*: edit-mode publish outcomes, failures, guards and version gating.
        'edit-mode-publish-outcomes/**/*.spec.ts',
        'edit-mode-edit-failure/**/*.spec.ts',
        'fn-composition-guards/**/*.spec.ts',
        'fn-self-ref-drop/**/*.spec.ts',
        'fn-dig-in-observability/**/*.spec.ts',
        'edit-mode-publish-version-gate/**/*.spec.ts',
        'version-pinning/**/*.spec.ts',
        'function-bare-names/**/*.spec.ts',
        'function-input-write-blocked/**/*.spec.ts',
        'var-setter-input-reject/**/*.spec.ts',
        'var-setter-output-assign/**/*.spec.ts',
        'fn-output-binding-create-var/**/*.spec.ts',
        'fn-local-vars-runtime/**/*.spec.ts',
        // Secret Function parameters (REQ-3.1.2.9, SECUI-10, SECUI-11).
        'fn-secret-params/**/*.spec.ts',
        // Required and enum Function inputs (REQ-3.1.2.10, REQ-3.1.2.11).
        'fn-required-input/**/*.spec.ts',
        'fn-enum-input/**/*.spec.ts',
        'fn-input-runtime-value/**/*.spec.ts',
        'fn-scope-run/**/*.spec.ts',
        'fn-debug-step-over/**/*.spec.ts',
        'fn-debug-repeat-step/**/*.spec.ts',
        'fn-debug-scope-options/**/*.spec.ts',
        // Step a Function as one composite, and function-scope Halt.
        'function-debug-halt/**/*.spec.ts',
        'fn-scope-advisory-toast/**/*.spec.ts',
        'fn-scope-terminal-event/**/*.spec.ts',
        'auto-naming-universal/**/*.spec.ts',
        'publish-stamps-originallibraryname/**/*.spec.ts',
        'from-library-link/**/*.spec.ts',
        'from-library-link-search/**/*.spec.ts',
        'library-refresh/**/*.spec.ts',
        'from-library-link-reapply/**/*.spec.ts',
        'fn-changelog-details/**/*.spec.ts',
        'fn-shared-config-functional/**/*.spec.ts',
        'fn-publish-required-functional/**/*.spec.ts',
        'function-nested/**/*.spec.ts',
        // V-FN-VAL-*: canonical, recursive and path-aware Function validation.
        'fn-validation/**/*.spec.ts',
        // V-FN-VER-REMEDIATE-01: a missing version clears live in the config modal.
        'fn-version-remediate/**/*.spec.ts',
        // V-FN-SCOPE-LOCALVAR-01: a body using its own local variable saves clean.
        'fn-scope-localvar/**/*.spec.ts',
        // V-FN-FROMLIB-01: a library-dropped instance shows its From library link.
        'fn-from-library-drop/**/*.spec.ts',
        // Function import and export, unproduced outputs and the publish version list.
        'functions-import-export/**/*.spec.ts',
        // Function import safety: id collisions and history-preserving overwrite.
        'function-import-safety/**/*.spec.ts',
        'fn-output-validation/**/*.spec.ts',
        'fn-publish-version/**/*.spec.ts',
        // Publish and set New shows the new version's input and output contract.
        'fn-edit-publish-contract/**/*.spec.ts',
        // V-FN-VIEW-*: run, edit and publish from the read-only library View.
        'function-view/**/*.spec.ts',
        // Run Unsaved State: run-current, the close nag and the dirty-switch guard.
        'run-current/**/*.spec.ts',
        'edit-mode-close-nag/**/*.spec.ts',
        'edit-mode-lifecycle/**/*.spec.ts',
        'fn-draft-publish-version/**/*.spec.ts',
        'dirty-switch-single-prompt/**/*.spec.ts',
        // Quick Insert modes and the config sheet lifecycle.
        'quick-add/**/*.spec.ts',
        'sheet-lifecycle/**/*.spec.ts',
        // The selected-block keys and the canvas keyboard after a sheet close.
        'block-keys/**/*.spec.ts',
        // Undo and redo change history (REQ-5.2.1.24).
        'undo-redo-drill/**/*.spec.ts',
        'undo-redo-lifecycle/**/*.spec.ts',
        'undo-redo-integrity/**/*.spec.ts',
        // Undo across the gated parameter rows of the Kubernetes write Blocks.
        'undo-redo-k8s-write/**/*.spec.ts',
        'run-current-nested/**/*.spec.ts',
        // Profiles drive real plugins (functional/profile-drives-plugin/README.md).
        'profile-drives-plugin/**/*.spec.ts',
      ],
      use: desktopChrome,
    },
  ],
})
