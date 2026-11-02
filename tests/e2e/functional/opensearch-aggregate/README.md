# OpenSearch block: Aggregate functional suite

One spec proves the OpenSearch block's Aggregate mode against the real
OpenSearch service of the E2E stack, WAVE connecting itself (REQ-3.3.3.2,
REQ-3.4.1.15; OS-7 to OS-11, OS-13).

| Case id | Spec | Fixture | Proves |
|---------|------|---------|--------|
| V-PLUGIN-OPENSEARCH-AGGREGATE-FUNCTIONAL | `v-plugin-opensearch-aggregate-functional.spec.ts` | `fixture.json` | Stats per minute, per field value (Top values) and for the whole window; Percentile, Unique count, Increase across a counter restart, Custom (JSON) columns; errors per minute feeding an Assert and a Try/Catch; two Stats lists refused before any request |
| V-PLUGIN-OPENSEARCH-AGGREGATE-FUNCTIONAL (sheet) | `v-plugin-opensearch-aggregate-functional.spec.ts` | none (built through the sheet) | Count plus a Percentile, a Unique count and a Custom (JSON) entry added with Add stat; the Field box offers only the fields a stat can use; the run gives one column per entry |

## Prerequisites

- Backend and frontend running, and the shared execution environment
  (`ensureEnvironment` creates it if absent).
- The real-service stack (see `tests/e2e/services/README.md`, section
  OpenSearch): `opensearch` (HTTPS on 9477, the OpenSearch leaf signed by the
  WAVE Test CA).

  ```bash
  ./scripts/e2e-stack.sh up --wait opensearch
  ```

- The fixture carries the host-mode address `https://127.0.0.1:9477`; the
  import (`injectHttp`) rewrites it to `OPENSEARCH_TARGET_HOST` per mode. The
  password and the CA come from `helpers/config.ts`; the spec fills them at
  load, so the fixture stores neither.
- The sheet case types nothing that the import would rewrite: its Test is
  seeded with the Cluster URL, Username, Password and CA Certificate built from
  the `helpers/config.ts` constants.
- The block cannot write, so the spec seeds its own indexes as `admin` through
  `helpers/opensearch-stack.ts`: `wave-e2e-<token>-metrics` (MAP-METRICS,
  F-METRICS), `wave-e2e-<token>-app-logs` and `wave-e2e-<token>-logs` (MAP-LOGS,
  F-LOGS), each with the 0-replica template and `_bulk?refresh=true`.

## Isolation

- Every index is named `wave-e2e-<run token>-<purpose>` (token `sh` plus 8 hex
  characters, fresh per run) and `afterAll` deletes `wave-e2e-<run token>-*`.
- Both Tests are created under unique names and deleted in `afterAll`, and the
  workbench session is cleared.

## Steps

1. `beforeAll` seeds the three indexes.
2. The fixture test replaces `__TOKEN__`, checks each Aggregate's address,
   index, user, window, mode and On error, and that no password or CA is
   stored, then fills both from config.
3. It imports the fixture via `POST /tests` (no repairs, host rewrite on),
   asserts `POST /tests/{id}/validate?context=run` reports zero errors and zero
   warnings, and opens it in the workbench.
4. It sets the console to DEBUG, picks the shared environment, presses Run and
   waits for the run to pass and the bookend `os-agg-done`.
5. It reads the console and the session variables and sends the same
   percentile, unique count and Top values aggregations as `admin` for the
   oracle values.
6. The sheet test seeds a Test holding one OpenSearch block (connection rows
   and output bindings only) and a bookend Log, opens the block's sheet, types
   the Query in its editor, picks Mode Aggregate and Group by time Every 1
   minute, sets From and To on the Absolute tab, then adds three entries with
   Add stat: Percentile (Percent 95; `Get fields` from the Field list, then
   `latency_ms`), Unique count (`user.id`) and Custom (JSON) (Column name
   `max latency`, the aggregation typed in Edit JSON). It saves the sheet and
   the Test, runs it and waits for `os-agg-sheet-done`.

## Cases

Every Aggregate reads the fixed window From `2026-09-25T10:00:00Z` To
`2026-09-25T10:04:59Z` and is followed by an `os-agg-<case>` Log.

| Case | Block | Expected |
|------|-------|----------|
| BY-MINUTE | `-metrics`, Every 1 minute, Count and Percentile 95 of `latency_ms` | Columns `@timestamp`, `count`, `percentile 95 of latency_ms`; rows 10:00 to 10:04; counts 3, 3, 2, 0, 2; percentiles equal the oracle, the quiet 10:03 row 0; Total 10; no table in the console |
| BY-FIELD | No time grouping, Group by field `service.name`, Top values 2, Count, Average of `latency_ms`, Unique count of `user.id` | Rows `checkout` 5 / 224 / 3 and `search` 3 / 100 / 3 (unique counts equal the oracle); the Top values WARN; Total 10 |
| INCREASE | Every 1 minute, Increase of `requests_total` | 60, 70, 35, 0, 50 |
| WHOLE | No time grouping, Count, Sum of `bytes`, Min and Max of `latency_ms`, Increase of `requests_total` | One row: 10, 101.25, 40, 250, 215 |
| CUSTOM | No time grouping, Count, Custom (JSON) `max` named `slowest`, Custom (JSON) `min` unnamed | Columns `count`, `slowest`, `custom 3`; values 10, 250, 40 |
| ERRORS-PER-MINUTE | `-app-logs`, DQL `log.level: "ERROR"`, Every 1 minute, Count into `errors` | Rows 2, 0, 4, 0, 0; Total 6; Assert `max(errors.col('count')) <= 5` passes; a Try/Catch around `<= 3` catches and logs `os-agg-busy-minute-caught` |
| STAT-NO-FIELD | Sum with no field, Record and continue | Reason `Validation`; error `Stat 1 (Sum) needs a Field` |
| STAT-DUP | Count twice, Record and continue | Reason `Validation`; error `Stats 1 and 2 both make the column 'count'; each stat needs its own column` |
| SHEET | `-logs`, DQL `log.level: "ERROR"`, Every 1 minute, Count plus the three entries added in the sheet | Entries read `95th percentile of latency_ms`, `Unique count of user.id`, `Custom: max latency`; the Percentile Field list holds only numeric fields and the Unique count list only aggregatable ones; columns `@timestamp`, `count`, `percentile 95 of latency_ms`, `unique count of user.id`, `max latency`; 10:00 count 2, unique 2, max 812; 10:02 count 4, unique 4, max 1500; the quiet minutes 0 |

## Validation

- **Block states:** every passing Aggregate ends success; the two refused ones
  end amber (`warning`); the run passes.
- **Console:** a passing Aggregate writes one INFO line
  `Aggregate wave-e2e-<token>-<index> from 2026-09-25T10:00:00.000Z to 2026-09-25T10:04:59.000Z: <n> results, <m> rows, <s.ss> s`
  (BY-FIELD adds the Top values WARN); at DEBUG only its inputs, the
  `_field_caps` and `_search` requests and its outputs echo. No console line prints a Results
  header or a row. A refused Aggregate writes one WARN
  `Aggregate failed (Validation): <error>` and sends no request.
- **Results:** read from the bound table variables, never from the console.
  Float columns carry exact decimal text; the spec compares them as numbers.
  A time slot with no documents shows 0 in every stat column (OS-8).
- **Oracles:** the percentile per minute, the unique counts and the Top values
  buckets come from the same aggregation sent by the spec as `admin`, never
  from a hand-computed value. The Field lists are checked against the index's
  `_field_caps`: numeric types for Percentile, aggregatable fields for Unique
  count.
- **Log lines:** `os-agg-by-minute total=10 rows=5 first=3`,
  `os-agg-by-field total=10 top=checkout count=5`,
  `os-agg-increase total=10 rows=5`, `os-agg-whole total=10 rows=1 count=10`,
  `os-agg-custom total=10 columns=3`,
  `os-agg-errors-per-minute total=6 busiest=4`, `os-agg-busy-minute-caught`,
  `os-agg-stat-no-field ok=False reason=Validation error=<error>`,
  `os-agg-stat-dup ok=False reason=Validation error=<error>`, then the bookend
  `os-agg-done`.
