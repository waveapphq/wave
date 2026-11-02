# V-CANVAS-FN-INNER-CONFIG-01: Inner-Function plugin config modal (regression guard)

Drill into a local Function, open the inner Log plugin's gear icon, verify the config modal opens populated with the seeded values, edit, save, reload, and verify the edit persisted.

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json` (one local Function containing one Log node, `inner-log`, whose `message` expression is `'hello before'`).

## Steps

1. Open `/workbench?editTest={id}`. Drill into Function_1.
2. Click the inner Log node's gear (`node-configure`). Config modal opens and `param-input-message` shows `'hello before'`.
3. Edit the message to `'hello after'`. Save the modal. Save the Test (`toolbar-save-button`).
4. Reload (`/workbench?editTest={id}`). Drill back in. Re-open the inner Log config. `param-input-message` now reads `'hello after'`.

## Validation

- Inner plugin config modal opens (not empty / not pointing at another node) - asserts `use-config-modal.ts` walks the active subtree on lookup.
- Edits inside a drilled-in Function are written into the right slot and persisted by the existing `PUT /tests/{id}` route.
