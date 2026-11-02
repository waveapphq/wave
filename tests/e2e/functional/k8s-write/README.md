# V-K8S-WRITE: the four K8s write Blocks

End-to-end proof for K8s Apply, K8s Delete, K8s Scale and K8s Rollout against a
REAL Kubernetes API (kwok), covering the contracts listed under "Case ids"
below (REQ-5.1.1, REQ-3.4.1.5, REQ-3.5.2.1, REQ-3.5.2.2, REQ-3.5.2.3,
REQ-4.5.5, REQ-4.5.6).

The design the four Blocks are proved against is K8SWRITE-1 to K8SWRITE-8.

Each case is a leg in a `cases-write.ts` table, and each leg is built into
workflow nodes by `helpers/k8s-nodes.ts`. The case table IS the checklist. One
small checked-in golden fixture keeps the shape of a generated leg reviewable;
everything else is generated.

A write suite is different from a read suite in one way that governs every
file here: the objects the assertions describe are the ones the workflow just
wrote. So a leg shares a run only with the legs it genuinely needs - the object
the leg before it created - and a chain is split into separate runs wherever
nothing is carried between them.

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`).
  This suite uses one service:
  - `kwok` - the published kwok cluster (127.0.0.1:9460 -> in-stack 6443),
    static tokens `wave-admin-token` (cluster-admin) and `wave-limited-token`
    (view-only), the standing node `kwok-node-0`, and a real control plane: the
    garbage collector, the namespace controller and the workload controllers all
    run, which is what makes a Deployment, a scale and a cascading delete
    behave the way they do on a real cluster.
- Backend and frontend running (standard functional-stack ports) and the shared
  execution environment (`ensureEnvironment` creates it if absent).
- All credentials are checked-in TEST-ONLY material: the kwok static tokens
  (`tests/e2e/services/kwok/tokens.csv`) and the kwok PKI
  (`tests/e2e/services/kwok/pki/`). The specs read them through
  `helpers/config.ts`; fixture JSON never commits PEM or token values.
- Fixtures carry the literal `https://127.0.0.1:9460` URL; the `injectHttp`
  import option rewrites it for container-shard mode.

### Editing anything under `tests/e2e/services/kwok/` needs a full image rebuild

The manifests, Stages, log files, `kwok.yaml` and `tokens.csv` are copied into
the image at BUILD time and applied from inside the container at startup.
Editing one and running `scripts/e2e-stack.sh up` leaves the old image serving
and the cluster exactly as it was - the specs then fail against stale
permissions or a missing Stage, and it reads like a plugin bug. The sequence is
`scripts/e2e-stack.sh build`, then `down`, then `up --wait kwok`. The rebuild
recreates the cluster from scratch, so every runtime object any suite created is
wiped and only the baked bootstrap returns.

## Steps

1. `seedRun(request, 'minimal')` (`helpers/k8s-seed.ts`) creates the run's own
   uniquely-named namespaces and returns the names and a `teardown`. This suite
   seeds no objects: every object an assertion describes is one the workflow
   under test wrote.
2. Build the workflow from the file's case table with `buildWriteFixture`
   (`cases-write.ts`), import it via `POST /tests`, and confirm
   `POST /tests/{id}/validate` reports zero errors (`importValidateAndNavigate`).
3. Open the test in the workbench, pick the shared environment, and Run
   (`startRun` / `finishRun` in `helpers/k8s-run.ts`).
4. Read the console between the run's bookend markers, the node execution
   statuses off the canvas, and the bound outputs in one session-variables call.
5. `test.afterAll` deletes the cluster-scoped namespace the suite applies and
   calls `run.teardown()`.

The console is always harvested against a bookend marker, never with a bare read
after a node status flips: the status goes terminal a beat before the console
renders its tail. `helpers/k8s-run.ts` does this; do not hand-roll it.

## Case ids

Every leg carries the `KW-` ids it proves - in the case table, in the console
marker it stamps, and in its test title - so a failure names the row it broke.
Each spec file owns a contiguous block of ids; `v-k8s-write-chain.spec.ts` owns
`KW-01` to `KW-20` and further files continue from `KW-21`. The one break in
that rule is `KW-35`, added to `v-k8s-write-manifest.spec.ts` after the later
ids were taken, so that file owns `KW-21` to `KW-27` plus `KW-35`; renumbering
four shipped specs would cost more than the gap does.

| Id | What it proves |
|---|---|
| `KW-01` | The node factories emit the checked-in golden shape, so a generated workflow and a hand-authored one import identically |
| `KW-02` | Apply from the ConfigMap form creates the object: Summary is RESOURCE / OUTCOME with the one row `configmap/<name>` and `created`, and a K8s Get reads the written data back |
| `KW-03` | The first apply of a name reports `created` |
| `KW-04` | Applying the same name again reports `configured`, not `created`, and the object carries the second apply's data. Update is the default and it is idempotent |
| `KW-05` | If exists = Fail on an object that is already there records AlreadyExists under Record and continue: success false, the cluster's own sentence, empty Result, names, count and Summary rows, exactly one WARN line, an amber Block and a run that still passes |
| `KW-06` | Apply from the Secret form creates an Opaque Secret |
| `KW-07` | The written value is masked everywhere the run is recorded - the console, the bound Result and the generated report - and the form the cluster echoes back reaches no file in the store |
| `KW-08` | A Deployment manifest applies as one document, and Result carries one entry per document |
| `KW-09` | Scale writes the replica count: Summary carries RESOURCE / OUTCOME / PREVIOUS / REPLICAS with the one row `deployment.apps/<name>`, `scaled`, 2, 5, and a K8s Get reads 5 back off the cluster |
| `KW-10` | Rollout restart stamps kubectl's own `restartedAt` annotation, Summary reports `restarted` with the type/name repeated in MESSAGE, and a K8s Get reads the annotation back |
| `KW-11` | Rollout status reports the cluster's own verdict: the Status output equals the OUTCOME cell and MESSAGE is kubectl's sentence for that verdict |
| `KW-12` | Delete with Cascade = Foreground and Wait until gone removes the workload, the path carries `propagationPolicy=Foreground`, and no pod of the workload is left behind |
| `KW-13` | Delete by name removes the object: Summary row `deleted`, one name, count 1, and the path carries the propagation policy |
| `KW-14` | Deleting a name that is already gone fails the Block with the cluster's not-found sentence, exactly as kubectl does. Nothing is recorded: no WARN line and no amber Block |
| `KW-15` | Ignore not found turns that same delete into a pass with count 0, no names and an empty Summary that still declares its columns |
| `KW-16` | A selector matching nothing is a pass with count 0, with Ignore not found off and on alike |
| `KW-17` | A Namespace manifest applies cluster-scoped, and a K8s Get reads it back at the object's own cluster-scoped path with no run-namespace segment in front of it |
| `KW-18` | Delete removes a cluster-scoped object by name |
| `KW-19` | A write under the view-only identity fails the Block with the cluster's own permission sentence, named as a permission problem and not as a product failure |
| `KW-20` | The same write under Record and continue records reason Forbidden with the same sentence, paints the Block amber, and leaves the run passed |
| `KW-21` | A mode row whose expression gives an empty string fails the Block with that row's own allowed-values sentence, and no Job reaches the cluster (the same blank saved as text is refused at save) |
| `KW-22` | A manifest whose `apiVersion` or `kind` is written but empty, or written as null, is refused with the manifest's own message, and none of those objects is created |
| `KW-23` | A manifest whose `metadata` is a string, a list or a number gets the Block's own missing-name message every time, and no internal Python error text ever reaches the console |
| `KW-24` | A manifest naming a served but non-preferred API version writes at the version it names, and a K8s Get finds the object at the version the cluster prefers |
| `KW-25` | A manifest naming a version the cluster does not serve fails, naming both the kind and the version, and writes nothing |
| `KW-26` | An unknown manifest field is refused on the create path (If exists = Fail) rather than dropped |
| `KW-27` | The same field is refused on the update path, and neither object is left on the cluster |
| `KW-28` | An Opaque Secret written from the form is created, and a K8s Get reads the stored key back off the cluster |
| `KW-29` | The planted value appears nowhere in cleartext and nowhere as its base64 encoding - not on the console, not in the websocket feed, not in the session variables and not in the report - and every surface that would have shown it shows the mask |
| `KW-30` | A selector delete whose wait poll is refused keeps polling until the Block Timeout runs out and then fails, naming the plural and the selector it was waiting on - and the objects it deleted really are gone, so the refusal is the poll and not the delete |
| `KW-31` | The same selector delete under an identity that can read the poll finishes its wait and reports exactly what it removed |
| `KW-32` | A rollout undo on a Deployment whose selector is written with `matchExpressions` rolls the workload back to its own previous revision, and Summary reports it as rolled back |
| `KW-33` | The undo lands on its own previous revision while another workload's revisions sit in the same namespace and answer the same label query, and the neighbor is left exactly as it was |
| `KW-34` | A revision object the workload owns but does not control is not history: the undo steps over it to the workload's own previous revision, even though the object carries the highest revision number in the namespace |
| `KW-35` | A manifest that is only a document separator declares no object at all, so Apply refuses it before it writes with the manifest's own apiVersion/kind message, and nothing reaches the cluster |

## Which file proves which ids

| File | Run | Ids |
|---|---|---|
| `v-k8s-write-chain.spec.ts` | W1: golden | KW-01, KW-02 |
| `v-k8s-write-chain.spec.ts` | W2: apply cycle | KW-03, KW-04, KW-05 |
| `v-k8s-write-chain.spec.ts` | W3: Secret form | KW-06, KW-07 |
| `v-k8s-write-chain.spec.ts` | W4: Deployment lifecycle | KW-08 to KW-12 |
| `v-k8s-write-chain.spec.ts` | W5: delete lifecycle | KW-13 to KW-16 |
| `v-k8s-write-chain.spec.ts` | W6: cluster-scoped write | KW-17, KW-18 |
| `v-k8s-write-chain.spec.ts` | W7: RBAC denial | KW-19, KW-20 |
| `v-k8s-write-manifest.spec.ts` | every refusal the Block makes before it writes | KW-21, KW-22, KW-23, KW-35 |
| `v-k8s-write-manifest.spec.ts` | the manifest's own apiVersion routes the write | KW-24, KW-25 |
| `v-k8s-write-manifest.spec.ts` | an unknown manifest field, create path and update path | KW-26, KW-27 |
| `v-k8s-write-secrets.spec.ts` | the planted value on every recorded surface | KW-28, KW-29 |
| `v-k8s-write-wait.spec.ts` | a refused wait poll and a readable one | KW-30, KW-31 |
| `v-k8s-write-rollout.spec.ts` | undo beside a neighbor answering the same label query | KW-32, KW-33 |
| `v-k8s-write-rollout.spec.ts` | a revision the workload owns but does not control | KW-34 |

The `W`n labels above are this README's own names for the chain spec's seven runs;
the other four spec files name their runs by their test titles, which is what the
right-hand column quotes.

## What the suite writes, and where

Everything except one namespace lives in the run's own namespace, so a parallel
shard never sees it.

The table below is the chain spec's seven runs. The other four spec files write
only inside the run's own namespace - no cluster-scoped object among them - so
the namespace teardown removes everything they leave.

| Object | Kind | Written by | Removed by |
|---|---|---|---|
| `wave-write-cm` | ConfigMap | W1 | the namespace teardown |
| `wave-cycle-cm` | ConfigMap | W2 | the namespace teardown |
| `wave-write-secret` | Secret | W3 | the namespace teardown |
| `wave-write-deploy` | Deployment | W4 | W4's own Foreground delete |
| `wave-delete-cm` | ConfigMap | W5 | W5's own delete |
| `wave-e2e-<suffix>-c` | Namespace | W6 | W6's own delete, and `afterAll` if the run stopped early |
| `wave-rbac-cm` | ConfigMap | never - both attempts are refused | - |

The cluster-scoped namespace carries the run suffix, exactly as the seeded
namespaces do, and `afterAll` deletes it whatever the run did, so a run that
stops early leaves nothing on the cluster.

Two deletes deliberately do not wait for the object to disappear:
`wait_until_gone` is unticked on the Namespace delete, because namespace removal
is finalizer-driven and the suite asserts the write the Block made rather than a
controller loop. The ConfigMap and the Deployment deletes both wait.

## Cluster handles the suite uses

| Handle | Where it comes from | Used for |
|---|---|---|
| `wave-admin-token` | `tests/e2e/services/kwok/tokens.csv`, bound to `cluster-admin` | every positive write, and the seeded namespace |
| `wave-limited-token` | the same file, bound to `view` | the two RBAC denial legs. `view` carries no write verb on any resource, so every write it attempts is refused by the cluster and never by WAVE |
| `wave-limited` | the user name that token maps to | the exact subject in the permission sentence the denial legs assert |
| The kwok PKI (`pki/ca.crt`) | baked into the image | the trust anchor every Connect Block carries |
| `busybox:1.36` | the image the seeded workloads name | the container in the Deployment manifest, so the pods behave like every other pod on this cluster |

## Isolation on the shared stack

- Every namespaced object lives in the run's own `wave-e2e-<suffix>` namespace,
  and the one cluster-scoped name carries the same suffix, so parallel shards
  never collide.
- The static tokens are read-only shared state; nothing rotates or invalidates
  them, and nothing here writes to `tokens.csv` or the RBAC manifests.
- The baked bootstrap is never written: not the `restricted` namespace, not
  `kwok-node-0`, not the `wave-tests` ServiceAccount and not the CRD. The only
  cluster-scoped object this suite touches is the namespace it creates itself.
- Each spec imports its own Test under a unique name and asserts only on that
  run's console, node statuses and session variables. No server state is reset.

## The Secret canary

The value a Secret form types is part of the Test definition the author saved,
so it is on disk before the run starts (K8SWRITE-3 points an author who needs
authoring-time secrecy at a secret variable instead). What the suite proves is
the runtime half: every value the Block writes registers with the run's secret
registry, so the console, the bound Result and the generated report carry the
mask rather than the value, and the base64 form the cluster echoes back - which
no file ever received from the fixture - reaches no file in the store. The
Secret form stores its keys under `secret_data`, a declared secret field of its
own, apart from the ConfigMap form's `data`, so the Block's Inputs line is
masked before the plugin runs and only the Secret half is scrubbed. Each run
types a value carrying its own suffix, so the sweep cannot collide with another
shard.

## Reusable pieces

`cases-write.ts` is shared by every spec in this suite:

- `buildWriteFixture(legs, material)` - the Connect Blocks a run needs, one
  Block plus one marker per leg, the bookend, and the variables every binding
  declares. A leg marked `guarded` is wrapped in a Try/Catch whose then branch
  prints the caught message; a leg marked `records` binds the core outputs.
- The leg tables, one per run, plus `WRITTEN` (every object name), the manifests
  and `WriteContext` (the run namespace, the cluster-scoped namespace and the
  Secret canary).
- The plugin console lines (`appliedLine`, `deletedLine`, `scaledLine`,
  `rolloutLine`, `readLine`, `recordedLine`), the path builders, `deleteQuery`
  and `typeName` - so a spec never hand-writes a path or a sentence.
- The assertions: `expectSummary`, `expectRecorded`, `expectEmptyWrite`,
  `expectCaught`, `expectMarkers`, `expectLine`, `expectLegStatuses` and
  `expectNoAmber`, plus `deleteNamespaceQuietly` for teardown.

## Related visual specs

The four config sheets are proved separately, with no cluster and no execution:
`tests/e2e/visual/canvas/v-plugin-k8s-06.spec.ts` (Apply), `-07` (Delete),
`-08` (Scale) and `-09` (Rollout), registered in the no-data project of
`tests/e2e/playwright.config.ts`.
