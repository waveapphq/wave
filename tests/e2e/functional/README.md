# Functional Tests

End-to-end tests that exercise real backend execution - importing fixtures, running workflows, and verifying results against the actual API. These tests are **separate from visual tests** and use their own Playwright config.

## Running

```bash
# From the root of the clone
./scripts/ci-playwright-local.sh

# Run specific specs, with paths relative to tests/e2e/:
./scripts/e2e-targeted-local.sh functional/http-plugin/v-plugin-http-execution.spec.ts
./scripts/e2e-targeted-local.sh functional/assert-control/v-ctrl-assert-functional.spec.ts
```

Both scripts start the backend, the frontend and the service stack in their containers.

External-protocol suites (HTTP, SSH, Remote Exec) target the real compose service stack - `http-echo`, `sshd`, `http-target`, and friends - managed by `scripts/e2e-stack.sh` and documented in `../services/README.md`.

**Important**: Functional tests are NOT registered in `playwright.config.ts`. They run exclusively via `playwright.functional.config.ts`. The CI script (`ci-playwright-local.sh`) runs them as a separate step.

## Execution Order

Two projects, declared in this order and with NO Playwright `dependencies` between them:

1. **`functional-destructive`** - Backup/restore and global variables (reset DB, CRUD operations)
2. **`functional-workflow`** - Workflow execution + import/export tests (fixture-based, non-destructive)

A dependency is deliberately absent: it would force `--shard` to replicate every destructive test into every shard. Isolation comes from per-worker state instead - each worker runs against its own backend stack with its own store root (`WAVE_STORAGE_BASE_PATH`), and a container shard runs a single worker against a single stack. Backup-restore also resets the database in `afterAll` to leave a clean state.

## Test Categories

### Workflow Execution Tests (fixture-based)

These tests follow a common pattern: load a `fixture.json` containing a pre-built workflow, import it via `POST /tests`, navigate to the workbench, run the workflow, and verify node statuses + console log output.

| Suite | Directory | Nodes | Coverage |
|-------|-----------|-------|----------|
| [HTTP Plugin](#http-plugin) | `http-plugin/` | 47 (23 HTTP + 23 Log + 1 Start) | All 7 HTTP methods, 14 parameters, 6 output variables, SSL, redirects, retries, timeouts |
| [HTTP Plugin Rework](#http-plugin-rework) | `http-plugin/` (`rework-fixture.json`) | 17 (8 HTTP + 6 Log + File I/O + 2 Try/Catch) | Auth helpers + masking, GET-with-body, form/multipart/file body modes, file response mode (artifact + sha256), max_size cap, combined DEBUG trace, dynamic-map Content-Type conflict |
| [Log Plugin](#log-plugin) | `log-plugin/` | 14 (1 VarSetter + 13 Log) | All 5 severity levels, expression messages, type coercion, arithmetic |
| [Variable Setter](#variable-setter) | `variable-setter/` | 11 (2 VarSetter + 7 Log + Start + End) | Literal scalar types, expression resolution, variable propagation |
| [Delay Control](#delay-control) | `delay-control/` | 11 (4 Delay + 1 VarSetter + 6 Log) | Literal/expression durations, output bindings, sequential delays, 1ms boundary |
| [XML Parser](#xml-parser) | `xml-parser/` | 14 (4 XML Parser + 10 Log) | Combined/individual mode, type coercion, error handling, namespace queries |
| [Assert Control](#assert-control) | `assert-control/` | 29 (1 VarSetter + 13 Assert + 15 Log) | The six types other than table and their comparison operators, groups, expressions, single/split branching; null and table checks are in [Checks on Null](null-checks/README.md) |
| [Recipe Authoring via MCP](#recipe-authoring-via-mcp) | `recipe-authoring/` | 22 (7 constructs + VarSetter/Break/Halt + 12 Log) | Live MCP validate/create tools, rejoin-edge persistence guard, canvas sanity, branch/loop/parallel/assert execution, and block geometry: a recipe-built block is stored at the width its name needs, the longest names stop at the maximum, a hand-set size survives an amend while a generated one is regenerated, and the recipe readback carries no geometry |
| [K8s Connect](k8s-connect/README.md) | `k8s-connect/` | Per-spec, built by `helpers/k8s-nodes.ts` | K8s Connect against the real kwok cluster: the credential matrix (static token, service-account token request, client certificate), the run-token denial, a tunneled Connect with `tls_server_name` and a CA with verification on, the session reveal, and the value-editor guard |
| [K8s Read](k8s-read/README.md) | `k8s-read/` | Per-spec, built by `helpers/k8s-nodes.ts` from a case table | Get / Events / Logs / Top against the real kwok cluster plus a fault-injecting stub: the full option matrix under the README's option ids - the shared session, timeout, namespace and impersonation set, kind resolution across 23 Kinds, the selectors and output formats, log tail / since / timestamps / previous, pod and node metrics, the read failures, and a read cut short by its Parallel lane's time limit staying silent once the cluster's held answer is finally due |
| [K8s Exec](k8s-exec/README.md) | `k8s-exec/` | Per-spec, built by `helpers/k8s-nodes.ts` from a case table | Exec / Script / Copy over kwok's real exec channel: container selection, working directory, exit codes and stderr, stdin-fed interpreters, and file transfer in both directions |
| [K8s Write](k8s-write/README.md) | `k8s-write/` | Per-spec, built by `helpers/k8s-nodes.ts` from a case table | Apply / Delete / Scale / Rollout against the real kwok cluster: the chained create-update-scale-rollout-delete workflow, the If exists and Ignore not found gates, cluster-scoped writes, the Secret leak canary in cleartext and base64 form, the RBAC denial with the limited token, and a manifest that is only a document separator refused before any write |
| [K8s Tunnel](k8s-tunnel/README.md) | `k8s-tunnel/` | Per-spec, built by `helpers/k8s-nodes.ts` | K8s multi-cluster: an Apply/Get ConfigMap round trip through an SSH tunnel to the unpublished `kwok-internal` cluster, interleaved with a second direct session to the published `kwok` cluster in one workflow |
| [K8s Remote Exec](k8s-remote-exec/README.md) | `k8s-remote-exec/` | Per-spec, built by `helpers/k8s-nodes.ts` | The K8s read Blocks inside a Remote Execution container on the real `sshd` host: Connect, Get, Events, Logs and Top reach `kwok` by its stack name and bind results materialized from the remote worker, a Secret read masks in both forms on the remote path, a Connect through the plain-HTTP path-prefixed `k8s-gateway` works, and a Connect the plugin refuses fails before any request. The write and exec Blocks ride here too: Apply, Delete, Scale and Rollout Status run inside the container in one roundtrip read back off the cluster, a Secret written twice - once from the form, once from a manifest reading a secret variable - masks in both forms on every surface the run is recorded on, the exec channel's streams and exit codes cross back intact with a cluster refusal recorded, and one file makes the round trip from the SSH host into a pod and back while an `artifact://` path on the same Block is refused before the run. Two host diagnoses ride here too: a host that prints a notice ahead of every command is never told it has no Python, and a host whose interpreter answers the probe and then cannot run the worker surfaces the host's own reason |
| [Helm](helm/README.md) | `helm/` | Per-spec, built by `helpers/k8s-nodes.ts` from a case table | The six Helm Blocks driving a REAL helm against the real kwok cluster and a real chart repository: the install / read / upgrade / rollback / uninstall lifecycle with the Reuse and Reset values rules and a superseded-revision read, the test hooks including a failed hook that still fills Result and Logs, Atomic removing an install that cannot come up, the chart-repository credentials and trust in all four combinations, the Uninstall options, the Blocks running on the remote execution host against its own different helm major and through an SSH tunnel to the unpublished cluster, a kubernetes profile as the only source of the session, the cluster's own impersonation refusal, a recipe authored through the live MCP endpoint compiling to the same Test a person would build, the Repository Password leak sweep, and which helm the WAVE server itself runs |
| [Block Timeout](block-timeout/README.md) | `block-timeout/` | Per-spec, built by `helpers/k8s-nodes.ts` from a case table | The Timeout row as a real wall-clock bound: every K8s Block (Connect, Get, Events, Logs, Top, Apply, Delete, Scale, Rollout, Exec, Script, Copy) and every Helm Block (Install, Upgrade, Rollback, Uninstall, Test, Status) is given one second against a fault-injecting cluster that holds every answer for ten, and each one dies at its typed second with the sentence that names it. A Get under Record and continue raises the same sentence, because a request timeout is a dependency failure rather than a cluster answer. Helm's Cleanup Timeout is the one row that widens the bound: with Atomic on it is added to Timeout and the message names the sum, with Atomic off it buys nothing, and a recorded Helm timeout finishes amber with Reason Timeout. Each run is held under a wall-clock ceiling the family defaults could not have met |
| [Shell Blocks](shell-blocks/README.md) | `shell-blocks/` | Per-spec JSON fixtures, one Test per case, each ending in a tokened bookend Log | Shell Script and Shell Exec on the WAVE server: arguments in row order after a reorder, a script file picked with Browse and a missing one recorded, Input Variables reaching a child process, typed and secret variable exports with an unset export and a replaced exit handler, non-zero exits and the script's own EXIT trap, a timeout, a Stop (also inside Parallel), a leftover job and both pattern stops each ending the whole process tree, Log Output levels and secret rules, the Working Directory default and Browse into the run's artifacts, `WAVE_TESTDATA_DIR` and `WAVE_ARTIFACTS_DIR` with protected Test Data, the server's environment inherited whole, Shell Exec shell choice and flags, the config sheet rules and a binding that follows a variable rename. Two remote cases on the real `sshd` host: a Stop during a remote block and a dropped session each leave this run's worker gone. Needs `sshd` and `http-target` |
| [Nesting](nesting/README.md) | `nesting/` | Per-cell graphs built by `helpers/nesting-graph.ts`, one Test per cell, each ending in a tokened bookend Log | Every container kind (If/Else, Switch/Case, split Assert, For, For Each, While, Wait Until, Parallel, Try/Catch, Remote Execution, Function) inside every slot kind of every container (176 placement cells): the inner sub-flow runs the expected number of times, untaken branches never run, the inner and outer `then` successors run in order, the verdict passes with no node left running and no ERROR line, a variable written at the innermost depth reads at the top, and validation agrees with the run. Needs `sshd` |
| [For Control](for-control/README.md) | `for-control/` | Fixture flows plus canvas-built For loops | Count and range mode, literal and expression settings, a timeout caught by a Try/Catch, a disabled For as a pass-through, a null count running zero times with its then lane and index 0, and range mode failing on a null start, end or step with the field named |
| [For Each Control](for-each-control/README.md) | `for-each-control/` | Fixture flows plus canvas-built For Each loops | Arrays, maps, tables, literal lists, empty collections and a timeout; a null or empty collection runs zero times at the top level and inside a For with its then lane, index 0 and the item kept; a null item reaches the body as null; a non-collection fails the run |
| [Profile Drives Plugin](profile-drives-plugin/README.md) | `profile-drives-plugin/` | Per-suite JSON fixtures, profiles filled or built per run | A Profile's own fields configure a real plugin and the workflow runs: an ssh profile driving `ssh-session-open` against `sshd`, an http profile driving `http-client` against `http-echo` and mutual-TLS `tls-lab`, and a kubernetes profile driving `k8s-connect` against kwok. Every plugin parameter the profile schema covers is bound to the profile, never typed into the Block. `v-profile-ssh-passphrase-functional.spec.ts` builds an ssh profile on the Profiles page with a passphrase-protected OpenSSH key, opens the session SFTP runs on from it, catches a wrong passphrase, and proves the profile Type picker and filter offer no `sftp` |
| [Ping](ping/README.md) | `ping/` | Two fixtures: 21 blocks on the WAVE server (15 of them Ping), plus a remote flow | Real ICMP echo requests, on the WAVE server and on a remote host inside a Remote Execution body: loopback and the gateway answered, every Advanced row (IPv4, TTL, Don't fragment, a held Source address, Packet size 0), a silent host recorded, all four Pass when rules passing and failing, the whole-block Timeout, an unresolvable host, forced IPv6 with no address, a foreign Source address, Fail the block inside a Try/Catch, and Log Output on and off. The remote spec adds the R locus badges, a compose service only the remote host resolves, the remote host's own loopback, Record and continue on the remote host, and the same Host unresolvable from WAVE. Needs `sshd` and `netcat-target`, and unprivileged ICMP open to the container's user |
| [SFTP](sftp/README.md) | `sftp/` | Per-spec JSON fixtures (one flow built on the canvas), each ending in a tokened bookend Log | The SFTP block on real OpenSSH servers: Upload, Download, List, Stats, Delete, Move and Create folder; wildcards, folder trees and merge, the Max files / Max size (MiB) refusals, read-only Test Data, a closed session and a server with no SFTP subsystem, Timeout and Stop leaving no partial file, a three-hop chain, a session through an SSH tunnel with Strict host keys, and the chrooted SFTP-only `dropzone` account. Each spec works in its own `e2e-<spec>-<uuid>` server folder and removes it. Needs `sshd` and `sshd-no-sftp`; the tunnel spec dials `sshd-no-fwd` by service name |
| [Network SSH Hosts](network-ssh-hosts/README.md) | `network-ssh-hosts/` | Four JSON fixtures (Strict, Accept New, Disabled and a palette-placed SSH Session Open) | WAVE's trusted SSH hosts list built through Settings > Network > SSH Hosts and proven by real SSH runs against `sshd`: Detect from host, Paste lines with a bad line and a changed key, trash and Mass Action Delete, Save and Cancel, Accept New first contact, the Save conflict, Lock, the Disabled default stamped into a newly placed block, the policy kept in the config file, the all-or-nothing Save, and an unreadable list stopping Strict and Accept New |
| [Network Certificates](network-certificates/README.md) | `network-certificates/` | One JSON fixture (three verify-on HTTP blocks in Try/Catch) | Certificate trust built through Settings > Network > Certificates against the tls-lab chain ports: built-in only fails, an added intermediate or root completes the chain, a block's own CA is exclusive, the Add Certificate dialog's private key and Already added states, the WAVE host's store source, and the trust line in the run console |
| [Network Certificates Consumers](network-certificates-consumers/README.md) | `network-certificates-consumers/` | One JSON fixture (PostgreSQL, SQL Server, OpenSearch, K8s Connect, Helm) | The blank-CA trust rule on every non-HTTP consumer: fails with the built-in list only, passes once the signing CAs are Additional Certificates, the trust line names the count, and PostgreSQL with TLS off makes a plain connection |
| [Network Proxy](network-proxy/README.md) | `network-proxy/` | Five JSON fixtures (HTTP routes, HTTP through the login proxy, K8s + OpenSearch, Helm, Shell Exec) | The Proxy setting built through Settings > Network > Proxy and proven by HTTP, K8s, OpenSearch and Helm runs against targets only the proxy can reach; the Proxy Setup and Proxy Blocks page behavior |
| [Instance Config](instance-config/README.md) | `instance-config/` | One JSON fixture (a run that prints a secret); spawned backends, each with its own config file and data folder | This WAVE's own settings in its config file: the startup refusals and their exact lines, settings read back after a restart, `WAVE_LOG_LEVEL` winning at the next start, staged Save and Cancel on General and MCP Server, the file keeping its comments and hand edits, a read-only file refusing the Save, the Unsaved changes prompt, the MCP restart and exposure confirmation, and the password strength score |
| [Network Settings Pages](network-settings-pages/README.md) | `network-settings-pages/` | No fixture (hosts and certificates seeded through the API) | The Network pages' frame and guards: the app shell and scrolling, the list-page pagination, Cancel and Save enablement, the Unsaved changes prompt on leaving, and the Network group's open or closed state |
| [Settings Sections](settings-sections/README.md) | `settings-sections/` | No fixture | The shared section error with Try Again on General and WAVE Server, the Data folder row and its copy button, and a Secret Masking switch held until Save |
| [Checks on Null](null-checks/README.md) | `null-checks/` | No fixture; each spec builds its checks in the config sheet on a blank `zz-` Test, or imports a Test generated from the same row shape | The check blocks on a null value and on typed values: the operator list of every type in every check block, every operator on a null and a held value, a null compare-to value failing each block, the four table checks, and Single-mode Asserts where `length equals` reads a typed number and array `contains` compares typed items |
| [Secret Function Parameters](fn-secret-params/README.md) | `fn-secret-params/` | No fixture; `zz-` Tests with Local Functions and library Functions seeded per test | A Function input or output marked secret: the secret input has no default, is a credential field on the Function Block and masks whatever is passed in; the secret output seeds Secret ticked and its default is sealed at rest and masked in the UI, MCP reads, exports and backups |
| [Secret UI Guards](secret-ui-guards/README.md) | `secret-ui-guards/` | No fixture; a `zz-` Test seeded per test | The "Edit Protected Value?" question answered with the keyboard keeps or drops the stored secret; the Save warning before a Block Save makes plain variables secret, on the HTTP Request and Function Block outputs tables, the Shell Script and Python export rows and the Variable Setter rows: exact texts, every name listed, Escape does nothing, Cancel saves nothing, new and already secret variables need no warning, and a second binding never makes a secret plain |
| [Secrets at Rest](secrets-at-rest/README.md) | `secrets-at-rest/` | `fixture.json` + `profile-http.json`; the Function-local spec seeds `zz-` Tests and library Functions per test | Secret Test variables, profile credentials and Function-local secrets (Local and library Functions) are sealed on disk, runs compute on the real values, and the console, session reads, reports, exports, backups, MCP reads and execution records never hold them in clear |
| [Enum Function Inputs](fn-enum-input/README.md) | `fn-enum-input/` | No fixture; `zz-` Tests with Local Functions and a library Function seeded per test | Enum inputs created from allowed values typed by their Value Type (String, Integer, Float), with no Type column; a wrong-typed value is refused in the window; the stored list keeps its types (`[1, 2]`); Secret and Create enum exclude each other; an enum input has no default; the call window offers them as a select on Local and library Functions; a pick is stored as its typed literal and reaches the body typed; a pick the allowed values no longer hold is refused on Save; a variable or expression outside the list fails the run when the call starts; a recipe binding outside the list is refused; a number typed into a literal-mode integer input is the saved binding |
| [Function Creation Windows](function-canvas-schema/README.md) | `function-canvas-schema/` | `fixture.json` for the schema spec; the window specs seed `zz-` Tests with Local Functions | The Add menu's input / output / local windows and the Test variable window share one body (field order, Kind, Visual / Code, a value area that fills the window and is whole at the smallest size and on a short screen); each Add opens its own window, cascaded, creating into the Function it was opened in; duplicate names are refused |
| [Function Output Validation](fn-output-validation/README.md) | `fn-output-validation/` | No fixture; `zz-` Tests with Local Functions built in the UI or seeded, and library Functions seeded per test | An unwritten output is a non-blocking warning; every call of a Function prints a run-console WARN per input no block uses and per output no block writes, for Local, library and nested Functions, also when the call is refused or its body fails, once per call in a loop |
| [Required Function Inputs](fn-required-input/README.md) | `fn-required-input/` | No fixture; `zz-` library Functions and Tests seeded per test | The input window locks a Required input's default to null for every type; an old default is dropped on save; running a Local or library Function alone uses the Current value set before the run, also right after Reset, and with no value stops and names the input; a library Function Block bound to null fails the run |
| [Variable Create Modal](variable-create-modal/README.md) | `variable-create-modal/` | No fixture; each spec seeds a `zz-` Test (blank or with one Local Function) | The Variable Manager creation windows: every type and kind, complex editors, element types, precision, secrets, and Set to null in the Variable, Function local, Input and Output windows (created null, stored as a plain null, null after a reload and in a run) |
| [Variable Manager Panel](var-manager-panel/README.md) | `var-manager-panel/` | `fixture.json`, `fixture-live-table.json`, `fixture-virtualized.json`; the reference specs seed a blank `zz-` Test per test | The Variable Manager panel: post-run row state, live complex values, the virtualized list, the Unused badge at every place a block or variable reads a name (Test scope and inside a Function), renames that follow every name site, and delete dialogs that count readers and name cleared bindings |
| [Function Parameter Persistence](function-canvas-param-persist/README.md) | `function-canvas-param-persist/` | `fixture.json` (one empty Local Function); the null and block-fields specs seed their own `zz-` Tests | Inputs, outputs and Function locals survive Save and a reload; created null with Set to null, each of every type stays null through Save, a reload and Publish to Library, and a run reads null in the body or in the bound caller variable; Function Block inputs open as their literal widget, show an unset default in gray in both modes, store nothing until a value is given, keep typed list and map items as numbers, and preview a table as its rows' JSON |
| [Table Runtime Forms](table-runtime-forms/README.md) | `table-runtime-forms/` | Per-test JSON fixtures; the filter-on-null spec seeds a `zz-` Test with one CSV block | Both runtime forms of a table reach every consumer (For Each, Variable Setter, CSV and Excel shaping, schema source), and `table.filter()` typed in Variable Setter rows reads a null cell by the check rule on every operator |

### Import/Export Tests

API-driven tests for data import/export. Some use `fixture.json` for test data, some create data via API.

| Suite | Directory | Coverage |
|-------|-----------|----------|
| [Test Import/Export](#test-importexport) | `import-export/` | YAML/JSON export, secret values modes (mask/encrypted/plaintext), bulk ZIP, YAML/JSON/ZIP import |
| [Environment Import/Export](#environment-importexport) | `import-export-env/` | YAML/JSON export, bulk ZIP, conflict resolution (rename/overwrite/skip), validation |
| [Profile Import/Export](#profile-importexport) | `import-export-profile/` | Env ID-to-name replacement, secret values modes, env name resolution, type fixup, conflicts |
| [Export and Import Secrets](export-secrets/README.md) | `export-secrets/` | The Secret values choice on exports; a secret WAVE cannot open or a masked placeholder, brought in by any import or a backup restore, is stored null, owed, and its block sends nothing; a masked restore never replaces a stored secret |

### API/UI CRUD Tests

Tests that exercise API and UI lifecycle operations without workflow execution.

| Suite | Directory | Coverage |
|-------|-----------|----------|
| [Backup & Restore](#backup--restore) | `backup-restore/` | Full backup/restore lifecycle, selective backup, the periodic schedule, the network settings round trip |
| [Global Variables](#global-variables) | `global-variables/` | API CRUD, UI CRUD, persistence, all 7 types, backup integration |

---

## Workflow Execution Tests

### HTTP Plugin

**Directory**: `http-plugin/`
**Files**: `fixture.json`, `v-plugin-http-execution.spec.ts`, `v-http-remote-proxy-choice-functional.spec.ts`

47-node linear workflow (43 active + 4 disabled) covering every HTTP Client parameter and output variable. HTTPS endpoints target the published `http-echo` stack service (`127.0.0.1:9449`, rewritten to the shard gateway in container mode via `injectHttp`).

**Fixture variables** (overridden at load):
- `backend_port` - backend port for the /health nodes
- `run_key` - per-run key isolating the shared service's /retry and /timeout state
- `ca_cert_pem` - WAVE Test CA PEM (`CA_CERT_PEM`) for the verify-on node

**Methods tested**: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS

**Parameter coverage**:

| Parameter | Default | Custom |
|-----------|---------|--------|
| `url` | All nodes | - |
| `method` | GET (health, redirects, retries) | POST, PUT, DELETE, PATCH, HEAD, OPTIONS |
| `body` | GET, HEAD, OPTIONS (no body) | POST, PUT, DELETE, PATCH (JSON body) |
| `headers` | Most nodes (none) | POST (Content-Type), Multi Headers (3 custom) |
| `query_params` | Most nodes (none) | PUT (env=test), Multi Params (3 params) |
| `timeout` | 30s (most nodes) | 5s (delay), 2s (timeout), 1s (timeout no retry) |
| `verify_ssl` | true (HTTPS With CA) | false (HTTPS Skip Verify) |
| `ca_cert` | Most nodes (none) | PEM content (HTTPS With CA) |
| `allow_redirects` | true (redirect chain) | false (no redirect) |
| `max_redirects` | 10 (default) | 3 (custom), 1 (exceed - disabled) |
| `retry_count` | 0 (most) | 3 (retry), 2 (custom codes), 1 (timeout) |
| `retry_delay` | 1s (default) | 0.5s (retry) |
| `retry_backoff_factor` | 2 (default) | 1 (no exponential) |
| `retryable_status_codes` | ["502","503","504"] | ["429"] (custom) |

**Output variables**: `status_code`, `body`, `headers`, `content_type`, `response_time`, `final_url`

**Disabled fail nodes** (4, need try-catch to enable): max redirects exceeded, SSL failure, timeout no retry, connection refused.

### HTTP Plugin Rework

**Directory**: `http-plugin/`
**Files**: `rework-fixture.json`, `v-plugin-http-rework-functional.spec.ts`

Multi-node chain (REQ-3.4.1.4) run against an in-spec
recording HTTP server on an ephemeral 127.0.0.1 port (`base_url` variable
patched at import - byte-deterministic and per-spec, kept off the shared stack
by design). Proves server-side wire truth AND console evidence:

- Auth section (Bearer / Basic / API key) composes the header, arrives in clear at the server, masks everywhere in the console
- GET-with-body reaches the server (ordinary Content-Type header row allowed in text mode)
- form mode sends url-encoded pairs; multipart streams a file part from `artifact://` plus a text part; text-only multipart still carries a boundary
- literal-vs-expression map/part values: a literal `{{ }}` is sent verbatim, an expression evaluates on the wire (int arrives as its string, empty as "")
- generated body Content-Type wins over an expression-map Content-Type on the wire
- file response mode: sha256/size outputs match the served bytes, artifact listed by the session artifacts API and visible in the workbench artifacts sheet; file-mode `max_size` cap truncates to the prefix
- `max_size` (body mode) cap: exact WARN message, node passes, size output capped
- combined multiline DEBUG trace entries (connect / exchange with masked `Authorization` / timing), 1-redirect GET = 4 entries, via `data-copy-text`
- name-masking of credential-catalog headers (incl. short values) in the trace; the `headers` output keeps raw values
- dynamic-map Content-Length fails the node before sending with the exact execution-time message (caught by try-catch)
- missing file source fails the node with the exact `File not found: <source>` message (caught by try-catch)

### HTTP TLS Matrix

**Directory**: `http-tls/`
**Files**: `fixture-versions.json`, `fixture-ciphers.json`, `fixture-mtls.json`, `v-http-tls-versions-functional.spec.ts`, `v-http-tls-ciphers-functional.spec.ts`, `v-http-tls-mtls-functional.spec.ts`

Real handshakes against the `tls-lab` nginx service: mutual-TLS client identity across TLS 1.0-1.3, protocol-version pins vs the version-restricted listeners, cipher pin / reorder / TLS 1.3 family / explicit-zero, and legacy `http2` load-parity. Dual proof: the listener JSON echoes the negotiated `ssl_protocol`/`ssl_cipher`/`client_dn`, and the DEBUG connect trace binds the same facts.

### Network Proxy

**Directory**: `network-proxy/`
**Files**: `fixture-http-routes.json`, `fixture-http-login.json`, `fixture-k8s-opensearch.json`, `fixture-helm.json`, `fixture-shell-env.json`, `v-network-proxy-functional.spec.ts`, `v-network-proxy-pages-functional.spec.ts`

Settings > Network > Proxy (REQ-4.7.14) against the `tinyproxy` pair. `v-network-proxy-functional.spec.ts` saves each proxy through the Proxy Setup page and proves the route with a run against a compose-DNS-only target that only the proxy can resolve: the HTTP block on WAVE setting and on Off, Exact and Regex entries in both list modes, the login proxy over plain HTTP and HTTPS-CONNECT with the password masked, the 407 inside a Try/Catch, K8s Connect and K8s Get against `kwok-internal`, an OpenSearch search against `opensearch`, a Helm Install from `tls-lab`, a Shell Exec that sees no proxy variable, and the setting in the stack's config file with a sealed password. `v-network-proxy-pages-functional.spec.ts` covers the Proxy Setup and Proxy Blocks pages where no request has to travel: the messages under the fields, when Save is offered, what a Save keeps, and the Blocks lists. Details: [network-proxy/README.md](network-proxy/README.md).

**http-echo service**: The published HTTPS endpoint of the compose stack (host `127.0.0.1:9449`, HTTP health `:9450`; same image as the internal `http-target`). Endpoints: `/health`, `/echo`, `/delay/:seconds`, `/status/:code`, `/retry`, `/timeout`, `/redirect/:count`, `/redirect-to`, `/cookie`, `/secret-payload`. Serves the WAVE Test CA leaf from `simulators/https/certs/` (the image source), so `CA_CERT_PEM` verifies it. Stateful endpoints (`/retry`, `/timeout`) are keyed - always use per-run keys.

### Log Plugin

**Directory**: `log-plugin/`
**Files**: `fixture.json`, `v-plugin-log-execution.spec.ts`

14-node linear chain testing all log severity levels and message expressions.

**Variables**: `user_name` (string), `record_count` (integer), `success_rate` (float), `is_enabled` (boolean)

**Features**: Literal messages at INFO/DEBUG/WARN/ERROR/FATAL, default level (omitted = INFO), string/integer/float/boolean expression coercion, computed expressions, arithmetic expressions, all-vars concatenation proof.

### Variable Setter

**Directory**: `variable-setter/`
**Files**: `fixture.json`, `v-plugin-varset-execution.spec.ts`

11-node chain testing literal and expression variable assignments.

**Variables**: `str_var`, `int_var`, `float_var`, `bool_var` (literals), `computed_str`, `computed_sum` (expressions)

**Features**: Literal scalar assignment (string, integer, float, boolean), per-variable expression resolution, variable propagation to downstream blocks, multiple variables per setter, type preservation, `variableExpressionKeys` wire format.

### Delay Control

**Directory**: `delay-control/`
**Files**: `fixture.json`, `v-control-delay-execution.spec.ts`

11-node chain testing delay execution with timing verification.

**Features**: Basic delay (200ms), output bindings (planned_duration_ms, actual_duration_ms), actual >= planned timing assertion, expression-based duration from variable, sequential delays with cumulative timing, minimal 1ms boundary, system log messages ("Delay: waiting X ms", "Wait complete").

### Wait Until Control

**Directory**: `wait-until-control/`
**Files**: `fixture.json`, `fixture-fail-scope.json`, `v-ctrl-wait-until-functional.spec.ts`, `README.md`

Four permutations chained through their `then` lanes in one workflow, plus a second
workflow for the failing timeout (a failed wait is the whole session's outcome, so
"session not failed" and "session failed" cannot be proven in the same run).

**Real service**: the retry lanes poll `http-echo` `/retry?key=<per-test>&fail_count=N&fail_status=418`,
so a wait that passes only passes because the polled system changed its answer between rounds.

**Features**: Retry lane running once per round until the condition holds (`passed` / `elapsed`
bindings), informational timeout (block shown amber, session untouched, WARN line), failing
timeout with Fail Current Scope (block shown red, failed session, ERROR line, the flow stops at the wait), Watch mode
on an already-true condition costing less than one check interval, and a disabled wait
cascade-skipping its lane.

### XML Parser

**Directory**: `xml-parser/`
**Files**: `fixture.json`, `v-plugin-xml-execution.spec.ts`

14-node workflow testing XML parsing with combined/individual modes.

**Features**: Combined mode (first_item, item_count, success), individual mode with type coercion (float price, integer qty, boolean is_active), error handling (bad XPath produces errors, good query succeeds), namespace queries with prefix.

### Assert Control

**Directory**: `assert-control/`
**Files**: `fixture.json`, `v-ctrl-assert-functional.spec.ts`

29-node workflow testing the six assertion types other than table, comparison operators, and branching modes.

**Variables**: `str_var` (string), `int_var` (integer), `float_var` (float), `bool_var` (boolean), `arr_var` (array), `map_var` (map)

**Assertion types tested**:

| Assert Node | Mode | Assertions | Expected |
|-------------|------|-----------|----------|
| Single All Pass | single | str_var equals "hello world" AND int_var equals 42 | Pass, continues |
| Single Fail Continue | single | int_var equals 999 | Fail, continues (single mode) |
| String Operators | single | contains, starts_with, ends_with, does_not_contain | Pass |
| Regex Match | single | matches_regex `^hello.*world$` | Pass |
| Numeric Comparisons | single | greater_than, less_than, greater_or_equal, less_or_equal, not_equals | Pass |
| Boolean Check | single | is_true | Pass |
| Array Operators | single | contains 2, is_not_empty, length_equals 3 | Pass |
| Map Operators | single | has_key "key", is_not_empty | Pass |
| Expression Assert | single | `int_var > 40 and len(arr_var) == 3` | Pass |
| Group OR Logic | single | Group OR (int_var==999 OR int_var==42) AND bool_var is_true | Pass (42 matches) |
| Ref Expression | single | int_var equals `40 + 2` (reference_is_expression=true) | Pass |
| Split Pass | split | bool_var is_true | Pass branch taken |
| Split Fail | split | int_var equals 999 | Fail branch taken |

**Branching verification**: Split Pass routes to pass branch (Log "split-pass-branch"), unreachable fail branch (Log "split-pass-unreachable") does NOT execute. Split Fail routes to fail branch (Log "split-fail-branch"), unreachable pass branch does NOT execute.

### Recipe Authoring via MCP

**Directory**: `recipe-authoring/`
**Files**: `recipe.yaml`, `mcp_recipe_client.py`, `mcp_tool_client.py`,
`v-mcp-recipe-functional.spec.ts`, `v-mcp-recipe-lifecycle-functional.spec.ts`,
`v-mcp-recipe-geometry-functional.spec.ts`,
`v-mcp-recipe-choice-words-functional.spec.ts`,
`v-mcp-recipe-null-params-functional.spec.ts`, `README.md`

Import-free: the 22-node workflow is created at runtime through the live MCP
`create_test_from_recipe` tool (listener enabled until-restart via `PUT /mcp/settings`,
one-shot python client run through the backend poetry env, listener disabled after).

**Recipe constructs**: if/else, three-branch if/elif/else, for (count 3), while with
labeled break, parallel (2 branches), split assert with halt on fail. Switch/Case is
covered by `v-mcp-recipe-lifecycle-functional.spec.ts`, which runs it end to end.

**Verified**: `validate_recipe` dry-run persists nothing; created test passes platform
validation; every rejoin edge survives persistence (if/else -> `ingress_1`, if/elif/else ->
`ingress_1`/`ingress_2`, parallel -> `ingress_1` - `_fix_multi_edges`
regression guard); canvas renders all nodes/edges with no overlapping bounds; execution
takes exactly the expected branches (log markers counted), `retries == 2` after the
labeled break, session outcome passed.

**Block sizing**: `v-mcp-recipe-geometry-functional.spec.ts` pins the widths the
compiler stores and the canvas draws - 338 for a 28-character name, 360 for a
51-character one that would otherwise keep growing, 160 for an unlabeled block,
and 348 when an amend renames a block whose width was compiler-generated. A
hand-set width and height survive the amend; the recipe readback carries no
geometry.

**Null parameters**: `v-mcp-recipe-null-params-functional.spec.ts` covers a secret
input refused with a default, `default: null` meaning no default, `expr:` / `template:`
outputs that run evaluated, the kind form refused on an input, and `is_null` with no
`value_type` taking the declared type on every type.

---

## Import/Export Tests

### Test Import/Export

**Directory**: `import-export/`
**Files**: `fixture.json`, `helpers.ts`, `v-export.spec.ts`, `v-import.spec.ts`

**Export**: Single YAML/JSON export, secret values modes (mask -> `********`, encrypted -> sealed envelope, plaintext -> cleartext), bulk ZIP for 2+ tests.
**Import**: Single YAML/JSON import, ZIP archive import (multiple tests).

### Environment Import/Export

**Directory**: `import-export-env/`
**Files**: `helpers.ts`, `v-env-export-import.spec.ts`

**Export**: Single YAML/JSON, bulk ZIP. No secrets parameter (environments have no secrets).
**Import**: Single YAML/JSON, conflict resolution (rename/overwrite/skip), validation (ok/conflict statuses), ZIP round-trip, new UUID assignment.

### Profile Import/Export

**Directory**: `import-export-profile/`
**Files**: `helpers.ts`, `v-prof-export-import.spec.ts`

**Export**: YAML/JSON with env ID-to-name replacement, secret values modes, bulk ZIP.
**Import**: Env name-to-ID resolution, invalid type fixup (defaults to 'custom'), unresolvable env name handling, conflict resolution (rename/skip), ZIP round-trip.

---

## API/UI CRUD Tests

### Backup & Restore

**Directory**: `backup-restore/`
**Files**: `v-backup-functional.spec.ts`, `v-backup-failure-functional.spec.ts`, `v-backup-upload-functional.spec.ts`

No fixture file - seeds data via admin API, then tests backup/restore lifecycle.

**Tests**:
1. **Full backup/restore lifecycle**: Seed data via API, create YAML backup (deflate), reset database, upload backup in Settings UI, verify preview, execute restore, verify entities via API
2. **Selective backup (JSON)**: Backup only tests + environments, restore, verify only selected types restored
3. **Periodic schedule**: saved, read back and turned off through Save; the nine staged-Save cases are listed in `backup-restore/README.md`
4. **Failure is stated** (`v-backup-failure-functional.spec.ts`, LIST-26 / LIST-11): a backup file the server refuses is reported on screen with no preview and nothing to restore from, and a restore whose request fails states the failure, shows no completion panel, leaves no progress bar behind and changes no stored data
5. **The file is sent once** (`v-backup-upload-functional.spec.ts`, BACKUP-5): `V-BACKUP-UP-1` to `-5` - one `POST /api/backup/uploads` per picked file, every preview and the restore carry `upload_id` and no file, an upload the backend no longer knows is sent again by the page with no error, and the kept upload is dropped on Clear, on another pick and when the page is left

### Global Variables

**Directory**: `global-variables/`
**Files**: `v-global-var-functional.spec.ts`

No fixture file - tests global variable CRUD operations directly against the API and Settings UI.

**Tests**:
- **API CRUD**: GET empty, POST/GET round-trip, POST replaces all, DELETE single, DELETE all, all 7 WAVE types round-trip
- **UI CRUD**: Add via UI + save + API verify, delete via UI + save, cancel reverts changes, persistence across page reload
- **Backup integration**: system_variables checkbox in entity selector, Select All includes system_variables

---

## Adding a New Functional Test

1. Create a directory under `functional/` (e.g., `functional/my-plugin/`)
2. If testing workflow execution: create `fixture.json` with the pre-built workflow
3. Create the spec file following the pattern: load fixture, import via API, run, verify logs + node statuses
4. Register the suite in `playwright.functional.config.ts`: add a `'<dir>/**/*.spec.ts'` glob to the `testMatch` array of the `functional-workflow` project (or `functional-destructive` if it resets the DB), with a short comment above it. There is NO auto-discovery - an unregistered directory matches no project, runs in no CI shard, and reports nothing
5. Do NOT add the test to `playwright.config.ts` - functional tests are separate
6. Update this README with the new suite's entry
