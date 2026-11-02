# V-CANVAS-FN-PARAM-DELETE-01: Delete inner param/variable rows (regression guard)

Drill into a local Function carrying one input, one output, and one local variable; delete each row; save; reload; rows stay gone.

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json` (Function_1 with input `user_id`, output `result`, local `tmp`).

## Steps

1. Open `/workbench?editTest={id}`. Drill into Function_1. All three rows visible in the right groups (`in-badge-param:input:user_id`, `out-badge-param:output:result`, `variable-row-*` in `var-group-variables`).
2. Click the row's delete affordance (`delete-button-param:input:user_id`) - input row disappears (no confirmation needed: params have no output bindings or refs).
3. Repeat for `param:output:result` and the local variable.
4. PARAMETERS / INPUTS, PARAMETERS / OUTPUTS, and VARIABLES are all empty.
5. Click `toolbar-save-button`. Reload (`/workbench?editTest={id}`). Drill back in. All three rows still gone.

## Validation

- `handleVariableDelete` recognizes the `param:input:` and `param:output:` id prefixes and routes to `removeInputParam` / `removeOutputParam`.
- `displayVariables` (not `workflowVariables`) is the lookup source so the synth rows for declared params are resolvable.
- `removeInputParam` / `removeOutputParam` / `removeVariable` are drill-aware so the deletion lands in `localDefinition.inputs/.outputs/.variables`.
- Deletion persists through `PUT /tests/{id}`.
