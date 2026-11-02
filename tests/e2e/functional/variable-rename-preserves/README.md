# V-VAR-RENAME-PRESERVES-FUNCTIONAL: Rename Preserves Value

Verify that renaming a list variable in its window (VMGR-106, VMGR-108) keeps its stored value
through the window's Save, the Test save and a reload.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No fixtures need to be pre-seeded; the spec imports its own fixture.

## Fixtures

- `fixture.json` - One Test (no workflow nodes) with one Test variable:
  - `colors`: array, value `["red", "green", "blue"]`

## Steps

1. Import `fixture.json` via `POST /tests` and check `POST /tests/{id}/validate` returns zero errors.
2. Navigate to `/workbench?editTest=<testId>`, wait for the canvas, expand the Variable Manager.
3. Pencil `colors`; change only the Name to `shades`; Save the window.
4. Save the Test and read it back from `GET /tests/<testId>`.
5. Reload the Test and open the `shades` window.

## Validation

- Step 3: the window shows `["red", "green", "blue"]`; after Save the Variable Manager shows a row
  `shades` and no row `colors`.
- Step 4: the saved variables hold `shades` with type `array` and value `["red", "green", "blue"]`, and
  no `colors`.
- Step 5: no `colors` row; the `shades` window shows `["red", "green", "blue"]`.
