# historical-test-canvas (functional)

Historical Test Canvas painted replay, read-only Variable Manager and
Console, and post-deletion viewability.

## Pre-requisites
- Shared `E2E Execution Env` environment (auto-created by the spec via `ensureEnvironment`).
- A running backend that accepts `POST /tests`, `POST /executions`, and
  `GET /executions/history/{runId}`.

## Execution steps
1. Import `fixture.json` (a one-Log-node test) via `POST /tests`.
2. Validate it with `POST /tests/{testId}/validate` - zero errors.
3. Start a test-type execution via `POST /executions`.
4. Poll `GET /executions/{id}` until the status is terminal.
5. Navigate to `/executions/history/{executionId}`  (test-type runs use
   `run_id == execution_id`).
6. Delete the source test via `DELETE /tests/{testId}` and reload the
   page to prove the snapshot survives the delete.

## Validation criteria
- The historical canvas page renders (`workbench-page` with `data-mode="history"`).
- Canvas, palette, action-bar chrome from the real Workbench are reused.
- The palette is collapsed and disabled (`data-state="collapsed"`, `data-disabled="true"`).
- The Open-in-Workbench button and the disabled environment pill are visible.
- The Console panel is visible.
- The Clear button in the console header is disabled.
- The Variable Manager panel is visible.
- The canvas still paints after the source test is deleted.

## V-EXEC-HISTORY-FN-DRILL

`v-exec-history-fn-drill-functional.spec.ts` - a run's history canvas drilled into a Function shows that
Function's own variables in the Variable Manager (REQ-3.1.3.1). No fixture file: the spec builds the Test in code.

### Pre-requisites
- Shared `E2E Execution Env` environment.
- A running backend that accepts `POST /tests`, `POST /executions`, and `GET /executions/history/{runId}`.

### Execution steps
1. Seed a Test via `POST /tests`: a Test variable `count` and a Local Function `Scoped_Fn` (input `region`
   with a default, output `result`, local `loc_n`) whose body sets `result`, then a Log of `count`.
2. Validate it with `POST /tests/{testId}/validate` - zero errors.
3. Run it as a tracked execution (`POST /executions`) to a terminal status.
4. Open the run's history canvas and read the Variable Manager rows.
5. Drill into `Scoped_Fn` and read the rows; go back with the back arrow and read them again.

### Validation criteria
- At the history root the Variable Manager lists `count` and none of `region`, `result`, `loc_n`.
- Drilled into `Scoped_Fn` it lists `region`, `result` and `loc_n` and no longer lists `count`.
- Back at the root `count` is listed again.

## V-EXEC-HISTORY-RUN-VARS

`v-exec-history-run-vars-functional.spec.ts` - a finished run's page shows which variables the run's Blocks
read or write (VMGR-105), the OUT badge of a variable bound to a Block output, and the table the run produced,
with a secret cell masked (REQ-5.2.1.40, REQ-3.1.3.11, REQ-3.5.5.1, REQ-3.1.3.5). No fixture file: the spec
builds the Test in code.

### Pre-requisites
- Shared `E2E Execution Env` environment.
- A running backend that accepts `POST /tests`, `POST /executions`, `GET /executions/{id}/variables`,
  `GET /executions/history/{runId}` and `DELETE /executions/{id}`.

### Execution steps
1. Seed a Test via `POST /tests`: a CSV Parser whose content expression reads `region_label` and the secret
   `api_token` and whose table output is bound to `parsed_rows`, then a Log of `log_note`; `spare_count` is
   read by nothing.
2. Validate it with `POST /tests/{testId}/validate` - zero errors.
3. Run it as a tracked execution (`POST /executions`) to a passed status.
4. Open `/executions/{executionId}` (it lands on the history canvas) and read the Variable Manager rows.
5. Open the `parsed_rows` watcher and read its table.
6. Read `GET /executions/{id}/variables` and `GET /executions/history/{runId}`.
7. In a separate run, delete the source Test and open the run page again.

### Validation criteria
- `region_label`, `api_token` and `log_note` carry no Unused mark; `spare_count` still does.
- `parsed_rows` shows OUT and no Unused mark; `region_label` has no OUT.
- `parsed_rows` reads `2×3 table` (the run's table), not the empty start value.
- Its watcher reads `2 rows × 3 cols`, columns `lbl`, `tok`, `prt`, and both rows, the secret cell as
  `********`; the plaintext secret appears nowhere on the page.
- Both payloads hold `parsed_rows` as `{columns, rows}` with typed columns and the secret cell masked, and
  no plaintext secret.
- With the source Test deleted, `parsed_rows` still reads as type `table` and `2×3 table`.

## V-EXEC-HISTORY-SECRET-COPY

`v-exec-history-secret-copy-functional.spec.ts` - a finished run keeps an unflagged copy of a secret table,
map or list masked whole: the stored run, the run page payload and the run page's Variable Manager show it as
the bare mask, with no column name, map key, cell, size or count (REQ-3.1.3.5, REQ-3.1.3.23, REQ-5.2.1.40,
REQ-3.1.3.11). No fixture file: the spec builds the Test in code, through `secret-copy.ts`.

### Pre-requisites
- Shared `E2E Execution Env` environment.
- A running backend that accepts `POST /tests`, `POST /executions`, `GET /executions/{id}/variables`,
  `GET /executions/history/{runId}` and `DELETE /executions/{id}`.

### Execution steps
1. Seed a Test via `POST /tests`: a secret table `vault_rows`, a secret map `vault_map` and a secret list
   `vault_list`, each holding the cells `zwadm` and `kq4z` (shorter than the 6 character scan floor), and
   one Variable Setter whose Expression rows copy each into the unflagged `copied_rows`, `copied_map` and
   `copied_list`, and the plain table `plain_rows` into `plain_copy`.
2. Validate it with `POST /tests/{testId}/validate` - zero errors.
3. Run it as a tracked execution (`POST /executions`) to a passed status.
4. Read `GET /executions/{id}/variables` and `GET /executions/history/{runId}`.
5. In a separate run, open `/executions/history/{executionId}` and read the Variable Manager rows.

### Validation criteria
- Both payloads hold `vault_rows`, `vault_map`, `vault_list`, `copied_rows`, `copied_map` and `copied_list`
  as exactly `********`, and `plain_copy` as `{columns, rows}` with its one row.
- No column name, map key or cell of the secrets appears in either payload.
- On the run page the three secrets and the three copies read `********`; `plain_copy` reads `1×2 table`.
- No column name, map key or cell of the secrets appears on the run page.

## V-EXEC-HISTORY-SECRET-TUPLE

`v-exec-history-secret-tuple-functional.spec.ts` - a finished run keeps a one-item tuple copy of a secret list
masked whole, the same way it keeps a one-item list copy: in the stored run, in the run page payload and in the
run page's watchers (REQ-3.1.3.5, REQ-3.1.3.23, REQ-5.2.1.40, REQ-3.1.3.11). No fixture file: the spec builds the
Test in code.

### Pre-requisites
- Shared `E2E Execution Env` environment.
- A running backend that accepts `POST /tests`, `POST /executions`, `GET /executions/{id}/variables`,
  `GET /executions/history/{runId}` and `DELETE /executions/{id}`.

### Execution steps
1. Seed a Test via `POST /tests`: a secret list `vault_list` holding the one cell `kq4z` (shorter than the 6
   character scan floor), and one Variable Setter whose Expression rows store a one-item tuple of it,
   `(*vault_list,)`, as the one item of the unflagged list `tuple_in_list` and as the entry `held` of the
   unflagged map `tuple_in_map`, and a one-item list copy, `[*vault_list]`, the same way in `list_in_list`
   and `list_in_map`. A Setter refuses a bare tuple for a variable of any type, so the tuple is stored inside
   a list and a map.
2. Validate it with `POST /tests/{testId}/validate` - zero errors.
3. Run it as a tracked execution (`POST /executions`) to a passed status.
4. Read `GET /executions/{id}/variables` and `GET /executions/history/{runId}`.
5. In a separate run, open `/executions/history/{executionId}`, read the Variable Manager rows and open the
   watcher of each copy.

### Validation criteria
- Both payloads hold `vault_list` as `********`, `tuple_in_list` and `list_in_list` as `["********"]`, and
  `tuple_in_map` and `list_in_map` as `{"held": "********"}`.
- The cell `kq4z` appears in neither payload.
- On the run page `vault_list` reads `********`, the list copies read `[1 item]` and the map copies `{1 key}`;
  each copy's watcher shows `********`, and `kq4z` is nowhere on the page.

## V-EXEC-HISTORY-SECRET-COPY-LIVE

`v-exec-history-secret-copy-live-functional.spec.ts` - the same copies read masked while the Test runs live in
the Workbench: each copy's row and watcher show the bare mask, and the watcher shows no type mismatch notice. On
the run page of a run whose Test was deleted, the copies read masked and carry no SECRET badge; only the secrets
they copy do (REQ-3.1.3.5, REQ-3.1.3.11, REQ-3.1.3.12, REQ-5.2.1.40). No fixture file: both specs build the Test
through `secret-copy.ts`.

### Pre-requisites
- Shared `E2E Execution Env` environment (the spec calls `ensureEnvironment`).
- A running backend that accepts `POST /tests`, `POST /executions`, `DELETE /tests/{id}`,
  `GET /executions/history/{runId}` and `DELETE /executions/{id}`.

### Execution steps
1. Seed and validate the Test of V-EXEC-HISTORY-SECRET-COPY.
2. Open it in the Workbench, pick the shared environment and press Run; read the Variable Manager rows.
3. Open the watcher of `copied_rows`, `copied_map` and `copied_list` in turn, then close it.
4. In a separate run, run the Test as a tracked execution, delete it, open
   `/executions/history/{executionId}` and read the Variable Manager rows.

### Validation criteria
- Live, `vault_rows`, `vault_map` and `vault_list` read `********` and cannot be inspected; the three copies
  read `********` and `plain_copy` reads `1×2 table`.
- Each copy's watcher, on Current, shows `********`, no `received <type> - declared <type>` notice and no
  `type mismatch` metric.
- On the run page of the deleted Test, the three secrets read `********` with the SECRET badge, the three
  copies read `********` with no SECRET badge, and `plain_copy` reads `1×2 table` with none.
- No column name, map key or cell of the secrets appears in the Variable Manager or a watcher.
