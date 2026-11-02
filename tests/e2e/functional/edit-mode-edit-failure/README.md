# V-FN-EDIT-FAILURE (functional)

Regression guard: edit-mode entry is client-side now - 'Edit' fetches the
pinned library version and builds the draft from it. If that fetch fails, the node
must stay a clean Published reference and never enter a false edit-mode state.

## Prerequisites

- Backend with `WAVE_ADMIN_ALLOWED=true` for the seed endpoints.
- Shared canvas helpers (`tests/e2e/helpers/canvas.ts`): `clickNodeKebabItem`,
  `expectNodeKebabItem`, `waitForCanvasLoad`.

## Steps

1. Seed a library entry (`POST /functions`) and a host Test with one Shared
   instance at v1.0.0 (`POST /tests`).
2. After the canvas loads, `page.route` the library-version GET
   (`GET /functions/{id}/versions/{version}`) to return 500.
3. Open the node kebab -> Edit (the client-side Edit action fetches the version).

## Validation

- The version fetch is attempted (and 500s).
- No edit-mode asterisk overlay appears (no false edit state - the entry is a
  silent no-op on failure).
- The kebab still offers Edit (the node stayed a clean Published reference).

The happy path (a reachable version -> edit mode) is exercised across the function
suite and by the use-node-actions unit tests; this spec guards the failure branch.
