# V-VAR-SELF-REF-FUNCTIONAL: Cycle Check in the Variable Window

Verify that the variable's window (VMGR-106, VMGR-110) refuses an expression source that reads its
own variable, or closes a loop with another variable, names the loop under the field, holds Save
until the source is fixed, and saves the fixed source.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No fixtures need to be pre-seeded; the spec imports its own fixture.

## Fixtures

- `fixture.json` - One Test (no workflow nodes) with three integer expression variables:
  - `a`: `a + 1` (reads itself)
  - `b`: `c + 1`
  - `c`: `2`

## Steps

1. Import `fixture.json` via `POST /tests` under a unique name (the import allows the self-reading
   `a`; the fixture is not validated because it holds that cycle on purpose).
2. Navigate to `/workbench?editTest=<testId>`, wait for the canvas, expand the Variable Manager.
3. Pencil `a`; replace the source with `a + 2` and leave the field; then replace it with `1 + 1`;
   Save.
4. Pencil `c`; replace the source with `b * 2` and leave the field; then replace it with `3`; Save.

## Validation

- Step 3: under the field, `Circular reference detected for variable 'a': a -> a` (`role="alert"`)
  and Save disabled; after `1 + 1` the message is gone, Save closes the window and the row shows
  `1 + 1`.
- Step 4: `Circular reference detected for variable 'b': b -> c -> b` and Save disabled; after `3`
  the message is gone, Save closes the window and the row shows `3`.
