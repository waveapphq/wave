# V-PLUGIN-HTTP-03-EDITORS: HTTP Request Map and List Editors

Verify the Headers map editor and the Retryable Codes list editor of a new HTTP
Request: their fixed item type and the entries they keep.

## Prerequisites

None. The spec clears the workbench session and drops its own HTTP Request on
an empty canvas.

## Steps

1. Open http://localhost:3000/workbench and drop an HTTP Request from the palette
2. Open its window, type the URL
3. Open Headers from the field's expand ("Open editor for Headers"), add three
   entries, remove the third, Save
4. Open Timeouts & Retries, open Retryable Codes from its expand, add 429,
   remove 502, Save
5. Save the window, reopen it and both editors

## Validation

- **Fixed type:** both editors show the `Type` header level with `Value`, a
  read-only `string` pill per entry (no combobox, no chevron) and the {x}
  toggle right after the pill with the grid gap, in the light and dark themes
- **Headers:** the field reads `{"Accept": "application/json", "X-Request-ID":
  "req-001"}`; the editor holds both entries after reopen
- **Retryable Codes:** not set, the field shows `["502", "503", "504"]` in gray
  with no reset icon; after Save it reads `["503", "504", "429"]` with the reset
  icon, also after reopen
