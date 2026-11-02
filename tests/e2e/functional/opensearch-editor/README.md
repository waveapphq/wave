# OpenSearch block: Query editor functional suite

One spec proves the OpenSearch block's Query editor against the real OpenSearch
service of the E2E stack, the WAVE server pulling the field list itself: Get
fields and Refresh fields on the editor chip, a failed pull and its one toast,
the unknown-field check, Run of unsaved text, Stop of a slow search, and the
Index pattern row's Get indexes with its refusal texts (REQ-3.3.2.5,
REQ-3.3.2.6, REQ-5.1.2; OS-11 to OS-13).

| Case id | Spec | Fixture | Proves |
|---------|------|---------|--------|
| V-PLUGIN-OPENSEARCH-EDITOR-FUNCTIONAL | `v-plugin-opensearch-editor-functional.spec.ts` | `fixture.json` | GET-FIELDS, REFRESH, FAILED (with the one-toast rule), CHECKS, RUN, STOP, and Get indexes with a blank Index pattern |

## Prerequisites

- Backend and frontend running, and the shared execution environment
  (`ensureEnvironment` creates it if absent).
- The real-service stack (see `tests/e2e/services/README.md`, section
  OpenSearch): `opensearch` (HTTPS on 9477, the OpenSearch leaf signed by the
  WAVE Test CA). Nothing listens on 9479.

  ```bash
  ./scripts/e2e-stack.sh up --wait opensearch
  ```

- The fixture carries the host-mode address `https://127.0.0.1:9477`; the
  import (`injectHttp`) rewrites it to `OPENSEARCH_TARGET_HOST` per mode and
  never touches `https://127.0.0.1:9479`. The Cluster URL the spec types to fix
  a block is `https://<OPENSEARCH_TARGET_HOST>:<OPENSEARCH_PORT>`. Every Get
  fields pull runs on the WAVE server, so these addresses are the ones that
  server dials.
- The users (`wave`, `wave-limited`), their passwords and the CA come from
  `helpers/config.ts`; the spec fills them at load, so the fixture stores no
  secret and no PEM.
- `beforeAll` seeds, as `admin` through `helpers/opensearch-stack.ts`:
  `wave-e2e-<token>-app-logs` and `wave-e2e-<token>-fields` (MAP-LOGS, the ten
  F-LOGS documents each) and `wave-e2e-<token>-slow` (S-SLOW, 2000 documents).
  STOP, the one test that runs the `Slow` block, first calibrates the slow
  query (`calibrateSlowQuery`) so one block-shaped search takes 3 to 5 s; the
  other tests leave that block at one loop pass.

## Isolation

- Every index is named `wave-e2e-<run token>-<purpose>` (token `sh` plus 8 hex
  characters, fresh per run) and `afterAll` deletes `wave-e2e-<run token>-*`.
  The spec reads, but never changes, anything else on the cluster.
- REFRESH changes the mapping of `-fields` only, so `-app-logs` stays F-LOGS
  for CHECKS and RUN.
- Each test imports the fixture under a unique name; `afterAll` clears the
  workbench session and deletes every imported Test.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/opensearch-editor/v-plugin-opensearch-editor-functional.spec.ts`.
2. Each test replaces `__TOKEN__`, checks that every secret and PEM row is
   blank and that each block logs in as a stack user, fills the password and
   the CA, puts the slow query in place of `__SLOW_QUERY__`, imports
   the fixture via `POST /tests` (no repairs, host rewrite on), asserts zero
   errors and zero warnings from `POST /tests/{id}/validate?context=run`, opens
   it in the workbench and selects the shared environment. In GET-FIELDS and
   REFRESH, FAILED and Get indexes the spec records every toast the page
   raises and every Get fields request and answer.
3. GET-FIELDS and REFRESH: the `Fields` block's Query editor; Get fields on the
   chip; the Fields popover searched for `reg`; `PUT <index>/_mapping` adds
   `region` (keyword) and one document holding it is indexed; Refresh fields;
   the popover searched again; `reg` typed into an emptied editor.
4. FAILED: the `Unreachable` block (Aggregate, Cluster URL
   `https://127.0.0.1:9479`); Get fields from the Group by field list; the Query
   editor opened over the sheet and its chip clicked; the editor closed, the
   Cluster URL set to the real cluster in the sheet, the editor reopened and Get
   fields clicked.
5. CHECKS and RUN: the `App logs` block's Query editor; Get fields;
   `log.invalid: ERROR` typed; then `log.level: "WARN"` typed and Run pressed
   without saving; then Save in the editor, Save of the sheet and Save of the
   Test from the toolbar.
6. STOP: the `Slow` block's Query editor (Query DSL, Timeout 300); Run; once
   the search task runs on the cluster, Stop in the editor.
7. Get indexes: the `Indexes` block (Aggregate); Index pattern emptied and Get
   indexes clicked in its list; the Group by field list opened and its line
   clicked; the Query editor opened, its chip hovered and clicked; Index pattern
   set to `wave-e2e-<token>-*` and Get indexes clicked. Then the `Limited` block
   (`wave-limited`, Index pattern `wave-e2e-*`): Get indexes clicked.
8. NULL CREDENTIAL: the `App logs` block seeded with an API Key that holds null
   (the way an import stores a secret WAVE cannot open); its Query editor; Get
   fields clicked; then Run.

## Validation

- **GET-FIELDS:** the start is answered 202 (a real pull); the chip passes
  exactly through `Getting fields...`, `Got N fields`, `Fields · N`, N being
  the `_field_caps` field count of the index with the metadata fields left out
  (the `openSearchFieldCount` oracle); the pull's answer holds N fields and the
  one index; no toast.
- **REFRESH:** before Refresh the popover finds no match for `reg`; the oracle
  count grows by one; Refresh sends `refresh: true`, is answered 202, and the
  chip passes through the same three states with N+1; the popover then lists
  `region`, and typing `reg` shows the Fields section with the one suggestion
  `region`; no toast.
- **FAILED:** the Group by field pull fails with the reason
  `Could not connect to OpenSearch at 127.0.0.1:9479: [Errno 111] Connection refused`;
  exactly one error toast titled `Could not get fields` carries it, and the
  list footer reads `Could not get fields. Try again`. The editor chip over the
  sheet reads `Could not get fields` with the reason as its tooltip; its click
  starts one pull, which fails, and exactly one new toast follows (two in all,
  one per pull). With the Cluster URL fixed, the chip starts at `Get fields`
  and settles on `Fields · N` for `-app-logs`; no new toast.
- **CHECKS:** with the fields loaded, the server check answers
  `Unknown field log.invalid in wave-e2e-<token>-app-logs`; `log.invalid` carries a
  wavy amber (`#f59e0b`) underline; the strip reads
  `Line 1: Unknown field log.invalid in wave-e2e-<token>-app-logs` as an
  advisory (not an alert); Save and Run stay enabled.
- **RUN:** the finding goes away for `log.level: "WARN"`; the run passes; the
  block's only console line is the INFO
  `Search wave-e2e-<token>-app-logs from 2026-09-25T10:00:00.000Z to 2026-09-25T10:04:59.000Z: 1 result, 1 kept, <n.nn> s`;
  Success true, Total results 1, Results holds `@timestamp`, `log.level`,
  `message` of the one WARN document (`Retrying payment`); no other block ran.
  The editor keeps the WARN text while the Query row of the sheet and the saved
  Test still hold `log.level: "ERROR"`; after the three Saves the saved Test
  holds `log.level: "WARN"`.
- **STOP:** within 5 s of Stop every search task on `-slow` is canceled or
  gone from `_tasks`; the run and the block end `stopped`, Run is back, and
  the block wrote no `Search wave-e2e-<token>-slow from ...` summary line.
- **Get indexes, blank pattern:** the pull is sent with an empty Index pattern
  and fails; exactly one error toast titled `Could not get indexes` reads
  `These credentials may not list every index. Type an index pattern they can read, such as logs-*`;
  the footer reads `Could not get indexes. Try again`.
- **Blank pattern, field rows:** the Group by field list shows only the muted
  line `Fill in Index pattern to get fields`, with no button and no
  suggestion. The editor chip reads `Get fields`, idle although the index pull
  failed, is `aria-disabled` and shows that line as its tooltip. Neither the
  line nor the chip starts a pull (one start in all so far).
- **Run indexes:** with `wave-e2e-<token>-*` the list holds exactly
  `-app-logs`, `-fields` and `-slow`, sorted, each marked `index`; no toast.
- **Limited user:** OpenSearch answers `wave-limited` 403 `security_exception`
  for the same index listing (read by the spec as that user); exactly one more
  toast titled `Could not get indexes` reads
  `These credentials may not read wave-e2e-*. OpenSearch said: security_exception: <reason>`
  with that reason, and the footer reads `Could not get indexes. Try again`.
- **Null credential:** the Get fields start is answered 422 and exactly one
  toast titled `Could not get fields` reads
  `Cannot resolve API Key: 'api_key' is null`; the run of the same block fails
  with `Block 'App logs' failed: 'api_key' is null` and the block writes no
  INFO line (REQ-3.1.3.21).
