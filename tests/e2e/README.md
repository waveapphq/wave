# Playwright E2E Tests

End-to-end tests for WAVE. Tests verify the UI matches design wireframes and decisions.

## Running Tests

Run these from the root of the clone:

```bash
./scripts/e2e-targeted-local.sh <spec>    # one or more specs
./scripts/ci-playwright-local.sh          # all specs
```

Never run the Playwright configs in this folder straight on the host. Their setup resets the data of the backend on port 8000.

After `npm ci` in `tests/e2e/`, `npm run type-check` and `npm run test:list` start nothing and are safe on the host.

The required host is stated in CONTRIBUTING.

The harness makes a config copy with a secret key for every backend it starts.

## Data Seeding

Tests require seeded data. Each test has its own fixtures.

Two of the 16 fixture areas, as examples:

```
tests/e2e/
├── scripts/
│   ├── reset.sh              # Clear test data; Functions, system variables and a few settings stay
│   └── lib.sh                # Shared helper functions
└── fixtures/
    ├── dashboard/
    │   ├── v-dash-01/        # Empty state (reset only)
    │   ├── v-dash-02/        # Populated dashboard
    │   ├── v-dash-03/        # Execution progress test
    │   ├── v-dash-04/        # Recent executions section
    │   └── v-dash-05/        # Quick actions section
    └── lists/
        ├── v-list-01/        # Populated tests list
        ├── v-list-02/        # Empty state
        ├── v-list-03/        # Loading state
        ├── v-list-04/        # Error state
        └── v-list-05/        # Selection mode
```

A fixture README describes what its spec does in its container. Do not run its steps against your dev backend.

### Usage in Tests

```typescript
import { exec } from '../../helpers/exec'

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/dashboard/v-dash-02/01-seed.sh')
})
```

### Dashboard Tests

| Test | Description |
|------|-------------|
| [v-dash-01](fixtures/dashboard/v-dash-01/README.md) | Empty state with zero metrics |
| [v-dash-02](fixtures/dashboard/v-dash-02/README.md) | Populated dashboard with tests, suites, executions |
| [v-dash-03](fixtures/dashboard/v-dash-03/README.md) | Execution progress updates |
| [v-dash-04](fixtures/dashboard/v-dash-04/README.md) | Recent executions section variations |
| [v-dash-05](fixtures/dashboard/v-dash-05/README.md) | Quick actions section |

### Lists Tests

| Test | Description |
|------|-------------|
| [v-list-01](fixtures/lists/v-list-01/README.md) | Populated tests list with filters, pagination |
| [v-list-02](fixtures/lists/v-list-02/README.md) | Empty state with CTA (LIST-6) |
| [v-list-03](fixtures/lists/v-list-03/README.md) | Loading skeleton state (LIST-4) |
| [v-list-04](fixtures/lists/v-list-04/README.md) | Error state with retry (LIST-5) |
| [v-list-05](fixtures/lists/v-list-05/README.md) | Selection mode with bulk actions (BULK-1 to BULK-4) |
| [v-list-06](visual/lists/v-list-06.spec.ts) | Tests list interactions on the v-list-01 seed (LIST-1, LIST-2, LIST-7, BULK-*) |
| [v-list-07](fixtures/lists/v-list-07/README.md) | Populated suites list with filters, pagination |
| [v-list-08](fixtures/lists/v-list-08/README.md) | Suites empty state with CTA (LIST-6) |

**Note:** Timestamps are generated dynamically. Executions with `-old-` in ID get 48h-old timestamps.

## Test Phases

Tests run in ordered phases via Playwright project dependencies:

**Dark Theme:**
1. `empty-db-dark` - Empty-state and zero-metric tests, on a clean DB
2. `no-data-dark` - UI-only tests that query no entity data (depends on `empty-db-dark`)
3. `fixture-dark` - Tests requiring seeded data (depends on `empty-db-dark`)

**Light Theme (mirrors dark structure):**
4. `empty-db-light` - Same tests as `empty-db-dark`, light color scheme
5. `no-data-light` - Same tests as `no-data-dark`, light color scheme
6. `fixture-light` - Same tests as `fixture-dark`, light color scheme

`no-data-dark` and `fixture-dark` run concurrently; both wait on `empty-db-dark`.

Fixture tests are ordered by shared seed script groups to minimize re-seeding.

## Container-Sharded CI & Duration Balancing

`./scripts/ci-playwright-local.sh` runs the full functional + visual-dark suite
across N podman containers (default 8; override with `WAVE_E2E_N_SHARDS`), each
with its own isolated backend/frontend stack. 8 shards runs reliably on a
16-core host because (a) the work is duration-balanced so no shard runs hot far
longer than the rest, and (b) the shared `request` fixture
(`helpers/playwright-fixtures.ts`) retries idempotent backend reads on transient
connection resets that the per-container backend can throw under CPU contention.

Playwright's `--shard` splits by test **count**, which leaves shards uneven
because per-test durations vary widely. Instead, each container runs
`scripts/e2e-shard-plan.mjs`, which reads the committed duration profile
`tests/e2e/shard-weights.json` and packs spec files into duration-balanced bins
(greedy LPT, functional + visual jointly). The partition is deterministic, so
every container computes the same bins and selects its own slice. With no
profile present it falls back to count-based `--shard`.

`empty-db-dark` runs once per CI run. The planner packs its files as one item;
the shard that gets it runs the three dark projects as usual (`empty-db-dark`
first, on the clean DB its globalSetup leaves), and every other shard runs
`no-data-dark` + `fixture-dark` with `--no-deps`. A planner failure fails that
shard: a `--shard` fallback next to planned shards would leave files unrun.

**Refresh the profile after adding or materially changing tests:**

```bash
./scripts/ci-playwright-local.sh            # green run writes per-shard JSON
./scripts/generate-shard-weights.sh         # harvest -> tests/e2e/shard-weights.json
```

The profile holds each file's wall time, hooks included: Playwright reports a
test's `beforeAll` / `afterAll` time in the gap after it, so that gap goes to the
test's file. A failed test (Playwright's rule, so a `test.fail()` test that fails
is green) counts as its file's median passing test. Balance degrades gracefully
between refreshes (a file not yet profiled weighs its test count times the
median seconds per test).
Preview balance without running CI:

```bash
node scripts/e2e-shard-plan.mjs --shards 4 --artifacts /tmp/plan \
  --weights tests/e2e/shard-weights.json --e2e-dir tests/e2e
```

### Targeted Runs (fail-first iteration)

`./scripts/e2e-targeted-local.sh` runs exactly the spec files you name in one
isolated container - the same image, service stack and ephemeral DB as a full
CI shard. Use it to watch a new spec fail before the fix and pass after; the
merge gate is still the full `ci-playwright-local.sh` run.

```bash
./scripts/e2e-targeted-local.sh functional/secret-leak-canary/v-secret-leak-canary-functional.spec.ts
./scripts/e2e-targeted-local.sh visual/canvas/v-ctrl-switch-01.spec.ts
```

Spec paths are relative to `tests/e2e/`. Paths under `visual/` run in the dark
visual projects and everything else in the functional config; you can name both
kinds in one invocation and a phase with no specs is skipped. The frontend
bundle rebuilds only when missing or older than `frontend/src` (force with
`WAVE_E2E_REBUILD=1`). Artifacts land in `/tmp/wave-e2e-targeted-artifacts/`.

## Real-Service Stack

The SSH, Remote, HTTP and Kubernetes suites run against a real
compose-orchestrated service stack (real `sshd` + interpreters, a nested jump
host, an internal HTTP target, an nginx TLS matrix, two forward proxies, two
kwok Kubernetes clusters, a Kubernetes gateway, a Kubernetes fault injector, raw
TCP and UDP targets, four databases, an OpenSearch node and an OCI registry),
not an in-process fake. It is managed by `scripts/e2e-stack.sh` and
documented in `services/README.md`. CI and the targeted runner bring it up and
tear it down automatically. Bring it up by hand with `scripts/e2e-stack.sh up --wait`. Add a new
protocol service per the recipe in `services/README.md` - never add a new
in-process simulator for a protocol the stack can serve for real.

The SSH hosts are `sshd` (127.0.0.1:9445, the main one), `sshd-no-sftp` (:9447,
SFTP subsystem removed), `sshd-no-fwd` (:9448, TCP forwarding off),
`sshd-banner` (:9446, prints one line on stdout before every command),
`sshd-badpy` (:9462, answers the interpreter version probe and then runs
nothing) and `nested-sshd` (reachable only through `sshd` as a jump host). They
are one image with a config variant per service.

The Kubernetes services are `kwok` (published on 127.0.0.1:9460, a real
Kubernetes API), `kwok-internal` (the identical second cluster, reachable only
on the compose network), `k8s-gateway` (an nginx plain-HTTP path-prefix front
for `kwok`, reachable only on the compose network) and `k8s-stub`
(127.0.0.1:9461, a fault injector that answers discovery and fails only the
resource read). They back `functional/k8s-connect/`, `functional/k8s-read/`,
`functional/k8s-write/`, `functional/k8s-exec/`, `functional/k8s-tunnel/`,
`functional/k8s-remote-exec/` and the kubernetes spec in
`functional/profile-drives-plugin/`; every one of those suites has its own
README.
`functional/k8s-tunnel/` also needs `sshd`, because it reaches `kwok-internal`
through an SSH tunnel; `functional/k8s-remote-exec/` needs `sshd` and
`k8s-gateway`, because it runs the read Blocks on the SSH host.
`functional/shell-blocks/` needs `sshd` for three cases only: the SH-12
remote-body run leg, SH-17 and SH-18. SH-17 and SH-18 also need `http-target`,
because they hold a remote request open against its `/delay` endpoint; the rest
of the suite runs on the WAVE host alone.
`functional/nesting/` needs `sshd` for its Remote Execution cells: every cell with
a Remote Execution container opens a connection-scoped session on the main host
and writes nothing there.
`functional/python-block/` needs `sshd` for `v-plugin-python-remote-functional`
only, which runs the script under the SSH host's own `python3`.
`functional/sftp/` needs `sshd` (users `wave` and the chrooted SFTP-only
`dropzone`) and `sshd-no-sftp`, and its tunnel spec dials `sshd-no-fwd` by
service name as a far host not in WAVE's trusted hosts list. Each spec writes only its own
`e2e-<spec>-<uuid>` folder on the server and removes it after.

The OpenSearch services are `opensearch` (127.0.0.1:9477, HTTPS on the lab CA)
and `opensearch-gateway` (127.0.0.1:9478, a plain-HTTP `/os` path-prefix
front). They back `functional/opensearch-search/`,
`functional/opensearch-aggregate/`, `functional/opensearch-editor/`, the
OpenSearch specs in `functional/remote-exec/` and `functional/ssh-tunnel/`
(both also need `sshd`) and in `functional/profile-drives-plugin/`, and the
visual `v-plugin-opensearch-02`; each has its own README.

The proxy services are `http-proxy` (127.0.0.1:9458, open) and
`http-proxy-auth` (127.0.0.1:9459, login required). They back
`functional/network-proxy/`, which also needs `http-target`, `tls-lab`,
`kwok-internal` and `opensearch`. The Helm suites in `functional/helm/` use the
chart repository on `tls-lab` (127.0.0.1:9463 and :9464) and, for
`v-helm-oci.spec.ts`, `oci-registry` (127.0.0.1:9482, HTTPS on the lab CA,
login required); each has its own README.

## File Structure

Visual specs: `visual/<area>/v-<name>.spec.ts`. Functional specs: `functional/<suite>/v-<name>.spec.ts`, usually ending in `-functional`.

## Shared Helpers (`tests/e2e/helpers/`)

| Module | Provides |
|--------|----------|
| `canvas.ts` | Palette drag (`dragPaletteItemToCanvas`), kebab helpers (`clickNodeKebabItem`, `expectNodeKebabItem`), canvas-load waits. Two geometry settles guard every coordinate read: `waitForViewportSettled` holds until React Flow's queued fitView has landed (`waitForCanvasLoad` already calls it), and `waitForCanvasBoxStable` holds until the canvas rect stops moving after a palette / console / Variable Manager toggle - call it at the toggle, once the panel's own `data-state` proves the toggle committed. `mockInventedTestReads(page, ids)` answers the load-time validation and the post-save re-read for Tests a spec invented with `page.route` - without it the real backend rejects an id it never stored, the canvas blocks and never reports itself ready |
| `workbench.ts` | Toolbar undo/redo/save locators, retry-hardened `dragNodeBy` with transform readback, `digIn`/breadcrumb pops, context-menu toggles (`disableNode`), `selectEnvironment`, `runToTerminal`, `expectPinnedVersion`, Radix pointer-lock clear, Block sheet open / Save (`openBlockSheet`, `saveBlockSheet`), the Save warning before a Block Save makes variables secret (`secretPromoteDialog`, `confirmSecretPromotion(page, names)`), the breadcrumb Reset (`resetRun`), a Current value set in the variable's Edit window (`setCurrentValue(page, name, value)`: pencil, pill Current, field, Save; returns the variable's watcher opened on the Current value), a library Function card dragged under Start (`dropLibraryFunctionBelowStart(page, name)`) |
| `variable-create.ts` | The one variable window (VMGR-106) for a Test variable, a Function local, an input and an output. Add: `openCreateModal`, `openFunctionCreateModal`, `fillCreateWindow`, `createSimpleVariable`, `createFunctionParam`, `createDeclaration` (an enum input is `type` + `createEnum` + `enumValues` + `value` as its default), `cancelCreate` (answers Close when the window asks). Edit: `openEditWindow(page, name, { view })` from the row pencil in the scope shown (an open window is raised, not doubled), `editWindow`, `editFromWatcher`; the value pill (`valueSwitch`, `setValueView`: Initial / Current / Default); the value field (`valueField`, `valueEditor`, `setWindowValue` per face: text, number, true / false, list / map / table one-line text, enum pick, source, `null`; `expectWindowValue`); checkboxes (`windowCheckbox`, `setWindowCheckbox`); Allowed values (`fillAllowedValues`, `setAllowedValues`); rename (`renameInWindow`, `renameNotice`); Type / Kind confirms (`retypeInWindow`, `rekindInWindow`, `answerChangeConfirm`); secrets (`editProtectedValue`, `answerRemoveSecret`, `makeSecretQuestion`); `saveWindow` (waits for the write and the close) and `cancelWindow` with the Keep Editing / Close / Save question (`closeQuestion`). The "Edit value" sheet behind Open editor: `openValueEditor`, `setValueEditorView`, `valueEditorCode`, `replaceValueEditorCode`, `saveValueEditor`, `closeValueEditor`, `setValueEditorFormat`, `formatValueEditor`, `writeValueEditor` / `insertCreateCode`. Every window locator a helper returns is pinned to its window, so it stays that window as others open and close |
| `entity-variables.ts` | The Edit Variables dialog of a Suite, a Regression and the System Variables page: `variablesDialog`, `openEntityVariables(page, 'suite' \| 'regression', id)` (from the detail page), `openSystemVariables` (Edit Variables, a filled list) and `openSystemVariablesOnNewRow` (one new last row, whether the list is empty or not); rows (`entityVariableRow(dialog, name)`, `newEntityVariableRow`, `setEntityRowType` by its label); the value cell (`entityValueCell`, `openEntityValue` returns the "Edit value" sheet); `saveVariablesDialog` (waits for the close), `cancelVariablesDialog`; `createEntity(request, path, data)` seeds a Suite, Regression or Test and returns its id |
| `fn-seed.ts` | Node/edge builders (`logNode`, `delayNode`, `localFunctionNode`, `sharedNode`, `editModeSharedNode`), library publish (`publishLibraryFunction`, with optional local `variables`) + Test seed + View/Test open helpers, Function Block fields (`setFunctionFields`, `expressionInputs`) |
| `fn-block.ts` | Function Block seeds in the stored field shape (`localFunctionBlock`, `sharedFunctionBlock`, `editModeFunctionBlock`, `libraryFunction`, and the body Blocks `logBlock`, `csvBlock`, `setterBlock`, `controlBlock`, `pluginBlock`), save-refusal reads (`postTest`, `postFunction`, `messagesOf`, `testIdsNamed`, `functionIdsNamed`, `storedBlock`, `cleanUp`) and Block window steps (`openBlockWindow`, `saveBlockWindow`, `setFieldExpression`, `setFieldTemplate`, `addMapEntryExpression`, `offeredNames`, `badgeMessages`) |
| `fixture-import.ts` | Unique-name fixture import + zero-error validate gate + workbench open (`importFixtureTest`, `importValidateAndNavigate`), session id/variables reads (`getActiveSessionId`, `getSessionVariables`), host rewrites for the real-service stack (`injectServiceHost` / `injectSsh` option, `injectHttpHost` / `injectHttp` option). `importExpectingErrors` is the opposite gate: it imports a fixture that is MEANT to fail validation and returns the findings, persisting through the admin bulk route because `POST /tests` refuses an invalid workflow. `importThroughListPage(page, route, file)` drives a list page's Import dialog (Import, file, Validate, Import) and returns the review step's summary and warnings; `importedTestId` finds the Test such an import stored. `expectNothingSent(variables, probe)` proves no block sent a request before an http-echo `/retry` probe with the run's key (the probe answers attempt 1) |
| `secret-canary.ts` | Secret-leak checks: `SECRET_MASK`, `SECRET_ENVELOPE`, `FOREIGN_ENVELOPE` (an envelope this instance cannot open), `sweepStore` (store files holding a canary), `dirBytes`, `listStoreFiles`, `expectNoSecret` |
| `k8s-seed.ts` | Kubernetes object seeding for the kwok-backed read suites: `seedRun(request, profile)` creates a run-unique namespace pair and one profile's object set (`get`, `events`, `logs`, `top`, `impersonation`, `minimal`) and returns its own `teardown`; `SEEDED` carries every seeded name; `waitForPodEvents` / `waitForPodMetrics` poll with no hard-coded floor |
| `k8s-nodes.ts` | Canvas node and edge factories for TypeScript-built fixtures (`pluginNode`, `k8sConnectNode`, `k8sReadNode`, `k8sApplyNode`, `k8sDeleteNode`, `k8sScaleNode`, `k8sRolloutNode`, `k8sExecNode`, `k8sScriptNode`, `k8sCopyNode`, `sshSessionOpenNode`, `sshSessionExecNode`, `remoteExecutionNode`, `parallelNode`, `markerNode`, `delayNode`, `tryCatchNode`, `edge`, `handleEdge`, `chainEdges`, `stackNodes`), shaped so a built workflow imports identically to a checked-in fixture |
| `k8s-run.ts` | Shared run helpers for workflow specs: `startRun`, `finishRun` (gates the harvest on the run's own bookend marker), `finishRunAnyVerdict`, `expectNodeStatus`, `expectNodesSuccess`, `runTrackedTest`, `openRunHistory`, `fetchSessionReport`, `fetchExecutionReport` |
| `log-reader.ts` | Virtualized console readers (`getLogEntries`, `getLogTexts`, `getLogLines`, `getLogCopyTexts` for newline-preserving multiline entries); `waitForLogText` polls for a run's bookend line and returns the harvest - use it whenever asserting on a run's late log lines; `expectConsoleLine` asserts one exact line and `expectLineBefore` that one line comes before another (an exact message or a pattern) |
| `profiles.ts` | `openProfileCreateDialog` - settles the profiles page's four mount fetches (the environment list gates the trigger) before opening the create dialog |
| `api-route.ts` | Forced API failures: `apiPathMatcher` matches one API path on the backend origin and the frontend `/api` proxy but never the SPA document served at the same path (`/profiles` and `/environments` are both), `failApiRoute` answers with the backend's real error envelope plus the CORS headers a cross-origin fulfill needs, `delayApiRoute` holds a real response back so a clean read can be made to land after something else, `throttleUploads` slows one page's outgoing bytes so an upload is genuinely in flight on the server while it is observed, `countApiFetches` counts one path's fetches |
| `page-block.ts` | Blocked-page state after a failed supporting read: one route matcher per read (`PROFILE_TYPES_ROUTE`, `SUITE_TAGS_ROUTE`, `SUITE_NAMES_ROUTE`, `FUNCTION_TAGS_ROUTE`, `ENVIRONMENT_TAGS_ROUTE`, `TEST_TAGS_ROUTE`, `REGRESSION_TAGS_ROUTE`, `SYSTEM_VARIABLES_ROUTE`, `WORKBENCH_SESSION_ROUTE`, `testValidateRoute`, `testWorkflowRoute`, `functionUsageRoute`, `functionVersionRoute`, `functionRoute`) plus the primary-read matchers (`PROFILES_LIST_ROUTE`, `SUITES_LIST_ROUTE`, `TESTS_LIST_ROUTE`, `FUNCTIONS_LIST_ROUTE`); `startAtRoot`, `failEnvironmentNames`, `blockedCard`, `blockedTitle`, `isRouteContentInert`, `routeContentFilter`, `expectBlockedWith`, `expectNotBlocked`, `expectSurfaceLive`, `retryBlockedPage`, `openBlockedDetails`, `stripBlockedOverlay` (deletes the card and every other layer so the page underneath can be proven dead), `focusLocation` |
| `config.ts` | Per-worker ports/URLs, `E2E_ENV_NAME`, `ensureEnvironment`, `STORAGE_BASE_PATH` (per-worker backend store root for raw at-rest reads) |
| `playwright-fixtures.ts` | Worker-routed `test`/`expect` (always import from here, not `@playwright/test`) |
| `code-editor.ts` | `leaveExpressionEditor(editor)`: the one way a spec leaves a code editor (an expression field, a create or inspect window, an Edit value sheet, a script body). It blurs the focused editor inside `editor` and asserts no suggestion list is open; a list still waiting to open never opens after the blur, so nothing covers the next click. Never a click elsewhere or an Escape, which could close the sheet. `SUGGESTION_LIST` is the list selector |
| `zip-reader.ts` | Reads an archive a download produced without any dependency: `listZipEntries`, `zipEntryNames` and `readZipEntry` / `readZipEntryText` for one member's decompressed bytes. Use it wherever a spec must assert what an export, backup or artifact archive actually carries rather than only its PK magic |
| `zip-writer.ts` | Writes an archive from members a spec built itself, without any dependency: `buildZip(members)` takes `ZipMember` entries (`{ name, data }`) and stores each one uncompressed. Use it to hand WAVE a backup or import archive whose member was changed after the download (a dropped key, a character that cannot be stored); read the result back with `zip-reader.ts` |
| `table-transform.ts` | The CSV / Excel config sheet's Transform section: `addSort` (column name + direction), `addFilterBlock` (column name + "as" type), `addFilterLiteral` (operator by its label, then the value unless the operator takes none), `filterOperatorOptions` (the labels a literal condition's operator select offers), `filterBlocks`; `addSortOn` (a column by name or by index), `setFilterAsType`, `setFilterCondition` (operator and value of the nth literal row); the stored shape (`storedFilter`, `storedSort`, `withoutIds`, `nameRef`, `indexRef`); the shared matrix (`FILTER_DATA`, `FILTER_COLUMNS`, `FILTER_CELLS`, `SHEET_BUILT_CELLS`, `filterCell`, `SORT_DATA`, `SINGLE_SORT_CELLS`, `PRIORITY_SORT_CELLS`); sources (`csvText`, `buildWorkbook` with booleans and a null cell left out, `transformSource`); generated Tests (`transformNode`, `tableVariables`, `filterMatrixSeed`); run reads (`runAndReadSession`, `keptIds`, `keptIdsByName`) |
| `condition-builder.ts` | Condition rows of the check blocks (Assert, If/Else, Switch, While, Wait Until) through the config sheet: `CHECK_BLOCK_PALETTE` (the palette item of each), `conditionBody` / `openConditionBody` (one condition list, a branch card opened when collapsed), `addLiteralRow`, `addExpressionRow`, `rowPath`, `pickConditionVariable`, `operatorTrigger`, `pickOperator` (by its label), `operatorOptions` (the labels a row offers, in order), `valueBox`, `setReference`, `referenceToggle`, `setReferenceExpression`, `setRootJoiner`, `addSwitchCase`, `addSwitchDefault`, `setWaitTiming`; `storedConditionRows` reads the stored rows back |
| `value-field.ts` | Reads and drivers of a Block row's one value field (FIELD-1..FIELD-7): its box, input, overlay and state marker (`fieldBox`, `fieldInput`, `fieldOverlay`, `stateMarker`), the expression box and its hint, the expand, reset, null and {x} buttons (`expandButton`, `resetButton`, `nullButton`, `expressionToggle`), tooltips and the muted look (`fieldTooltip`, `expectTextMuted`, `textLook`), and the switch warning with its exact texts (`switchWarning`, `askSwitch`, `answerSwitch`) |
| `default-rule.ts` | The default rule on a Block row (FIELD-2, FIELD-3, FIELD-7): the gray default and the user value (`expectGrayDefault`, `expectGrayEmptyDefault`, `expectNullNotSet`, `expectEmptyNotSet`, `expectUserValue`), the {x} hint and expression text (`expectDefaultKeyHint`, `expectExpression`, `typeExpression`), the switch warning (`expectSwitchWarning`, `switchWithAnswer`, `switchSilently`) and the stored result (`storedFields`, `expectNothingStored`, `expectStored`) |
| `list-fields.ts` | Reads of a row's box, line, icons and look (FIELD-1, FIELD-9, FIELD-10): the row's parts (`fieldRow`, `fieldBox`, `fieldExpand`, `fieldReset`, `fieldToggle`, `fieldLabel`), its one line (`oneLine`, `lineCount`, `lineSegments`), geometry (`rectOf`, `expectInside`, `expectUncovered`, `expectCut`), `openGroup`, `closeUnchangedSheet`, `storedBlock`, `tlsCapabilities` and `deleteSeededTest` |
| `entry-editors.ts` | The list, map, table and Parts editors (FIELD-1, FIELD-10, FIELD-13): opening them from a Block row or a variable window (`openBlockEditor`, `openPartsEditor`, `openVariableEditor`, `openNestedEditor`), the parts of one entry (`mapEntry`, `listItem`, `tableCell`, `partRow`: key box, value box, null button, {x}, expand, Type pill) and the geometry and computed-style reads their look specs assert (`rectOf`, `colorLook`, `expectVisuallyDisabled`, `inBothThemes`); selectors only, never class names |
| `entry-behavior.ts` | The type change and {x} switch questions of an entry (FIELD-6, FIELD-7, FIELD-13): `expectTypeChangeQuestion`, `answerTypeChange`, `pickEntryType`, `expectSwitchQuestion`, `answerSwitch`; the text of an entry's {x} box (`codeText`, `writeCode`), the unsaved-secret line, `deleteAndEdit`, and the saves a behavior spec reads back (`saveBlockAndTest`, `runTest`, `storedNode`) |
| `choice-tls.ts` | Choice values a Block holds from creation, the Cipher Suites field and its picker, and the time picker (FIELD-8, FIELD-9, FIELD-10): `catalogChoiceDefaults`, `storedValues`, `expectHolds`, `pickChoice`, `setTrueFalse`; `cipherCatalog`, `defaultCiphers`, `expectGrayList`, `expectOwnList`, `openCipherPicker`, `savePicker`; `openTimeFromExpand`, `setRelativeAmount` |
| `number-entry.ts` | Number box keystrokes and pastes (`typeKeys`, `typeAtEnd`, `pasteOver`, `expectTypedAs`), refused saves (`refusalOf`, `messagesOf`, `expectBlocked`), import dry runs (`importDryRun`, `validateInDialog`) and a response's raw JSON text, every digit kept (`rawBody`), shared by the number rule specs (REQ-3.1.3.14) |
| `number-rule.ts` | Shared steps of the number rule specs (REQ-3.1.3.14): save refusals (`expectTestRefused`, `expectFunctionRefused`), raw JSON bodies (`sendJson`, `postJson`, `rawJson`, `withPlaceholders`), sheet reads (`typeNumber`, `clearNumber`, `badgeLines`), DEBUG lines (`ioLines`) and recipe refusals over MCP (`callToolRaw`, `recipeErrors`) |
| `run-fill.ts` | The run fill specs' Test Data (`uploadRunFillData`), the kwok workload they roll (`createDeployment`, `restartStamp`), stored-field reads (`storedBlock`, `expectLeftOut`) and the run lines they read (`httpSendLine`, `deploymentRestartLine`) |
| `mcp.ts` | MCP settings reset / until-restart enable (`resetMcpSettings`, `enableMcpUntilRestart`), endpoint probes (`askMcpEndpoint`, `askMcpSession`), a held client session (`connectMcpClient`) and one-shot tool calls through the SDK client (`callTool(port, tool, args)` returns the `{ isError, payload }` envelope) |
| `testdata.ts` | The per-test Test Data HTTP surface: `uploadTestData` (one file per request, fields in the order path, replace, then the file part), `createTestDataFolder`, `deleteTestDataEntry`, `readTestDataListing` / `listTestDataPaths`, `readTestDataContent` / `readTestDataBytes`, and `readTestDataUploads` (what is in flight and what did not land). Seed a test's own files through it and read every assertion back from it; the sheet's own locators stay with its suite |
| `opensearch-stack.ts` | Admin-side OpenSearch access for specs: the `wave-e2e` template, index create and `_bulk` seed, per-token cleanup, API token mint / revoke, oracle searches, field counts, search-task watch, slow-query calibration, and the F-LOGS / F-METRICS / B-PAGE / S-SLOW / D-DAILY data |
| `theme.ts` | `toggleTheme(page)` clicks the shell's theme toggle, waits until the page carries the other theme and returns it (`'light'` or `'dark'`). Use it wherever a visual spec repeats its checks in the second theme |
| `ws-events.ts` / `exec.ts` / `edge-drag.ts` / `dashboard.ts` | WS subscribe capture, shell exec, edge dragging, dashboard waits |

Before writing a new spec-local helper, check these modules; extend them
instead of re-rolling per-spec copies.

The table covers the common modules. `helpers/` holds a few more.

## Test ID Convention

`V-<AREA>-<NN>`, such as `V-DASH-02`, `V-LIST-05`, `V-CANVAS-16`.

## Test Structure

```typescript
/**
 * V-LIST-02: Tests List Empty
 *
 * Design Decisions: LIST-6
 *
 * Main Purpose: Empty state provides a clear path for new users.
 *
 * Pass Criteria:
 * 1. Empty state container is centered
 * 2. Heading reads "No tests yet"
 * 3. CTA button is primary variant
 * 4. No table visible
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('V-LIST-02: Tests List Empty', () => {
  test('V-LIST-02: empty state renders with clear call-to-action', async ({ page }) => {
    await page.goto('/tests')

    const emptyState = page.getByTestId('empty-state')

    // 1. Empty state container is centered
    await expect(emptyState).toBeVisible()
    await expect(emptyState).toHaveCSS('text-align', 'center')

    // 2. Heading reads "No tests yet"
    const heading = emptyState.getByRole('heading')
    await expect(heading).toHaveText('No tests yet')

    // 3. CTA button is primary variant
    const cta = emptyState.getByRole('button', { name: 'Create Test' })
    await expect(cta).toBeVisible()

    // 4. No table visible
    await expect(page.locator('table')).not.toBeVisible()
  })
})
```

## Selector Priority

Use in this order (most preferred first):

1. **Role selectors** - `page.getByRole('button', { name: 'Create Test' })`
2. **Test IDs** - `page.getByTestId('tests-table')`
3. **Semantic HTML** - `page.locator('main')`, `page.locator('aside')`
4. **Text content** - `page.getByText('No tests yet')`

Avoid: class selectors, complex CSS chains, XPath.

**Tip:** Use `exact: true` when matching by name to avoid partial matches:
```typescript
// BAD: matches "Search" AND "OpenSearch Index..."
page.getByRole('button', { name: 'Search' })

// GOOD: matches only exact "Search"
page.getByRole('button', { name: 'Search', exact: true })
```

## Common Assertions

```typescript
// Visual
await expect(element).toHaveCSS('width', '240px')
await expect(element).toHaveCSS('background-color', 'rgb(250, 250, 250)')

// Accessibility
await expect(element).toHaveAttribute('aria-label', 'Close')
await expect(element).toBeFocused()

// State
await expect(button).toBeEnabled()
await expect(element).toHaveText('Expected text')
await expect(page.locator('[data-testid="row"]')).toHaveCount(5)

// Page
await expect(page).toHaveURL('/tests')
await expect(page).toHaveTitle('Tests | WAVE')
```

## Test Categories

Each screen typically needs:

| Category | Verifies |
|----------|----------|
| Layout | Position, spacing, alignment |
| States | Empty, loading, error, populated |
| Interactions | User actions, feedback |
| Accessibility | Keyboard nav, focus, ARIA |

---

*Reference design decisions by ID (e.g., LIST-6, CANVAS-9) in test comments for traceability.*
