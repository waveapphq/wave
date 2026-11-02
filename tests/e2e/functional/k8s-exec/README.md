# V-K8S-EXEC: the three K8s exec-channel Blocks

End-to-end proof for K8s Exec, K8s Script and K8s Copy against a REAL
Kubernetes API (kwok) whose exec channel runs real processes, covering the
contracts listed under "Case ids" below (REQ-5.1.1, REQ-3.4.1.5).

The design the three Blocks are proved against is K8SEXEC-1 to K8SEXEC-10.

Each case is a leg in a `cases-exec.ts` table, and each leg is built into
workflow nodes by `helpers/k8s-nodes.ts`. The case table IS the checklist. One
small checked-in golden fixture keeps the shape of a generated leg reviewable;
everything else is generated.

The rule that governs every assertion here: **every declared output is read
back, not just the headline one.** Exec and Script bind stdout, stderr,
exit_code and success on every leg; Copy binds summary and success; a leg
running under Record and continue adds error and reason. A leg that binds only
its own stream would let three of its outputs go unproved, which is exactly the
gap this suite exists to close.

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`).
  This suite uses one service:
  - `kwok` - the published kwok cluster (127.0.0.1:9460 -> in-stack 6443),
    static token `wave-admin-token` (cluster-admin), the standing node
    `kwok-node-0`, and a `ClusterExec` document that turns on `kubectl exec`
    for two named pods.
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
the image at BUILD time and applied from inside the container at startup, and
the kwok controller itself is rebuilt from patched source in the same build.
Editing one and running `scripts/e2e-stack.sh up` leaves the old image serving
and the cluster exactly as it was - the specs then fail against a cluster that
serves no exec at all, and it reads like a plugin bug. The sequence is
`scripts/e2e-stack.sh build`, then `down`, then `up --wait kwok`.

### Why the Script legs need the patched kwok

Stock kwok v0.7.0 copies standard input to the command but never closes the
pipe, so an interpreter reading a script body waits forever and K8s Script
cannot finish at all. The checked-in `kwok-exec-fidelity.patch` closes the pipe
when the client's stream ends, which is what lets the interpreter reach EOF and
exit - `KE-11` passes only because of it. The same patch turns a non-zero exit
into the canonical `NonZeroExitCode` status frame with an `ExitCode` cause,
which is where `KE-06` and `KE-13` read their codes from.

## Steps

1. `seedRun(request, 'exec')` (`helpers/k8s-seed.ts`) creates the run's own
   uniquely-named namespaces and the three exec-fixture pods, and returns the
   names and a `teardown`.
2. Build the workflow from the file's case table with `buildExecFixture`
   (`cases-exec.ts`), import it via `POST /tests`, and confirm
   `POST /tests/{id}/validate` reports zero errors (`importValidateAndNavigate`).
3. Open the test in the workbench, pick the shared environment, and Run
   (`startRun` / `finishRun` in `helpers/k8s-run.ts`). The limit run first
   types Max size (MiB) 1 and Max files 2 into two Copy sheets over the
   256 / 10000 the fixture carries, saves the Test, and checks the saved values
   and a `context=run` validation before it runs, so both refusals happen only
   if the sheets saved what was typed.
4. Read the console between the run's bookend markers, the node execution
   statuses off the canvas, the bound outputs in one session-variables call,
   and - for the Copy legs - the run's own artifacts through
   `GET /workbench/session/artifacts`.
5. `test.afterAll` deletes every Test the spec imported and calls `run.teardown()`.

The console is always harvested against a bookend marker, never with a bare read
after a node status flips: the status goes terminal a beat before the console
renders its tail. `helpers/k8s-run.ts` does this; do not hand-roll it. The one
run that is MEANT to fail harvests against the Block's own failure line instead,
because its bookend never runs.

## Case ids

Every leg carries the `KE-` ids it proves - in the case table, in the console
marker it stamps, and in its test title - so a failure names the row it broke.

| Id | What it proves |
|---|---|
| `KE-01` | The node factories emit the checked-in golden shape, so a generated workflow and a hand-authored one import identically |
| `KE-02` | The golden workflow runs: the command's output, its empty error stream, its exit code and its success flag all come back bound, and the plugin's own INFO line names the pod and the code |
| `KE-03` | One busybox command writes to standard output AND standard error and exits 0, and the two streams come back separately rather than merged |
| `KE-04` | The same command in the `app` container lands in that container's working directory and sees that container's `WAVE_EXEC_TARGET` |
| `KE-05` | The same command in the `sidecar` container lands in a different working directory and sees a different `WAVE_EXEC_TARGET`, so Container is honored rather than decorative |
| `KE-06` | A non-zero exit is data: `exit_code` carries the code, `success` is true, no WARN line is written, the Block passes and so does the run |
| `KE-07` | A quoted argument holding a space stays ONE argument through the Block's shell-style split |
| `KE-08` | A pod that does not exist under Record and continue reports success false, reason `NotFound`, the cluster's own sentence in `error`, empty streams, exactly one WARN line, an amber Block and a run that still passes |
| `KE-09` | The same missing pod under Fail the block fails the Block with the same sentence, stops the run before the next Block, and records nothing: no WARN line and no amber Block |
| `KE-10` | A pod outside the cluster's exec fixture is refused by the cluster itself, recorded with the cluster's own reason and empty streams. The refusal is the cluster's, not WAVE's |
| `KE-11` | A multi-line `/bin/sh` script reaches EOF and exits, and both its streams, its exit code and its success flag come back. This leg passes only because of the kwok exec-fidelity patch |
| `KE-12` | `python3` as a second interpreter runs a body the shell could not, and its two streams come back separately |
| `KE-13` | A script exiting non-zero is data: `exit_code` carries the code, `success` is true, the Block passes and so does the run |
| `KE-14` | A Script failure under Record and continue reports success false, reason `NotFound`, the cluster's own sentence in `error`, empty streams, exactly one WARN line and an amber Block |
| `KE-15` | Pulling one file out of the pod reports one Summary row whose SOURCE is the pod path, whose TARGET is where it landed on the WAVE side and whose SIZE is the file's size, reports success, and the artifact reads back through the session API with exactly what the pod held |
| `KE-16` | Pulling a directory reports one Summary row per FILE and no row for the directory itself, so the table's own row count is the file count, and every file lands under the artifact the Block named |
| `KE-17` | A source path the pod does not hold under Record and continue reports success false, reason `NonZeroExitCode`, the command's own message in `error`, an empty Summary that still declares its three columns, exactly one WARN line and an amber Block |
| `KE-18` | A push sources an artifact an earlier Block in the same test wrote: Summary names the resolved local file, the pod path and the size, and a K8s Exec `cat` in the pod reads the same bytes back |
| `KE-19` | A pull of two 700,000-byte files with Max size (MiB) 1, typed in the sheet, under Record and continue reports success false, reason `ArchiveTooLarge`, the Max size (MiB) refusal text with max 1 in `error`, an empty Summary that still declares its three columns, exactly one WARN line and an amber Block. The first file lands before the second goes over, so the pull must undo it: an earlier pull landed known bytes at both paths the size pull writes, and after the refusal they read back byte for byte, nothing new is left under `limit-size`, and no `.<name>.<8 hex>.keep` file is left anywhere in the artifacts |
| `KE-20` | A pull of three files with Max files 2, typed in the sheet, reports reason `ArchiveTooManyEntries` and the Max files refusal text with max 2 in `error`, and leaves nothing under `limit-files` |

## Which file proves which ids

| File | Run | Ids |
|---|---|---|
| `v-k8s-exec-command.spec.ts` | E1: golden | KE-01, KE-02 |
| `v-k8s-exec-command.spec.ts` | E2: command sweep | KE-03 to KE-07 |
| `v-k8s-exec-command.spec.ts` | E3: recorded refusals | KE-08, KE-10 |
| `v-k8s-exec-command.spec.ts` | E4: the run that fails | KE-09 |
| `v-k8s-exec-script.spec.ts` | S1: two interpreters, a non-zero exit, a recorded refusal | KE-11 to KE-14 |
| `v-k8s-exec-copy.spec.ts` | C1: a file and a directory out of the pod | KE-15 to KE-17 |
| `v-k8s-exec-copy.spec.ts` | C2: a push sourcing an artifact | KE-18 |
| `v-k8s-exec-copy.spec.ts` | C3: two pulls over the limit rows the sheets set | KE-19, KE-20 |

The `E`n / `S`n / `C`n labels are this README's own names for the runs; the
specs name them by their test titles.

## What the suite writes, and where

Two places, and they behave differently.

| Object | Where | Written by | Removed by |
|---|---|---|---|
| `wave-pod-exec`, `wave-pod-exec-b`, `wave-pod-noexec` | the run's own namespace | `seedRun(request, 'exec')` | the namespace teardown |
| `<suffix>-pull.txt`, `<suffix>-dir/`, `<suffix>-push.txt` | `/wave/exec/app` inside the kwok container | the suite's own K8s Exec and K8s Copy legs | nothing - see below |
| `<suffix>-sizes/`, `<suffix>-prior/`, `<suffix>-many/` | `/wave/exec/app` inside the kwok container | the limit run's first K8s Exec leg | the limit run's last K8s Exec leg (`rm -rf`) |
| `<suffix>-pull.txt`, `<suffix>-dir/*`, `<suffix>-push.txt`, `limit-size/*` | the run's artifacts directory | K8s Copy and File I/O | the workbench session's own lifecycle |

kwok's only exec target is `local`, so every command the suite runs is a real
process on the kwok container's own filesystem rather than inside a pod. Nothing
in the suite deletes what it wrote there, and the kwok image rebuild is what
clears it - so every pod-side path the suite writes carries the run's 8-char
suffix. A fixed path would collide with the parallel shard next to it. The
files are a few bytes each, except the limit run's two 700,000-byte files, which
that run removes itself.

## Cluster handles the suite uses

| Handle | Where it comes from | Used for |
|---|---|---|
| `wave-admin-token` | `tests/e2e/services/kwok/tokens.csv`, bound to `cluster-admin` | every leg, and the seeded pods |
| `wave-pod-exec` | seeded by the `exec` profile; named in the `ClusterExec` selector | the Exec and Copy legs |
| `wave-pod-exec-b` | the same | the Script legs, so the suite proves the selector grants BOTH names it lists rather than only the first |
| `wave-pod-noexec` | seeded by the `exec` profile; NOT in the selector | KE-10, where the refusal has to be the cluster's own |
| `wave-pod-absent` | never created anywhere | KE-08, KE-09 and KE-14, where the apiserver answers NotFound before kwok is reached |
| `app` / `sidecar` | the container names the `ClusterExec` doc keys its entries on | KE-04 and KE-05, the only way to prove which container a command reached |
| The kwok PKI (`pki/ca.crt`) | baked into the image | the trust anchor the Connect Block carries |

## Isolation on the shared stack

- Every Kubernetes object lives in the run's own `wave-e2e-<suffix>` namespace.
  The suite creates no cluster-scoped object at all.
- Every pod-side file and directory carries the run suffix, because the kwok
  container's filesystem is shared by every pod the fixture matches AND by every
  parallel shard.
- The static tokens are read-only shared state; nothing here writes to
  `tokens.csv`, the RBAC manifests or `kwok.yaml`.
- Each spec imports its own Test under a unique name and asserts only on that
  run's console, node statuses, session variables and artifacts. No server state
  is reset.

## Rows this suite does NOT prove

- **`UnsupportedVersion` on K8s Script.** kwok speaks the v5 subprotocol, so the
  older-cluster refusal cannot be produced against it at all. The backend unit
  tests own that path.
- **Which pod a file landed in.** Two pods matched by the `ClusterExec` doc share
  the kwok container's one filesystem, so "the file is in pod A and not pod B"
  is not a provable claim here. What IS provable is which CONTAINER the command
  reached, through the per-container working directory and `WAVE_EXEC_TARGET` -
  which is what KE-04 and KE-05 do.
- **The text of an exec status-frame refusal.** The message differs between the
  v4 and v5 transports, so KE-10 keys on the `reason` the plugin surfaces and on
  the wrapper sentence WAVE puts around it, never on the cluster's own words.

## Reusable pieces

`cases-exec.ts` is shared by all three specs:

- `buildExecFixture(legs, material)` - the Connect Block, one Block plus one
  marker per leg, the bookend, and the variables every binding declares. A leg
  marked `records` binds error and reason on top of the outputs every leg binds.
- The leg tables, one per run, plus the exec-fixture names, the per-container
  working directories and `WAVE_EXEC_TARGET` values, the command and script
  bodies with what each one writes, and the pod-side and artifact path builders
  keyed on the run suffix.
- The plugin console lines (`ranCommandLine`, `ranScriptLine`, `copiedLine`,
  `recordedLine`) and the failure wordings (`where`, `execRefused`,
  `scriptRefused`, `copyRefused`, `podNotFound`, `blockFailedLine`) - so a spec
  never hand-writes a sentence.
- The assertions: `expectStreams` (every output an Exec or Script leg declares),
  `expectSuccess`, `expectRecordedCore`, `expectEmptyStreams`, `copySummary`,
  `copyRows`, `expectEmptyCopy`, `expectMarkers`, `expectLine`,
  `expectLegStatuses` and `expectNoAmber`, plus `listArtifacts` and
  `readArtifact` for the run's own artifacts directory.
- The limit texts and names: `overSizeDetail` (the Max size (MiB) refusal),
  `overFilesDetail` (the Max files refusal), `TOO_LARGE_REASON`,
  `TOO_MANY_REASON`, the fixture and typed limit values, and `KEEP_NAME`, the
  name a pull gives a file it keeps aside while it overwrites it.

## Related visual specs

The three config sheets are proved separately, with no cluster and no execution:
`tests/e2e/visual/canvas/v-plugin-k8s-10.spec.ts` (Exec), `-11` (Script) and
`-12` (Copy), registered in the no-data project of
`tests/e2e/playwright.config.ts`.
