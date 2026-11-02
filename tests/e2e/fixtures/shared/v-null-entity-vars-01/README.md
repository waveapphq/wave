# V-VMGR-11: Null Values in the Suite and System Variables Lists

Verify that a null suite or system variable reads `null` in the one null look (VMGR-93) beside its
type pill, that Edit Variables shows the null chip instead of an `Edit…` preview, that a row
switched to Boolean stores `false` (VMGR-95) and that an emptied integer blocks Save.

## Prerequisites

The spec seeds and removes its own data through the API; no seed script runs. Equivalent manual
seed against a running stack (http://localhost:8000):

```bash
curl -s -X POST http://localhost:8000/suites -H 'Content-Type: application/json' -d '{
  "name": "V-VMGR-11 Suite",
  "variables": {
    "ent_string":  {"type": "string",  "value": null,        "secret": false},
    "ent_integer": {"type": "integer", "value": "5",         "secret": false},
    "ent_boolean": {"type": "boolean", "value": true,        "secret": false},
    "ent_array":   {"type": "array",   "value": null,        "secret": false},
    "ent_list":    {"type": "array",   "value": ["a","b","c"], "secret": false},
    "ent_word":    {"type": "string",  "value": "null",      "secret": false},
    "ent_switch":  {"type": "string",  "value": "switch me", "secret": false}
  }
}'
```

System variables: add `nv11_<run>_string` (string, null), `nv11_<run>_integer` (integer, `5`),
`nv11_<run>_boolean` (boolean, `true`), `nv11_<run>_array` (array, null) and `nv11_<run>_list`
(array, `["x","y"]`) to the existing collection (GET `/variables/system`, then POST the merged map).

## Steps

1. Open http://localhost:3000/suites/{suite id} and look at the sidebar Variables list
2. Click the Variables pencil to open Edit Suite Variables
3. Clear the `ent_integer` value box, then type `7`
4. Switch `ent_switch` to Boolean and click Save
5. Open http://localhost:3000/settings/variables and look at the System Variables list
6. Click Edit Variables, then Cancel
7. Delete the suite and each `nv11_<run>_*` system variable (DELETE `/variables/system/{name}`)

## Validation

- **Null rows (steps 1, 5):** `ent_string` / `ent_array` and the `nv11_<run>_string` / `_array` rows read `null` in gray italic mono beside the STRING / ARRAY pill, on the pill's line; the rows are not faded
- **Other rows (steps 1, 5):** `5`, `true`, `[3 items]` / `[2 items]` in their type colors; `ent_word` reads `null` upright in the string color; no `Edit…` anywhere
- **Edit dialog (steps 2, 6):** each null row shows a `null` chip named `<name> (null)` with the tooltip "Click to enter a value", never an `Edit…` button; the list row's button reads `3 items`
- **Emptied integer (step 3):** the row shows "Must be an integer", Save is disabled and the note reads "Save is disabled: the variables have errors"; typing `7` clears both
- **Save (step 4):** the suite stores `ent_switch` as boolean `false`, `ent_integer` as `7`, and `ent_string` / `ent_array` still null; the sidebar reads `false` for `ent_switch`
- **Cleanup (step 7):** no `nv11_<run>_*` system variable is left
