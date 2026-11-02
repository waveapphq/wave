# Profile value-editor migration

End-to-end coverage for the profile parameter value cell after it was migrated onto
the shared Variable-Setter value affordances.

## Pre-requisites

- Backend on `BACKEND_PORT` with `WAVE_ADMIN_ALLOWED=true`.
- The shared E2E environment (`ensureEnvironment`) - created automatically.
- No fixture file: each test seeds and deletes its own custom profile via the
  `/profiles` API (`functional-destructive` phase).

## Execution

`./scripts/e2e-targeted-local.sh functional/profile-value-editor/<spec>.spec.ts` from the root of the clone, or via `./scripts/ci-playwright-local.sh`.

## What it validates

| Test | Behavior |
|------|-----------|
| scalars | string edits via the sheet; integer + boolean edit inline; all persist on reopen |
| complex | array / map / table edit via the shared complex sheet and persist; the table stays the `{headers, rows}` shape at rest (read back from the API) |
| secret | the uniform masked affordance gates clear-and-edit (integer clears + edits inline, string clears + opens the sheet); unchecking secret runs the "Remove Secret Protection?" confirm |
| per-environment | each environment keeps its own value; editing one does not bleed into the other |
| description | an edited profile description persists; clearing it persists empty |
| number precision (UI) | a >2^53 integer and a >17-significant-digit float survive save/reopen exactly |
| sheet-over-modal | the "Edit value" sheet floats above the open profile modal, edits the row, suppresses the Kind/Template dropdown, ESC closes only the sheet, and the string Format control (Auto detection + pretty-print) works |
| empty name | an unnamed (or invalid-named) parameter blocks Save and shows "Name is required"; the Trash2 delete removes a row |

The table runtime binding and the number-precision runtime binding
are proven in `../profile-value-runtime/`.

# V-PROF-SECRET-UNPROTECT-FUNCTIONAL: Removing secret protection empties every environment

Verify that unticking Secret on a profile parameter drops its stored value in every
environment, not only in the one on screen (REQ-4.7.4, REQ-4.7.10, REQ-3.1.3.5).

## Prerequisites

- Backend on `BACKEND_PORT` with `WAVE_ADMIN_ALLOWED=true`.
- The shared E2E environment (`ensureEnvironment`) - created automatically.
- No fixture file: the test creates the environments `PSU-env-A` and `PSU-env-B` and
  the custom profile `PSU-unprotect` over the API and deletes them afterwards
  (`functional-destructive` phase). The profile has three parameters with a value in
  both environments: `relay_code` (secret text), `vault_pin` (secret integer) and
  `region` (plain text).
- The system masking flags are reset to all-off before the test, so a stored secret
  shows masked.

## Steps

1. Open Profiles, search `PSU-unprotect`, click Edit
2. Select `PSU-env-B`, then `PSU-env-A`, and read the `relay_code` row
3. On `PSU-env-A` untick Secret on `relay_code` and click "Remove & Delete Value" in
   "Remove Secret Protection?"
4. Click Save Changes
5. Click Edit again and read the rows on `PSU-env-A` and on `PSU-env-B`
6. Read the profile over `GET /profiles/{id}`

## Validation

- **Before:** `relay_code` is secret and holds a value in both environments (API), and
  shows masked in both.
- **After the confirm:** the Secret box is unticked and the masked field is gone.
- **Reopened, both environments:** `relay_code` is not secret, shows no masked field
  and its value reads `Edit…` (empty); `region` reads `"eu-a"` on `PSU-env-A` and
  `"eu-b"` on `PSU-env-B`; `vault_pin` is still masked.
- **Saved profile, both environments:** `relay_code` holds no value and is not secret;
  `vault_pin` is still secret and holds a value; `region` holds its own text.
