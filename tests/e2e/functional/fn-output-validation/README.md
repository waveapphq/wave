# Function Output Validation Functional Tests

Verifies the no-producer rule: a declared output that no block writes
is a non-blocking WARNING, so save, run, and publish all proceed.

| Spec | Anchor |
|------|--------|
| `v-fn-output-validation-01-functional.spec.ts` | REQ-3.1.2.4 - save non-blocking + reworded validate warning (`OUTPUT_HAS_NO_PRODUCER`), run completes (Function passes), publish proceeds. |
| `v-fn-unused-param-warn-functional.spec.ts` | REQ-3.1.2.7, FNCFG-5 - every Function Block run prints one run-console WARN per input no unmuted block uses and per output no unmuted block writes, after `Entering Function` and before the body's first line; six groups (block settings, condition rows, Function declarations and output writers, a Function Block run refused before its body, a body that fails, a Function Block in a For with count 3), each for a Local Function built in the UI, a library Function and a Function nested in a Function. |

The run-console WARN for an unused input or an unwritten output is covered by
`v-fn-unused-param-warn-functional.spec.ts` (below).

## Prerequisites

- Backend running on port 8000 (or `WAVE_E2E_BACKEND_PORT`).
- Frontend running on port 3000 (or `WAVE_E2E_FRONTEND_PORT`).
- No external seed script - self-seeds via `POST /tests` with a Local Function
  that declares output `result` but never writes it.

## Steps

1. Seed the Test via `POST /tests` (succeeds - save is non-blocking).
2. Validate via `POST /tests/{id}/validate` (no-producer is a warning, not an error).
3. Open `/workbench?editTest={id}`, pick the environment, Run.
4. Publish the Function via `POST /tests/{id}/functions/publish`.

## Validation

- `POST /tests` succeeds (save not blocked by the unproduced output).
- Validate returns 200 with `OUTPUT_HAS_NO_PRODUCER` in `warnings`, not `errors`;
  the message matches `Declared output '<name>' is not written by any block`.
- The workflow status settles `passed` and the Function node ends `passed`.
- The publish call returns ok (publish not blocked).

## v-fn-unused-param-warn-functional (REQ-3.1.2.7)

Prerequisites: no seed script. Each test seeds one blank `zz-` Test (the refused-input tests also
declare the variable `nothing` holding null); the library tests publish a `zz-` library Function
(deleted with `cascade=true`); the nested tests seed the Function inside a seeded Local Function.

Steps:

1. Local: drag a Function from the palette (inside a For with count 3 for the loop group), drill in,
   make its inputs, outputs and locals with the Add menu, drop and set the body blocks (Log in
   expression and template mode, Shell Exec with an expression environment entry, For Each over an
   input, Variable Setter rows, the five check blocks, a nested Function Block set in its window), mute
   one block from its context menu, give the Function Block's inputs their values, Save. The stored body is compared with the
   body the library and nested tests seed.
2. Library and nested: seed the same body as a published Function on a Shared Function Block, or as a
   Local Function inside a Local Function.
3. Run and read the console.

Validation: the console holds exactly the expected `Function '<name>' declares input '<input>' but no
block uses it` / `Function '<name>' declares output '<output>' but no block writes it` WARN lines,
source FUNCTION, in declaration order, once per Function Block run; each run prints `Entering Function`, then
its WARN lines, then the body's first line (or the refusal `'req' is null`); the run verdict is
passed, or failed for the refused input and the failing body.
