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
  `scripts/e2e/e2e-stack.sh up --wait http-echo`
- `fixture.json` - four waits chained through their `then` lanes, so a lost
  egress breaks the chain rather than passing silently
- `fixture-fail-scope.json` - one wait with Fail Current Scope on
- `fixture-watch-wires.json` - one Retry wait whose condition already holds, a
  Log on its retry lane and a Log after it (used by the wires spec below, which
  needs no `http-echo`)
- `fixture-fn-wait-wires.json` - a Function body: a Watch wait with a retry
  wire and a next wire, then a Retry wait whose next wire names no lane; the
  retry wire lands on the Log after the Retry wait, so every Block stays
  reached without it (used by the Function wires spec below, API only); the
  stranded Block spec below builds its body from this file's Watch wait and Log

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

## V-CTRL-WAIT-UNTIL-WIRES: the next wire across a mode change

`v-ctrl-wait-until-wires-functional.spec.ts` proves that a Wait Until mode
change takes only the retry lane's wire with it and keeps the wire to the next
Block (REQ-3.5.4.3, WAIT-3), and that the Test save removes and reports only
that wire (REQ-5.2.4.3).

### Steps

1. Build each Test from `fixture-watch-wires.json`, the mode and the wires set
   per case; a seed goes in via `POST /tests` with no repair allowed
2. Retry to Watch: open the Test, pick Watch in the Wait Until's window, Save
   the window, Save the Test, reopen it and press Run
3. API: `POST /tests` a Watch wait with a retry wire and a next wire on `then`;
   `PUT /tests/{id}` a Retry wait to Watch with a retry wire and a next wire on
   the unnamed exit
4. Watch to Retry: seed a Watch wait with only its next wire, pick Retry in the
   window, Save the window, Save the Test, reopen it and press Run
5. Retry through the API: `POST /tests` a Retry wait with a retry wire and a
   next wire that names no lane; `PUT /tests/{id}` a Retry wait with no stored
   mode and its next wire alone, naming no lane; open the created Test and
   press Run

### Validation

- **Retry to Watch:** after the window Save the retry lane and its wire are
  gone and the wire to `ww-after-log` is drawn from the single exit; the Test
  save lists no repair and stores that wire with no lane name; reopened, the
  canvas draws it, the run passes, `ww-after-ran` logs, the Log paints
  `success` and `ww-retry-ran` never logs
- **API save:** both saves store the wire into the wait and the next wire alone,
  on the unnamed exit, keep mode `watch`, validate with zero errors, and their
  `repairs` list holds only the retry wire `e-ww-retry`
- **Watch to Retry:** after the window Save the retry lane is drawn with no
  wire and the wire to `ww-after-log` leaves the `then` lane; the Test save
  lists no repair and stores it on `then`; reopened, the run passes and
  `ww-after-ran` logs
- **Retry through the API:** both saves store the next wire on `then`, the
  create keeps the retry wire on `retry`, neither lists a repair and the
  update validates with zero errors; the canvas draws the retry wire from the
  retry dot and the next wire from the `then` dot, the run passes,
  `ww-after-ran` logs and `ww-retry-ran` never logs

## V-CTRL-WAIT-UNTIL-FN-WIRES: a Function body's wait wires

`v-ctrl-wait-until-fn-wires-functional.spec.ts` proves that the save puts a
Function body's Wait Until wires on the lanes each mode draws, the way the
Test canvas saves them (REQ-3.5.4.3, WAIT-3, REQ-3.1.2.4), and that the Test
save, the library save and a new library version all report the wire they
remove, with the path to the body that held it (REQ-5.2.4.3).

### Steps

1. Build the body from `fixture-fn-wait-wires.json`, the Watch wait's next
   wire on `then` in one case and on the unnamed exit in the other
2. `POST /functions` each body as a library Function named
   `v-wu-fn-wires-<case>-<6 hex>`, then `GET /functions/{id}`
3. `POST /tests` each body as the Local Function `fw-fn`, the one Block of a
   Test named `V-CTRL-WAIT-UNTIL-FN-WIRES <case> <unique>`, then
   `GET /tests/{id}`
4. `POST /functions` the body (next wire on `then`) as a library Function
   named `v-wu-fn-rep-<place>-<6 hex>`: once as the library Function's own
   flow, once inside the Local Function `fw-fn` of that flow; then
   `GET /functions/{id}`
5. `POST /functions` version 1.0.0 named `v-wu-fn-ver-<place>-<6 hex>`
   holding the body without the retry wire, at the same two places; then
   `POST /functions/{id}/versions` version 1.0.1 whose draft holds the retry
   wire, and `GET /functions/{id}?version=1.0.1`
6. `POST /functions/batch` the body at the same two places as two library
   Functions named `v-wu-fn-bat-<place>-<6 hex>`, then `GET /functions/{id}`
7. `POST /tests/batch` both cases as two Tests holding the Local Function
   `fw-fn`, then `GET /tests/{id}`
8. `POST /tests` a Test holding the body without the retry wire, then
   `PATCH /tests/batch` its workflow to the body with the retry wire

### Validation

- **Stored body, every save and every case:** the retry wire
  `e-fw-watch-retry` is gone, the Watch wait's next wire is stored on the
  unnamed exit, the Retry wait's next wire on `then`, and every other wire is
  stored as sent
- **Repairs:** every save answers with exactly one repair, the edge
  `e-fw-watch-retry`, reading `Connection fw-watch -> fw-after-retry was
  removed`; its function path is `fw-fn` when the wait sits in the Local
  Function body (Test save, library save, new version) and empty when it sits
  in the library Function's own flow
- **Batch repairs:** each batch answer lists that same repair under the id of
  each Function or Test it created or updated, in its `repairs` map

## V-CTRL-WAIT-UNTIL-FN-STRANDED: the save says why a Block is unreached

`v-ctrl-wait-until-fn-stranded-functional.spec.ts` proves that when the save
removes a Watch-mode wait's retry wire and that wire was the only way into a
Block, the refusal names the removed wire as the reason the Block is unreached
(REQ-3.5.4.3, WAIT-3, REQ-3.1.2.4, REQ-5.2.4.3). API only.

### Steps

1. Build a body from `fixture-fn-wait-wires.json`: the Watch wait, labeled
   `Watch ready`, with a retry wire to the Log `Retry log` (nothing else reaches
   it) and an unnamed next wire to another Log
2. `POST /functions` the body as a library Function named
   `v-wu-fn-stranded-<6 hex>`
3. `POST /tests` the body as the Local Function `fw-fn`, the one Block of a
   Test named `V-CTRL-WAIT-UNTIL-FN-STRANDED <unique>`
4. `POST /functions` a library Function named `v-wu-fn-nested-<6 hex>` whose
   one Block is the Local Function `fw-fn` running the body

### Validation

- **All three saves:** 422, and the one `NODE_UNREACHABLE` finding reads
  `Block 'Retry log' is not reachable from the Function's entry: its only wire
  came from the retry lane of Watch-mode Wait Until 'Watch ready', which was
  removed` (one line in the answer)
- **Nested body:** the library save checks the body inside its Local
  Function the way the Test save checks a body nested in a body
- **Nothing stored:** no library Function and no Test of that name exists
