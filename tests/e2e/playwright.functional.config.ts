/**
 * Playwright Functional Test Configuration
 *
 * Config for workflow-execution tests that hit the backend's real
 * execution engine + the compose service stack. See playwright.config.ts for
 * the full host-mode vs container-sharded-mode rationale - this file
 * mirrors the same switch via WAVE_E2E_EXTERNAL_SERVICES.
 *
 * Run one or more specs: ./scripts/e2e-targeted-local.sh functional/<suite>/<spec>.spec.ts
 * Run all specs: ./scripts/ci-playwright-local.sh
 */

import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const projectRoot = path.resolve(__dirname, '../..')
const isCI = !!process.env.CI

const externalServices = process.env.WAVE_E2E_EXTERNAL_SERVICES === '1'

// N-stack parallel execution (host mode only). Container-sharded mode
// collapses to 1 stack since each container has its own BE+FE pair and
// --shard splits tests across containers.
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
    // baseURL is overridden per worker by playwright-fixtures.ts so this is
    // only a fallback for code paths that import `test` from @playwright/test.
    baseURL: `http://localhost:${FRONTEND_BASE_PORT}`,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Allow self-signed certs from the stack's HTTPS services
    ignoreHTTPSErrors: true,
  },

  // Container-sharded mode: services are started by run-e2e-shard.sh inside
  // each container and Playwright just connects over 127.0.0.1. Host mode:
  // spawn N isolated BE+FE pairs; the compose service stack is shared.
  webServer: externalServices
    ? undefined
    : [
        ...Array.from({ length: N_STACKS }).flatMap((_, i) => {
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
              timeout: 120_000,
              // Don't mix server logs into the Playwright output.
              stdout: 'ignore' as const,
              stderr: 'ignore' as const,
            },
            {
              // Preview from frontend/build-<i> (produced by
              // ci-playwright-local.sh host-mode with the matching
              // VITE_API_BASE_URL baked in).
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
        // Real-service stack (compose): real sshd + interpreters, a nested jump
        // host, HTTP targets, the TLS matrix, and the forward proxies.
        // e2e-stack.sh run brings the
        // stack up in the foreground and tears it down when Playwright kills it;
        // an already-running stack short-circuits via reuseExistingServer + the
        // main sshd port. Container-shard mode brings the stack up in the CI
        // script instead (this webServer block is skipped there).
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
    // Step 1: Destructive tests (reset DB, CRUD operations) - run first.
    // Parallel across N stacks (different files on different workers, each
    // with isolated DB). Within a file tests stay serial because many
    // rely on top-down ordering of mutations within the same suite file.
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
        // Server-side System Variables export/import round-trip
        // through the shared Export/Import dialogs (restricted resolutions).
        'import-export-global-variables/**/*.spec.ts',
        // Per-export Secret values choice (mask/encrypted/
        // plaintext) end-to-end, functions/GV surfaces carry the mode, and the
        // foreign-encrypted import warning.
        'export-secrets/**/*.spec.ts',
        'regression-management/**/*.spec.ts',
        'regression-variable-collision/**/*.spec.ts',
        'regression-namespace-autocomplete/**/*.spec.ts',
        // Pure CRUD: suite delete cascades out of regressions
        'suite-delete-cascade/**/*.spec.ts',
        // Admin endpoint inspection/teardown of the workbench session map
        'admin-workbench-session/**/*.spec.ts',
        // Profiles: usage tracking, structural lock, env cascade,
        // type alignment, alias validation, namespace conflicts.
        'profile-bugs/**/*.spec.ts',
        // Profile value-editor migration - per-type edit+persist, secret
        // clear-and-edit, per-env isolation, description, number precision,
        // sheet-over-modal + Format control, empty-name-blocks-Save. CRUD via the modal.
        'profile-value-editor/**/*.spec.ts',
        // Entity-scope (Suite / System / Regression) variable value editing
        // migrates onto the shared bodies - array authored in the Visual body (no
        // one-line JSON error), secret clear-and-edit, integer exact text.
        'entity-variable-editor/**/*.spec.ts',
        // Suite + regression secret grid alignment - the
        // per-scope save-path round-trip guard (a masked re-save preserves the
        // sealed value) and the grid un-secure confirm-and-clear affordance.
        'secret-entity-grid/**/*.spec.ts',
        // Tests, profiles and environments follow their storage directories:
        // deletes files from the running backend's data directory, so it is
        // destructive and must never share a backend with the workflow project.
        'storage-directory-follow/**/*.spec.ts',
        // Settings saved into the config file (REQ-4.7.15 to REQ-4.7.18); changes stack-wide settings.
        'instance-config/**/*.spec.ts',
        // The number rule on stack-wide state: Settings ports and backups, System variables and the
        // MCP variable update (REQ-3.1.3.14).
        'number-rule-global/**/*.spec.ts',
      ],
      use: desktopChrome,
    },
    // Step 2: Workflow execution tests (run actual WAVE tests via fixtures)
    //
    // No dependency on functional-destructive. Each workflow test imports
    // its own fixture via API and runs it in isolation, so destructive
    // tests don't need to pre-populate anything. Keeping a dependency
    // would force `--shard` to replicate every destructive test in every
    // shard (Playwright re-runs dep tests in each shard), which is the
    // single biggest cost to sharding this suite.
    {
      name: 'functional-workflow',
      testMatch: [
        'assert-control/**/*.spec.ts',
        'delay-control/**/*.spec.ts',
        'http-plugin/**/*.spec.ts',
        // HTTP TLS matrix: real handshakes against the tls-lab nginx service
        // (mTLS, version pins, cipher pins).
        'http-tls/**/*.spec.ts',
        // One-shot recipe authoring through the live MCP
        // endpoint - the created test runs like a hand-built one and every
        // rejoin (ingress_N) edge survives the save pipeline.
        'recipe-authoring/**/*.spec.ts',
        // Single-active-session ownership + live mirroring +
        // take-over. Two isolated contexts drive the global editing lock; the
        // mirror + approve/deny/force/cancel/inherit flows and read-only lock.
        'session-ownership/**/*.spec.ts',
        // Watch-mode authoring + Focus Current. Focus Current
        // navigates across Function levels then centers; two person tabs prove
        // Follow Changes / change pulse / variable cue; a real MCP
        // build_test_from_recipe reveal is mirrored and taken over mid-build.
        'watch-mode/**/*.spec.ts',
        // Browser sessions as first-class terminable connections.
        // Real holder + mirror contexts drive the /server/status roster + roles,
        // the person See-Connection deep-link, and admin disconnect (single /
        // others / all) booting a tab to /dashboard with the disconnect modal.
        'wave-server-sessions/**/*.spec.ts',
        // Live-execution mirroring - person/MCP-held runs
        // streamed to watchers (banner phrase, env readout, progressive
        // console, auto-yield + silent hand-back, browse-away), and the
        // watched-vs-unwatched broadcast-only parity proof.
        'run-mirror/**/*.spec.ts',
        // Defect guard: a split fail_current_scope assert inside a
        // loop body paints red, keeps the flow going down its fail branch, and fails the run.
        'scope-fail-loop/**/*.spec.ts',
        // Defect guard: recipe readback is faithful or honestly
        // inexpressible - custom if-else branch ids keep their children and
        // fail_current_scope, and a dropped-walk graph refuses amendment.
        'mcp-readback-integrity/**/*.spec.ts',
        // Defect guard: declare-empty profile secrets over MCP
        // come back announced as explicit manual action items.
        'mcp-profile-actions/**/*.spec.ts',
        // Defect guard: declare-empty TEST secrets are a valid
        // authoring case (created + action item) and failed runs surface them
        // as pending_action_items in the failure report.
        'mcp-declare-empty-secrets/**/*.spec.ts',
        // Test Data over MCP: the five tools round trip into the folder the sheet
        // renders, a run in progress refuses every write as a finding, and a
        // missing testdata:// reference warns without blocking until
        // write_testdata supplies the file and the packaged example runs green.
        'mcp-testdata/**/*.spec.ts',
        // SSH Session trio (Open / Execute / Close) - stateful
        // session against the asyncssh simulator, a 2-hop parent chain, cascade
        // close, and the Connected-flips-false-on-close proof.
        'ssh-session/**/*.spec.ts',
        // SSH Tunnel pair (Open / Close) riding a session -
        // fixed + auto-assigned local port forwarding proven by an HTTP round
        // trip, explicit + idempotent close, session-close cascade reaping, and
        // the secret-password save round-trip guard.
        'ssh-tunnel/**/*.spec.ts',
        // K8s Connect against the real kwok clusters: the credential matrix +
        // admin-token canary, run-token denial, tunneled access to the
        // unpublished cluster, deliberate session reveal with cipher-range
        // narrowing, and the token value-editor guard.
        'k8s-connect/**/*.spec.ts',
        // The four K8s read Blocks (Get / Events / Logs / Top) against the real
        // kwok cluster and the k8s-stub service: the per-Block option sweeps,
        // the impersonation matrix, the empty-shape and failure cells, the
        // run-time refusals, the endpoint faults, the pre-run gate, and a read
        // cut short by its Parallel lane's time limit staying silent afterwards.
        // Needs the kwok + k8s-stub services up (functional/k8s-read/README.md).
        'k8s-read/**/*.spec.ts',
        // The four K8s write Blocks (Apply / Delete / Scale / Rollout) against
        // the real kwok cluster: the chained create-update-scale-rollout-delete
        // workflow, the If exists and Ignore not found gates, the cluster-scoped
        // write, the Secret leak canary in both cleartext and base64 form, and
        // the RBAC denial with the limited token.
        // Needs the kwok service up (functional/k8s-write/README.md).
        'k8s-write/**/*.spec.ts',
        // The three K8s exec-channel Blocks (Exec / Script / Copy) against the
        // real kwok cluster: the command sweep with per-container targeting and
        // a non-zero exit as data, the two script interpreters reading a body
        // to EOF, the file and directory pulls into the run's artifacts, the
        // push that sources an artifact an earlier Block wrote, and the
        // recorded and raised cluster refusals.
        // Needs the kwok service up (functional/k8s-exec/README.md).
        'k8s-exec/**/*.spec.ts',
        // K8s multi-cluster: an Apply/Get ConfigMap round trip through an SSH
        // tunnel to the unpublished kwok-internal cluster, interleaved with a
        // second direct session to the published kwok cluster in one workflow.
        // Needs the sshd, kwok-internal and kwok services up
        // (functional/k8s-tunnel/README.md).
        'k8s-tunnel/**/*.spec.ts',
        // The K8s Blocks inside a Remote Execution container on the real sshd
        // host: every read, write and exec-channel Block's bound result
        // materialized from the remote worker, a Secret read and a Secret
        // write that mask in both forms on the remote path, a Copy round trip
        // and the WAVE-side-scheme refusal,
        // a Connect through the plain-HTTP path-prefixed gateway, and a Connect
        // the plugin refuses before any request. Also the two host diagnoses: a
        // host that prints ahead of every command, and one whose interpreter
        // answers the probe and then cannot run the worker.
        // Needs the sshd, sshd-banner, sshd-badpy, kwok, k8s-stub and
        // k8s-gateway services up (functional/k8s-remote-exec/README.md).
        'k8s-remote-exec/**/*.spec.ts',
        // The six Helm Blocks (Install / Upgrade / Rollback / Uninstall / Test /
        // Status) driving the real helm executable against the kwok cluster and
        // the fixture chart repository: the release lifecycle and revision walk,
        // the chart test hooks, atomic rollback on a stuck workload, chart
        // repository auth and TLS, the uninstall options, the remote and tunnel
        // loci, the Helm Path matrix, profiles, impersonation, an MCP-authored
        // recipe, and the repository-password leak canary.
        // Needs the kwok, tls-lab and sshd services up (functional/helm/README.md).
        'helm/**/*.spec.ts',
        // The Timeout row as a real wall-clock bound: every K8s and Helm Block
        // that carries one, given a second against a cluster that stalls for
        // three, plus the Cleanup Timeout that widens an Atomic write's bound.
        // Needs the k8s-stub, kwok and tls-lab services up
        // (functional/block-timeout/README.md).
        'block-timeout/**/*.spec.ts',
        // The output binding name gate on both surfaces that carry it: the Block
        // config sheet and the Function config modal. An invalid name keeps the
        // suggestion popover shut and Save disabled; a type mismatch does not.
        'output-binding-name-gate/**/*.spec.ts',
        // The pre-run check validates the canvas that is about to run, not the
        // last saved copy, across Run / Debug / ad-hoc / Function scope.
        'prerun-dirty-gate/**/*.spec.ts',
        // Tables logged to the run console: aligned columns, five self-announcing
        // caps, and masking applied before column widths are measured.
        'console-table-render/**/*.spec.ts',
        // A declared variable with no value holds null and reads null in the
        // Variable Manager, secrets included.
        'null-start-value/**/*.spec.ts',
        // Null values in real runs (REQ-3.1.3.20 to REQ-3.1.3.23): settings and
        // Function inputs refuse null, null in text / scripts / SQL / OpenSearch,
        // the print form, null chips in editors, MCP owed secrets and run overrides.
        'null-values/**/*.spec.ts',
        // The one value field on every Block (REQ-3.1.1.5): default rule, switch warning, choice values
        // at creation, the run fill, the special editors and the expression text.
        'one-value-field/**/*.spec.ts',
        // Map, list and table entry editors: entry {x}, null, nested levels, type change and the row look.
        'entry-editors/**/*.spec.ts',
        // One number rule for every numeric field (REQ-3.1.3.14) on Blocks, Functions, variables,
        // conditions, profiles, recipes and the stored form.
        'number-rule/**/*.spec.ts',
        // Checks on null (REQ-3.1.3.25): is null / not null, the holds-nothing rule.
        'null-checks/**/*.spec.ts',
        // SSH Session Script: a script pipes to a chosen interpreter's stdin
        // (/bin/sh, bash, python3, perl, node) over one live session and its
        // outputs propagate. The same fixture runs against the main host and the
        // SFTP-disabled one, which proves stdin delivery needs no SFTP.
        // Needs the sshd and sshd-no-sftp services up
        // (functional/ssh-session-script/README.md).
        'ssh-session-script/**/*.spec.ts',
        // Remote Execution against the real sshd host, with the pushed bundle run
        // by the host's own python3: the container's mixed-locus body (remotable
        // HTTP runs on the host, non-remotable JSON/Log run on WAVE), standalone
        // remote-block routing, session lifecycle on run boundaries, the
        // via-parent variants, SSH secret masking, and the console log-level
        // accumulation filter. The chained full-chain form is remote-real-harness.
        // Needs the sshd, nested-sshd and http-target services up
        // (functional/remote-exec/README.md).
        'remote-exec/**/*.spec.ts',
        'ssh-session-via-parent/**/*.spec.ts',
        // Settings > Network (REQ-4.5.14, REQ-4.5.16): trusted SSH hosts and
        // certificate trust built through the UI and proven by real SSH, HTTPS,
        // SQL, OpenSearch, K8s and Helm runs. Each spec resets the network
        // settings and re-seeds the stack's trusted hosts around every test.
        'network-ssh-hosts/**/*.spec.ts',
        'network-certificates/**/*.spec.ts',
        'network-certificates-consumers/**/*.spec.ts',
        // Settings > Network > Proxy (REQ-4.7.14): the Proxy pages built through
        // the UI and proven by HTTP, K8s, OpenSearch and Helm runs that reach
        // proxy-only targets through the tinyproxy pair.
        'network-proxy/**/*.spec.ts',
        // Settings page shell, leave prompt, nav group state (NET-1) and the
        // shared section error, Data folder and Secret Masking rows.
        'network-settings-pages/**/*.spec.ts',
        'settings-sections/**/*.spec.ts',
        'remote-standalone/**/*.spec.ts',
        'remote-lifecycle/**/*.spec.ts',
        'ssh-secrets/**/*.spec.ts',
        // Shell Script / Python marked-output canary: a marked Shell Script
        // stdout, a marked Shell Script variable export and a marked Python
        // output var mask on every output surface, and no raw pre-masking
        // output dump appears.
        'shell-python-secrets/**/*.spec.ts',
        'console-log-level/**/*.spec.ts',
        'remote-real-harness/**/*.spec.ts',
        // Element-config params (HTTP Headers / Query / Body) edit through
        // the shared "Edit value" sheet (deleted array/map/text modals): string-only
        // param maps reach the request as strings, a templateFields body
        // renders at execution, and a multiline JSON body round-trips via Format.
        'element-config-value-editor/**/*.spec.ts',
        // A single-line string `url` param resolves through Template /
        // Expression / Literal+trim kinds end-to-end (template renders, expression
        // evaluates, a trailing newline is trimmed before the request), and the
        // multiline body template still renders.
        'param-template-trim/**/*.spec.ts',
        // File I/O artifact:// round-trip inside a workbench
        // session + session artifacts API listing/content (REQ-3.7.1.4).
        'file-io-artifacts/**/*.spec.ts',
        // File I/O: the eight operations against per-test test data and session
        // artifacts in one chained workflow, plus three abort fixtures for the
        // write-fail, folder-destination and testdata-write refusals.
        'file-io-operations/**/*.spec.ts',
        // File I/O inside a Remote Execution body on the real sshd host: the
        // operations under a per-run unique host folder, the R locus badge, the
        // last block clearing the folder, and the save-time refusal of a
        // testdata:// path inside the body (functional/file-io-remote/README.md).
        'file-io-remote/**/*.spec.ts',
        // The Test Data sheet end to end: chip, selection-driven Upload and New
        // folder, rename, delete, download bytes and folder zip, copy path, the
        // pre-request replace prompt, concurrent uploads with their own progress,
        // drop onto a folder row, the running-test refusal, and a run that
        // resolves testdata://folder/file (functional/testdata-sheet/README.md).
        'testdata-sheet/**/*.spec.ts',
        // The file-reference picker in all four modes across File I/O, Excel,
        // HTTP, K8s Copy and Helm: each pick is read back from the saved
        // workflow and the run resolves it. Needs http-echo and kwok up
        // (functional/file-picker/README.md).
        'file-picker/**/*.spec.ts',
        // Shell Script and Shell Exec on the WAVE server: arguments, input
        // variables, typed and secret variable exports, exit codes, timeout,
        // Stop and pattern stops ending the whole process tree, Log Output,
        // Working Directory and Browse, the two WAVE_ directories, the sheet
        // rules, and a Stop or dropped session during a remote block.
        // Needs the sshd and http-target services up
        // (functional/shell-blocks/README.md).
        'shell-blocks/**/*.spec.ts',
        // The Python block on the WAVE server and on the real sshd host: the
        // typed round trip in and out, exception and sys.exit outcomes, logging
        // to the run console, the live checks in the script editor, Run from the
        // editor, F2 rename, the Plain-locked script bodies and the editor's
        // scroll containment. Needs the sshd service up
        // (functional/python-block/README.md).
        'python-block/**/*.spec.ts',
        // Netcat on the WAVE server against the real netcat-echo and sshd
        // services: TCP and UDP Check states, Range pass rules, Talk Text / File
        // / Nothing, and Record and continue (functional/netcat/README.md).
        'netcat/**/*.spec.ts',
        // Netcat inside a Remote Execution body on sshd, reaching the
        // internal-only netcat-target (functional/netcat-remote/README.md).
        'netcat-remote/**/*.spec.ts',
        // Netcat on a local port of an open SSH tunnel tests the far end
        // (NETCAT-9, NETCAT-18) (functional/netcat-tunnel/README.md).
        'netcat-tunnel/**/*.spec.ts',
        // Ping on the WAVE server and inside a Remote Execution body on the real
        // sshd host: the four Pass when rules, every Advanced row, Record and
        // continue, the whole-block Timeout and Fail the block. Needs the sshd
        // and netcat-target services up (functional/ping/README.md).
        'ping/**/*.spec.ts',
        // The SQL block against the real postgres, mariadb, oracle and mssql
        // services (and SQLite on a file): Run SQL, its failure paths, Load
        // table, Call procedure and the SQL editor's Get Tables, checks, Run and
        // Stop (SQL-1..SQL-15). Needs the four database services and sshd up
        // (functional/sql-run/README.md and its siblings).
        'sql-run/**/*.spec.ts',
        'sql-load/**/*.spec.ts',
        'sql-procedure/**/*.spec.ts',
        'sql-editor/**/*.spec.ts',
        // UTF-8 text on every surface and the start refusal on a host that is
        // not UTF-8 (REQ-4.6.9). The startup spec starts its own backends.
        // Needs the sshd service up (functional/text-encoding/README.md).
        'text-encoding/**/*.spec.ts',
        // A failed request keeps its request line and one request id in the
        // server log, on a backend the spec starts itself.
        'request-logging/**/*.spec.ts',
        // The engine names a block by its Name on every surface (EXEC-26).
        'block-name/**/*.spec.ts',
        // The OpenSearch block against the real opensearch and opensearch-gateway
        // services: Search, its failure and amber paths, every Authentication way,
        // Aggregate with every grouping and stat, and the editor's Get fields,
        // checks, Run and Stop (OS-1..OS-16) (functional/opensearch-search/README.md
        // and its siblings).
        'opensearch-search/**/*.spec.ts',
        'opensearch-aggregate/**/*.spec.ts',
        'opensearch-editor/**/*.spec.ts',
        // The SFTP block on real OpenSSH servers: transfers, wildcards, folders,
        // refusals, Stop, hop chains, an SSH tunnel and the chrooted dropzone
        // account. Needs the sshd and sshd-no-sftp services up; the tunnel spec
        // dials sshd-no-fwd by service name (functional/sftp/README.md).
        'sftp/**/*.spec.ts',
        // Every block and every lane of every control built through the canvas
        // (drop, quick-add, drag from the lane dot), saved and run
        // (functional/canvas-lanes/README.md).
        'canvas-lanes/**/*.spec.ts',
        // Field-level save errors on the profile modal: the port-range message
        // under the field, the Name message once left, no required fields
        // (FIELDERR-1..FIELDERR-3) (functional/profile-field-errors/README.md).
        'profile-field-errors/**/*.spec.ts',
        // Every container inside every slot kind of every container, at depth.
        // Needs the sshd service up (functional/nesting/README.md).
        'nesting/**/*.spec.ts',
        // On-demand report generation - tracked execution job +
        // inline document + workbench session report (REQ-3.7.2.1..2.8).
        'report-generation/**/*.spec.ts',
        // Artifact browser end-to-end - landing count, four-section
        // grouping, single-file download bytes, soft-delete audit trail, streamed
        // zip, and the execution-delete cascade to /artifacts + /reports.
        'artifact-browser/**/*.spec.ts',
        'halt-control/**/*.spec.ts',
        'if-else-control/**/*.spec.ts',
        // Switch/Case end-to-end - break, fall-through
        // (matching + non-matching next case), the default reached by
        // fall-through and by no-match, no-default, lazy per-case guards, the
        // always-present then egress, the disabled cascade, Skip Block on a
        // paused Switch, and the config-save then-edge guard.
        'switch-case-control/**/*.spec.ts',
        // Parallel end-to-end - wait-for-all with sibling
        // writes readable past the join, cross-branch coordination through a
        // Watch-mode Wait Until, first-to-finish stopping the loser, a nested
        // section, a disabled section, a per-branch time limit that ends the
        // run, an Assert failure that is not a branch failure, a Halt that
        // carries its declared status, and the debug cursor parking the section.
        'parallel-control/**/*.spec.ts',
        // Wait Until end-to-end against the real http-echo
        // service - a Retry lane that polls until the endpoint flips to 200, an
        // informational timeout (amber, session untouched), a scope-failing
        // timeout that still continues through then, Watch on an already-true
        // condition, and the disabled cascade-skip.
        'wait-until-control/**/*.spec.ts',
        // The shared variable picker on every
        // condition surface - namespace members with real types, never the
        // bare roots, OUT only for output bindings, and long names that stay
        // readable. Seeds its own System / Suite / Regression scopes.
        'variable-picker/**/*.spec.ts',
        'json-parser/**/*.spec.ts',
        // json_content runs as literal / expression / template
        // across combined + individual output modes (expression body is the new
        // capability from dropping noExpression; template is no-loss).
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
        'variable-setter/**/*.spec.ts',
        // The migrated setter assigns one value of EACH type
        // (string/int/float/bool/array/map/table) + a per-key expression row +
        // a per-key template row; exact numbers preserved, template renders
        // eagerly, expression evaluates.
        'variable-setter-migration/**/*.spec.ts',
        // A Variable Setter overriding an
        // expression variable must supersede the pending expression via a
        // direct write WITHOUT realizing it.
        'variable-setter-expression/**/*.spec.ts',
        // The profile value runtime binding is UNCHANGED by the
        // editor migration - a table param resolves to the same {headers,rows} dict
        // and exact-digit-string numbers realize to int / Decimal at execution.
        'profile-value-runtime/**/*.spec.ts',
        // Bound HTTP and Custom profile fields read as alias.field; a secret field prints masked.
        'profile-binding/**/*.spec.ts',
        // Float Decimal pipeline (REQ-3.1.3.14) -
        // a long float survives storage -> realization -> WS -> display exact,
        // the derived expression is exact, a setter overwrite reaches the
        // watcher (WS push), a Current-mode rename
        // persists, and a live Current float override propagates.
        'float-precision/**/*.spec.ts',
        'xml-parser/**/*.spec.ts',
        // CSV Parser end-to-end - PARSE typing matrix, schema
        // mapping + mismatch policy, declarative sort/filter transforms, SERIALIZE,
        // Table.filter/order_by in expressions, and the aborting permutations
        // (on_mismatch=fail / unknown operator / serialize-non-table). Guards the
        // plugin variable_ref resolution (serialize table + schema_source).
        'csv-parser/**/*.spec.ts',
        // Secret-masking guards using CSV/Log as the vehicle
        // (scrub-before-truncate + escaped forms, carried by a multiline
        // CSV-content secret).
        'csv-secret-masking/**/*.spec.ts',
        // Both runtime forms of a table reach every consumer -
        // the loop, the Variable Setter, CSV's table and schema-source params, and
        // the collection row's type selector.
        'table-runtime-forms/**/*.spec.ts',
        // Excel Parser end-to-end - write/read round trip, sheet
        // and range selection, workbooks authored by a spreadsheet application,
        // looping over the rows a workbook was read into, and the aborting
        // permutations (.xls, missing sheet, declared-type mismatch).
        'excel-parser/**/*.spec.ts',
        // The read-only guard on field expressions, the table
        // query operations, and the save-time scan over comprehensions / lambdas /
        // sandbox builtins.
        'table-expression-guards/**/*.spec.ts',
        'tracked-execution/**/*.spec.ts',
        'tracked-termination-yaml-unsafe/**/*.spec.ts',
        'dashboard-live-refresh/**/*.spec.ts',
        'execution-detail/**/*.spec.ts',
        'executions-list/**/*.spec.ts',
        // Executions export flows - detail dialog YAML/JSON
        // downloads, row single download, bulk POST /executions/export ZIP.
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
        // EntityPickerModal cross-page selection persistence.
        // Self-seeds a PKR2-namespaced fixture (no reset) and cleans it up.
        'entity-picker/**/*.spec.ts',
        // Workbench undo/redo refactor (post-state baseline model)
        'workbench-undo-redo/**/*.spec.ts',
        // Save-spec sanitization (selected/dragging/hasNewerVersion)
        'workbench-save-sanitize/**/*.spec.ts',
        // Tests-list switch dialog timing for clean-but-executed workbench
        'tests-list-switch-dialog/**/*.spec.ts',
        // Tests-page New Test / Open-in-Workbench
        // gates over an artifact-holding session + running-blocker suppression
        'tests-page-artifact-gates/**/*.spec.ts',
        // BE outage detection + dataEpoch-driven content remount
        'connection-recovery/**/*.spec.ts',
        // Settings > Environments page list endpoint must not redirect
        'environments-page/**/*.spec.ts',
        // A page whose supporting read failed goes genuinely inert behind the
        // blocked card (LIST-13/14), Try Again / Details / Copy behave
        // (LIST-16/17), every supporting read on the six list pages blocks its
        // page (LIST-10/19), a failed record read wins outright so the two
        // states never share the screen (LIST-20), a card belongs to whoever
        // raised it (LIST-21), each failure is named (LIST-22), a section
        // nobody is on never reads (LIST-23), the Entity Picker blocks itself
        // and names what failed (LIST-18 / PICKER-4), a Function whose usage
        // read failed refuses both delete paths, a failed workbench or
        // library read never fakes a clean canvas or an empty library, and a
        // failed Discard and Stay never passes unsaved edits off as saved.
        'page-blocked/**/*.spec.ts',
        // Runtime enum validator: HTTP method='xyz' / 60-char string produces
        // exact anchored error format and 50-char truncation.
        'validation-runtime-enum/**/*.spec.ts',
        // Var Manager: cycle gates + rename preservation. Editing runs
        // through the inspect modal; type change is create-only.
        'variable-self-reference/**/*.spec.ts',
        'variable-rename-preserves/**/*.spec.ts',
        // Guard: a VM rename must refactor every
        // reference (node template/expression fields, setter target key, setter
        // per-key expression/template values) and leave the old name nowhere.
        'variable-rename-refactor/**/*.spec.ts',
        'variable-create-cycle/**/*.spec.ts',
        'variable-edit-cycle-blur/**/*.spec.ts',
        // V-VMGR-06-EDIT: edit scalars / complex / expression
        // variables in the inspect modal, rename-with-refactoring, Save gates.
        'var-inspect-edit/**/*.spec.ts',
        // V-TABLE-VALIDATION: the shared table-schema
        // validator gates Save across the Visual + Code views (invalid cell,
        // duplicate/unexpected/missing column, structure), plus the
        // issue-list popover, Visual-switch locks and Compare pill.
        'table-type-validation/**/*.spec.ts',
        // V-VMGR-CURRENT-EDIT: runtime variable override
        // while paused/stopped - literal + expression overrides propagate
        // downstream, survive a partial re-run, are discarded by a full Run All,
        // the run-while-editing conflict dialog.
        'var-current-edit/**/*.spec.ts',
        'var-current-edit-exec/**/*.spec.ts',
        // V-VMGR-TEMPLATE: a template value kind renders
        // lazily on reference - a Log reading `greeting` realizes the {{ }}
        // template to "Hello Ada!", plus the metric + unreferenced
        // computed-var guards on the live inspect watcher.
        'template-variable/**/*.spec.ts',
        // V-VMGR-03: Variable Manager panel functional behavior
        // (lazy expressions, count summaries, Run All clearing, terminal-state
        // edit/delete unlock).
        'var-manager-panel/**/*.spec.ts',
        // V-VMGR-CREATE: the create modal end-to-end -
        // create each type/kind, in-Function input/output param declaration,
        // type-switch confirm, numeric + nested precision round trips, the
        // secret-visibility model, and the nested-element-type save/inspect
        // regression. Seeds + saves its own Tests via POST /tests.
        'variable-create-modal/**/*.spec.ts',
        // The one variable window for Add and Edit (VMGR-106..114): rename,
        // retype, Set to null, Current values before a run and while paused,
        // Function inputs and outputs, and tables with column types.
        'variable-window/**/*.spec.ts',
        // Runtime secret masking: composed-expression leak
        // matrix across console/WS/variables/report (secret-masking), the
        // system/suite/regression raw-injection proofs, and the FE secret-editor
        // guards
        // (drop-consent gate, write-only empty editors, watcher re-lock).
        'secret-masking/**/*.spec.ts',
        'secret-namespace-injection/**/*.spec.ts',
        'secret-ui-guards/**/*.spec.ts',
        // Encrypt-at-rest: canary A (secret test variable)
        // and canary B (profile credential) sealed as wave:enc:v1: envelopes on
        // disk, run computes on the real unsealed values (slice proofs),
        // masking holds over sealed storage, and the tracked-execution record
        // persists no profile-alias credentials (return-trip leak fix).
        'secrets-at-rest/**/*.spec.ts',
        // Unified secret UI: the save-path round-trip guard
        // (a masked re-save never clobbers the stored sealed secret; the run
        // keeps the real bytes) plus the edit-modal-has-no-secret-toggle guard.
        'secret-save-roundtrip/**/*.spec.ts',
        // The two new secret carriers - a Variable Setter
        // secret literal (sealed at rest, unsealed at run) and a plugin output
        // bound to a secret variable - both masking on every output surface.
        'secret-new-carriers/**/*.spec.ts',
        // Per-block Secret masking (REQ-3.1.3.16): two HTTP
        // blocks hit the cookie simulator - one keeps Set-Cookie masked
        // (registered + scrubbed run-wide, container still viewable), one
        // reveals it via unmasked_secret_fields (distinct token flows visible).
        'secret-field-masking/**/*.spec.ts',
        // Leak-proof truth-gate: one canary family planted in
        // every storable carrier, swept for cleartext across on-disk storage,
        // logs, a caught secret-bearing error, WS, the step-debugger paused state,
        // the report and every export flow (test / profile / GV / backup) in its
        // safe (mask / encrypted) mode.
        'secret-leak-canary/**/*.spec.ts',
        // Controlled secret reveal: the per-block
        // tri-state run-output control (reveal / system / mask) + run-start &
        // pre-block warnings, and the scope-based system reveal toggles' runtime
        // effect (run_output log reveal, test_variables panel + watcher, shared_
        // variables system + profile surfaces) proven end-to-end by flipping each flag.
        'secret-reveal-controls/**/*.spec.ts',
        // The "Mask specific fields" per-field reveal -> re-mask
        // cycle driven through the config modal (unmask Set-Cookie, run cleartext,
        // re-mask, reset console, run masked).
        'secret-field-cycle/**/*.spec.ts',
        // V-FN-PALETTE-FUNCTIONAL: drag "New Function" -> local Function node;
        // open Functions Library modal, drag a published card -> shared Function
        // reference. Validation gate after each save.
        'function-palette/**/*.spec.ts',
        // V-CANVAS-FN-*: drill-down + inner-canvas editing
        // + schema editor coverage, plus their guards. Each
        // function-canvas-* folder seeds its own fixture via POST /tests.
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
        // Function runs end-to-end, scoped, and Halt / scope-fail / Try/Catch propagation
        // (the propagation specs read block states from GET /workbench/session).
        'function-execution/v-canvas-fn-exec-01.spec.ts',
        'function-execution/v-canvas-fn-run-scoped-01.spec.ts',
        'function-execution/v-canvas-fn-halt-01.spec.ts',
        'function-execution/v-canvas-fn-assert-scope-fail-01.spec.ts',
        'function-execution/v-canvas-fn-assert-in-trycatch-01.spec.ts',
        // V-FN-*: publish + detach lifecycle transitions
        // end-to-end. Each spec self-seeds via POST /tests + POST /functions
        // and exercises the kebab Publish to Library / Make Local... flow.
        'function-lifecycle/**/*.spec.ts',
        // V-FN-*: full functional coverage of
        // edit-mode lifecycle, per-instance version pinning, paradigm changes
        // (bare-name input access, Var Setter rules), runtime variable
        // visibility, scoped Run/Debug, library modal flows, and nested
        // function variations.
        'edit-mode-publish/**/*.spec.ts',
        'edit-mode-drop/**/*.spec.ts',
        // V-FN-*: edit-mode publish - three-option
        // outcome + no-forced-save + undo (edit-mode-publish-outcomes), genuine
        // edit-failure surfacing (edit-mode-edit-failure), the recursive-walker
        // guards EDIT_MODE_DRAFT_IN_BODY + SELF_REFERENTIAL_FUNCTION
        // (fn-composition-guards), the self-nest drop guard (fn-self-ref-drop),
        // dig-in observability (fn-dig-in-observability), and bump-gating +
        // tooltip + semver (edit-mode-publish-version-gate).
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
        // Step a Function as a single-egress
        // composite (Step Over / Into / Skip / Repeat) + function-scope Halt
        // (passed/skipped continue, failed caught by Try/Catch).
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
        // V-FN-VAL-*: canonical/recursive/path-aware Function
        // validation. PATHS (path rows + drill nav), VER (top-level missing-
        // version gate), SCHEMA (pinned-contract binding/type checks), FIXALL
        // (Fix All gated on the auto-fixable subset).
        'fn-validation/**/*.spec.ts',
        // V-FN-VER-REMEDIATE-01: missing-version config-
        // modal live-clear + save badge-clear.
        'fn-version-remediate/**/*.spec.ts',
        // V-FN-SCOPE-LOCALVAR-01: a body referencing its
        // own declared local variable saves clean (array-shaped scope).
        'fn-scope-localvar/**/*.spec.ts',
        // V-FN-FROMLIB-01: a library-dropped instance
        // exposes its From-library link (canvas-drop originalLibraryName stamp).
        'fn-from-library-drop/**/*.spec.ts',
        // Function import/export round-trip,
        // unproduced-output non-blocking save/run/publish, and the
        // edit-mode publish version dropdown (advance-from-latest + skip-taken).
        'functions-import-export/**/*.spec.ts',
        // Function import safety - id-collision
        // detection/resolution (rename mints a fresh uuid, original untouched;
        // skip reports the UUID reason; overwrite targets the colliding id) and
        // history-preserving overwrite (available = existing UNION imported).
        'function-import-safety/**/*.spec.ts',
        'fn-output-validation/**/*.spec.ts',
        'fn-publish-version/**/*.spec.ts',
        // Edit-mode "Publish and set New" refreshes
        // the re-pinned instance's resolved I/O so the config modal renders the
        // new version's input + output contract.
        'fn-edit-publish-contract/**/*.spec.ts',
        // V-FN-VIEW-*: standalone run/edit/publish from
        // the read-only library View, plus the guards
        // (fold, renav, no-dirty, dirty-switch). The View edited-run guard
        // (v-fn-view-run-edited) lives here too.
        'function-view/**/*.spec.ts',
        // Run Unsaved State: run-current per entry point,
        // the edit-mode close nag, the client-side edit-mode lifecycle, draft
        // publish version match, and the single-prompt dirty-switch guard.
        'run-current/**/*.spec.ts',
        'edit-mode-close-nag/**/*.spec.ts',
        'edit-mode-lifecycle/**/*.spec.ts',
        'fn-draft-publish-version/**/*.spec.ts',
        'dirty-switch-single-prompt/**/*.spec.ts',
        // Quick Insert insert modes end-to-end +
        // config sheet lifecycle (dirty-delete confirm, close gate, drill
        // read-only).
        'quick-add/**/*.spec.ts',
        'sheet-lifecycle/**/*.spec.ts',
        // The selected-block keys (Enter configures,
        // Ctrl+Enter opens a Function), and the canvas keyboard surviving a
        // sheet close.
        'block-keys/**/*.spec.ts',
        // Undo / redo change history (REQ-5.2.1.24): drill reconciliation,
        // lifecycle pick-out, integrity and gating, and the nested run-current
        // matrix.
        'undo-redo-drill/**/*.spec.ts',
        'undo-redo-lifecycle/**/*.spec.ts',
        'undo-redo-integrity/**/*.spec.ts',
        // Undo across the gated parameter rows of the Kubernetes write Blocks.
        'undo-redo-k8s-write/**/*.spec.ts',
        'run-current-nested/**/*.spec.ts',
        // A Profile's own fields drive a real plugin through a real run: an ssh
        // profile opens a session on sshd, two http profiles reach http-echo and
        // the tls-lab mTLS listener, and a kubernetes profile built from the
        // eight explicit fields connects the kwok cluster.
        // Needs the sshd, http-echo, tls-lab and kwok services up
        // (functional/profile-drives-plugin/README.md).
        'profile-drives-plugin/**/*.spec.ts',
      ],
      use: desktopChrome,
    },
  ],
})
