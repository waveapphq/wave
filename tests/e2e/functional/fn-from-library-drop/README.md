# V-FN-FROMLIB-01: dropped-from-library source link

Verify a Shared instance created by the REAL library-card drop exposes its
"From library: <name>" link (the drop stamps `originalLibraryName`), and that
clicking the link opens the Functions Library modal pre-filled with that name.

## Prerequisites

No external seed script. The spec self-seeds:

1. `POST /functions` publishes a library Function.
2. `POST /tests` creates an empty host Test.

## Steps

1. Open `/workbench?editTest={id}`.
2. Expand the palette, open the Functions Library modal, and drag the published
   Function's card onto the canvas (below the modal footprint). A shared Function
   node lands on the canvas.
3. Open the dropped node's Edit Config. The "From library: <name>" link renders.
4. Click the link. The Functions Library modal opens with its search field
   pre-filled with the Function name.

## Validation

- Distinct from `from-library-link` (which seeds `originalLibraryName` directly):
  this guards the canvas-drop stamp end-to-end (`use-canvas-drop.ts`). A drop
  that fails to stamp `originalLibraryName` shows no link, failing step 3.
- The link's `onOpen(name)` seeds `functionLibraryInitialSearch` (step 4).
