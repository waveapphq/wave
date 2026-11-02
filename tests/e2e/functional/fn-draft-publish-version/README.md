# V-FN-DRAFT-PUBLISH-VERSION: draft publish honors the typed version

Publishing a NEW Function from a draft (never-saved) canvas with a custom version
stores THAT version in the library and pins the node to it.

## Prerequisites

- A running stack (self-seeds: draft canvas + POST /functions via the UI).

## Steps

1. Open the workbench in draft mode (no editTest).
2. Drag "New Function" onto the canvas.
3. Kebab -> Publish to Library; set a name and a custom version (`1.4.3-beta.1`); Publish.
4. Double-click the node to open the config modal.

## Validation

- The library entry stores the typed version (`1.4.3-beta.1`), not the `1.0.0` default.
- The node becomes a Shared reference.
- The config modal shows the custom version on the dropdown trigger and NO
  missing-version banner (the pin matches a real library version).
