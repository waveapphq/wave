# V-CANVAS-BEHAVIORAL: Toolbar Edit and the Direct Re-save

Verify the toolbar Edit button follows the saved state, opens the Test's own info, and that a saved Test saves again
without a dialog.

## Prerequisites

None. The test builds its own Test through the workbench and deletes it afterwards.

## Steps

1. Open http://localhost:3000/workbench on a draft canvas.
2. Drop a Halt Block from the palette.
3. Click Save, type a name in the `New Test` dialog and click Create Test.
4. Click Edit, then Cancel; switch the theme and do it again.
5. Drop a second Halt Block and click Save.

## Validation

- **Draft:** Edit is disabled, also after a Block is dropped.
- **First save:** `New Test` asks for the name; after Create Test the breadcrumb shows the name, Save is disabled,
  Edit is enabled and the stored Test holds one Halt Block.
- **Edit:** the `Edit Test Info` dialog holds the saved name, with Cancel and Save, in both themes.
- **Second save:** no dialog opens, Save goes disabled and the stored Test holds both Halt Blocks.
