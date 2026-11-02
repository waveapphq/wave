# V-PLUGIN-K8S-CONNECT-FUNCTIONAL: K8s Connect

End-to-end proof that the K8s Connect plugin authenticates against a REAL
Kubernetes API (kwok), emits the K8s Session, and keeps its credentials
sealed on every surface (REQ-5.1.1, REQ-3.4.1.5, REQ-4.5.1, REQ-4.6.3).

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`).
  The specs use three services:
  - `kwok` - the published kwok cluster (127.0.0.1:9460 -> in-stack 6443),
    static tokens `wave-admin-token` (cluster-admin) and `wave-limited-token`
    (view-only), service account `wave-tests` in `default`.
  - `kwok-internal` - an identical cluster with NO published port, reachable
    only through an SSH tunnel (the tunneled-access proof).
  - `sshd` - the main OpenSSH host (:9445) the tunnel leg rides.
- All credentials are checked-in TEST-ONLY material: the static tokens
  (`tests/e2e/services/kwok/tokens.csv`) and the kwok PKI
  (`tests/e2e/services/kwok/pki/` - CA plus a `system:masters` client pair).
  The specs read them via `helpers/config.ts` and inject them into the
  fixture variables at load time; fixture JSON never commits PEM or token
  values.
- Fixtures carry the literal `https://127.0.0.1:9460` API URL; the
  `injectHttp` import option rewrites it for container-shard mode. The
  tunneled fixture instead builds its URL from the tunnel's resolved local
  port and pins `tls_server_name: kwok-internal`.

## Steps

1. Load a fixture, inject the token/PEM material into its variables, import
   via `POST /tests`, and validate (zero errors).
2. Open in the workbench, select the shared E2E environment, and Run.
3. Assert on the console log markers, node execution statuses, the session
   variables API, the WS event stream, the generated report, and the raw
   on-disk store.

## Validation

- **Credential matrix (`fixture-matrix.json`):** one run chains six Connect
  legs - admin bearer token with CA verification ON, client-certificate pair,
  token + certificate together, the view-only token, anonymous (no credential;
  `/version` is readable by default), and `acquire_run_token` for service
  account `wave-tests`. Every leg logs `k8sconn-<leg> ver=v1.33`, the plugin
  logs `Connected to Kubernetes v1.33` and
  `Run token for service account 'wave-tests' granted until`, and every
  Connect node reports `success`.
- **Secret canary (same run):** the admin token appears NOWHERE in cleartext -
  console, WS (`log:` + `variable:` topics), report.html, or the on-disk
  store - and the default-secret `session` output masks to `********` in the
  session variables API.
- **Run-token denial (`fixture-denied.json`):** `acquire_run_token` under the
  view-only token fails with the plugin's real
  `Could not get a run token for service account '...` error, caught by a
  Try/Catch (workflow PASSED, error map bound and logged, the Connect node is
  NOT success).
- **Tunneled cluster (`fixture-tunnel.json`):** SSH session -> tunnel
  (local_port 0) -> Connect to `https://127.0.0.1:{lport}` with
  `tls_server_name: kwok-internal` and CA verification ON reads v1.33 through
  the tunnel - a cluster WAVE cannot reach directly.
- **Session reveal (`fixture-reveal.json`):** two Connects saved with the
  `session` output deliberately UNCHECKED (`outputSecretFields: []`) surface
  the kubeconfig JSON in cleartext; its effective `cipher_suites` list is a
  non-empty array that narrows when the TLS range is pinned to 1.3, and the
  token INSIDE the revealed session stays scrubbed (byte-form registration).
- **Token editor guard (`fixture-editor.json`):** typing the token in the
  value editor and dismissing with Escape raises the Unsaved-changes dialog;
  Keep Editing preserves the draft and dialog-Save commits it; the committed
  token rides into the run's emitted session.

## Isolation

- `importFixtureTest` uniquifies every test name; runs execute in the
  per-worker workbench session and the worker fixture frees it afterwards.
- The specs only READ from the cluster (`/version`) and mint short-lived
  tokens for the dedicated `wave-tests` service account - no cluster-scoped
  mutations, and the `restricted` namespace is never written.
- The static tokens are read-only shared state; nothing rotates or
  invalidates them.
