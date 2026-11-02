# V-CONTROL-PARALLEL: Parallel Control End-to-End

Verify the Parallel container does what the control promises: it forks named
branch lanes that run at the same time over the test's live variables, joins on
the always-present exit lane, stops what it must when a branch fails or runs out
of time, and parks the whole section around a single debug cursor.

Branches share variables rather than copying them, so the coordination case is
the proof that matters: a Watch-mode Wait Until in one branch is satisfied by a
sibling's write, which is impossible under a fork-time snapshot.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service: Parallel opens no protocol, so nothing from
  `tests/e2e/services/` is required
- `fixture.json` - six Parallel sections chained through their exit lanes, so a
  lost egress breaks the chain rather than passing silently
- `fixture-assert-scope.json` - one section whose branch holds a failing split
  Assert with Fail Current Scope on, its fail branch leading to the branch tail
- `fixture-halt.json` - one section whose branch halts the test with status
  `passed`
- `debug-fixture.json` - two branches under a wait-for-all join: a Delay then a
  Log, against four counter bumps
- `fixture-no-exit.json` - one section with NOTHING wired to its exit handle and
  one failing lane
- `fixture-race-no-exit.json` - the same shape under a first-to-finish join with
  every lane healthy, the loser being a single long-running Block
- `fixture-stopped-lanes.json` - four lanes with the exit wired: one that
  finishes, one that fails, and two that are a single long-running Block each
- `fixture-section-limit.json` - a whole-section time limit that expires while
  both one-Block lanes are still working

Assert and Halt each need their own workflow: each decides the whole session's
outcome, so neither can share a run with the others. The per-branch time limit
is the last section of the main workflow for the same reason - an expired limit
skips the exit lane, so nothing can follow it.

## Isolation on the shared stack

Each spec imports its own Test through `POST /tests` under a unique name and
asserts only on that run's console, node statuses and session variables. No
server state is reset and no other shard is affected.

## Steps

1. Import each fixture via `POST /tests` and confirm `POST /tests/{id}/validate`
   reports zero errors (`importValidateAndNavigate` / `importAndNavigate`)
2. Open the test in the workbench, pick the shared environment, press Run - or,
   for the debug spec, set a breakpoint and press Debug
3. Read the console log and the session variables once the session reaches a
   terminal state; the debug spec reads `b_count` while the run is still paused
4. Read the node execution statuses off the canvas

## Validation

### fixture.json (one run)

- **P1 Wait for all:** both branches write, the exit lane composes what they
  wrote into `p1_seen == "AB"`, and `p1-then` logs exactly once
- **P2 Cross-branch coordination:** `p2_passed` binds `true`, `p2_elapsed`
  covers the sibling's 400 ms of work, `gate` reads `open`, and both branch
  markers log - the wait was satisfied by a sibling's write, not by a snapshot
- **P3 First to finish:** `p3-fast` and `p3-then` log, `p3-slow` never does, the
  loser's in-flight Delay reads `stopped`, its tail reads `skipped`, and the log
  carries `Branch 'slow' stopped` at WARN. The winner waits 500 ms before its Log,
  so the loser's Delay is always in flight when the join releases
- **P5 Nesting:** the inner branches log before the inner exit, which logs before
  the outer branch's tail, which logs before the outer exit
- **P6 Disabled:** neither branch body logs, both render muted (no execution
  status - the same treatment a disabled Switch gives its cases), the node reads
  `data-disabled="true"`, and the exit lane logs and reads `success`
- **P4 Per-branch limit:** the log carries
  `Branch 'capped' exceeded its time limit of 200 ms` at ERROR and
  `Branch 'sibling' stopped` at WARN, both Delays read `stopped`, both tails read
  `skipped`, the exit lane never logs, nothing behind the section runs, and the
  session ends `failed`
- **Chain order:** `par-before`, `p1-then`, `p2-then`, `p3-then`, `p5-then`,
  `p6-then` log in that order

### fixture-assert-scope.json (second run)

- The branch carries on down its failing Assert's fail branch (`as-tail` logs), the sibling
  runs, the Assert node reads `failed`, the exit lane runs once, the block behind
  the section runs, and the session ends `failed`

### fixture-halt.json (third run)

- The Halt announces `Halt (test): halt in a branch`, the sibling's in-flight
  Delay reads `stopped` and its tail `skipped`, the exit lane never logs, nothing
  behind the section runs, and the session ends `passed` - only the status the
  Halt declared can make a cut-short run pass

### fixture-no-exit.json (fourth run)

- One failing lane with nothing wired after the section: the failing Log reads
  `failed`, the section reads `failed`, the session ends `failed`, the log
  carries `halted with status: failed` and never carries `completed
  successfully`

### fixture-race-no-exit.json (fifth run)

- Nothing wired after a healthy section still reads as a pass: the session ends
  `passed` and the log carries `completed successfully`
- The losing one-Block lane reads `stopped`, the log carries `Branch 'slow'
  stopped` at WARN, the winning lane's Blocks read `success`, and no Block on the
  canvas is left reading `running`

### fixture-stopped-lanes.json (sixth run, and the history spec)

- The lane that finished keeps its own result (`success`) and the lane that
  failed keeps its failure
- Each abandoned one-Block lane reads `stopped` and is named in the log:
  `Branch 'adrift' stopped` and `Branch 'marooned' stopped`, both at WARN
- No Block anywhere reads `running` once the run ends
- With the exit wired the section behaves exactly as before: the exit lane
  carries no execution status on the live canvas (a container's skipped exit
  lane is stored but never broadcast), neither `sl-then` nor `sl-after` logs,
  and the session ends `failed` without `completed successfully`

### fixture-section-limit.json (seventh run)

- The log carries `Parallel section exceeded its time limit of 500 ms` at ERROR,
  both one-Block lanes read `stopped` and are named at WARN, the exit lane
  carries no execution status on the live canvas and never logs, and the session
  ends `failed`

### v-control-parallel-history.spec.ts

The live canvas paints from the run's own `block_status_changed` events; the
historical canvas paints from the stored `block_states` of the finished run.
They are different sources, so this spec runs `fixture-stopped-lanes.json` as a
TRACKED execution (`POST /executions` - a workbench Run has no history route),
reads `GET /executions/history/{id}`, then reopens the run at
`/executions/history/{id}`.

- The stored run records `stopped` for both abandoned lanes, `passed` for the
  lane that finished, `failed` for the lane that failed and `skipped` for the
  exit lane, with no Block stored as `running`
- The stored run log names each stopped lane
- The reopened canvas paints the same states, and no Block reads `running`

### debug-fixture.json (v-control-parallel-debug.spec.ts)

| # | Validation |
|---|------------|
| D1 | While paused inside branch 1, `b_count <= 1` - the sibling parked at its next block boundary |
| D2 | Continue releases every parked branch: the run passes, `b_count == 4`, `EXIT` logs once |
| D3 | Step Over re-pauses on branch 1's next block, before that block runs |
| D4 | `b_count` is unchanged across the step |
| D5 | Step Over off branch 1's last block surfaces the cursor in the sibling branch instead of hanging the section |
| D6 | Step Into behaves as D3 and D4 do |
| D7 | Skip Block reads `skipped` on the block, re-pauses on branch 1's next block, and leaves `b_count` unchanged |
| D8 | Two breakpoints in different branches surface one after another, one paused block at a time |
| D9 | The Parallel block reads `running` while a branch is paused |
| D10 | A run stepped to completion ends with `b_count == 4` and one `EXIT`, the same as a plain run |

Debugging a `join: first` section is out of scope: under first-to-finish the
debugger picks the winner by construction, so the outcome is a property of the
debugger rather than of the section.
