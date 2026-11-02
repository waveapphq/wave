# V-FN-PALETTE-FUNCTIONAL: "New Function" drag end-to-end

Drag the "New Function" handle onto the canvas, then verify the local Function node persists with the correct data shape and passes server-side validation.

## Prerequisites

```bash
# Reset the worker's DB (global setup already does this).
./tests/e2e/scripts/reset.sh
```

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json` (workflow has only the implicit Start node).

## Steps

1. Open `http://localhost:3000/workbench?editTest={importedTestId}` and wait for the canvas to hydrate.
2. Expand the palette if collapsed (`palette-expand-button`).
3. Drag `palette-new-block-button` ("New Function") onto an empty canvas region; assert a local Function node appears with the auto-name `Function_1`.
4. Click `toolbar-save-button`; wait for the button to disable (clean state).
5. `GET /tests/{id}/workflow` and assert the saved node carries `nodeType: 'function'`, `functionLifecycle: 'local'`, `elementType: 'function'`, `label: 'Function_1'`, and a `localDefinition` with empty workflow + empty inputs/outputs.
6. `POST /tests/{id}/validate?context=load` and assert HTTP 200 (zero errors).

## Validation

- The local Function node is materialized by the "New Function" drag handle and carries the documented data shape (`nodeType: 'function'`, `functionLifecycle: 'local'`, `localDefinition`).
- The node passes server-side validation in the `load` context (HTTP 200 from `POST /tests/{id}/validate`).

## Out of scope (covered by other specs)

- Dragging a published Function card from the Functions Library modal.
- Workflow execution (`POST /executions`) for Function nodes. The validation gate is the strongest contract this spec asserts against the materialized node.
