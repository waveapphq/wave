# V-HTTP-03: Multipart Parts Editor + File Mode Empty State

Verify the multipart Parts field and its editor, and the file-mode empty state.

## Prerequisites

None. The spec self-seeds one Test via `POST /tests` (multipart node with a
text part carrying an expression value and a file part with an `artifact://`
source; a second node in text mode for the file-mode switch).

## Steps

1. Open the seeded test in `/workbench?editTest=<id>`
2. Double-click the multipart node, open the Parts editor from the Parts
   field's expand ("Open editor for Parts")
3. Add / retype / remove parts, rename a part, save through all layers
4. On the second node switch Body Mode to File

## Validation

- **Parts row:** the one value field holds both parts on one line + the exact
  boundary generated-CT note
- **Parts editor:** PARTS badge, Kind/Name/Value-or-Source rows, expression
  toggle pressed on the text part, no expand on a part, "+ Add part", footer
  "2 parts"
- **Row behaviors:** Kind File swaps the value input for a source input with
  the placeholder
- **Persistence:** the renamed part and the `parts.0.value` dotted expression
  field survive sheet Save + config Save + toolbar save (asserted via
  `GET /tests/{id}`)
- **File mode:** File Source field with the exact placeholder
  "artifact://..., testdata://..., or /abs/path on host" + the
  auto-from-extension note; Body/Form Fields/Parts rows hidden
