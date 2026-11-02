# V-UNDO-INTEGRITY: History Gating, Skip Transience, Dirty Truth

Functional coverage for the integrity half of the history model
(REQ-5.2.1.24): unified execution/save gating of undo/redo, runtime-transient
skip, and derived dirty against the canonical baseline.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- The shared E2E execution environment (created on demand via
  `ensureEnvironment`) - only the mid-run gating test executes a workflow.
- No pre-existing fixtures: each test self-seeds via `POST /tests`
  (+ `POST /functions` for the drilled-save test).

## Steps

1. **Mid-run gating** - seed a Test with a 6s Delay, move a
   node (one undoable entry), Run. While `workflow-status` is `running`:
   toolbar Undo/Redo are disabled and `Ctrl+Z` leaves the node transform
   untouched. After the terminal state, Undo is enabled again and reverts the
   move.
2. **Skip transience** - on a clean canvas, Skip then Unskip
   a node: `data-skipped` toggles but Undo and Save stay disabled throughout.
   Disable the same node: Undo and Save enable (persisted state is a regular
   entry); undoing it returns both to disabled.
3. **Save-while-drilled + dirty round-trip** - move a root
   node, drill into a clean Shared, Save while drilled. Save and Undo disable
   (canonical baseline), the persisted Test carries no transient
   `localDefinition` on the Shared ref, and popping out stays clean. Then
   move -> Save enables; undo -> Save disables (canonical-equal baseline);
   redo -> Save enables.
4. **Save-in-flight gating** - delay the `PUT /tests/{id}` round-trip via
   route interception, click Save, and assert Undo/Redo are disabled and
   `Ctrl+Z` is inert while the request is pending; after it lands the canvas
   is floored at the saved baseline with the moved position kept.

## Validation

- Gating reads the real toolbar buttons plus the node's React Flow transform
  (the only way a rogue keyboard undo would manifest).
- Skip assertions pair the `data-skipped` stamp with the Undo/Save button
  states; the Disable counter-case proves the asymmetry is intentional.
- The canonical-baseline assertions combine UI state (Save/Undo disabled) with
  the persisted Test read back over REST (no transient drill body).
- The save-in-flight window is widened to 1.5s by the route delay; this
  guard is best-effort and may be dropped if the interception
  proves flaky under container shards.
