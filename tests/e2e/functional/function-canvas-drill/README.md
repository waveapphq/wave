# V-CANVAS-FN-DRILL-01: Drill-down into local Functions

Seed a Test carrying nested local Functions, exercise drill-down via every affordance (glyph / kebab / Cmd+Ctrl+Enter), assert the violet breadcrumb segments, and pop back via parent segment and back arrow.

## Prerequisites

Global setup resets the per-worker DB before all tests; no separate seed script. The spec self-seeds via `POST /tests` using `fixture.json`.

## Steps

1. `POST /tests` with `fixture.json` (a Test that already contains `Function_1` carrying an inner `Helper_1` local Function).
2. Open `/workbench?editTest={importedTestId}` and wait for the canvas to hydrate.
3. S1: Click `node-dig-in` on the outer Function. Inner Helper node becomes visible; outer node leaves the canvas; the breadcrumb gains a violet `Function_1` segment (`svg.lucide-square-function` present).
4. S2: From inside `Function_1`, click `node-dig-in` on `Helper_1`. The inner empty-state placeholder appears with "Drag a plugin to define". Breadcrumb shows two violet function segments.
5. S3: Select the outer Function node and press `Control+Enter`. Inner Helper node becomes visible (drill-via-keyboard parity).
6. S4: With the outer Function drilled into, click the Test name segment in the breadcrumb. Outer Function reappears; inner Helper leaves the canvas.
7. S5: Drill twice deep, click `breadcrumb-back-arrow`. One function segment is left; the canvas shows `Function_1`'s inner subtree.

## Validation

- Drilling swaps the active subtree on the same React Flow canvas.
- Three drill triggers (glyph, kebab "Open" - covered via the equivalent dig-in path here, Cmd/Ctrl+Enter) all resolve to the same drill handler.
- Breadcrumb appends one violet function segment per drill entry.
- Pop is per-segment or one-level via back arrow.
- Inner-empty-state placeholder swaps copy to the Function-body wording.

## V-FN-DRILL-SAVE-DELETE

`v-fn-drill-save-delete-functional.spec.ts` - a Save or a delete made while drilled into a Function touches only
that Function's body (REQ-3.1.2.3, REQ-3.1.3.5). No fixture file: the spec builds the Test in code.

### Prerequisites

No external seed script. The spec seeds a root Log and a Local Function `sec_fn` (an SSH Session Open with no
password yet, and a CSV Parser whose Row Count writes the local `bound_local`) via `POST /tests`, zero
validation errors.

### Steps

1. Open the Test and drill into `sec_fn`.
2. Type a password in the SSH Block's sheet, save the sheet, then Save from the toolbar.
3. Read the stored Test; go back with the back arrow; reopen the Test and drill in again.
4. Delete `bound_local` from its Variable Manager row (confirm the dialog), then Save from the toolbar.
5. Read the stored Test again.

### Validation

- After the drilled Save the canvas still shows the Function's two Blocks under the Function breadcrumb; the
  stored body holds the same two Blocks with the password sealed, and the root holds the Log and the Function.
- The back arrow shows the Test's own Blocks; reopening and drilling in shows the same body.
- After the drilled delete both Blocks stay on the canvas and the next Save is accepted: the stored body keeps
  both Blocks and names `bound_local` nowhere.
