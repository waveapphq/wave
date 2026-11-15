# Note Control Functional Tests

Verify that a run passes a Note straight on wherever it is wired: inside a For, For Each and While body
(REQ-3.5.1.15, REQ-3.5.1.16, REQ-3.5.1.17), a Try section (REQ-3.2.2.6), a Switch case (REQ-3.5.1.20) and a Parallel
lane (REQ-3.2.3.1) the Blocks after the Note run, and on a path that does not run (an untaken If/Else branch, a body
that runs zero times) the Blocks after the Note paint skipped.

| Spec | V-TEST ID | What it proves |
|---|---|---|
| `v-ctrl-note-run-functional.spec.ts` | V-CTRL-NOTE-RUN | For count 2 and For Each over `[1, 2]` with body Log A, Note, Log B print A, B, A, B; a While whose body is a Note and a Setter `i + 1` ends after its two rounds and its then Log reads 2; a Try section, a matching Switch case and a Parallel lane holding Log A, Note, Log B print A and B (the lane 2 Log too, the catch and default Logs never); in a For body the Log after a Note on the untaken else branch of an If/Else, and the Log after a Note in a For body that runs zero times, never print and paint skipped |

The canvas side of a Note (one input per wire where paths join, the `+` input and the cycle mark while a wire is
dragged near it) is `../../visual/canvas/v-ctrl-note-03.spec.ts`.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service

## Isolation on the shared stack

Each test creates its own `zz-note-run` Test through `POST /tests` and deletes it after, with the workbench session.
Every Log prints its name with a token unique to the test, so the lines read belong to that run alone.

## Steps

1. Build the graph in `note-flows.ts`, save it through `POST /tests` and check `POST /tests/{id}/validate` reports no
   error.
2. Open the Test in the Workbench, pick the shared environment and press Run.
3. Read the console once the run's closing line is in, and the paint of the Blocks on the canvas.

## Validation

- The run verdict, the order and count of the marker Log lines, and the absence of a While max iterations line.
- The `data-execution-status` of the Blocks after a Note on a path that did not run (`skipped`) and of the taken
  branch Log (`success`).
