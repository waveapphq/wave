# V-UNDO-LIFECYCLE: Function Lifecycle Actions vs Change History

Functional coverage for the lifecycle-vs-history contract (REQ-5.2.1.24):
enter-edit and Make Local are single undoable entries; publish
and drop are NOT undoable and perform per-entry pick-out surgery that preserves
unrelated changes; set-new appends exactly one version-flip entry with binding
reconciliation; drop/publish stay coherent at any drill depth and in the
library View.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No pre-existing fixtures: every test self-seeds via `POST /functions` /
  `POST /tests` (helpers in `tests/e2e/helpers/fn-seed.ts`, including the
  pre-seeded edit-mode node builder `editModeSharedNode`).
- No execution, so no environment is required.

## Steps

1. **Enter edit** - kebab Edit on a clean Shared ref; one undo exits
   edit mode cleanly and floors the stack; redo re-enters.
2. **Make Local** - kebab Make Local; one undo restores the shared
   instance while `GET /functions/{id}` still succeeds; redo re-applies.
3. **First publish** - move a root Log, disable a node inside the local
   Function, publish to library. Undo reverts only the move; the conversion
   and the picked-out body edit are not undoable; the badge stays `shared`
   all the way to the floor.
4. **Drop truncates redo** - move, undo (redo tail exists), Drop
   changes: both Undo and Redo are disabled afterwards.
5. **Selection-residue dedup** - move A, kebab Edit, move B, Drop,
   then undo twice: exactly two Move steps, no dead Enter-edit step, no
   edit-mode markers reappear; redo replays both moves.
6. **Publish keep-old** - enter edit, move a root Log inside the
   session, publish keep-old: 1.0.1 exists in the library, the pin stays
   1.0.0, the move survives as the only undo step.
7. **Publish set-new** - source v1.0.0 declares `legacy_in`; the
   pre-seeded draft removes it, so the Block in edit mode holds no field for
   it. Set-new re-pins with no `legacy_in` row; the single flip undo restores
   pin v1.0.0 in edit mode, whose window lists the draft's inputs (none);
   redo re-pins the new version.
8. **Drop while drilled deeper (in-Test)** - drill into the edit-mode
   draft, then into a local child, Drop changes from the chrome: the view
   pops to the Test root without crashing; the instance is a clean ref.
9. **View drop** - edit in the View, disable a body node, Drop:
   the View re-drills into the reverted published body (read-only chrome
   back, the disable gone).
10. **Publish while drilled (in-Test)** - chrome Publish + set New while
    drilled: still drilled, body refreshed to the published version,
    read-only chrome; popping out shows the clean v1.0.1 pin.
11. **View publish** - View edit + publish via the single-confirm
    outcome: read-only chrome restored, the refreshed body carries the
    published node state, the version list grew.

## Validation

- Single-entry guarantees are asserted through the toolbar buttons: Undo
  disabled exactly after the one expected step, Redo state mirroring it.
- Pick-out preservation is asserted through React Flow transforms (moves
  revert/replay exactly) while lifecycle badges / edit-mode overlays prove the
  function state never time-travels.
- Pin assertions read the `version-dropdown-trigger` inside the node's Edit
  Config modal; the field list reads the presence/absence of the `legacy_in`
  input row.
- Drill coherence is asserted via breadcrumb Function-segment counts plus the
  visible node set; View flows assert the `action-bar-*` chrome variants.
