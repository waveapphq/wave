# Function Publish Version Dropdown Functional Tests

Verifies the edit-mode publish version dropdown advances bump targets within the
source's MAJOR LINE (per-major no-backports, VIEW-9), skipping any taken version,
validates a custom entry against the live version list, and anchors / styles the
menu correctly.

| Spec | Anchor |
|------|--------|
| `v-fn-publish-version-01-functional.spec.ts` | REQ-3.1.2.2 - editing from 1.0.0 while 2.0.0 is taken: options bump within the 1.x line (1.0.1 / 1.1.0), +major skips the taken 2.0.0 -> 3.0.0 (never offering 2.0.0); custom field rejects a duplicate and a backport (global-latest authority), commits a valid version via the apply button; menu anchors left with the `[LATEST]` header first and no "v" prefix; publishing +major (3.0.0) succeeds with no "version exists" error. |

## Prerequisites

- Backend running on port 8000 (or `WAVE_E2E_BACKEND_PORT`).
- Frontend running on port 3000 (or `WAVE_E2E_FRONTEND_PORT`).
- No external seed script - self-seeds a library Function with 1.0.0 + 2.0.0 and
  a Test whose Shared instance is in edit mode branched from 1.0.0.

## Steps

1. Seed the library Function and the edit-mode Test via REST.
2. Open `/workbench?editTest={id}`; open the node kebab -> Publish.
3. Open the version dropdown; inspect the bump options and the custom field.
4. Pick +major, fill the changelog, Publish, and choose "Publish and set New".

## Validation

- The bump options show `-> 1.0.1 / -> 1.1.0 / -> 3.0.0`; `-> 2.0.0` is never offered.
- The custom field rejects `2.0.0` (already exists) and `1.5.0` (below latest);
  `2.5.0` applies and closes the menu.
- The menu carries the `left-0` class and the `[LATEST]` header is its first child.
- After publish, `GET /functions/{id}/versions` contains `3.0.0`.
