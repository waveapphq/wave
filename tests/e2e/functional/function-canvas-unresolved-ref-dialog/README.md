# V-CANVAS-FN-UNRESOLVED-REF-DIALOG-01: Unresolved-reference dialog flows (regression guard)

Save / Run / BE-contract coverage for the unresolved-reference dialog. Seed a Test with a Log node whose `message` expression references variable `test1`, plus the `test1` variable. Delete `test1` from the Var Manager, then verify each path raises the right validation-error-dialog mode and the user-initiated Fix All restores the variable.

## Prerequisites

No external seed script. The spec self-seeds via `POST /tests` using `fixture.json`. The Run path also uses `ensureEnvironment` to create the shared E2E environment if missing.

## Steps

### S1 (Save path)
1. Open `/workbench?editTest={id}`. Delete `test1` in Var Mgr (confirm the references-will-become-unresolved prompt).
2. Click `toolbar-save-button`. Validation dialog opens with title "Cannot Save Test" and lists `UNDECLARED_VARIABLE`.
3. Click `validation-close-btn`. Dialog closes. The Log node's `node-validation-alert` carries `animate-validation-icon-pulse`.
4. Re-click `toolbar-save-button`. Dialog reopens. Click `validation-fix-all-btn`. Dialog closes. `test1` reappears in Var Mgr.

### S2 (Run path)
1. Reload + delete `test1` again (separate test for isolation).
2. Pick the shared env. Click `run-button`. Validation dialog opens with title "Cannot Run Test".
3. Click `validation-fix-all-btn`. `test1` is restored.

### S3 (BE contract)
1. POST /tests/{id}/validate?context=save on a clean test returns `errors: []`.
2. After the FE delete + Save flow surfaces the validation dialog, the on-disk Test still has `test1` (Save did NOT proceed).
3. POST /tests/{id}/fix on the clean test is a successful no-op.

## Validation

- `UNDECLARED_VARIABLE` is no longer in `_VARIABLE_FIX_CODES` - the BE does NOT silently recreate the variable on save.
- The variable lives in `_ON_DEMAND_VARIABLE_FIX_CODES` instead, so `fix_test` still restores it when the user clicks Fix All.
- Save / Run dialogs show the same error code; only the title and "Fix All" button reachability differ.
- Save's Cancel triggers the alert pulse (`animate-validation-icon-pulse`) on the offending Log node.

## Out of scope

Load-mode dialog ("Test Issues Found") needs the Test on disk to already carry the unresolved ref. Seeding such state via `POST /tests` is gated by the same `_validate_test_data` pipeline that rejects the Save path, so producing it from a vanilla test runner requires admin-only DB editing. Load-mode visual coverage is provided by the per-component unit tests; the V-test covers the user-facing Save and Run flows.
