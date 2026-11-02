# V-UNDO-DRILL: Undo/Redo vs Drill State

Functional coverage for the stay-put undo model (REQ-5.2.1.24):
undo keeps the user's drill location while the scope stays valid, auto-pops to the
nearest valid ancestor when the restored state unmaterializes the scope, and
pop-out never leaves residue.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No pre-existing fixtures: each test self-seeds via `POST /functions` /
  `POST /tests` (helpers in `tests/e2e/helpers/fn-seed.ts`).

## Steps

1. **Stay-put undo** - seed a Test with a local Function,
   drill in, drop a Log inside the body (one entry, no auto-connect), undo.
   The block disappears but the user STAYS drilled; breadcrumb keeps its one
   Function segment; the outer node is not rendered. Redo restores. Then pop
   out, re-drill, undo again - canvas and breadcrumb must stay in agreement.
2. **Auto-pop** - seed a Test with a clean Shared ref plus a root
   Log. Move the root Log (one pre-drill entry), drill into the Shared
   (read-only inspect), click Undo. The restored baseline has no materialized
   body for the Shared, so the view auto-pops to root without crashing; the
   move is reverted; the "Undone:" announcement toast is the cue. Redo
   re-applies the move and stays at root.
3. **Pop-out residue** - drill in / pop out on a clean Shared neither
   dirties nor commits. Then enter edit mode, disable a draft-body node while
   drilled, pop out, undo: the body edit reverts, the canvas stays at root with
   no leaked body nodes, and re-drilling shows the un-disabled draft. A final
   undo exits edit mode and floors the stack (Save and Undo disabled).

## Validation

- Stay-put: `breadcrumb` Function-segment count stays 1 across undo/redo while
  drilled; `workflow-node-fn-local` has count 0 (the canvas shows the body, not
  the parent); undo disabled exactly at the baseline.
- Auto-pop: after undo, `workflow-node-fn-shared` and `workflow-node-root-log`
  are visible at root, the Function segment count is 0, the read-only chrome is
  gone, `root-log`'s React Flow transform equals its pre-drag value, and a
  toast matching `^Undone:` is visible.
- Residue: Save stays disabled across pure drill/pop; after the post-pop undo
  the root canvas holds exactly the seeded 2 workflow nodes and the draft body
  shows `lib-drop` without `data-disabled`; the final undo leaves Save/Undo
  disabled and Redo enabled.
