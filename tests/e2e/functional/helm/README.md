# V-HELM: the six Helm Blocks

End-to-end proof for Helm Install, Helm Upgrade, Helm Rollback, Helm Uninstall,
Helm Test and Helm Status against a REAL helm executable, a REAL Kubernetes API
(kwok) and a REAL chart repository, covering REQ-3.5.3.1 to REQ-3.5.3.6 and
REQ-3.4.1.5. The design the six Blocks are proved against is HELM-1 to HELM-11.

WAVE ships no helm and reimplements none of it: a Block runs the helm found
where the Block runs. That is the fact this suite exists to prove, so every
case here drives a real helm process. Two different majors are exercised on
purpose - helm 4 on the WAVE side, helm 3 on the remote execution host - so a
flag that behaves differently across them cannot pass unnoticed.

Workflows are built in TypeScript from the node factories in
`helpers/k8s-nodes.ts` through the leg tables and `buildHelmFixture` in
`cases-helm.ts`. The case table IS the checklist. Nothing is a checked-in
fixture document.

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`).
  This suite uses five services:
  - `kwok` - the published cluster (127.0.0.1:9460 -> in-stack `kwok:6443`),
    static tokens, a real control plane, and two Stages that complete or fail a
    bare helm test-hook Pod.
  - `kwok-internal` - the same cluster with no published port, reachable only
    through an SSH tunnel. HL-8 uses it.
  - `tls-lab` - besides its TLS matrix, two static chart-repository listeners:
    9463 plain HTTP with no auth, 9464 HTTPS with basic auth. The fixture charts
    and their index are baked into the image.
  - `sshd` - the remote execution host, carrying a pinned helm 3.21.4 at
    `/usr/local/bin/helm`, a different major from the runner's helm 4.2.4.
  - `oci-registry` - an OCI registry on 9482, HTTPS on the WAVE Test CA, behind
    a basic login, holding the one chart `charts/wave-demo` 0.1.0. Nothing is
    pushed at run time. HL-15 uses it.
- Backend and frontend running (standard functional-stack ports) and the shared
  execution environment (`ensureEnvironment` creates it if absent).
- helm must exist on the machine the backend runs on. The E2E runner image
  carries it; a developer running these specs by hand needs helm 3.13 or newer
  on PATH.
- All credentials are checked-in TEST-ONLY material: the kwok static tokens and
  PKI, the WAVE Test CA, the chart repository's basic-auth pair and the OCI
  registry's login. The specs read them through `helpers/config.ts`.

### The chart-repository ports are not rewritten for you

Every other stack endpoint reaches container shards through the `injectHttp`
import option, which rewrites a fixture's host. The chart-repository ports sit
outside the range that option matches, so a chart URL MUST be built from the
`CHART_REPO_*` constants in `cases-helm.ts` at fixture-build time. Hardcode one
and it will pass locally and fail in CI.

### Editing anything under `tests/e2e/services/` needs a full image rebuild

The charts, the kwok Stages and the two helm binaries are copied into their
images at BUILD time. Editing one and running `scripts/e2e-stack.sh up` leaves
the old image serving, and the specs then fail against a stale chart or a
missing Stage in a way that reads like a plugin bug. The sequence is
`scripts/e2e-stack.sh build`, then `down`, then `up --wait`.

## Steps

1. `seedRun(request, 'minimal')` (`helpers/k8s-seed.ts`) creates the run's own
   uniquely-named namespaces and returns them with a `teardown`. This suite
   seeds no objects: everything an assertion describes was put there by helm.
2. Build the workflow from the file's leg table with `buildHelmFixture`, import
   it via `POST /tests`, and confirm `POST /tests/{id}/validate` reports zero
   errors (`importValidateAndNavigate`).
3. Run it in the workbench and harvest the console on the run's bookend marker.
4. Assert on the bound variables (`GET /workbench/session/.../variables`), the
   Block statuses on the canvas, and the plugin's own console lines.
5. Release names are unique per run and every release is uninstalled, in the
   workflow or through `uninstallQuietly` in teardown. Shards share the stack,
   so nothing here may depend on global cluster state.

## Case ids

| Case | File | What it proves |
|------|------|----------------|
| HL-1 | `v-helm-lifecycle.spec.ts` | Install from the plain chart repository fills the release row and the Status scalar; Helm Status reads the same row back; Uninstall removes it; a Status afterwards records NotFound |
| HL-2 | `v-helm-lifecycle.spec.ts` | Upgrade raises the revision; Reuse Values keeps an install-time value and Reset Values drops it; Rollback with an empty Revision returns the previous chart; Status by Revision returns the superseded revision |
| HL-3 | `v-helm-test-hooks.spec.ts` | Helm Test reports one row per hook with its Phase and, with Logs on, every test pod's log. A failed hook fails the Block, and under Record and continue STILL fills Result and Logs |
| HL-4 | `v-helm-atomic.spec.ts` | Atomic on an install that cannot come up records Timeout, leaves Result and Status empty, and removes the release, so the name is free again |
| HL-5 | `v-helm-repo-auth.spec.ts` | Chart-repository credentials and trust: the right password with the CA deploys, a wrong password is Forbidden, a missing CA is Unreachable, and turning verification off deploys |
| HL-6 | `v-helm-uninstall-options.spec.ts` | Ignore Not Found, Keep History (the release stays readable and reads `uninstalled`) and Cascade |
| HL-7 | `v-helm-remote.spec.ts` | The Blocks run on the remote execution host against its own helm 3, with Helm Path empty and set, and name that host in the missing-helm message |
| HL-8 | `v-helm-tunnel.spec.ts` | The Blocks work against a cluster reachable only through an SSH tunnel |
| HL-9 | `v-helm-profile.spec.ts` | A kubernetes profile is the only source of the session's credentials, and the Blocks ride it |
| HL-10 | `v-helm-impersonation.spec.ts` | Impersonate User makes the cluster refuse in its own words, and nothing is left behind |
| HL-11 | `v-helm-mcp.spec.ts` | A recipe authored through the live MCP endpoint compiles to the same Test a person would build, and that Test really installs the chart |
| HL-12 | `v-helm-secrets.spec.ts` | A Repository Password never appears in cleartext in the console, the stream, the report, either export or the store |
| HL-14 | `v-helm-host.spec.ts` | Which helm a Block runs on the WAVE server: PATH by default, an explicit path executed as given, and the local missing-helm message, which names no host |
| HL-15 | `v-helm-oci.spec.ts` | A chart in an OCI registry: the Block's own Repository Username and Password with the lab CA deploy it and Helm Status reads it back; with no login the install is Forbidden in helm's own words, also while a login for that registry is stored on the WAVE host |
| FIELD-13 | `v-field-helm-set-null-functional.spec.ts` | A null `set` entry (literal null or an expression giving None) is passed as `key=null`: the release's user values hold `marker: null`, the chart default `chart-default` is gone from the manifest and the Deployment's pod template, and `replicaCount` beside it still applies; a control install without the null keeps the default |

HL-13 is deliberately absent: the version-floor message needs a helm older than
3.13, and no such helm exists in the stack. It is covered by the unit tests with
a fake helm.

## Validation criteria

- Every case asserts on Result, Status, Success and Reason VALUES, never on
  helm's prose, except where the case is about an exact message WAVE itself
  writes (the two missing-helm sentences) and HL-15, whose subject is the
  sentence a person reads when an OCI pull carried no login.
- Never assert that helm's stderr is clean. Real helm 4 prints a deprecation
  line on every Atomic run.
- The release row is asserted whole - its columns, their types and every cell.
  Chart and App Version are part of that: helm's own release read does not carry
  the chart, and WAVE composes it from helm's release history, so an empty cell
  is a regression, not an absence.
- A recorded failure means Success false, the cluster's or helm's own sentence,
  a classified Reason, empty outputs in the chosen shape, an amber Block and a
  passed run. A raised failure means the Block and the run fail.

## V-HELM-OCI (HL-15) - `v-helm-oci.spec.ts`

A chart in an OCI registry is pulled with the Block's own Repository Username
and Password and never with a login stored on the WAVE host (REQ-3.5.3.1,
REQ-3.5.3.6, HELM-5).

### Prerequisites

- `oci-registry`, `kwok` and the backend's own helm, as above. The chart
  reference is `OCI_CHART_REF` and the login is `OCI_REGISTRY_USER` /
  `OCI_REGISTRY_PASSWORD` from `helpers/config.ts`; port 9482 is outside the
  `injectHttp` range, and the reference is mode-correct as built.
- The lab CA (`CA_CERT_PEM`) rides every install as the Repository CA
  Certificate, so no Network setting is changed.

### Steps

1. `seedRun(request, 'minimal')` creates the run's namespace; each test uses
   release names of its own.
2. Test 1 builds four legs with `buildHelmFixture`: Helm Install of the OCI
   chart 0.1.0 with the registry login, Helm Status of that release, the same
   Helm Install with no Repository Username and Password under Record and
   continue, and Helm Uninstall. It imports, validates and runs the Test.
3. Test 2 puts a Shell Exec Block in front of one leg. The Block runs
   `helm registry login` for the registry with the backend's own environment
   (the login lands where a person at the WAVE host would store it), then
   `helm show chart` for the same reference with no login passed, and binds
   the chart's `name:` line. The leg is the Helm Install with no Repository
   Username and Password under Record and continue.
4. After test 2, `afterEach` runs a one-Block Test headless (`POST /executions`)
   whose Shell Exec runs `helm registry logout`, requires it to pass, and
   deletes that Test.

### Validation

- **Login and CA:** Result is the one-row release table (Revision 1, Status
  `deployed`, Chart `wave-demo-0.1.0`, App Version `1.0.0`), Status reads
  `deployed`, and the console holds
  `Installed release '<release>' as revision 1`.
- **Read back:** Helm Status binds the same row and Status, and logs
  `Read release '<release>' at revision 1`.
- **No login:** Success false, Reason `Forbidden`, Error exactly
  `INSTALLATION FAILED: failed to perform "FetchReference" on source: GET "https://<host>:9482/v2/charts/wave-demo/manifests/0.1.0": basic credential not found`
  (helm 4 prints no 401 number here), an empty Status, the release table with
  no row, an amber Block, and exactly one WARN line
  `Helm Install failed (Forbidden): <error>`. The run passes.
- **Stored login is live:** the Shell Exec Block ends success and its bound
  stdout is exactly `name: wave-demo`, so the WAVE host's own helm reaches the
  chart on the stored login alone.
- **Stored login is ignored:** in that same run the Helm Install with no
  Repository Username and Password reports the same Reason, the same Error,
  an empty Status, no release row and exactly one WARN line.
- **Cleanup:** the logout run ends `passed`; the deployed release is removed
  in the workflow (`Uninstalled release '<release>'`) and every release name is
  swept again in `afterAll`.
