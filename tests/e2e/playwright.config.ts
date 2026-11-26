/** Phased E2E config; run it through scripts/e2e/e2e-targeted-local.sh or scripts/gate/15-playwright.sh. */

import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI

// Each shard container runs one stack, so every project runs one worker.
const WORKERS = 1

const FRONTEND_PORT = Number(process.env.WAVE_E2E_FRONTEND_PORT || '3000')

// Common device settings
const desktopChrome = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1280, height: 800 },
}

// Test file lists, shared by the dark and light projects

/** Tests that MUST run on a clean (empty) database. */
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
  // V-TESTDATA-02 (TDATA-6): creates and deletes its own Test, so the DB stays clean.
  'testdata/v-testdata-02.spec.ts',
]

/** Tests that need no backend entity data, so they run beside the fixture tests. */
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
  // Session-mirror banner variants, driven by mocked ownership state.
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
  // WAVE Server section, driven by a mocked /server/status roster + seeded own-session ids.
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
  // The other regression specs need seeded data and sit in fixtureTests.
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
  // SSH Session Open config sheet.
  'canvas/v-plugin-ssh-01.spec.ts',
  // SSH Tunnel Open config sheet.
  'canvas/v-plugin-ssh-tunnel-01.spec.ts',
  // SSH Session Script config sheet.
  'canvas/v-plugin-ssh-script-01.spec.ts',
  // Remote Execution: 7 distinct Set A Remote icons + order.
  'canvas/v-plugin-remote-icons-01.spec.ts',
  'canvas/v-remote-exec-01.spec.ts',
  'canvas/v-plugin-http-03.spec.ts',
  'canvas/v-plugin-http-03-validation.spec.ts',
  // HTTP Block: headers editor, body modes, parts editor + file-mode empty state.
  'canvas/v-http-01.spec.ts',
  'canvas/v-http-02.spec.ts',
  'canvas/v-http-03.spec.ts',
  // Per-block Secret masking config section (REQ-3.1.3.16).
  'canvas/v-secmask-01.spec.ts',
  // Controlled secret reveal (SECREV-1, SECREV-4).
  'canvas/v-secrev-block.spec.ts',
  'canvas/v-secrev-badge.spec.ts',
  // The declared plugin credential input field states and the Variable Setter stored-secret gate.
  'secrets/v-cred-field-01.spec.ts',
  'secrets/v-cred-stored-gate-01.spec.ts',
  // A map credential seals value by value, so its keys survive but never render.
  'secrets/v-cred-map-gate-01.spec.ts',
  // Validation alert icon, pulse and output-binding gate (no fixture data).
  'canvas/v-validate-icon-01.spec.ts',
  'canvas/v-plugin-http-03-editors.spec.ts',
  // Single-line string value field, kind sheet and row-level validation.
  'canvas/v-param-string-kind.spec.ts',
  // Variable Setter config modal
  'canvas/v-plugin-varset-01.spec.ts',
  // The shared "Edit value" sheet in the Variable Setter: string Kind and Format, complex View.
  'canvas/v-plugin-varset-value-editor.spec.ts',
  // XML Parser config modal
  'canvas/v-plugin-xml-01.spec.ts',
  'canvas/v-plugin-xml-02.spec.ts',
  // CSV Parser config sheet.
  'canvas/v-plugin-csv-01.spec.ts',
  // Excel Parser config sheet.
  'canvas/v-plugin-excel-01.spec.ts',
  // K8s Connect config sheet.
  'canvas/v-plugin-k8s-01.spec.ts',
  // The four K8s read config sheets.
  'canvas/v-plugin-k8s-02.spec.ts',
  'canvas/v-plugin-k8s-03.spec.ts',
  'canvas/v-plugin-k8s-04.spec.ts',
  'canvas/v-plugin-k8s-05.spec.ts',
  // The four K8s write config sheets.
  'canvas/v-plugin-k8s-06.spec.ts',
  'canvas/v-plugin-k8s-07.spec.ts',
  'canvas/v-plugin-k8s-08.spec.ts',
  'canvas/v-plugin-k8s-09.spec.ts',
  // The three K8s exec-channel config sheets.
  'canvas/v-plugin-k8s-10.spec.ts',
  'canvas/v-plugin-k8s-11.spec.ts',
  'canvas/v-plugin-k8s-12.spec.ts',
  // The six Helm config sheets.
  'canvas/v-plugin-helm-01.spec.ts',
  // File I/O config sheet.
  'canvas/v-plugin-fileio-01.spec.ts',
  'canvas/v-plugin-sftp-01.spec.ts', // SFTP config sheet; seeds its own Test via POST /tests, no DB reset
  'canvas/v-plugin-shellscript-01.spec.ts', // Shell Script config sheet; seeds its own Tests via POST /tests
  'canvas/v-plugin-shellexec-01.spec.ts', // Shell Exec config sheet and palette placement; seeds its own Tests
  // Python block: the config sheet with Interpreter where Shell Script has Shell.
  'canvas/v-plugin-python-01.spec.ts',
  'canvas/v-pyedit-01-default.spec.ts',
  'canvas/v-pyedit-02-syntax-errors.spec.ts',
  'canvas/v-pyedit-03-completion-docs.spec.ts',
  'canvas/v-pyedit-04-rename.spec.ts',
  'canvas/v-pyedit-05-help.spec.ts',
  'canvas/v-pyedit-06-help-tips.spec.ts',
  // Netcat config sheet (NETCAT-12): Check, Range, Talk with Advanced expanded, and the OUTPUT tab.
  'canvas/v-plugin-netcat-01.spec.ts',
  // Ping config sheet (PING-3, PING-6, PING-7, PING-9, PING-17, PING-18).
  'canvas/v-plugin-ping-01.spec.ts',
  // SQL block (SQL-1..SQL-13, FIELDERR-1, FIELDERR-3).
  'canvas/v-plugin-sql-01.spec.ts',
  'canvas/v-plugin-sql-02.spec.ts',
  // OpenSearch block (OS-1..OS-8, OS-11).
  'canvas/v-plugin-opensearch-01.spec.ts',
  // OpenSearch editor (OS-5, OS-12, OS-13).
  'canvas/v-plugin-opensearch-02.spec.ts',
  'canvas/v-fielderr-01.spec.ts',
  // Table query operations in the expression editor.
  'canvas/v-table-expr-ops-01.spec.ts',
  // Note control
  'canvas/v-ctrl-note-01.spec.ts',
  'canvas/v-ctrl-note-02.spec.ts',
  // Note inputs at a join, the + input and the cycle mark. Seeds its own Tests via POST /tests.
  'canvas/v-ctrl-note-03.spec.ts',
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
  // V-CANVAS-FN-*: Function instance modal; all seed via POST /tests, no DB reset.
  'canvas/v-canvas-fn-cfg-01.spec.ts',
  'canvas/v-canvas-fn-cfg-03.spec.ts',
  // V-CANVAS-FN-CFG-04: call window field kinds per FNCFG-6 / FNCFG-7.
  'canvas/v-canvas-fn-cfg-04.spec.ts',
  'canvas/v-canvas-fn-autoname-01.spec.ts',
  'canvas/v-canvas-fn-errmsg-01.spec.ts',
  // V-CANVAS-FN-NESTED-01: 3-deep Function drill round-trip + per-level scoped Variable Manager.
  'canvas/v-canvas-fn-nested-01.spec.ts',
  // If/Else, Halt, For, ForEach, While, Break, Continue controls
  'canvas/v-ctrl-ifelse-01.spec.ts',
  // Switch/Case control: canvas lanes and the config sheet.
  'canvas/v-ctrl-switch-01.spec.ts',
  'canvas/v-ctrl-switch-02.spec.ts',
  // Wait Until control: canvas lanes and the config sheet.
  'canvas/v-ctrl-wait-01.spec.ts',
  'canvas/v-ctrl-wait-02.spec.ts',
  // Parallel control: canvas lanes and the config sheet.
  'canvas/v-ctrl-parallel-01.spec.ts',
  'canvas/v-ctrl-parallel-02.spec.ts',
  'canvas/v-ctrl-parallel-03.spec.ts',
  // Shared variable picker with a 60-character name.
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
  // Time Zone preference picker - Settings UI only, no entity fixtures required.
  'settings/v-settings-tz-01.spec.ts',
  // Settings > General staged Save (SETTINGS-18 to SETTINGS-20, SETTINGS-22); staged only, never saved.
  'settings/v-settings-general-01.spec.ts',
  // Secret Masking settings section (SECREV-6/7).
  'settings/v-secrev-settings-01.spec.ts',
  // MCP Server settings page (MCP-1..MCP-9): staged only, never saved; no entity fixtures.
  'settings/v-mcp-01.spec.ts',
  // Settings > Network pages (NET-1..NET-11).
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
  // Shared field primitives across profiles, entity names and breadcrumbs (UI only).
  'profiles/v-form-overflow-profiles.spec.ts',
  'canvas/v-form-overflow-test-suite-regression-names.spec.ts',
  'canvas/v-canvas-breadcrumb-overflow.spec.ts',
  'profiles/v-profile-parameter-name-validation.spec.ts',
  'profiles/v-profile-metadata-stack.spec.ts',
  // Profile parameter value cell; each spec seeds and deletes its own profile.
  'profiles/v-prof-param-cell.spec.ts',
  // The kubernetes profile form and the type-change data-loss confirmation.
  'profiles/v-prof-k8s-01.spec.ts',
  // Database profile form (SQL-14, K8SPROF-7, K8SPROF-8).
  'profiles/v-prof-database-01.spec.ts',
  // OpenSearch profile form (OS-15, K8SPROF-7, K8SPROF-8).
  'profiles/v-prof-opensearch-01.spec.ts',
  'profiles/v-profile-type-change-warning.spec.ts',
  // The shared ValueField truncates a long setter string value inside its bounded field.
  'canvas/v-varset-value-field-overflow.spec.ts',
  'canvas/v-variable-manager-overflow.spec.ts',
  // Var Manager: Unused indicator.
  'canvas/v-var-unused-badge.spec.ts',
  // V-VAR-UNUSED-BADGE-02: the amber Unused badge on a variable, an input, an output and a local.
  'canvas/v-var-unused-badge-02.spec.ts',
  // V-VMGR-CREATE-01: create modal labeled-form layout, secret-above-value, value-fills.
  'canvas/v-vmgr-create-01.spec.ts',
  // V-VMGR-CREATE-02: the creation windows with Set to null ticked (VMGR-97).
  'canvas/v-vmgr-create-02.spec.ts',
  // V-VMGR-CREATE-03: the input and output parameter windows (VMGR-98, VMGR-103, VMGR-104).
  'canvas/v-vmgr-create-03.spec.ts',
  // V-VMGR-WIN-01..03: the one variable window (VMGR-106).
  'canvas/v-vmgr-window-01.spec.ts',
  'canvas/v-vmgr-window-02.spec.ts',
  'canvas/v-vmgr-window-03.spec.ts',
  // Canvas node visuals: persistent status bar.
  'canvas-node/v-canvas-node-01.spec.ts',
  'canvas-node/v-canvas-node-03.spec.ts',
  'canvas-node/v-canvas-node-04.spec.ts',
  'canvas-node/v-canvas-node-06.spec.ts',
  'canvas-node/v-canvas-node-07.spec.ts',
  'canvas-node/v-canvas-node-08.spec.ts',
  'canvas-node/v-canvas-node-11.spec.ts',
  // Function palette UI - bottom buttons + tooltips + library modal open/close Pure UI.
  'canvas/v-palette-fn-01.spec.ts',
  // Function Library modal empty placeholder.
  'canvas/v-lib-fn-01.spec.ts',
  // Function versioning: edit-mode entry + drop changes, publish-as-major flow.
  'function-versioning/v-fn-edit-01.spec.ts',
  'function-versioning/v-fn-edit-02.spec.ts',
  'function-versioning/v-fn-ver-01.spec.ts',
  // Function versioning additional visual coverage.
  'function-versioning/v-fn-publish-headers.spec.ts',
  'function-versioning/v-fn-lifecycle-dialogs.spec.ts',
  // V-FN-PUBLISH-OUTCOME-01: the publish outcome dialog in both themes.
  'function-versioning/v-fn-publish-outcome-01.spec.ts',
  'function-versioning/v-fn-output-binding-picker.spec.ts',
  'function-versioning/v-fn-shared-config-parity.spec.ts',
  'function-versioning/v-fn-missing-function.spec.ts',
  'function-versioning/v-library-card-name-tooltip.spec.ts',
  'function-versioning/v-library-search-textfield.spec.ts',
  'function-versioning/v-fn-publish-required-fields.spec.ts',
  // The config-modal Changelog + Details dialogs render their per-version content as real Markdown.
  'function-versioning/v-fn-config-dialogs-md.spec.ts',
  // Function Library page, detail page and config modals.
  'functions-library/*.spec.ts',
  // Function View canvas: read-only chrome + Function-only breadcrumb + Test-control gating.
  'function-view/*.spec.ts',
  // Edit Config header across block types and the node validation alert.
  'canvas-config-header/v-canvas-edit-config-header.spec.ts',
  'canvas/v-canvas-validation-alert.spec.ts',
  'canvas/v-dialog-no-entrance-animation.spec.ts',
  // Quick-add popover + DraggableSheet shell (CANVAS-223..230).
  'canvas/v-qadd-01.spec.ts',
  // V-QADD-02 (CANVAS-249) and V-CANVAS-START-01 (CANVAS-248) seed and delete their own Tests.
  'canvas/v-qadd-02.spec.ts',
  'canvas/v-canvas-start-01.spec.ts',
  'canvas/v-sheet-01.spec.ts',
  'canvas/v-sheet-02.spec.ts',
  // V-SHEET-03: the shared refocusSheet reopen affordance - raise + pulse across all four triggers.
  'canvas/v-sheet-03-reopen.spec.ts',
  // V-VMGR-PARSER-STRICT: JSON and XML parser strict-string settings; no DB seed.
  'v-vmgr-parser-strict.spec.ts',
  // V-FIELD-*: the one value field and its states (FIELD-1, FIELD-12).
  'canvas/v-field-block-states.spec.ts',
  'canvas/v-field-switch-warning.spec.ts',
  'canvas/v-field-time-picker.spec.ts',
  'canvas/v-field-list-fields.spec.ts',
  'canvas/v-field-variable-required.spec.ts',
  'canvas/v-field-icons.spec.ts',
  // V-CTRL-CONDROW-01, V-CTRL-SETTER-01: condition rows and Setter rows on the one value field (FIELD-14..16).
  'canvas/v-ctrl-condrow-01.spec.ts',
  'canvas/v-ctrl-setter-01.spec.ts',
  // V-CANVAS-NODE-05 and V-12 need a real run, so they are not in this list.
]

/** Fixture tests: files sharing a seed script are grouped, so only the first one seeds. */
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
  // --- Variable Manager panel: imports a fixture with one variable per type
  'canvas/v-vmgr-01.spec.ts',
  'canvas/v-vmgr-02.spec.ts',
  // V-VMGR-03: per-variable inspect modal.
  'canvas/v-vmgr-03.spec.ts',
  // V-VMGR-04: complex value bodies.
  'canvas/v-vmgr-04.spec.ts',
  // V-VMGR-05: expression watcher views.
  'canvas/v-vmgr-05.spec.ts',
  // V-VMGR-06: inspect modal Compare mode static states.
  'canvas/v-vmgr-06.spec.ts',
  // V-VMGR-07: inspect modal EDIT states.
  'canvas/v-vmgr-07.spec.ts',
  // V-VMGR-CURRENT-EDIT-VISUAL: the Mode pill and the Current-mode Edit gate.
  'canvas/v-vmgr-current-edit-visual.spec.ts',
  // V-FLOAT-PRECISION: inspect-modal scalar-edit guards for the float Decimal pipeline.
  'canvas/v-float-precision.spec.ts',
  // V-STRING-FORMATS: the string watcher Format control.
  'canvas/v-string-formats.spec.ts',
  // V-VMGR-08: the template watcher.
  'canvas/v-vmgr-08.spec.ts',
  // V-VMGR-09 / V-VMGR-10 / V-VMGR-11 (VMGR-93, VMGR-94).
  'canvas/v-vmgr-09.spec.ts',
  'canvas/v-vmgr-10.spec.ts',
  'shared/v-null-entity-vars-01.spec.ts',
  // --- Debug: paused-state visuals, driven by live debug runs
  'canvas/v-canvas-05.spec.ts',
  'canvas/v-canvas-15.spec.ts',
  'canvas/v-canvas-16.spec.ts',
  'canvas/v-canvas-17.spec.ts',
  // --- Debug Step Over / Step Into / Repeat Step / Skip: the paused toolbar
  'canvas/v-debug-paused-toolbar-01.spec.ts',
  // --- V-CANVAS-FN-DEBUG-01: the canvas follows a step-debugged Function
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
  // Cross-surface Time Zone flip.
  'v-tz-surfaces-01.spec.ts',
  // Date range filter (needs a seeded execution so the filter pill is enabled)
  'executions/v-exec-date-range-01.spec.ts',
  // Executions export affordances: row/bulk/detail Export all open the shared ExportDialog.
  'executions/v-exec-export-01.spec.ts',
  // --- Report viewer: self-seeding.
  'reports/v-report-02.spec.ts',
  // --- Workbench session artifacts: self-seeding.
  'reports/v-report-03.spec.ts',
  // --- Artifact browser: execution-first list + per-execution drill.
  'artifacts/v-artif-01.spec.ts',
  // V-TESTDATA-01 (TDATA-3..9): the Test Data chip, the populated sheet and the four picker modes.
  'testdata/v-testdata-01.spec.ts',
  // A skipped execution row exposes View + Re-run + Delete (isTerminalStatus includes skipped).
  'executions/v-exec-skipped-actions.spec.ts',
  // --- Canvas node visuals, fixture-phase tests.
  'canvas-node/v-canvas-node-02.spec.ts',
  'canvas-node/v-canvas-node-09.spec.ts',
  'canvas-node/v-canvas-node-10.spec.ts',
  'canvas-node/v-canvas-node-13.spec.ts',
  // Function node affordances.
  'canvas-node/v-canvas-fn-node-01.spec.ts',
  // V-CANVAS-FN-* fixture-phase.
  'canvas/v-canvas-fn-cfg-02.spec.ts',
  'canvas/v-canvas-fn-val-01.spec.ts',
  // V-FN-*: publish dialog.
  'function-lifecycle/v-fn-pub-01.spec.ts',
  'function-lifecycle/v-fn-lib-01.spec.ts',
  'function-lifecycle/v-fn-mk-local-01.spec.ts',
  'function-lifecycle/v-fn-ro-01.spec.ts',
  'function-lifecycle/v-fn-profile-01.spec.ts',
  // The Tags chip picker's chosen-state contract, reached through the Publish dialog.
  'function-lifecycle/v-fn-tags-01.spec.ts',
  // Function versioning: a Test pinning a version the library lacks; seeds in the body.
  'function-versioning/v-fn-ver-avail-01.spec.ts',
  // --- Long-name truncation; both files share the long-names-overflow seed
  'lists/v-list-name-truncate.spec.ts',
  'suites/v-metadata-sidebar-description-wrap.spec.ts',
  // --- Workbench Context Breadcrumb: all five files share the v-breadcrumb-01 seed
  'canvas/v-canvas-breadcrumb-modes.spec.ts',
  'canvas/v-canvas-breadcrumb-truncation.spec.ts',
  'detail-header/v-detail-header-cascade.spec.ts',
  'detail-header/v-detail-header-icons.spec.ts',
  'tests-list/v-tests-list-suite-cell.spec.ts',
  'shared/v-entity-list-popover-parity.spec.ts',
  // --- EntityPickerModal pagination + error surfacing.
  'shared/v-picker-paginate-01.spec.ts',
  // --- Mutation tests (modify state mid-execution, must run last) ---
  'dashboard/v-dash-04.spec.ts',
  // V-MCP-02 (MCP-3..MCP-7): saves the MCP settings and starts and stops the real endpoint.
  'settings/v-mcp-02.spec.ts',
  // V-VMGR-03 live update.
  'canvas/v-vmgr-03-live.spec.ts',
  // V-VMGR-04 live: the open watcher fetches full values during a run.
  'canvas/v-vmgr-04-live.spec.ts',
  // V-VMGR-05 live: the expression watchers go from empty to evaluated.
  'canvas/v-vmgr-05-live.spec.ts',
  // V-VMGR-06 live: in Compare, Current shows the runtime array, Initial the definition.
  'canvas/v-vmgr-06-live.spec.ts',
]

export default defineConfig({
  testDir: './visual',
  forbidOnly: isCI,
  // No retries: a retry hides races; fix flaky tests at the root.
  retries: 0,
  workers: WORKERS,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],

  // Global setup: resets database before all tests
  globalSetup: './setup/global-setup.ts',

  // Store all test artifacts in tests/e2e/playwright-artifacts/ (gitignored)
  outputDir: './playwright-artifacts/test-results',

  // Fallback; playwright-fixtures.ts sets each worker's baseURL.
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // DARK THEME

    // Step 1: empty-DB tests, which need a clean database
    {
      name: 'empty-db-dark',
      testMatch: emptyDbTests,
      fullyParallel: true,
      workers: WORKERS,
      use: { ...desktopChrome, colorScheme: 'dark' },
    },

    // Step 2a: no-data tests, run beside the fixture tests
    {
      name: 'no-data-dark',
      testMatch: noDataTests,
      dependencies: ['empty-db-dark'],
      fullyParallel: true,
      workers: WORKERS,
      use: { ...desktopChrome, colorScheme: 'dark' },
    },

    // Step 2b: fixture tests
    {
      name: 'fixture-dark',
      testMatch: fixtureTests,
      dependencies: ['empty-db-dark'],
      fullyParallel: true,
      workers: WORKERS,
      use: { ...desktopChrome, colorScheme: 'dark' },
    },

    // LIGHT THEME: a separate Playwright invocation with its own DB reset

    // Step 1 (light): Empty DB tests
    {
      name: 'empty-db-light',
      testMatch: emptyDbTests,
      fullyParallel: true,
      workers: WORKERS,
      use: { ...desktopChrome, colorScheme: 'light' },
    },

    // Step 4a: No-data tests (light) - concurrent with fixture-light
    {
      name: 'no-data-light',
      testMatch: noDataTests,
      dependencies: ['empty-db-light'],
      fullyParallel: true,
      workers: WORKERS,
      use: { ...desktopChrome, colorScheme: 'light' },
    },

    // Step 4b: Fixture tests (light)
    {
      name: 'fixture-light',
      testMatch: fixtureTests,
      dependencies: ['empty-db-light'],
      fullyParallel: true,
      workers: WORKERS,
      use: { ...desktopChrome, colorScheme: 'light' },
    },
  ],
})
