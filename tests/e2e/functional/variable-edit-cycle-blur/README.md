# V-VAR-EDIT-CYCLE-BLUR-FUNCTIONAL: Window Cycle Check on Blur

Verify that leaving an expression variable's source field in its window (VMGR-106, VMGR-110) after
making it read itself shows the cycle path under the field, holds Save while the cycle is present,
clears the message when the source is corrected, and lets the save succeed.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No fixtures or pre-seeded data required.

## Fixtures

None.

## Steps

1. Navigate to `/workbench` (draft workflow). Expand the Variable Manager.
2. "+ Add": create `x`, Type Integer, Kind Expression, source `2 + 3`.
3. Pencil `x`; replace the source with `x + 1` (the field keeps focus), then leave the field.
4. Replace the source with `1 + 1` and leave the field.
5. Save the window.

## Validation

- Step 3: no message while the field has focus; once it is left, the field reads
  `Circular reference detected for variable 'x': x -> x` and Save is disabled.
- Step 4: the message is gone and Save is enabled.
- Step 5: the window closes; exactly one row `x` is left, it keeps the `{x}` badge and shows `1 + 1`.
