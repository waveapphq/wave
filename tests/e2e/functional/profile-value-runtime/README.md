# Profile value runtime binding

Proves the profile value runtime binding is UNCHANGED by the editor migration. The
editor moved onto the shared sheet, but the stored shape and execution-time resolution
are identical to before.

## Pre-requisites

- Backend on `BACKEND_PORT` with `WAVE_ADMIN_ALLOWED=true`.
- The shared E2E environment (`ensureEnvironment`) - created automatically.
- No fixture file: each test builds its profile + bound test via the API, validates
  (`GET /tests/{id}/validate`, zero errors), runs it, and reads the console
  (`functional-workflow` phase).

## Execution

`./scripts/e2e-targeted-local.sh functional/profile-value-runtime/<spec>.spec.ts` from the root of the clone, or via `./scripts/ci-playwright-local.sh`.

## What it validates

| Test | Behavior |
|------|-----------|
| table binding | a `table` param bound to a Log node resolves to the same `{headers, rows}` dict at runtime (`sorted(prof.conn.keys()) == ['headers', 'rows']`, header list + a cell read back) |
| number binding | a >2^53 `integer` and a >17-significant-digit `float` resolve to an exact int + Decimal, and integer arithmetic stays exact (`prof.bignum + 1`) |

The editor-side UI round-trip (edit via the sheet, exact display on reopen, table stored
as `{headers, rows}`) is proven in `../profile-value-editor/`.

## V-PROF-VALUE-ELEMENT-TYPES

- Spec: `v-prof-value-element-types.spec.ts`; fixture: `element-types-fixture.json`.
- A custom profile map field keeps the type picked for every row through save and reopen, and a bound Test run reads each element as its declared type (REQ-3.1.3.19).

## V-PROF-VALUE-FN-ENVIRONMENT-FUNCTIONAL

- Spec: `v-prof-value-fn-environment-functional.spec.ts`; no fixture file (the Test is built in code).
- Pre-requisites: besides the shared E2E environment, the spec creates a second environment (`POST /environments/`)
  and a custom profile holding a different `url` in each; it removes both after.
- Steps: seed a Test (zero validation errors) with a profile-bound Log at the root followed by a Local Function
  whose body holds a profile-bound Log; run it from the toolbar with the shared E2E environment, then with the
  second one.
- A profile-bound Block inside a Function uses the environment the run started with, as the root Block does:
  both Logs print the shared environment's `url` on the first run and the second environment's `url` on the
  second (REQ-4.7.10, REQ-4.7.12).
