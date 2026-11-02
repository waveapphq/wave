# V-WORKBENCH-SAVE-SANITIZE: Save Sanitizes UI-Only Fields

End-to-end coverage for save-time sanitizing.
React Flow's `applyNodeChanges` / `applyEdgeChanges` stamp UI-only fields
(`selected`, `dragging`, `data.hasNewerVersion`, edge `selected`) onto the
workflow store; two pure boundary helpers
(`sanitizeNodesForSave`, `sanitizeEdgesForSave`) strip those fields
before every POST to the backend or write to the localStorage draft.

This spec drives the toolbar Save flow through the UI and asserts the
persisted YAML is clean.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No external fixture file - the spec POSTs a small inline fixture (two Log
  nodes chained off Start) via `POST /tests`.

## Steps

1. Import the inline fixture, navigate to `/workbench?editTest=<id>`.
2. Drag `log-a` ~60px to dirty the store and stamp transient `dragging`.
3. Click `log-b` to set `selected:true` on a node.
4. Click an edge to set `selected:true` on an edge.
5. Double-click `log-a` to open its config modal, then click Save (this
   forces `data.hasNewerVersion` onto the node via `use-config-modal.ts`).
6. Click the toolbar Save button.
7. Wait for `toolbar-save-button` to become disabled (save committed,
   `isDirty=false`).
8. `GET /tests/{id}/workflow` and assert no node carries `selected`,
   `dragging`, or `data.hasNewerVersion`, and no edge carries `selected`.

## Validation

- The save round-trip succeeds (toolbar Save toggles back to disabled).
- For every node in the persisted workflow:
  - top-level `selected` is absent;
  - top-level `dragging` is absent;
  - `data.hasNewerVersion` is absent.
- For every edge in the persisted workflow:
  - top-level `selected` is absent.

If any field leaks, at least one of the four save sites has dropped a
sanitizer call.
