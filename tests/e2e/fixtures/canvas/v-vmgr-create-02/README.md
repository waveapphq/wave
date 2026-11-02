# V-VMGR-CREATE-02: Creation Windows With Set to Null Ticked

Verify the Set to null ticked field (VMGR-97, REQ-3.1.3.24) in the Variable, Function local, Input and Output windows, and the height a
ticked window opens at. Spec: `tests/e2e/visual/canvas/v-vmgr-create-02.spec.ts`.

## Prerequisites

None - the spec seeds its own `zz-` Test through `POST /tests` (one Local Function `fn1` with one
inner Log, the shape V-VMGR-CREATE-01 seeds), opens `/workbench?editTest={id}` and deletes the Test
and the workbench session afterwards. Nothing is created in the windows.

## Steps

1. Open the root "+ Add" window; drill into `fn1` and open Add > Variable, Add > Input parameter and
   Add > Output parameter.
2. In each window: name it, tick Set to null on a String, then switch the Type to Array.
3. Height test: in each window, for String, Integer, Array and Table, read the height, tick Set to
   null, read it again, untick and read it once more.

## Validation

- **Ticked:** Kind, the value editor, Format and Visual / Code are gone; one `null` field in the null
  look; Cancel and Create stay, Create enabled
- **Layout:** Type keeps half the row; Set to null sits right under Mark as secret; the `null` field
  sits under it, below the Value / Default value label
- **Type switch:** Array while ticked keeps the tick and the `null` field, with no Visual / Code
- **Height:** one ticked height for every type, never taller than the window holding a list, inside
  the screen, the `null` field and Create in view with nothing to scroll; unticked, the window
  returns to its earlier height
