# V-CTRL-WAIT-UNTIL: Wait Until Control End-to-End

Verify the Wait Until container does what the control promises: it checks its
condition each round, runs its retry lane between checks to try to make the
condition true, and gives up when the timeout expires. Giving up is
informational (amber) by default and the flow continues through `then`; with
Fail Current Scope on it fails the block (red) and the flow stops at the wait.

The retry lanes poll the REAL `http-echo` service, so a wait that passes only
passes because the system it was watching actually changed its answer between
rounds.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- The E2E service stack's `http-echo` up (automatic: Playwright `webServer` in
  host mode, the CI script in container-shard mode). Manual escape hatch:
  `scripts/e2e-stack.sh up --wait http-echo`
- `fixture.json` - four waits chained through their `then` lanes, so a lost
  egress breaks the chain rather than passing silently
- `fixture-fail-scope.json` - one wait with Fail Current Scope on

Fail Current Scope needs its own workflow: it decides the whole session's
outcome, so "the session is NOT failed" cannot be proven in the same run that
asserts "the session IS failed".

## Isolation on the shared stack

Each test generates its own `run_key` and every poll URL carries
`?key=wu-<permutation>-<run_key>`, so the `/retry` counters this test moves are
its own. No server state is reset and no other shard is affected.

## Steps

1. Import each fixture via `POST /tests` and confirm `POST /tests/{id}/validate`
   reports zero errors (`importValidateAndNavigate`)
2. Open the test in the workbench, pick the shared environment, press Run
3. Read the console log and the session variables once the session reaches a
   terminal state
4. Read the wait nodes' execution status and border color off the canvas

## Validation

- **P1 Retry succeeds:** the poll endpoint fails twice then answers 200, so
  `wu-p1-round` logs at least twice, `p1_passed` binds `true`, `p1_elapsed`
  covers at least two 300 ms check intervals, the log carries
  `[WAIT] Condition met after <n> ms`, and the node reads `success`
- **P3 Informational timeout:** `p3_passed` binds `false`, `p3_elapsed` reaches
  the 1500 ms limit, the timeout message logs at WARN, the node reads `warning`
  with the amber `rgb(245, 158, 11)` border and NO run-state badge, `wu-p3-then`
  still logs, and the session ends `passed`
- **P4 Watch, already true:** `p4_passed` binds `true` and `p4_elapsed` stays
  under one 1000 ms check interval - a satisfied wait costs nothing
- **P5 Disabled:** `wu-p5-retry` never logs, no give-up line appears for it, and
  `wu-p5-then` still logs (WAIT-9)
- **Chain order:** `wu-before`, `wu-p1-then`, `wu-p3-then`, `wu-p4-then`,
  `wu-p5-then`, `wu-after` log in that order - every wait left through `then`
- **P2 Fail Current Scope:** the session ends `failed`, `fs_passed` binds
  `false`, the node reads `failed` with the red `rgb(239, 68, 68)` border, the
  timeout message logs at ERROR, `wufs-round` logs, and `wufs-then` /
  `wufs-after` never log - the flow stops at the failed wait
