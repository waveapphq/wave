# V-CANVAS-FN-EDIT-01: Save persists inner-Function edits

Drill into a local Function, drop a plugin inside, save, reload, drill back in - verify the inner plugin survived.

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json` (one empty local Function on canvas).

## Steps

1. `POST /tests` with `fixture.json`. Open `/workbench?editTest={id}`.
2. Click `node-dig-in` on Function_1. Inner empty-state placeholder appears.
3. Drag a Log plugin from the palette onto the inner canvas. A node with `data-nodetype="plugin"` appears inside Function_1.
4. Click `toolbar-save-button`; wait for the button to disable (clean state).
5. Navigate to `/workbench?editTest={id}` again (full reload to clear drill state).
6. Click `node-dig-in` on Function_1 - the inner Log node is still on canvas.
7. Click `breadcrumb-back-arrow` to pop back. Outer Function reappears.
8. Drill into Function_1 once more - inner Log node still present.

## Validation

- Saving a Test while drilled in persists the whole Test, including all nested `localDefinition` content.
- Popping a drill level does not discard inner edits.
- The drill cycle (in / out / in) is non-destructive - the inner subtree's nodes survive multiple drill transitions.
