# V-CANVAS-FN-INNER-DELETE-01: Delete inner node + edges (regression guard)

Drill into a local Function carrying two connected inner Log nodes, assert the inner edge is present and inner nodes render at full opacity, delete `inner-2`, verify the edge is gone and the root tree (sibling Shell Script) is intact.

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json` (one root Shell Script + one local Function with two inner Logs connected by an edge).

## Steps

1. Open `/workbench?editTest={id}`. Drill into Function_1.
2. Verify `workflow-node-inner-1` + `workflow-node-inner-2` visible, root-shell + fn-1 NOT in active subtree.
3. Verify `data-disabled` NOT set on either inner node (regression guard for the isUnreachable styling bug).
4. Verify `.react-flow__edge` count = 1.
5. Open `inner-1`'s kebab. The "Unlink" menuitem is enabled (not grayed) because `hasConnections` reads the active subtree.
6. Select `inner-2`, press Delete. inner-2 + the inner edge both vanish; inner-1 stays.
7. Pop back to Test root. The Function node + the sibling root Shell Script node are both still on the canvas.

## Validation

- `deleteSelected` walks the active subtree: inner-2 removed without touching root state.
- `hasConnections` selector for the inner-1 node sees the inner edge (Unlink enabled).
- Inner edges are rendered + maintained by ReactFlow exactly like root edges.
- Root tree untouched by inner mutations.
