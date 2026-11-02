# For Each Control Functional Tests

Verify the For Each loop (REQ-3.5.1.16) end to end: it runs its body once per item of an array, a map or a table,
runs zero times on an empty or null collection and then leaves through its then lane, leaves the bound item as it
was after zero runs wherever it sits, and hands a null item to the body as null (REQ-3.1.3.25).

| Spec | V-TEST ID | What it proves |
|---|---|---|
| `v-ctrl-foreach-functional.spec.ts` | V-CTRL-FOREACH-FUNCTIONAL | Eight chained loops from `fixture.json`: array, empty, map, table, literal list, empty map, empty table, and a timeout caught by a Try/Catch; `non-collection.fixture.json` fails the run with `Parameter 'collection' expects array/map/table, got int` |
| `v-ctrl-foreach-nested-empty-functional.spec.ts` | V-CTRL-FOREACH-NESTED-EMPTY | Built on the canvas: a For Each over `[]` inside a For body runs zero times and the bound item keeps its seed |
| `v-ctrl-foreach-null-functional.spec.ts` | V-CTRL-FOREACH-NULL | Built on the canvas at the top level: a For Each over a null variable (picked in the collection list) and over `[]` runs zero times, its then lane runs, the index reads 0 and the item keeps its seed; a null item in `['a', None, 'c']` reaches the body as null |

The same zero-run rule inside every other container slot is the `B7.loop-null` family of `../nesting/README.md`.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service

## Isolation on the shared stack

Each spec creates its own `zz-` Test (fixture import or a blank Test through `POST /tests`) and deletes it. No
server state is reset.

## Steps

1. Fixture specs: import the fixture, validate, open it, pick the environment and Run.
2. Canvas specs: create a blank Test declaring the bound variables, open it, drop the For Each under Start, set the
   collection (pick a variable or type an expression) and bind Item and Index in its sheet, drop Logs on its body
   and then lanes, Save and Run.

## Validation

- The run verdict, each loop's `[FOR-EACH] Starting loop (<n> iterations)` line and the Log lines its body and then
  lane print.
- The bound item and index read back from the session variables after the run.
