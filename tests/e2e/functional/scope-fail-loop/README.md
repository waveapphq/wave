# V-SCOPEFAIL-LOOP-FUNCTIONAL: Scope-Fail Inside a Loop Body

A split-mode `fail_current_scope` assert inside a for-each body marks the Test
failed and its flow continues down the fail branch; a plain failed assert in a
loop paints warning.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared E2E environment present (created by `ensureEnvironment` at test start)

## Fixtures

- `fixture.json` - for-each over `[node-1, node-2, node-3]`; the body pins the
  loop item, runs a plain assert and a split `fail_current_scope` assert (both
  failing only on `node-3`), notes the blocking node on the gate's fail branch,
  and closes with a log on every pass; the post-loop spine runs a verdict if whose
  blocked branch writes a FATAL sign-off line.

## Steps

1. Import the fixture via POST /tests and validate it (zero errors)
2. Open it in the workbench, select the shared environment, Run
3. Wait for the terminal state and read node paint + console entries

## Validation

- **Session outcome:** failed (the scope-fail flag survives the loop)
- **Paint (last pass):** gate assert `failed` (red), plain assert `warning`
  (amber), every other executed block `success`; the cleared verdict branch
  never runs
- **Continuation:** evidence + close lines for all three hosts (a split-mode
  failure marks the Test failed and goes on down its fail branch), post-loop
  line present
- **Console detail:** `Assertion failed: 1 of 3 assertions failed`, the
  per-expression line, and the FATAL `SIGN-OFF BLOCKED` verdict naming the
  blocking node; `SIGN-OFF CLEARED` absent
