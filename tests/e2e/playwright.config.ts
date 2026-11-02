/**
 * Playwright Configuration
 *
 * E2E testing configuration for WAVE with phased parallel execution.
 *
 * Test Phases (dark mode CI - optimized for speed):
 * 1. empty-db-dark: Small set of tests needing a clean database
 * 2. no-data-dark + fixture-dark: Run after empty-db completes
 *
 * Light mode mirrors the same structure with a DB reset between themes.
 *
 * Two execution modes:
 *
 * 1. Host mode (what the config does outside a container):
 *    The config spawns N_STACKS isolated BE+FE pairs via the webServer
 *    block and routes each Playwright worker to its own stack via
 *    TEST_PARALLEL_INDEX % N_STACKS. Run through the scripts below instead:
 *    the setup of this mode resets the data of the backend on port 8000.
 *
 * 2. Container-sharded mode (CI, WAVE_E2E_EXTERNAL_SERVICES=1):
 *    The surrounding orchestrator (ci-playwright-local.sh) launches N
 *    podman containers, each with its own pinned-CPU stack already
 *    running. Inside each container Playwright runs with --shard=K/N and
 *    workers=1, so there is exactly one Playwright process talking to
 *    exactly one backend. Config skips webServer (services are external)
 *    and flattens worker counts to 1 to match the single in-container BE.
 *
 * Run through the scripts, from the root of the clone:
 *   ./scripts/e2e-targeted-local.sh <spec>    # One or more specs
 *   ./scripts/ci-playwright-local.sh          # All specs
 */

import { defineConfig, devices } from '@playwright/test'
import path from 'path'

// Resolve project root (two levels up from tests/e2e/)
const projectRoot = path.resolve(__dirname, '../..')

// Determine if running in CI
const isCI = !!process.env.CI

// Container-sharded mode - services are already running, webServer block
// and multi-stack routing are disabled.
const externalServices = process.env.WAVE_E2E_EXTERNAL_SERVICES === '1'

// N-stack host-mode parallel execution. In container-sharded mode this
// collapses to 1 because the orchestrator gives each container a single
// BE+FE pair and splits tests across containers with --shard.
const N_STACKS = externalServices
  ? 1
  : Number(process.env.WAVE_E2E_N_STACKS || '4')

// Worker counts per project.
//
// Host mode: fixture-dark bottlenecks on shared DB state (one DB per
// worker), so it maxes out at N_STACKS. Other projects can use more
// workers since they don't contend on backend state.
//
// Container-sharded mode: exactly one BE per container, so all projects
// run with workers=1 to eliminate the workbench/session + seed races
// that flake host mode at N>1.
const fixtureWorkers = externalServices ? 1 : N_STACKS
const noDataWorkers = externalServices ? 1 : Math.max(N_STACKS * 2, 8)
const emptyDbWorkers = externalServices ? 1 : N_STACKS

// Base ports - the i-th stack uses FRONTEND_BASE_PORT+i and BACKEND_BASE_PORT+i.
const FRONTEND_BASE_PORT = Number(process.env.WAVE_E2E_FRONTEND_PORT || '3000')
const BACKEND_BASE_PORT = Number(process.env.WAVE_E2E_BACKEND_PORT || '8000')


// Common device settings
const desktopChrome = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
}

// =========================================================================
// Test file lists (shared between dark and light projects)
// =========================================================================

/**
 * Tests that MUST run on a clean (empty) database.
 * These check empty states, zero metrics, "no items" messages.
 * Kept small so this phase finishes fast (~30-60s).
 */
const emptyDbTests = [
  'dashboard/v-dash-01.spec.ts',
  'lists/v-list-02.spec.ts',
  'lists/v-list-03.spec.ts',
  'lists/v-list-04.spec.ts',
  'lists/v-list-08.spec.ts',
  'lists/v-list-09-empty.spec.ts',
  'settings/v-set-01-empty.spec.ts',
  // Opens the env create dialog from a clean DB - independent of any seed.
  'settings/v-form-overflow-environments.spec.ts',
  // V-TESTDATA-02 (TDATA-6): the Test Data sheet empty state on a saved Test with
  // no files, and the save-first state on a canvas that was never saved. Creates
  // and deletes its own Test inside the test body, so the DB stays clean.
  'testdata/v-testdata-02.spec.ts',
]

/**
 * Tests that don't depend on backend entity data at all.
 * Canvas/workbench UI, palette interactions, keyboard shortcuts,
 * modals, navigation shell, save dialogs, import dialogs (mocked).
 * These can run concurrently with fixture tests since DB resets
 * don't affect workbench sessions or pure UI tests.
 */
const noDataTests = [
  // --- Canvas foundation (empty canvas, workbench UI) ---
  'canvas/v-canvas-01.spec.ts',
  'canvas/v-canvas-01a.spec.ts',
  'canvas/v-canvas-01b.spec.ts',
  'canvas/v-canvas-01c.spec.ts',
  'canvas/v-canvas-01h.spec.ts',
  'canvas/vi-int-01.spec.ts',
  'canvas/vi-int-02.spec.ts',
  'canvas/vi-int-05.spec.ts',
  'canvas/v-canvas-03.spec.ts',
  'canvas/v-canvas-03-selection.spec.ts',
  'canvas/v-canvas-03-context-menus.spec.ts',
  'canvas/v-canvas-03-edge-type-menu.spec.ts',
  'canvas/v-canvas-03-disable-skip.spec.ts',
  'canvas/v-canvas-12.spec.ts',
  'canvas/v-canvas-12-modal.spec.ts',
  // Session-mirror banner variants (person indigo / assistant
  // violet "(MCP)" + See connection), driven by mocked ownership state.
  'canvas/v-sess-mirror-banner-01.spec.ts',
  // Variable Manager panel (See Results)
  'canvas/v-canvas-01e.spec.ts',
  // Save workflow tests
  'save/v-save-01.spec.ts',
  'save/v-save-02.spec.ts',
  'save/v-save-03.spec.ts',
  'save/v-save-behavioral.spec.ts',
  // Toolbar Edit and the direct re-save of a saved Test (saves and deletes its own Test)
  'canvas/v-canvas-behavioral.spec.ts',
  // Console panel tests
  'canvas/v-canvas-01d.spec.ts',
  'canvas/v-canvas-06.spec.ts',
  // Backup & Restore - tests UI components, no entity data
  'settings/v-backup-01.spec.ts',
  // WAVE Server section (server fact cards + browser-session
  // roster with You marker / Active-Watching roles / bulk disconnect), driven
  // by a mocked /server/status roster + seeded own-session ids.
  'settings/v-wave-server-01.spec.ts',
  // Canvas loading experience
  'canvas/v-canvas-load-01.spec.ts',
  'canvas/v-canvas-load-02.spec.ts',
  'canvas/v-canvas-load-03.spec.ts',
  // Edge interaction + connection enforcement
  'canvas/v-canvas-03-edge-selection.spec.ts',
  'canvas/v-canvas-03-proximity.spec.ts',
  'canvas/v-canvas-03-pill-handles.spec.ts',
  'canvas/v-canvas-03-connection-enforcement.spec.ts',
  // Keyboard & Mouse Interactions
  'canvas/v-canvas-hint-bar.spec.ts',
  'canvas/v-canvas-shortcuts.spec.ts',
  'canvas/v-canvas-shortcut-labels.spec.ts',
  'canvas/v-canvas-rubber-band.spec.ts',
  // App shell & navigation (pure UI)
  'shell/*.spec.ts',
  'navigation/*.spec.ts',
  'consistency/*.spec.ts',
  // regression/v-reg-detail-01 and v-reg-edit-01 need seeded data - they
  // live in the fixtureTests list instead. Only regression-prevention.spec.ts
  // is actually data-free (tests for UI regressions, not entity fixtures).
  'regression/regression-prevention.spec.ts',
  // Canvas tests - hardcoded UI components
  'canvas/v-canvas-01f.spec.ts',
  'canvas/v-canvas-01g.spec.ts',
  'canvas/v-control-01.spec.ts',
  'canvas/v-control-02-08.spec.ts',
  'canvas/v-log.spec.ts',
  'canvas/v-plugin-def-01.spec.ts',
  'canvas/v-plugin-def-02.spec.ts',
  // Palette drag-drop only (no backend data needed)
  'canvas/v-canvas-02.spec.ts',
  'canvas/v-canvas-02-appearance.spec.ts',
  'canvas/vi-int-03.spec.ts',
  // Debug split button + Debug Options popover
  'canvas/vi-int-04.spec.ts',
  // HTTP Client config modal
  'canvas/v-plugin-http-01.spec.ts',
  // SSH Session Open config sheet: Connection group expanded
  // by default + description, Advanced collapsed + description, four outputs
  // each with a leading (i). Palette drag-drop only, no backend data.
  'canvas/v-plugin-ssh-01.spec.ts',
  // SSH Tunnel Open config sheet: single Forwarding group
  // expanded + description, required markers on Session ID / Remote Host /
  // Remote Port, two outputs (Tunnel ID + Local Port) each with a leading (i).
  // Palette drag-drop only, no backend data.
  'canvas/v-plugin-ssh-tunnel-01.spec.ts',
  // SSH Session Script config sheet: five flat input rows
  // (no groups), required markers on Session ID / Script only, three outputs
  // (Stdout / Stderr / Exit Code) each with a leading (i). Palette drag-drop
  // only, no backend data.
  'canvas/v-plugin-ssh-script-01.spec.ts',
  // Remote Execution: 7 distinct Set A Remote icons + order,
  // the container node's cyan body / zinc then egress + config sheet, and the
  // per-block R/L locus badge. Palette drag + POST /tests seed, no DB reset.
  'canvas/v-plugin-remote-icons-01.spec.ts',
  'canvas/v-remote-exec-01.spec.ts',
  'canvas/v-plugin-http-03.spec.ts',
  'canvas/v-plugin-http-03-validation.spec.ts',
  // HTTP Plugin Rework: headers editor (kinds, scaffolds,
  // guard rails, Code-view $expr, load-parity badges via admin bulk), body
  // modes (mode menu, notes, GET-with-body, draft retention, group rename),
  // parts editor + file-mode empty state. All seed via POST /tests or
  // /admin/bulk/tests; no DB reset required.
  'canvas/v-http-01.spec.ts',
  'canvas/v-http-02.spec.ts',
  'canvas/v-http-03.spec.ts',
  // Per-block Secret masking config section (REQ-3.1.3.16):
  // the last Input-Parameters collapsible lists the HTTP client's eight known
  // credential headers, checked (masked) by default. Palette drag-drop only.
  'canvas/v-secmask-01.spec.ts',
  // Controlled secret reveal: the block "Secrets" tri-state
  // run-output control (SECREV-1/2/3) and the canvas amber reveal badge
  // (SECREV-4). Palette drag-drop + a self-seeded reveal fixture.
  'canvas/v-secrev-block.spec.ts',
  'canvas/v-secrev-badge.spec.ts',
  // The declared plugin credential input field states (masked
  // write-only lock / non-secret alert / secret lock, mask list, literal->
  // expression discard, post-save re-mask) and the Variable Setter stored-secret
  // gate (column headers, typed-visible-vs-saved-masked, masks-without-reload).
  // Self-seeds via POST /tests; no execution.
  'secrets/v-cred-field-01.spec.ts',
  'secrets/v-cred-stored-gate-01.spec.ts',
  // A map credential seals value by value, so its keys survive but never render.
  'secrets/v-cred-map-gate-01.spec.ts',
  // Validation unification: persistent alert icon, post-modal pulse,
  // edit-clears-icon, output-binding inline gate (no fixture data).
  'canvas/v-validate-icon-01.spec.ts',
  'canvas/v-plugin-http-03-editors.spec.ts',
  // Single-line string param value affordance: ValueField preview +
  // kind sheet (Literal/Template), expression toggle, and row-level URL/required
  // validation below the value field.
  'canvas/v-param-string-kind.spec.ts',
  // Variable Setter config modal
  'canvas/v-plugin-varset-01.spec.ts',
  // Variable Setter migration: the shared "Edit value" sheet -
  // string Kind (Literal/Template) + Format, complex View (Visual/Code) + metric.
  'canvas/v-plugin-varset-value-editor.spec.ts',
  // XML Parser config modal
  'canvas/v-plugin-xml-01.spec.ts',
  'canvas/v-plugin-xml-02.spec.ts',
  // CSV Parser config sheet: operation-gated params + outputs,
  // enum/boolean noExpression, Schema-source picker, the Transform (Sorts/Filters)
  // collapsibles + column-ref control, and the secret/output affordances.
  'canvas/v-plugin-csv-01.spec.ts',
  // Excel Parser config sheet: the flat Read form + its
  // header-row gating and placeholders, the Schema-source picker, the Transform
  // collapsibles on BOTH operations, operation-gated outputs, the grid Sheet
  // icon, and the no-badge guard for elements that bind a table variable.
  'canvas/v-plugin-excel-01.spec.ts',
  // K8s Connect config sheet: the three section groups with footer notes,
  // modeless credentials, run-token gating with value retention, the
  // expression-toggle policy, and the secret-by-default session output.
  'canvas/v-plugin-k8s-01.spec.ts',
  // The four K8s read config sheets (Get / Events / Logs / Top): group order and
  // footer notes, Advanced + Failure Handling opening COLLAPSED, the grouped Kind
  // picker, the mode-gated rows, required markers and expression-toggle policy,
  // and the per-Block output rows. Palette drag-drop or POST /tests, no cluster.
  'canvas/v-plugin-k8s-02.spec.ts',
  'canvas/v-plugin-k8s-03.spec.ts',
  'canvas/v-plugin-k8s-04.spec.ts',
  'canvas/v-plugin-k8s-05.spec.ts',
  // The four K8s write config sheets (Apply / Delete / Scale / Rollout):
  // Manifest vs Form mode and the per-kind form rows, the Default/Custom
  // Resource Type, the Name/Selector and Operation gating, the mode-gated
  // Output Format row, and the outputs growing under Record and continue.
  // Palette drag-drop or POST /tests, no cluster.
  'canvas/v-plugin-k8s-06.spec.ts',
  'canvas/v-plugin-k8s-07.spec.ts',
  'canvas/v-plugin-k8s-08.spec.ts',
  'canvas/v-plugin-k8s-09.spec.ts',
  // The three K8s exec-channel config sheets (Exec / Script / Copy): the verb
  // group holding Pod, Container and what to run, Container required on all
  // three, the absent stdin and working-directory rows, Copy's Direction with
  // its two fixed path labels, and the outputs growing under Record and
  // continue. Palette drag-drop only, no cluster.
  'canvas/v-plugin-k8s-10.spec.ts',
  'canvas/v-plugin-k8s-11.spec.ts',
  'canvas/v-plugin-k8s-12.spec.ts',
  // The six Helm config sheets (Install / Upgrade / Rollback / Uninstall / Test
  // / Status): group order with Auth & TLS on the chart blocks, only Connection
  // and the verb group opening expanded, the verb rows and defaults, no wait row
  // anywhere, Reuse and Reset Values unchecking each other, the Create Namespace
  // and Logs gates, Result's type following Output Format, and the Helm palette
  // section between Kubernetes and Data. Palette drag-drop only, no cluster.
  'canvas/v-plugin-helm-01.spec.ts',
  // File I/O config sheet: the eight operations and the rows, labels,
  // placeholders, defaults, enum labels, Browse buttons, expression toggles and
  // info badges each one shows; the outputs per operation including the three
  // Stats formats; the R badge and the missing Browse inside a Remote Execution
  // body; and the single 1.0.0 version on File I/O and HTTP Client. Palette
  // drag-drop plus one self-seeded POST /tests, no DB reset.
  'canvas/v-plugin-fileio-01.spec.ts',
  'canvas/v-plugin-sftp-01.spec.ts', // SFTP config sheet; seeds its own Test via POST /tests, no DB reset
  'canvas/v-plugin-shellscript-01.spec.ts', // Shell Script config sheet; seeds its own Tests via POST /tests
  'canvas/v-plugin-shellexec-01.spec.ts', // Shell Exec config sheet and palette placement; seeds its own Tests
  // Python block: the config sheet with Interpreter where
  // Shell Script has Shell, and the six states of the Python-mode "Edit value"
  // sheet - default footer, syntax errors, completion with its documentation
  // panel, F2 rename, and the F1 help popover collapsed and expanded. Each
  // seeds its own Test via POST /tests, no DB reset.
  'canvas/v-plugin-python-01.spec.ts',
  'canvas/v-pyedit-01-default.spec.ts',
  'canvas/v-pyedit-02-syntax-errors.spec.ts',
  'canvas/v-pyedit-03-completion-docs.spec.ts',
  'canvas/v-pyedit-04-rename.spec.ts',
  'canvas/v-pyedit-05-help.spec.ts',
  'canvas/v-pyedit-06-help-tips.spec.ts',
  // Netcat config sheet (NETCAT-12): Check, Range, Talk with Advanced expanded,
  // and the OUTPUT tab. Seeds its own Test via POST /tests, no DB reset.
  'canvas/v-plugin-netcat-01.spec.ts',
  // Ping config sheet (PING-3, PING-6, PING-7, PING-9): the seven top rows and
  // their defaults, the two Pass when reveals, Advanced expanded, the three
  // outputs, and the declared numeric bounds (PING-17, PING-18) on the row, on
  // the canvas badge and at the run gate. Seeds its own Tests via POST /tests.
  'canvas/v-plugin-ping-01.spec.ts',
  // SQL block (SQL-1..SQL-13): the config sheet in its three operation states,
  // the SQL editor states (suggestions, Tables popover, running footer, Get
  // Tables chip states), and the field-level save errors on the sheet
  // (FIELDERR-1..FIELDERR-3). Each seeds its own Test via POST /tests.
  'canvas/v-plugin-sql-01.spec.ts',
  'canvas/v-plugin-sql-02.spec.ts',
  // OpenSearch block (OS-1..OS-8, OS-11): the config sheet in both modes,
  // Authentication and Advanced, the From / To popover and the stat popover.
  'canvas/v-plugin-opensearch-01.spec.ts',
  // OpenSearch editor (OS-5, OS-12, OS-13): DQL and Query DSL modes, suggestions,
  // the unknown-field warning and the Get fields chip against the real service.
  'canvas/v-plugin-opensearch-02.spec.ts',
  'canvas/v-fielderr-01.spec.ts',
  // Table query operations in the expression editor: a table
  // offers filter / order_by / col, and naming a column offers that column's
  // operators. Seeds its own Test via POST /tests.
  'canvas/v-table-expr-ops-01.spec.ts',
  // Note control
  'canvas/v-ctrl-note-01.spec.ts',
  'canvas/v-ctrl-note-02.spec.ts',
  // Assert control
  'canvas/v-ctrl-assert-01.spec.ts',
  'canvas/v-ctrl-assert-02.spec.ts',
  'canvas/v-ctrl-assert-03.spec.ts',
  'canvas/v-ctrl-assert-04.spec.ts',
  'canvas/v-ctrl-assert-05.spec.ts',
  'canvas/v-ctrl-assert-06.spec.ts',
  'canvas/v-ctrl-assert-07.spec.ts',
  'canvas/v-ctrl-assert-08.spec.ts',
  'canvas/v-ctrl-assert-mode-switch-01.spec.ts',
  'canvas/v-ctrl-assert-dup-egress-01.spec.ts',
  // V-CANVAS-FN-*: Function instance modal layout,
  // empty-section pattern, save-validation error envelope, and per-prefix
  // auto-naming. All seed via POST /tests; no DB reset required.
  'canvas/v-canvas-fn-cfg-01.spec.ts',
  'canvas/v-canvas-fn-cfg-03.spec.ts',
  // V-CANVAS-FN-CFG-04: call window field kinds per FNCFG-6 / FNCFG-7.
  'canvas/v-canvas-fn-cfg-04.spec.ts',
  'canvas/v-canvas-fn-autoname-01.spec.ts',
  'canvas/v-canvas-fn-errmsg-01.spec.ts',
  // V-CANVAS-FN-NESTED-01: 3-deep Function drill
  // round-trip + per-level scoped Variable Manager. Seeds its own nested Test
  // via POST /tests and drills (no run), so it slots into no-data.
  'canvas/v-canvas-fn-nested-01.spec.ts',
  // If/Else, Halt, For, ForEach, While, Break, Continue controls
  'canvas/v-ctrl-ifelse-01.spec.ts',
  // Switch/Case control: canvas lanes (order, role
  // colors, no rendered labels, hover tooltips, width growth) and the config
  // sheet (case cards, Break in the header, DEFAULT copy, blocked-Save
  // reasons, condition completeness). Each seeds its own Test via POST /tests.
  'canvas/v-ctrl-switch-01.spec.ts',
  'canvas/v-ctrl-switch-02.spec.ts',
  // Wait Until control: canvas lanes (retry cyan + then
  // neutral, no rendered labels, hover tooltips, Watch's single egress, the
  // RUNNING-badge-alone running node) and the config sheet (timing parameters,
  // assertion builder, two outputs, WAIT MODE radio, Fail Current Scope, and
  // the mode switch reaching storage). Each seeds its own Test via POST /tests.
  'canvas/v-ctrl-wait-01.spec.ts',
  'canvas/v-ctrl-wait-02.spec.ts',
  // Parallel control: canvas lanes (violet branches +
  // neutral then, config order, no rendered labels, hover tooltips, the
  // one-slot-per-branch widening, the RUNNING-badge-alone running node) and the
  // config sheet (single Section Time Limit row, one-line BRANCH rows, the
  // two-branch minimum, JOIN MODE, no Output Variables, storage round-trip and
  // reorder). Each seeds its own Test via POST /tests.
  'canvas/v-ctrl-parallel-01.spec.ts',
  'canvas/v-ctrl-parallel-02.spec.ts',
  // Shared variable picker with a 60-character name: truncation, reachable
  // full name, pinned type pill, no horizontal overflow, both themes.
  'canvas/v-varpick-01.spec.ts',
  'canvas/v-ctrl-halt-01.spec.ts',
  'canvas/v-ctrl-for-01.spec.ts',
  'canvas/v-ctrl-foreach-01.spec.ts',
  'canvas/v-ctrl-while-01.spec.ts',
  'canvas/v-ctrl-break-01.spec.ts',
  'canvas/v-ctrl-continue-01.spec.ts',
  // Import dialogs (mocked API)
  'lists/v-import-01.spec.ts',
  'lists/v-import-02.spec.ts',
  'lists/v-import-03.spec.ts',
  'settings/v-env-import-01.spec.ts',
  'profiles/v-prof-import-01.spec.ts',
  // Backup restore section (mocked API validation)
  'settings/v-backup-02.spec.ts',
  // Time Zone preference picker - Settings UI only,
  // no entity fixtures required (uses live system info for the About flip).
  'settings/v-settings-tz-01.spec.ts',
  // Settings > General staged Save (SETTINGS-18 to SETTINGS-20, SETTINGS-22); staged only, never saved.
  'settings/v-settings-general-01.spec.ts',
  // Secret Masking settings section (SECREV-6/7): three
  // system-wide reveal toggles + carve-out footnote + reload persistence.
  // Runtime admin flags only - no entity fixtures.
  'settings/v-secrev-settings-01.spec.ts',
  // MCP Server settings page (MCP-1..MCP-9): staged only, never saved; no entity fixtures.
  'settings/v-mcp-01.spec.ts',
  // Settings > Network pages (NET-1..NET-11): SSH Hosts and Certificates with
  // their Add dialogs, Proxy Setup and Proxy Blocks. Staged edits only, never
  // saved; reads are intercepted.
  'settings/v-network-ssh-hosts-01.spec.ts',
  'settings/v-network-certificates-01.spec.ts',
  'settings/v-network-proxy-01.spec.ts',
  // Edge drag interaction tests
  'canvas/edge-drag-create.spec.ts',
  'canvas/edge-drag-autoconnect.spec.ts',
  'canvas/edge-drag-replace.spec.ts',
  // 404 Not Found page
  'navigation/v-not-found-01.spec.ts',
  // Dashboard live-refresh header indicator (REQ-3.2.2.17)
  'dashboard/v-dash-06.spec.ts',
  // Ad-hoc Run/Debug menus + action-bar Scope labels (REQ-3.2.1.5)
  'canvas/v-canvas-runadhoc-menu.spec.ts',
  'canvas/v-canvas-action-bar-scope-labels.spec.ts',
  // Shared element + config UI overflow and sizing
  'canvas/v-element-config-name-field.spec.ts',
  'canvas/v-element-config-parameter-rows.spec.ts',
  'canvas/v-shared-text-input-overflow.spec.ts',
  'canvas/v-varset-expression-row-overflow.spec.ts',
  'canvas/v-variable-name-fields.spec.ts',
  'canvas/v-variable-picker.spec.ts',
  'canvas/v-inline-expression-overflow.spec.ts',
  'canvas/v-expression-editor-modal-titles.spec.ts',
  'canvas/v-expression-editor-modal-resize.spec.ts',
  'canvas/v-expression-editor-modal-overflow.spec.ts',
  'canvas/v-dialog-grid-track-overflow.spec.ts',
  // Legacy canvas-node coverage (sizing chip / chevron / name overflow / persistence
  // / edge tracking) is replaced by the canvas-node/v-canvas-node-*
  // suite covering the new persistent status bar + description row contract.
  // Shared field primitives adoption across profiles, environments,
  // tests/suites/regressions, parameter validation, breadcrumb truncation,
  // variable manager (system scope) - all UI-only / no-data interactions.
  'profiles/v-form-overflow-profiles.spec.ts',
  'canvas/v-form-overflow-test-suite-regression-names.spec.ts',
  'canvas/v-canvas-breadcrumb-overflow.spec.ts',
  'profiles/v-profile-parameter-name-validation.spec.ts',
  'profiles/v-profile-metadata-stack.spec.ts',
  // Profile parameter value cell after the Variable-Setter value-editor
  // migration (per-type affordances, uniform masked secret, long-value truncation).
  // Each self-seeds + deletes its own custom profile via the API.
  'profiles/v-prof-param-cell.spec.ts',
  // The kubernetes profile form (eight explicit fields, seeded
  // starting values, no kubeconfig import) and the type-change data-loss
  // confirmation. Both open the create modal directly; no fixture data.
  'profiles/v-prof-k8s-01.spec.ts',
  // Database profile form (SQL-14, K8SPROF-7, K8SPROF-8): the ten fields in
  // order, no Database type / timeout / failover / TLS toggle. Opens the create
  // modal directly; no fixture data.
  'profiles/v-prof-database-01.spec.ts',
  // OpenSearch profile form (OS-15, K8SPROF-7, K8SPROF-8): the nine fields in
  // order, four secret, none required. Opens the create modal directly.
  'profiles/v-prof-opensearch-01.spec.ts',
  'profiles/v-profile-type-change-warning.spec.ts',
  // The shared ValueField truncates a long setter string
  // value inside its bounded field (parity with the profile cell above).
  'canvas/v-varset-value-field-overflow.spec.ts',
  'canvas/v-variable-manager-overflow.spec.ts',
  // Var Manager: Unused indicator. (The destructive type-change
  // confirm spec was retired - type change is create-only.)
  'canvas/v-var-unused-badge.spec.ts',
  // V-VAR-UNUSED-BADGE-02: the amber Unused badge on a variable, an input, an output and a local.
  'canvas/v-var-unused-badge-02.spec.ts',
  // V-VMGR-CREATE-01: create modal labeled-form layout
  // (variable + input/output param modes), secret-above-value, value-fills, and
  // the resize-floor containment. Seeds its own Test via POST /tests + drills.
  'canvas/v-vmgr-create-01.spec.ts',
  // V-VMGR-CREATE-02: the four creation windows with Set to null ticked (VMGR-97) and their
  // ticked height. Seeds and deletes its own Test via POST /tests.
  'canvas/v-vmgr-create-02.spec.ts',
  // V-VMGR-CREATE-03: the input and output parameter windows, the enum list and the input default
  // rules (VMGR-98..100, VMGR-103, VMGR-104). Seeds and deletes its own Test via POST /tests.
  'canvas/v-vmgr-create-03.spec.ts',
  // V-VMGR-WIN-01..03: the one variable window - the Test variable window, the value field faces and the
  // input window, in both themes (VMGR-106..114). Each seeds and deletes its own Test via POST /tests.
  'canvas/v-vmgr-window-01.spec.ts',
  'canvas/v-vmgr-window-02.spec.ts',
  'canvas/v-vmgr-window-03.spec.ts',
  // Canvas node visuals: persistent status bar,
  // description row, run-state badges, note edit-mode morph, handle positioning.
  // V-04, V-05, V-12 use page.route to mock /executions/history responses
  // (read-only canvas surface, no live BE run required).
  'canvas-node/v-canvas-node-01.spec.ts',
  'canvas-node/v-canvas-node-03.spec.ts',
  'canvas-node/v-canvas-node-04.spec.ts',
  'canvas-node/v-canvas-node-06.spec.ts',
  'canvas-node/v-canvas-node-07.spec.ts',
  'canvas-node/v-canvas-node-08.spec.ts',
  'canvas-node/v-canvas-node-11.spec.ts',
  // Function palette UI - bottom buttons + tooltips + library modal open/close
  // Pure UI, no BE entity state needed.
  'canvas/v-palette-fn-01.spec.ts',
  // Function Library modal empty placeholder - the modal
  // is intentionally an empty shell; library content (search, filter, card
  // grid, drag-to-canvas) has its own coverage.
  'canvas/v-lib-fn-01.spec.ts',
  // Function versioning: edit-mode entry + drop changes,
  // publish-as-major flow. Each spec POSTs its own library entry + Test so
  // they slot into no-data despite needing BE state.
  'function-versioning/v-fn-edit-01.spec.ts',
  'function-versioning/v-fn-edit-02.spec.ts',
  'function-versioning/v-fn-ver-01.spec.ts',
  // Function versioning additional visual coverage.
  // Each spec POSTs its own library entry + Test - no shared seed.
  'function-versioning/v-fn-publish-headers.spec.ts',
  'function-versioning/v-fn-lifecycle-dialogs.spec.ts',
  // V-FN-PUBLISH-OUTCOME-01: the three-option
  // PublishOutcomeDialog renders in both themes (DOM-assertion, no pixel
  // baseline) and enforces the no-ESC / no-backdrop AlertDialog policy.
  'function-versioning/v-fn-publish-outcome-01.spec.ts',
  'function-versioning/v-fn-output-binding-picker.spec.ts',
  'function-versioning/v-fn-shared-config-parity.spec.ts',
  'function-versioning/v-fn-missing-function.spec.ts',
  'function-versioning/v-library-card-name-tooltip.spec.ts',
  'function-versioning/v-library-search-textfield.spec.ts',
  'function-versioning/v-fn-publish-required-fields.spec.ts',
  // The config-modal Changelog + Details
  // dialogs render their per-version content as real Markdown, wrap long tokens
  // + the description, and show a human release date.
  'function-versioning/v-fn-config-dialogs-md.spec.ts',
  // Function Library page + detail page + config-modal fixes. Each spec POSTs its own library entries / Tests under a per-run
  // prefix, so they slot into no-data despite needing BE state.
  'functions-library/*.spec.ts',
  // Function View canvas: read-only chrome +
  // Function-only breadcrumb + Test-control gating, edit-mode Publish button,
  // single-outcome publish confirm, FunctionSquare palette icon. Each spec
  // POSTs its own library Function, so they slot into no-data.
  'function-view/*.spec.ts',
  // Edit Config paradigm (uniform Edit Config header across block
  // types; node-validation-alert real tooltip; no-entrance-animation dialogs).
  'canvas-config-header/v-canvas-edit-config-header.spec.ts',
  'canvas/v-canvas-validation-alert.spec.ts',
  'canvas/v-dialog-no-entrance-animation.spec.ts',
  // Quick-add popover + DraggableSheet shell (CANVAS-223..230).
  // All three seed via POST /tests + POST /functions; no DB reset required.
  'canvas/v-qadd-01.spec.ts',
  'canvas/v-sheet-01.spec.ts',
  'canvas/v-sheet-02.spec.ts',
  // V-SHEET-03: the shared refocusSheet reopen
  // affordance - raise + pulse across all four triggers (library button,
  // config double-click + gear, watcher row, artifacts chip). Seeds via
  // POST /tests; no runs, no DB reset required.
  'canvas/v-sheet-03-reopen.spec.ts',
  // V-VMGR-PARSER-STRICT: JSON/XML strict-string params (locked format
  // pickers), eager-blocking literal validation, the config-modal restructure
  // (Input Parameters -> Queries -> Output Mode radios -> Output Variables), the
  // footer fit at min width, the copyable validation strip, and the (+N more)
  // strip aggregation. Drops parser / http / setter nodes from the palette; no DB seed.
  'v-vmgr-parser-strict.spec.ts',
  // V-FIELD-*: the one value field and its states, the switch warning, the time picker, the list
  // fields, the red star on open and the icons (FIELD-1..FIELD-12), both themes. Each seeds and
  // deletes its own Test via POST /tests.
  'canvas/v-field-block-states.spec.ts',
  'canvas/v-field-switch-warning.spec.ts',
  'canvas/v-field-time-picker.spec.ts',
  'canvas/v-field-list-fields.spec.ts',
  'canvas/v-field-variable-required.spec.ts',
  'canvas/v-field-icons.spec.ts',
  // V-CANVAS-NODE-05 (RUN border-pulse) and V-12 (config modal read-only
  // during run) need a real workflow run to drive the canvas into a
  // running execution state. A mocked historical canvas does not work: the
  // apiClient envelope mismatch keeps the React component stuck in its
  // loading state. Covering them needs a real Run via the canvas action bar
  // (env seed + run).
]

/**
 * Fixture tests - run serially, each group seeds its own data.
 * Order matters: files sharing the same seed script are grouped together
 * so only the first file in each group needs to seed.
 *
 * Fixture groups:
 * - Dashboard: v-dash-02, v-dash-03, v-dash-05 (separate seeds)
 * - Lists (v-list-01 seed): v-list-01, v-list-06, v-list-12, v-export-01, v-export-02
 * - Lists (unique seeds): v-list-05, v-list-07, v-list-09, v-list-10, v-list-11
 * - Profiles (v-prof-01 seed): v-prof-01, v-prof-export-01
 * - Profiles (unique seeds): v-prof-02, v-prof-03
 * - Settings (v-set-01 seed): v-set-01, v-env-export-01
 * - Settings (unique): v-global-var-01
 * - Canvas (v-canvas-04 seed): v-canvas-04, v-canvas-03-canvas-reset
 * - Canvas (unique seeds): v-canvas-14, v-plugin-http-01-profiles, v-plugin-http-02,
 *   v-plugin-varset-02, v-plugin-varset-03, v-validate-load-01
 * - Canvas: v-ctrl-trycatch-01 (creates environments via API)
 * - Suite detail: v-suite-detail-01, v-suite-detail-02, v-suite-detail-03
 * - Mutation: v-dash-04 (modifies state mid-execution, must run last)
 */
const fixtureTests = [
  // --- Dashboard fixtures ---
  'dashboard/v-dash-02.spec.ts',
  'dashboard/v-dash-03.spec.ts',
  'dashboard/v-dash-05.spec.ts',
  // Reuses v-dash-02 seed - asserts Recent Activity is display-only
  'dashboard/v-dash-activity-display-only-01.spec.ts',
  // Reuses v-dash-02 seed: test entries show suiteCount, not always "Unassigned"
  'dashboard/v-dash-test-suite-count.spec.ts',
  // --- Lists: shared v-list-01 fixture group ---
  'lists/v-list-01.spec.ts',
  'lists/v-list-06.spec.ts',
  'lists/v-list-12.spec.ts',
  'lists/v-export-01.spec.ts',
  'lists/v-export-02.spec.ts',
  // --- Lists: unique fixture per file ---
  'lists/v-list-05.spec.ts',
  'lists/v-list-07.spec.ts',
  'lists/v-list-09.spec.ts',
  'lists/v-list-10.spec.ts',
  'lists/v-list-11.spec.ts',
  // Self-seeding: creates entity + tracked execution to exercise the 409 toast
  'lists/v-tests-delete-running-01.spec.ts',
  // --- Profiles: shared v-prof-01 fixture group ---
  'profiles/v-prof-01.spec.ts',
  'profiles/v-prof-export-01.spec.ts',
  // --- Profiles: unique fixture per file ---
  'profiles/v-prof-02.spec.ts',
  'profiles/v-prof-03.spec.ts',
  // --- Settings: shared v-set-01 fixture group ---
  'settings/v-set-01.spec.ts',
  'settings/v-env-export-01.spec.ts',
  // --- Settings: unique fixture ---
  'settings/v-global-var-01.spec.ts',
  // --- Canvas: shared v-canvas-04 fixture group ---
  'canvas/v-canvas-04.spec.ts',
  'canvas/v-canvas-03-canvas-reset.spec.ts',
  // --- Canvas: unique fixture per file ---
  'canvas/v-canvas-14.spec.ts',
  'canvas/v-plugin-http-01-profiles.spec.ts',
  'canvas/v-plugin-http-02.spec.ts',
  'canvas/v-plugin-varset-02.spec.ts',
  'canvas/v-plugin-varset-03.spec.ts',
  'canvas/v-validate-load-01.spec.ts',
  // --- Canvas: scope tests that create environments/tests ---
  'canvas/v-ctrl-trycatch-01.spec.ts',
  // --- Variable Manager panel (V-VMGR) - imports a fixture
  //     with one variable per type plus expression + secret to assert
  //     the wireframe layout, action cluster, and idle eye-disabled state. ---
  'canvas/v-vmgr-01.spec.ts',
  'canvas/v-vmgr-02.spec.ts',
  // V-VMGR-03: per-variable inspect modal - shell anatomy,
  // modes, sizing/resize, viewport cap, stacking, scope + reload persistence.
  // Imports its own fixture via POST /tests; reloads + multi-test navigation
  // need the serial fixture phase.
  'canvas/v-vmgr-03.spec.ts',
  // V-VMGR-04: complex value bodies (array / map / table),
  // View dropdown + Code view, complex metrics, empty / initial states, and
  // the 500-row Visual cap. Shares the v-vmgr-inspect fixture family.
  'canvas/v-vmgr-04.spec.ts',
  // V-VMGR-05: expression watcher views - per-kind View
  // dropdown families (Literal/Expression, Visual/Code/Expression), the
  // "Not evaluated yet." empty state (no metric), the Expression
  // view cyan source, and the Initial lock + Current view restore. Shares
  // the v-vmgr-inspect fixture family.
  'canvas/v-vmgr-05.spec.ts',
  // V-VMGR-06: inspect modal Compare mode static states -
  // the two-pane split, the always-arrow delta metric for string / array /
  // table, the View dropdown driving both panes, and the expression scalar
  // source/evaluated panes with the disabled `Literal` View. Shares the
  // v-vmgr-inspect fixture family.
  'canvas/v-vmgr-06.spec.ts',
  // V-VMGR-07: inspect modal EDIT states - the Initial-mode
  // Edit affordance, per-type edit bodies, the invalid-JSON guard, name
  // counter/validation strip, shared sheet behaviors (active outline, pencil
  // re-entry, geometry), and the read regressions. Self-imports the
  // v-vmgr-inspect fixture family.
  'canvas/v-vmgr-07.spec.ts',
  // V-VMGR-CURRENT-EDIT-VISUAL: the color-coded Mode pill
  // (indigo Initial / amber Current / neutral Compare), the Current-mode gate-on
  // Edit button, the run-while-editing conflict dialog, and the
  // expression-view render guards. Self-imports its own fixture.
  'canvas/v-vmgr-current-edit-visual.spec.ts',
  // V-FLOAT-PRECISION: inspect-modal scalar-edit guards
  // for the float Decimal pipeline - the 28-significant-digit input cap, the
  // numeric edit counter (float /28, integer /19), the 64-char rename cap, and
  // width-resizable scalar watchers with a fixed boolean toggle. Self-imports
  // the v-scalar-edit fixture.
  'canvas/v-float-precision.spec.ts',
  // V-STRING-FORMATS: the string watcher Format control -
  // read JSON highlight + Auto (JSON) trigger, the six-option Format menu, Plain
  // dropping / YAML restoring highlight, the edit pretty-print button, invalid-JSON
  // advisory lint with Save enabled, and Template {{ }} cyan. Self-imports its own
  // fixture (deletes the workbench session + POST /tests), so it slots beside the
  // other inspect-modal specs.
  'canvas/v-string-formats.spec.ts',
  // V-VMGR-08: the template watcher - cyan {{ }} kind badge
  // (row + header), Rendered/Template views, centered "Not rendered yet." empty
  // state, cyan {{ }} source, no source metric, template Compare
  // source-vs-source, centered compact empty state and Auto format
  // re-detect. Self-imports its fixture.
  'canvas/v-vmgr-08.spec.ts',
  // V-VMGR-09 / V-VMGR-10 / V-VMGR-11: one null look on Variable Manager rows,
  // watchers (VMGR-93, VMGR-94) and the suite / System Variables lists. Each
  // seeds through the API; serial because they share the workbench session and
  // global system variables.
  'canvas/v-vmgr-09.spec.ts',
  'canvas/v-vmgr-10.spec.ts',
  'shared/v-null-entity-vars-01.spec.ts',
  // --- Debug: paused-state visuals + Running
  //     toolbar Pause-hidden deviation. Import fixtures via POST /tests and
  //     drive live debug runs so the paused affordances are observable. ---
  'canvas/v-canvas-05.spec.ts',
  'canvas/v-canvas-15.spec.ts',
  'canvas/v-canvas-16.spec.ts',
  'canvas/v-canvas-17.spec.ts',
  // --- Debug Step Over / Step Into / Repeat Step / Skip routing:
  // Paused Toolbar visual coverage on a leaf, on a
  //     diverging If-Else (Skip disabled), and on a node mid-Repeat. ---
  'canvas/v-debug-paused-toolbar-01.spec.ts',
  // --- V-CANVAS-FN-DEBUG-01: the canvas follows
  //     execution while step-debugging a Function. Step Over stays at the
  //     caller canvas; Step Into auto-drills into the body (breadcrumb gains a
  //     Function segment, first inner node paused). Drives a live Debug run. ---
  'canvas/v-canvas-fn-debug-01.spec.ts',
  // --- Suite detail ---
  'suites/v-suite-detail-01.spec.ts',
  'suites/v-suite-detail-02.spec.ts',
  'suites/v-suite-detail-03.spec.ts',
  'suites/v-suite-run-01.spec.ts',
  // Self-seeding: creates suite + tracked suite execution to exercise the 409 toast from list and detail
  'suites/v-suite-delete-running-01.spec.ts',
  // --- Regression detail ---
  'regression/v-reg-detail-01.spec.ts',
  'regression/v-reg-edit-01.spec.ts',
  'regression/v-reg-run-01.spec.ts',
  // Self-seeding: creates regression + tracked regression execution to exercise the 409 toast from list and detail
  'regression/v-regression-delete-running-01.spec.ts',
  // --- Execution detail ---
  'executions/v-exec-01.spec.ts',
  'executions/v-exec-02.spec.ts',
  'executions/v-exec-test-01.spec.ts',
  // Cross-surface Time Zone flip. Reuses the v-exec-01
  // fixture - place after v-exec-01 in this group so the same seed is reused.
  'v-tz-surfaces-01.spec.ts',
  // Date range filter (needs a seeded execution so the filter pill is enabled)
  'executions/v-exec-date-range-01.spec.ts',
  // Executions export affordances: row/bulk/detail Export all
  // open the shared ExportDialog (JSON default, no secrets checkbox). Reuses
  // the v-exec-01 seed - place in the same group.
  'executions/v-exec-export-01.spec.ts',
  // --- Report viewer: self-seeding - imports a Log-levels
  //     test via POST /tests, runs it tracked, then drives the reports list,
  //     generate-on-view, level filter, history entry point, and download. ---
  'reports/v-report-02.spec.ts',
  // --- Workbench session artifacts: self-seeding - imports
  //     a File I/O artifact:// fixture via POST /tests, runs it in the live
  //     workbench, then drives the chip badge, sheet rows, per-row delete,
  // the artifact-guarded Reset Session dialog, the close
  //     dialog callout, and the zero-artifact instant reset. ---
  'reports/v-report-03.spec.ts',
  // --- Artifact browser: execution-first list + per-execution
  //     drill. Self-seeds a failing tracked execution (File I/O outputs under
  //     data/, error.json, the persisted log, report.html/json) via the API,
  //     then asserts the landing list + drill layout + soft-delete audit. ---
  'artifacts/v-artif-01.spec.ts',
  // V-TESTDATA-01 (TDATA-3..9): the Test Data chip, the populated sheet and
  // the four picker modes. Self-seeds a Test with four File I/O blocks, uploads
  // its data files one request at a time, and runs it once so the artifact drill
  // has rows for the Copy path assertions.
  'testdata/v-testdata-01.spec.ts',
  // A skipped execution row exposes View + Re-run +
  // Delete (isTerminalStatus includes skipped). Self-seeds via reset.
  'executions/v-exec-skipped-actions.spec.ts',
  // --- Canvas node visuals, fixture-phase tests:
  //     V-02 (description row), V-09 / V-10 (function nodeType + L/S badges),
  //     V-13 (chevron-not-nested) all seed via POST /tests then navigate
  //     to /workbench?editTest=... ---
  'canvas-node/v-canvas-node-02.spec.ts',
  'canvas-node/v-canvas-node-09.spec.ts',
  'canvas-node/v-canvas-node-10.spec.ts',
  'canvas-node/v-canvas-node-13.spec.ts',
  // Function node affordances - seeds a workflow with both
  // local + shared Function nodes and a plugin to assert the L/S badge, dig-in
  // glyph, and Function-only "Open" kebab entry render together.
  'canvas-node/v-canvas-fn-node-01.spec.ts',
  // V-CANVAS-FN-* fixture-phase: Published-variant
  // modal layout needs a seeded Published-shaped node; validation
  // surfacing drills into a seeded Local Function with an inner
  // Log missing its required `message`.
  'canvas/v-canvas-fn-cfg-02.spec.ts',
  'canvas/v-canvas-fn-val-01.spec.ts',
  // V-FN-*: publish dialog, library modal populated,
  // Make Local confirmation, read-only chrome, Profiles button. Each
  // spec seeds via POST /tests (V-FN-LIB-01 / V-FN-MK-LOCAL-01 / V-FN-RO-01 /
  // V-FN-PROFILE-01 also POST /functions for library entries).
  'function-lifecycle/v-fn-pub-01.spec.ts',
  'function-lifecycle/v-fn-lib-01.spec.ts',
  'function-lifecycle/v-fn-mk-local-01.spec.ts',
  'function-lifecycle/v-fn-ro-01.spec.ts',
  'function-lifecycle/v-fn-profile-01.spec.ts',
  // The Tags chip picker's chosen-state contract, reached through the Publish
  // dialog: the tick, the cursor and the choice are three separate things, and
  // a multi-selectable list must publish the choice, not the cursor.
  'function-lifecycle/v-fn-tags-01.spec.ts',
  // Function versioning - missing-version state needs a
  // Test that pins a version not present in the library; seeds the lib +
  // Test in the test body.
  'function-versioning/v-fn-ver-avail-01.spec.ts',
  // --- Long-name truncation across list pages + suite/regression sidebar wrap ---
  // Both files share the long-names-overflow seed.
  'lists/v-list-name-truncate.spec.ts',
  'suites/v-metadata-sidebar-description-wrap.spec.ts',
  // --- Workbench Context Breadcrumb: canvas + detail-header
  //     + tests-list Suite cell + cross-surface EntityListPopover parity.
  //     All five files share the breadcrumb/v-breadcrumb-01/01-seed.sh fixture
  //     (3 tests, 5 suites, 2 regressions, 2 executions). Modes spec uses
  //     page.route to mock the live workbench session for the multi-segment
  //     execution paths; everything else reads from the seeded entities.
  'canvas/v-canvas-breadcrumb-modes.spec.ts',
  'canvas/v-canvas-breadcrumb-truncation.spec.ts',
  'detail-header/v-detail-header-cascade.spec.ts',
  'detail-header/v-detail-header-icons.spec.ts',
  'tests-list/v-tests-list-suite-cell.spec.ts',
  'shared/v-entity-list-popover-parity.spec.ts',
  // --- EntityPickerModal pagination + error surfacing:
  //     25/page infinite scroll, refine nudge, page-1 ListErrorState,
  //     load-more retry pill. Seeds 60 tests + 60 suites via its own fixture.
  'shared/v-picker-paginate-01.spec.ts',
  // --- Mutation tests (modify state mid-execution, must run last) ---
  'dashboard/v-dash-04.spec.ts',
  // V-MCP-02 (MCP-3..MCP-7): saves the MCP settings and starts and stops the real endpoint.
  'settings/v-mcp-02.spec.ts',
  // V-VMGR-03 live update (functional): runs the
  // Var Setter + Delay fixture and asserts the open watcher's Current body
  // follows the runtime overlay, then Reset restores definition parity.
  'canvas/v-vmgr-03-live.spec.ts',
  // V-VMGR-04 live (functional): runs the complex Var
  // Setter fixture and asserts the open watcher resolves summary envelopes
  // to FULL fetched values (skeleton, mid-run in-place refresh, endpoint
  // parity), plus the secret-edit regression (Mark as secret + Save).
  'canvas/v-vmgr-04-live.spec.ts',
  // V-VMGR-05 live (functional): runs the Log fixture
  // whose message expression references both expression variables and
  // asserts the open watchers' empty-state to evaluated transition (lazy
  // engine realize -> WS push -> overlay/full-value fetch), plus the
  // Expression view keeping the source after evaluation.
  'canvas/v-vmgr-05-live.spec.ts',
  // V-VMGR-06 live (functional): runs the complex Var
  // Setter fixture with the watcher open in Compare and asserts the Current
  // pane resolves the full runtime array (delta flipping 2 -> 6 -> 3 items)
  // while the Initial pane stays the definition.
  'canvas/v-vmgr-06-live.spec.ts',
]

export default defineConfig({
  testDir: './visual',
  forbidOnly: isCI,
  // Retries are disabled intentionally. Flaky tests need to be fixed at the
  // root (real async waits, not sleep + hope) - a retry safety net hides
  // race conditions that grow with parallelism.
  retries: 0,
  workers: noDataWorkers, // Global worker limit (per-project overrides this)
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  // Global setup: resets database before all tests
  globalSetup: './setup/global-setup.ts',

  // Store all test artifacts in tests/e2e/playwright-artifacts/ (gitignored)
  outputDir: './playwright-artifacts/test-results',

  // Global test settings. baseURL is set to stack 0 as a fallback for code
  // that doesn't get the per-worker override via playwright-fixtures.ts; in
  // practice every spec imports `test` from that module which overrides
  // baseURL based on TEST_WORKER_INDEX.
  use: {
    baseURL: `http://localhost:${FRONTEND_BASE_PORT}`,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Spawn N isolated FE+BE stacks (host mode). Each stack has its own port
  // pair and its own WAVE_STORAGE_BASE_PATH so workers can reset/seed the
  // DB without interfering with each other. Tests route to a stack via the
  // per-worker baseURL fixture (playwright-fixtures.ts) and the per-worker
  // BACKEND_PORT export (helpers/config.ts).
  //
  // Container-sharded mode skips this entirely - services are started by
  // run-e2e-shard.sh inside each container before Playwright launches.
  webServer: externalServices
    ? undefined
    : Array.from({ length: N_STACKS }).flatMap((_, i) => {
        const fePort = FRONTEND_BASE_PORT + i
        const bePort = BACKEND_BASE_PORT + i
        const dataDir = `/tmp/wave-e2e-stack-${i}`
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
            timeout: 120000,
            // Don't mix server logs into the Playwright output.
            stdout: 'ignore' as const,
            stderr: 'ignore' as const,
          },
          {
            // Prod preview. Each stack has its own build dir (build-<i>)
            // produced by ci-playwright-local.sh host-mode with the matching
            // VITE_API_BASE_URL baked in. Vite inlines the URL at build time,
            // so per-stack bundles are required in host mode.
            command: `npx vite preview --outDir build-${i} --port ${fePort} --strictPort`,
            cwd: path.join(projectRoot, 'frontend'),
            url: `http://localhost:${fePort}`,
            reuseExistingServer: !isCI,
            timeout: 120000,
            stdout: 'ignore' as const,
            stderr: 'ignore' as const,
          },
        ]
      }),

  projects: [
    // =========================================================================
    // DARK THEME
    // =========================================================================

    // Step 1: Empty DB tests (tiny set, finishes in ~30-60s)
    // Tests that check empty states and zero metrics - need clean DB
    {
      name: 'empty-db-dark',
      testMatch: emptyDbTests,
      fullyParallel: true,
      workers: emptyDbWorkers,
      use: { ...desktopChrome, colorScheme: 'dark' },
    },

    // Step 2a: No-data tests (run CONCURRENTLY with fixture tests)
    // UI-only tests that don't query entity data. Safe to run on more
    // workers than N_STACKS because they don't contend on backend state.
    {
      name: 'no-data-dark',
      testMatch: noDataTests,
      dependencies: ['empty-db-dark'],
      fullyParallel: true,
      workers: noDataWorkers,
      use: { ...desktopChrome, colorScheme: 'dark' },
    },

    // Step 2b: Fixture tests. Each worker's stack has its own DB
    // (WAVE_STORAGE_BASE_PATH), so a reset and seed stays within that stack.
    {
      name: 'fixture-dark',
      testMatch: fixtureTests,
      dependencies: ['empty-db-dark'],
      fullyParallel: true,
      workers: fixtureWorkers,
      use: { ...desktopChrome, colorScheme: 'dark' },
    },

    // =========================================================================
    // LIGHT THEME (mirrors dark structure)
    // Run as a separate Playwright invocation (own globalSetup resets DB).
    // =========================================================================

    // Step 1 (light): Empty DB tests
    {
      name: 'empty-db-light',
      testMatch: emptyDbTests,
      fullyParallel: true,
      workers: emptyDbWorkers,
      use: { ...desktopChrome, colorScheme: 'light' },
    },

    // Step 4a: No-data tests (light) - concurrent with fixture-light
    {
      name: 'no-data-light',
      testMatch: noDataTests,
      dependencies: ['empty-db-light'],
      fullyParallel: true,
      workers: noDataWorkers,
      use: { ...desktopChrome, colorScheme: 'light' },
    },

    // Step 4b: Fixture tests (light) - parallel across N stacks
    {
      name: 'fixture-light',
      testMatch: fixtureTests,
      dependencies: ['empty-db-light'],
      fullyParallel: true,
      workers: fixtureWorkers,
      use: { ...desktopChrome, colorScheme: 'light' },
    },
  ],
})
