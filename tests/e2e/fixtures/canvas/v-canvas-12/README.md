# V-CANVAS-12: Config Modal

Verify block configuration modal displays properly with all required sections.

## Prerequisites

No fixtures required. Test creates nodes dynamically and opens config modal.

## Steps

1. Open http://localhost:3000/workbench
2. Drag HTTP Client block from palette to canvas
3. Click on the block to select it
4. Click gear icon in action row to open config modal

## Validation

- **Modal header:** Element name (left) + version dropdown (right)
- **Name input:** Field for user-defined display name with helper text
- **INPUT PARAMETERS section:** Table with Parameter, Type, Value columns
- **OUTPUT VARIABLES section:** Table with Parameter, Type, Assign to columns
- **Footer left:** [Changelog] [Details] buttons
- **Footer right:** [Cancel] [Save] buttons
- **No X button:** Modal closes only via Cancel/Save
- **Version selector:** Shows current version, dropdown arrow, green arrow if newer available
- **Save validation:** Button disabled until required fields filled
