# V-CANVAS-FN-PARAM-EDIT-01

Editing an existing input's or output's default in its Edit window (the row pencil, VMGR-106, VMGR-108) must persist the change.

## Pre-requisites
- Backend running on `BACKEND_PORT` (8000 by default; container-sharded mode uses 8001..N).
- The test seeds its own fixture via `POST /tests`.

## Execution steps
1. Seed fixture (one local Function with one input `user_id` and one output `result`).
2. Open the Test in the workbench and drill into Function_1.
3. Pencil on the `user_id` input row: the Edit window opens on Default showing `admin`; change it to `guest`, Save.
4. Pencil on the `result` output row: the Edit window opens on Initial showing `0`; change it to `42`, Save.
5. Save the Test.
6. Reload the page, drill back into Function_1 and open both Edit windows again.

## Validation criteria
- After step 3 + 4, the BE workflow's `data.localDefinition.inputs[0].default == "guest"` and `outputs[0].default == 42`.
- After step 6, the Edit windows show `guest` and `42`, and the stored defaults are unchanged.
