# V-BLOCK-KEYS: selected-block keys (functional)

Enter configures the one selected block, Ctrl+Enter opens a selected Function,
and closing any floating sheet leaves the canvas keyboard alive (CANVAS-238..240,
REQ-4.2.5).

## Prerequisites

- A running stack. Each test seeds its own data via REST:
  - `POST /functions` publishes a library Function whose body holds one Log.
  - `POST /tests` seeds a Test with a Log, a Shared instance of that Function,
    and a Local Function whose body holds one Log.

## Steps

1. Click the Log block, press Enter.
2. Click the Shared Function block, press Ctrl+Enter; pop back to the root via
   the breadcrumb; click the Local Function block, press Ctrl+Enter.
3. Select two blocks (click, then Ctrl+click) and press each key.
4. Open the Log's config with Enter, close it with Esc, press Enter again;
   repeat closing with the X control; then open and close Quick Insert
   (Ctrl+Space, Esc) and press Enter again.
5. With the Log selected, click the cog on the Local Function block.

## Validation

- The sheet that Enter opens carries the selected block's name in its name
  field - not merely "a sheet is open".
- Ctrl+Enter adds one Function segment to the breadcrumb AND puts that
  Function body's own block on the canvas, for Shared and Local alike.
- With two blocks selected neither key does anything: no sheet, no drill.
- After every close path (Esc, X, Quick Insert) a further Enter reopens the
  block's config sheet - proof the canvas still hears the keyboard.
- Clicking a block's cog while a different block is selected leaves the
  configured block selected and the other one not.
