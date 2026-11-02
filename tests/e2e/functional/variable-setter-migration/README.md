# V-PLUGIN-VARSET-MIGRATION-FUNCTIONAL: Setter Migration End-to-End

Verify that the migrated Variable Setter persists and
resolves one value of EACH type plus a per-key expression and a per-key
template, end-to-end through a real run.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- The shared E2E environment (`ensureEnvironment`); the spec creates it if absent.
- No fixtures need to be pre-seeded; the spec imports its own fixture.

## Fixtures

- `fixture.json` - one Variable Setter assigning nine targets, each read back by
  a downstream Log:
  - `str_v` = "hello world" (string literal)
  - `int_v` = "42" (integer, exact text)
  - `float_v` = "2.718281828459045" (float, exact precision)
  - `bool_v` = true (boolean)
  - `arr_v` = `["a","b","c"]` (array)
  - `map_v` = `{"k1":"v1","k2":"v2"}` (map)
  - `tbl_v` = `[{id,name} x2]` (table)
  - `expr_v` = `base_num + 1` (per-key expression, evaluates to 42)
  - `tmpl_v` = `Hi {{ first_name }}` (per-key template, renders to "Hi Ada")

## Steps

1. Import `fixture.json` via `POST /tests`; assert `POST /tests/<id>/validate`
   returns zero errors.
2. Navigate to `/workbench?editTest=<id>`, wait for the canvas.
3. Select the E2E environment and Run; wait for the run to leave `running`.
4. Read the console logs.

## Validation

- Step 1: the fixture validates with zero errors.
- Step 3: the workflow status is `passed`.
- Step 4: the console contains each resolved value -
  `str=hello world`, `int=42`, `float=2.718281828459045`, `bool=True`,
  `arr=a,b,c`, `map=v1,v2`, `tbl=1,alpha,beta`, `expr=42`, `tmpl=Hi Ada`.
- Every node shows execution status `success`.
