# For Control Functional Tests

Verify the For loop (REQ-3.5.1.15) end to end: count mode and range mode, literal and expression settings, a
timeout caught by a Try/Catch, a disabled For as a pass-through, a null count that runs zero times (REQ-3.1.3.25),
and range mode refusing a null start, end or step (REQ-3.1.3.21).

| Spec | V-TEST ID | What it proves |
|---|---|---|
| `v-ctrl-for-functional.spec.ts` | V-CTRL-FOR-FUNCTIONAL | Six chained loops from `fixture.json`: count 3, count 0, range 0..10 step 2, count and range from variables, and a timeout caught by a Try/Catch |
| `v-ctrl-for-disabled-01.spec.ts` | V-CTRL-FOR-DISABLED-01 | A disabled For skips its body and passes the flow through its then lane; the run passes |
| `v-ctrl-for-null-functional.spec.ts` | V-CTRL-FOR-NULL | Built on the canvas: a For whose count is a null variable runs zero times with `[FOR] Starting loop (0 iterations)`, its then lane runs and the index reads 0; in range mode a null start, end or step fails the For with `Block '<For>' failed: '<field>' is null`, and the same For passes once all three hold values |

The same zero-run rule inside every other container slot is the `B7.loop-null` family of `../nesting/README.md`.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service

## Isolation on the shared stack

Each spec creates its own Test (fixture import or a blank `zz-` Test through `POST /tests`) and deletes it. The
range-mode test changes only its own Test's variables (`PATCH /tests/{id}/variables`) between runs.

## Steps

1. Fixture specs: import the fixture, validate, open it, pick the environment and Run.
2. Canvas specs: create a blank Test declaring the variables, open it, drop the For under Start, set the count (or
   the range mode with start, end and step) as expressions and bind Index in its sheet, drop Logs on its body and
   then lanes, Save and Run. The range test runs four times, changing one seed between runs.

## Validation

- The run verdict, the For's paint, its `[FOR] Starting loop (<n> iterations)` line, the ERROR line naming a null
  field, and the Log lines its body and then lane print.
- The bound index read back from the session variables after the run.
