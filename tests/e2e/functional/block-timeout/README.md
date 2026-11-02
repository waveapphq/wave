# V-BLOCK-TIMEOUT: the Timeout row is the real wall-clock bound

End-to-end proof that the number typed into a Block's Timeout row is the
deadline that Block actually dies at, for every Kubernetes and Helm Block that
carries the row. Set it to 1 and the Block fails after one second, and the
sentence it fails with names that second, so the message IS the proof.

The one Block whose bound is wider than the typed Timeout is an Install, an
Upgrade or a Rollback that asked for cleanup room. With Atomic or Cleanup on
Fail ticked, the sheet offers a Cleanup Timeout row and the bound becomes the
two added together, because helm gets its Timeout to do the work and the
Cleanup Timeout to undo it. Both numbers are visible on the sheet and the
message names their sum.

Workflows are built in TypeScript from the node factories in
`helpers/k8s-nodes.ts` through the leg tables in each spec and
`buildTimeoutFixture` in `cases-timeout.ts`. The case table IS the checklist.
Nothing is a checked-in fixture document.

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`).
  This suite uses three services:
  - `k8s-stub` - the fault-injecting cluster (127.0.0.1:9461). It answers
    Kubernetes discovery and stalls whatever a spec asks it to stall, which is
    the only way to hold an answer long enough for a Timeout to matter.
  - `kwok` - not read by any Block here, but `seedRun` creates the run's own
    namespaces on it, which is where each leg's unique names come from.
  - `tls-lab` - the fixture chart repository the two Install legs name, so helm
    resolves a real chart and can only be stopped by its deadline.
- Backend and frontend running (standard functional-stack ports) and the shared
  execution environment (`ensureEnvironment` creates it if absent).
- helm must exist on the machine the backend runs on. The E2E runner image
  carries it.
- All credentials are checked-in TEST-ONLY material, read through
  `helpers/config.ts`.

### The stall must stay well above every Timeout under test

The stub holds its answers for `STALL_SECONDS` (`cases-timeout.ts`). That number
has to sit well above the widest bound any leg types, including the
cleanup-room bound, or a leg reaches the stalled answer and refuses for the
cluster's own reason instead of its deadline. It was raised once already for
exactly that: at a three-second stall the three-second cleanup-room leg was
decided by a fraction of a second.

### Editing anything under `tests/e2e/services/` needs a full image rebuild

The stub's server is copied into its image at BUILD time, so the `vdelay`
directive this suite depends on only exists after
`scripts/e2e-stack.sh build`, then `down`, then `up --wait`. Skipping the
rebuild leaves the old image serving and every request answers 500 naming the
unknown directive, which reads like a Connect bug.

## Steps

1. `seedRun(request, 'minimal')` (`helpers/k8s-seed.ts`) creates the run's own
   uniquely-named namespaces and returns them with a `teardown`. Shards share
   the stack, so nothing here may depend on global cluster state.
2. Build the workflow from the file's leg table with `buildTimeoutFixture`,
   import it via `POST /tests`, and confirm `POST /tests/{id}/validate` reports
   zero errors (`importValidateAndNavigate`).
3. Run it in the workbench and harvest the console on the run's bookend marker.
4. Assert the exact sentence each leg raised, read off the console through the
   Try/Catch that carries it, and for the recorded leg the bound Success, Error
   and Reason plus the amber Block on the canvas.
5. Assert the whole run's wall clock against a ceiling the family defaults
   could not have met.

## The stalling cluster

Both specs configure the stub through the K8s Connect `api_url` path prefix, so
one session carries the fault to every Block that rides it:

| Prefix | Effect |
|--------|--------|
| `/cfg/delay=<s>` | every RESOURCE read stalls; discovery stays fast, so Connect still succeeds |
| `/cfg/vdelay=<s>` | discovery stalls too, so K8s Connect itself can be made to pass its own Timeout |

## Case ids

| Case | File | What it proves |
|------|------|----------------|
| TO-01 | `v-block-timeout-k8s.spec.ts` | K8s Connect times out on the cluster version read and names the api_url it was reading |
| TO-02 | `v-block-timeout-k8s.spec.ts` | K8s Get times out on the Pod list read, and Record and continue does not soften it: a request timeout is a dependency failure, so it raises under both Failure Handling settings |
| TO-03 | `v-block-timeout-k8s.spec.ts` | K8s Events times out on the event list read |
| TO-04 | `v-block-timeout-k8s.spec.ts` | K8s Logs times out on the log subresource read |
| TO-05 | `v-block-timeout-k8s.spec.ts` | K8s Top times out on the pod metrics read |
| TO-06 | `v-block-timeout-k8s.spec.ts` | K8s Apply times out on the server-side apply |
| TO-07 | `v-block-timeout-k8s.spec.ts` | K8s Delete times out on the delete request |
| TO-08 | `v-block-timeout-k8s.spec.ts` | K8s Scale times out reading the scale subresource |
| TO-09 | `v-block-timeout-k8s.spec.ts` | K8s Rollout times out reading the workload |
| TO-10 | `v-block-timeout-k8s.spec.ts` | K8s Exec times out on the pod exec channel |
| TO-11 | `v-block-timeout-k8s.spec.ts` | K8s Script times out on the pod exec channel |
| TO-12 | `v-block-timeout-k8s.spec.ts` | K8s Copy times out on the pod exec channel |
| TO-13 | `v-block-timeout-helm.spec.ts` | Helm Install is killed at its Timeout and the message names it |
| TO-14 | `v-block-timeout-helm.spec.ts` | Helm Upgrade likewise |
| TO-15 | `v-block-timeout-helm.spec.ts` | Helm Rollback likewise |
| TO-16 | `v-block-timeout-helm.spec.ts` | Helm Uninstall likewise |
| TO-17 | `v-block-timeout-helm.spec.ts` | Helm Test likewise |
| TO-18 | `v-block-timeout-helm.spec.ts` | Helm Status likewise |
| TO-19 | `v-block-timeout-helm.spec.ts` | An Install with Atomic on and Cleanup Timeout 2 beside Timeout 1 is bounded at 3 s, and the message names the sum |
| TO-20 | `v-block-timeout-helm.spec.ts` | The same Cleanup Timeout with Atomic OFF still bounds at 1 s: an unticked flag buys no room |
| TO-21 | `v-block-timeout-helm.spec.ts` | Under Record and continue a timed-out Helm Block finishes amber with Success false, the same sentence and Reason Timeout |

## Validation criteria

- Every message is matched whole, never by a loose regex. The sentence names
  the deadline in seconds, so a matched sentence is what pins the bound to the
  typed number.
- Every leg that raises is wrapped in a Try/Catch, so one Block's refusal never
  ends the run and every later leg still reports.
- The wall-clock assertion is a band, not a stopwatch. It says the run could
  not have been running on the family defaults. It never asserts that one leg
  finished in exactly its typed second: a sharded container run cannot carry
  that and the spec would flake.
- Nothing here asserts on the cluster's or helm's own prose. Every pinned
  sentence is one WAVE itself writes.
