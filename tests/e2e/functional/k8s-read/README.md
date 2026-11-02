# V-K8S-READ: the four K8s read Blocks

End-to-end proof for K8s Get, K8s Events, K8s Logs and K8s Top against a REAL
Kubernetes API (kwok) plus a fault-injecting stub, covering the option matrix
defined under "Option ids" below
(REQ-5.1.1, REQ-3.3.2.1, REQ-3.3.2.3, REQ-3.3.5.4, REQ-3.4.1.5, REQ-4.5.6,
REQ-3.1.2.4).

The design the four Blocks are proved against is K8SREAD-1 to K8SREAD-11,
K8SREAD-20 and K8SCON-1 to K8SCON-6.

Each option row is a case-table entry in a `cases-*.ts` file, and each case is
built into workflow nodes by `helpers/k8s-nodes.ts`. The case table IS the
checklist. One small checked-in golden fixture per Block keeps the shape of a
generated leg reviewable; everything else is generated.

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`).
  The specs use two services:
  - `kwok` - the published kwok cluster (127.0.0.1:9460 -> in-stack 6443),
    static tokens `wave-admin-token` (cluster-admin) and `wave-limited-token`
    (view-only), the standing node `kwok-node-0`, the checked-in pod-log files,
    the `wavegadgets` custom resource, the opt-in Stages and `metrics.k8s.io`.
  - `k8s-stub` - the fault injector (127.0.0.1:9461), not a cluster. It answers
    discovery successfully and faults only the resource read, which is what kwok
    cannot be made to do on demand.
- Backend and frontend running (standard functional-stack ports) and the shared
  execution environment (`ensureEnvironment` creates it if absent).
- All credentials are checked-in TEST-ONLY material: the kwok static tokens
  (`tests/e2e/services/kwok/tokens.csv`), the kwok PKI
  (`tests/e2e/services/kwok/pki/`) and the stub CA
  (`tests/e2e/services/k8s-stub/certs/`). The specs read them through
  `helpers/config.ts`; fixture JSON never commits PEM or token values.
- Fixtures carry the literal `https://127.0.0.1:9460` and
  `https://127.0.0.1:9461` URLs; the `injectHttp` import option rewrites them for
  container-shard mode.

### Editing anything under `tests/e2e/services/kwok/` needs a full image rebuild

The manifests, Stages, log files, `kwok.yaml` and `tokens.csv` are copied into
the image at BUILD time and applied from inside the container at startup.
Editing one and running `scripts/e2e-stack.sh up` leaves the old image serving
and the cluster exactly as it was - the specs then fail against stale
permissions, stale log text or a missing Stage, and it reads like a plugin bug.
The sequence is `scripts/e2e-stack.sh build`, then `down`, then
`up --wait kwok`. The rebuild recreates the cluster from scratch, so every
runtime object any suite created is wiped and only the baked bootstrap returns.

## Steps

1. `seedRun(request, <profile>)` (`helpers/k8s-seed.ts`) creates the run's own
   uniquely-named namespaces and the profile's object set, then returns the
   names and a `teardown`.
2. Build the workflow from the file's case table with `helpers/k8s-nodes.ts`,
   import it via `POST /tests`, and confirm `POST /tests/{id}/validate` reports
   zero errors (`importValidateAndNavigate`).
3. Open the test in the workbench, pick the shared environment, and Run
   (`startRun` / `finishRun` in `helpers/k8s-run.ts`).
4. Read the console between the run's bookend markers, the node execution
   statuses off the canvas, and the bound outputs in one session-variables call.
5. `test.afterAll` calls `run.teardown()`.

The console is always harvested against a bookend marker, never with a bare read
after a node status flips: the status goes terminal a beat before the console
renders its tail. `helpers/k8s-run.ts` does this; do not hand-roll it.

## Option ids

Every leg carries the ids of the option rows it proves - in the case table, in
the console marker it stamps, and in its test title - so a failure names the row
it broke. The families:

| Family | What it covers |
|---|---|
| `S-01`..`S-21` | Options all four read Blocks share: `session`, `timeout`, the namespace override, `all_namespaces`, the impersonation pair and `on_error` |
| `G-01`..`G-67` | K8s Get. `G-01`..`G-33` resource type, the 23 Kinds and kind resolution; `G-34`..`G-48` and `G-53`..`G-55` Search by, the selectors, Output Format and namespace scope; `G-56`..`G-67` the failure options |
| `E-01`..`E-40` | K8s Events. `E-01`..`E-13` object scoping, Object Type and Object Kind; `E-14`..`E-29` the event filters (type, reason, window, max) and Output Format; `E-30`..`E-40` the zero values, the four timestamp fields and the read failures |
| `L-01`..`L-32` | K8s Logs. `L-01`..`L-10` pod, container and `previous`, where `L-03` and `L-04` are the pre-run gate's refusal of an empty Container, since WAVE never picks one (K8SREAD-20); `L-11`..`L-26` `tail_lines`, `since_seconds`, `timestamps` and `max_bytes` with their zero values; `L-27`..`L-32` namespace scope and the read failures |
| `T-01`..`T-26` | K8s Top. `T-01`..`T-14` scope, Select by, `include_containers` and namespace scope; `T-15`..`T-21` the values the cluster reports for pods and nodes; `T-22`..`T-26` the read failures |

### Local ids

The five families above cover the option matrix. A second set of ids labels
contracts the matrix has no row for, so each one is named for what it covers
rather than numbered. They are local to this suite and mean nothing outside it.

| Local id | Where it rides | What it covers |
|---|---|---|
| `RESULT-TYPE` | `cases-get.ts`, `v-k8s-get-options.spec.ts` | The Result output declares the type that Output Format and Search by produce: Map by name gives a map, Map listed gives an array, Table gives a table, JSON and YAML give a string. Binding a Table Result to a map variable is refused |
| `KIND-PICKER` | `fixture-events-golden.json`, `v-k8s-events-options.spec.ts` | Events names the involved object through Object Type plus the same grouped searchable Kind picker Get uses, and a read driven through the picker returns the fixture events |
| `TABLE-KIND` | `cases-events.ts`, `v-k8s-endpoint-faults.spec.ts` | Table on a kind the cluster will not print a table for is refused with the sentence that names Map, JSON or YAML instead, and a kind it does print a table for still renders normally |
| `READ-WORDING` | `cases-get.ts`, `v-k8s-get-failures.spec.ts`, `v-k8s-endpoint-faults.spec.ts` | A failed read is worded as a read, never as a failed update: it carries the cluster's own text, names the object once, and an error body with no message ends in `(HTTP {status})` with no dangling colon |
| `ONE-WARN` | `cases-get.ts`, `v-k8s-get-failures.spec.ts` | A Record-and-continue failure writes exactly one WARN line, paints the Block amber, and leaves the run passed |
| `EMPTY-SESSION` | `v-k8s-get-failures.spec.ts` | A `session` pointing at a declared but EMPTY variable says so, instead of reporting a missing parameter |
| `DIRTY-CANVAS` | `v-k8s-config-refused.spec.ts` | The pre-run gate checks the canvas that is about to run, not the last saved copy, and a valid dirty canvas still runs with no false block |
| `FN-BODY` | `v-k8s-config-refused.spec.ts` | The same gate reaches a half-filled read Block inside a Local Function body, on the run route and at save |
| `GET-KIND`, `GET-KIND-CUSTOM`, `EVENTS-KIND-CUSTOM`, `GET-KIND-DEFAULT`, `E-07-DEFAULT` | `cases-refused.ts`, `v-k8s-config-refused.spec.ts` | The Kind fields the matrix has no row for: Get's `kind_custom` while Resource Type is Custom and Events' `object_kind_custom` while scoping with Object Type Custom are holes, each with its negative; Get's `kind` (Resource Type Default) and Events' `object_kind` (E-07, scoping) are not holes: left out, the run takes their default `Pod` |
| `EVENTS-KIND-RESOLVE` | `cases-events.ts`, `v-k8s-events-options.spec.ts` | Events resolves Object Kind the way kubectl does, so `Pod`, `pods` and `po` all name the same object and return the same events |
| `LOGS-SHAPE-STRING`, `LOGS-SHAPE-ARRAY`, `LOGS-SHAPE-TABLE` | `cases-logs.ts`, `v-k8s-logs-options.spec.ts` | The Logs output declares the type Output Format and Timestamps produce together: String is the text the container wrote, Array is one entry per line, and the same Array value with Timestamps on is a TIME and MESSAGE table split at each line's first space, so a message carrying spaces stays whole. Binding that table to an array variable is refused |
| `TOP-DEFAULT-ALL` | `cases-top.ts`, `v-k8s-top-options.spec.ts`, `cases-refused.ts`, `v-k8s-config-refused.spec.ts` | Select by opens on All, so a Top Block that never wrote it measures everything and its Name row is not a hole |
| `NO-MANAGED-FIELDS` | `v-k8s-get-options.spec.ts`, `v-k8s-events-options.spec.ts` | `metadata.managedFields` is stripped from every object a read hands back, in Map, JSON and YAML alike |
| `STOPPED-READ-SILENT` | `cases-stopped.ts`, `v-k8s-read-stopped.spec.ts` | A read whose Parallel lane runs out of time is painted stopped and stays quiet: its own console line never appears, not while the run settles and not once the cluster's held answer is finally due, and it binds nothing |

`RESULT-TYPE`, `KIND-PICKER`, `TABLE-KIND`, `READ-WORDING` and `ONE-WARN` ride
a console marker or a checked-in fixture that a spec matches on, so renaming one
means changing it on both sides in the same edit.

## Which file proves which rows

| File | Run | Option rows |
|---|---|---|
| `v-k8s-get-options.spec.ts` | R1 | G-01..G-37, G-40..G-48, G-53..G-55, S-01, S-05, S-08, S-10, S-11 |
| `v-k8s-get-failures.spec.ts` | R1 (split) | G-32, G-56..G-62, S-20, S-03 |
| `v-k8s-events-options.spec.ts` | R2 | E-01..E-05, E-08..E-29, E-32..E-35, E-37..E-39, S-03 |
| `v-k8s-logs-options.spec.ts` | R3 | L-01, L-05..L-09, L-11..L-13, L-15..L-17, L-19..L-25, L-27..L-30 (L-29 refused at save as an unknown setting), S-09, S-04 |
| `v-k8s-top-options.spec.ts` | R4 | T-01..T-06, T-08..T-17, T-22..T-25 |
| `v-k8s-impersonation.spec.ts` | R5 | S-13..S-17, L-31 |
| `v-k8s-endpoint-faults.spec.ts` | R6 | S-06, G-64..G-67, T-26, L-32 |
| `v-k8s-error-modes.spec.ts` | R7 | S-18, S-19, S-21, G-39, G-63, S-07, E-30, E-31, L-14, L-18, L-26 |
| `v-k8s-config-refused.spec.ts` | R8 | S-02, L-02, L-03, L-04, G-38, E-06, T-07 refused; E-07 and Get's `kind` take their default; plus the Local Function body route |
| `v-k8s-read-stopped.spec.ts` | R9 | STOPPED-READ-SILENT |

The Get sweep is split across two files only for the runtime budget: one run
carrying the sweep and the eight empty-shape cells lands over the 60 s a
functional file is allowed.

`v-k8s-get-failures.spec.ts` states one caveat in the leg title itself: G-60's
401 arises from discovery, not from the read, because every authenticated
identity on this cluster passes the default `system:discovery` grant.

### Rows this suite does NOT prove

They cannot be produced against kwok, so they are covered by backend unit tests
and are named here so nobody mistakes their absence for a gap:

- `E-36` - an event with no timestamp of any kind; no real cluster writes one.
- `E-40` - a list in a missing namespace answers 200 with an empty list, so
  there is no failure to observe.
- `L-10` - `previous` on a container that never restarted; kwok serves the
  previous log file where a real kubelet answers 400.
- `T-18`..`T-21` - impossible on a shared single-node cluster.
- `S-12` - splits per Block into G-53, E-29 and T-13 and is asserted there.
- A node that is in the cluster but absent from the metrics response: kwok bakes
  one node and it reports as soon as any pod runs on it, so the mismatch cannot
  be produced here.

## Seeding and teardown

`seedRun` takes one profile per file - never a shared object set, because a
Deployment, a Job or a PVC in the namespace adds control-plane events of its own
and breaks every event count.

| Profile | Used by | Creates |
|---|---|---|
| `get` | `v-k8s-get-options` | one object of every listable kind across the two namespaces, plus a run-suffixed StorageClass and PersistentVolume |
| `events` | `v-k8s-events-options` | the kubelet-event and crash-loop Stage pods, a Deployment and a ReplicaSet, four hand-written Events with different timestamp fields, and one Event in the second namespace; waits for the Stage events to land |
| `logs` | `v-k8s-logs-options` | a two-container pod (`app` + `sidecar`), a solo pod whose container name falls through to `pod.log`, and one pod in the second namespace |
| `top` | `v-k8s-top-options` | annotated and unannotated usage pods in both namespaces, then polls `metrics.k8s.io` until all four have a row |
| `impersonation` | `v-k8s-impersonation` | one namespace with a Secret, a usage pod and the kubelet-event Stage pod |
| `minimal` | `v-k8s-get-failures`, `v-k8s-error-modes` | a namespace and one pod - every leg fails on purpose |

`v-k8s-logs-options.spec.ts` creates two further pods of its own inside the
run namespace: one for the `recent` container and one for the `unicode`
container, because kwok keys those log files by CONTAINER name and the seeding
helper does not make them.

`v-k8s-endpoint-faults.spec.ts`, `v-k8s-config-refused.spec.ts` and
`v-k8s-read-stopped.spec.ts` seed nothing: the first and the third talk only to
the stub, the second starts no execution except one deliberate control run.

Teardown deletes the run's namespaces (which cascades everything inside them)
and the two cluster-scoped names the `get` profile creates. Nothing else on the
cluster is touched.

## Isolation on the shared stack

- Every namespaced object lives in the run's own `wave-e2e-<suffix>` namespace,
  and the two cluster-scoped names carry the same suffix, so parallel shards
  never collide.
- The static tokens and the impersonation subjects are read-only shared state;
  nothing rotates or invalidates them.
- Node metrics are the one exception: `kwok-node-0` is a single node across
  every shard and its usage sums every pod on it. `v-k8s-top-options` asserts
  node usage for presence, shape and units only, never for a value. Node
  capacity and allocatable come from the checked-in manifest and ARE exact.
- `v-k8s-top-options` runs alone: the metrics API only starts serving a pod
  35-90 s after it is created, so the profile overlaps that wait with seeding.
  The wait itself is `waitForPodMetrics` in `helpers/k8s-seed.ts`, which polls
  for up to 150 s with no lower bound. Never hand-roll a shorter poll.
- Each spec imports its own Test under a unique name and asserts only on that
  run's console, node statuses and session variables. No server state is reset.

## Related visual specs

The four config sheets are proved separately, with no cluster and no execution:
`tests/e2e/visual/canvas/v-plugin-k8s-02.spec.ts` (Get), `-03` (Events), `-04`
(Logs) and `-05` (Top), registered in the no-data project of
`tests/e2e/playwright.config.ts`. They encode K8SREAD-8 and K8SREAD-10:
Advanced and Failure Handling open COLLAPSED on all four sheets, and a
collapsed card renders neither its rows nor its footer.
