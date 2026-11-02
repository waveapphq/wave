# V-RC-NESTED: Run-Current Parity for Nested Unsaved Edits

Functional coverage for nested run-current parity (REQ-5.2.1.24,
"Running with unsaved changes"): unsaved in-memory edits execute at depth 1-3
for Local bodies and Shared edit-mode drafts across the whole-Test run, the
scoped Function run, and the library View run. Also guards the run gate
(EDIT_MODE_DRAFT_IN_BODY skips context="run").

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- The shared E2E execution environment (created on demand via
  `ensureEnvironment`).
- No pre-existing fixtures: each test self-seeds via `POST /functions` /
  `POST /tests`.

## Steps

Nesting shape (one fixture, all tests): the Test runs
`d0-keep -> L1(local)`; L1's body runs `Inner(shared) -> d1-drop`; Inner's
published body runs `d2-keep -> L3(local) -> d2-drop`; L3's body runs
`d3-keep -> d3-drop`.

UI staging (all unsaved): drill into L1 and disable `d1-drop` (depth 1); drill
into the nested Shared and enter ITS edit mode via the drilled chrome's Edit
Function button, then disable `d2-drop` inside the draft (depth 2); drill into
L3 and disable `d3-drop` (depth 3). The chrome button is used instead of the
node kebab because drilling preserves the root viewport and the kebab's tall
menu cannot fit around a mid-screen node.

1. **Whole-Test run** - pop to root and Run. The run-current payload carries
   the in-memory workflow, the run is admitted by the validation gate despite
   the nested edit-mode draft (run-gate fix), the session passes, kept lines
   log, dropped lines do not, and the edit-mode WARN appears.
2. **Scoped run** - pop to the L1 scope and Run. The dispatch carries
   `scope_mode=function` plus the in-memory workflow; the same nested edits
   execute; `d0-keep` (outside the scope) does not log.
3. **View run + undo floor** - open Outer (a published Function whose body
   references Inner) in the library View, enter edit mode, make the same
   depth-2/3 edits BELOW the synthetic root, then Run while still drilled
   (in View mode the Run button always dispatches the whole-Function
   standalone run). The `POST /functions/{id}/run` draft carries the nested
   edit-mode draft with the disables folded in (deep fold); execution
   matches. Then undo until the floor: the canvas never blanks - the loaded
   View body is the baseline.

## Validation

- Log assertions: `d0-keep` (whole-Test only), `d2-keep`, `d3-keep` present;
  `d1-drop`, `d2-drop`, `d3-drop` absent. Each absence proves the EDITED
  in-memory body executed at that depth instead of the saved/published one.
- Payload assertions: whole-Test and scoped runs POST `/workbench/run` with
  `workflow` (and `scope_mode=function` when drilled); the View run POSTs
  `/functions/{id}/run` with `draft.workflow.nodes[inner-shared].data` showing
  `editMode: true` and the depth-2 disable inside its nested draft.
- Floor assertions: after exhausting undo, the Undo button is disabled,
  `workflow-node-view-shared-root` is visible, and no empty-state placeholder
  is shown.
