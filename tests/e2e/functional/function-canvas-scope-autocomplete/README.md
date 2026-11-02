# V-CANVAS-FN-SCOPE-AUTOCOMPLETE-01: Scope-filtered autocomplete (regression guard)

Verify autocomplete suggestions differ at the Test root vs. drilled into a local Function: root sees all scopes; inside a Function only declared inputs / outputs / locals appear.

## Prerequisites

No external seed script. The spec self-seeds via:

1. `POST /admin/enable` then `POST /variables/system` (sets one system variable `sys_env`).
2. `POST /tests` with `fixture.json` (root `test_var`, root Log plugin, local Function declaring `fn_input` + inner Log plugin).

## Steps

1. Open `/workbench?editTest={id}`.
2. Open the root Log's config modal. Click into the `message` expression field, press Ctrl+Space. Autocomplete labels include `test_var` AND `sys_env`. Cancel.
3. Drill into Function_1. Open the inner Log's config modal. Click into `message`, press Ctrl+Space. Autocomplete labels include `fn_input` and EXCLUDE both `test_var` and `sys_env`.

## Validation

- `availableVariablesForManager` (in `use-variable-management.ts`) drops external scopes when `scope.insideFunction` is true.
- `expression-input` `useFunctionScope` filter prunes the autocomplete list before passing it to CodeMirror's completion source.
- Bare-name access - `fn_input` appears without an `input.` prefix.
