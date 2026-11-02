# V-PLUGIN-VARSET-01: Var Setter Config Modal

Verify the Variable Setter control configuration modal renders with the custom inline variable editor (not generic ParameterTable).

## Prerequisites

No backend data required - control metadata is hardcoded in frontend.

## Steps

1. Open http://localhost:3000/workbench
2. Drag Variable Setter control from palette to canvas
3. Select the node and open config modal
4. Verify custom inline editor, version, changelog, and details

## Validation

- **Custom inline editor:** VariableSetterEditor renders instead of generic ParameterTable
- **Empty state:** One empty row with name input, type defaults to "String" (VARSET-10)
- **Row structure:** Name input, type dropdown, value input, expression toggle, delete button (VARSET-1)
- **Add button:** "+ Add" button visible and inserts new empty rows (VARSET-2)
- **No scope:** Scope parameter/dropdown not present
- **No outputs:** Outputs section not visible
- **Version:** Version selector shows "1.0.0"
- **Expression toggle:** Per-variable toggle switches value field to expression input (VARSET-6)
- **Details dialog:** Opens with documentation content, shows version badge "1.0.0"
- **Changelog:** Opens with 5 entries, shows release date
