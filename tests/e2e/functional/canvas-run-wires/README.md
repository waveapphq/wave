# Canvas Run Wires Functional Tests

Verify that after a run a lane wire is highlighted only when the flow went through that lane, and every other lane
wire of a Block that ran is dimmed, whether or not the lanes join one Block (REQ-3.5.1.6, REQ-3.5.1.11,
REQ-3.2.2.6). A loop body that never ran paints skipped and its wire is dimmed (REQ-3.5.1.17). The live canvas, a
page reload and the run history show the same wires (REQ-3.2.2.15).

| Spec | V-TEST ID | What it proves |
|---|---|---|
| `v-canvas-run-wires-functional.spec.ts` | V-CANVAS-RUN-WIRES-FUNCTIONAL | Walk conditions: an If/Else whose three empty branches all join the Switch lights only the IF wire; a While whose conditions are false from the start dims its body wire, paints its body Log skipped and lights its then wire; the same on a reload and on the history canvas of a tracked run. Branch targets: an If/Else whose branches lead to three Logs lights only the IF wire; a split Assert whose empty pass and fail lanes join the Try/Catch lights pass and dims fail; a Try/Catch whose catch never ran lights try and then and dims catch |

## Fixtures

- `fixture-walk-conditions.json`: the stored Test a recipe compiles from the walk conditions recipe (If/Else, Switch,
  Assert, While with a body Log, Wait Until).
- `fixture-branch-targets.json`: the stored Test a recipe compiles for an If/Else with one Log per branch, a split
  Assert with empty lanes, a Try/Catch with a try and a catch Log, and a closing Log.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service

## Steps

1. Import the fixture through `POST /tests` under a unique name and check `POST /tests/{id}/validate` reports no
   error.
2. Open the Test in the Workbench, pick the shared environment and press Run; wait for the run's closing line.
3. Read the stroke and opacity of each lane wire and the `data-execution-status` of the Blocks named below.
4. Walk conditions only: reload the page and read them again; clear the settled session, start a tracked run of the
   same Test, open its history canvas and read them again.

## Validation

- Highlighted wire: stroke `rgb(34, 197, 94)`. Dimmed wire: stroke `rgb(113, 113, 122)` at opacity `0.3`.
- Walk conditions: `branch_0` highlighted, `branch_1` and `branch_2` dimmed, While `body` dimmed, While `then`
  highlighted, the body Log `skipped`.
- Branch targets: `branch_0` highlighted, `branch_1` and `branch_2` dimmed, Assert `pass` highlighted and `fail`
  dimmed, Try/Catch `try` and `then` highlighted and `catch` dimmed, the IF Log `success`, the catch Log `skipped`.
