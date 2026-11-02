# OpenSearch block: Search functional suites

Specs that prove the OpenSearch block against the real OpenSearch service of the
E2E stack, WAVE connecting itself (REQ-3.3.2.2, REQ-3.3.2.3, REQ-3.3.2.5,
REQ-3.3.2.6, REQ-3.3.3.1, REQ-3.3.3.6, REQ-3.4.1.15, REQ-5.1.2; OS-2, OS-4 to
OS-6, OS-8 to OS-11).

| Case id | Spec | Fixture | Proves |
|---------|------|---------|--------|
| V-PLUGIN-OPENSEARCH-SEARCH-FUNCTIONAL | `v-plugin-opensearch-search-functional.spec.ts` | `fixture.json` | Wait-then-collect, Max results and Total results, escaping, Query DSL and expression forms, result shapes, sort, paging, date math |
| V-PLUGIN-OPENSEARCH-SEARCH-ERRORS-FUNCTIONAL | `v-plugin-opensearch-search-errors-functional.spec.ts` | `fixture-errors.json`, `fixture-stop.json` | Every failure reason, the amber outcomes, Timeout and Stop ending the search on the cluster, Fail the block |
| V-PLUGIN-OPENSEARCH-AUTH-FUNCTIONAL | `v-plugin-opensearch-auth-functional.spec.ts` | `fixture-auth.json` | Basic, client certificate, Bearer (JWT), API Key, the plain-http gateway with a path prefix, verify on and off, secrets never logged |

## Prerequisites

- Backend and frontend running, and the shared execution environment
  (`ensureEnvironment` creates it if absent).
- The real-service stack (see `tests/e2e/services/README.md`, section
  OpenSearch): `opensearch` (HTTPS on 9477, the OpenSearch leaf signed by the
  WAVE Test CA) and `opensearch-gateway` (plain HTTP on 9478, path prefix
  `/os`). Nothing listens on 9479.

  ```bash
  ./scripts/e2e-stack.sh up --wait opensearch opensearch-gateway
  ```

- Fixtures carry the host-mode addresses `https://127.0.0.1:9477` and
  `http://127.0.0.1:9478/os`; the import (`injectHttp`) rewrites them to
  `OPENSEARCH_TARGET_HOST` per mode and never touches 9479. Users, passwords,
  the JWT, the CA and the tls-lab client pair come from `helpers/config.ts`;
  the spec fills them at load, so no fixture stores a secret or a PEM.
- The block cannot write, so each spec seeds its own indexes as `admin`
  through `helpers/opensearch-stack.ts`: the `wave-e2e` 0-replica template,
  then each index with an explicit mapping, then `_bulk?refresh=true` checked
  for `errors: false`.

## Isolation

- Every index is named `wave-e2e-<run token>-<purpose>` (token `sh` plus 8 hex
  characters, fresh per run) and `afterAll` deletes `wave-e2e-<run token>-*`.
  No spec touches another index or a cluster setting.
- The auth spec mints one API token named
  `wave-e2e-<run token>-auth-api-key` (a name can never be reused on the node,
  even after revoking) and revokes it in `afterAll`.
- The imported Test is deleted and the workbench session cleared in
  `afterAll`.

## V-PLUGIN-OPENSEARCH-AUTH-FUNCTIONAL

### Steps

1. `beforeAll` seeds `wave-e2e-<token>-app-logs` with MAP-LOGS and F-LOGS (10
   documents, 6 of them `ERROR` inside the fixed window) and mints one API
   token.
2. The spec replaces `__TOKEN__`, checks each Search's address, user, Verify
   Server Certificate and On error against its case and that every secret and
   PEM row is blank, then fills them: the password, the CA, the client
   certificate and key, the JWT, the minted token (and `ApiKey <token>` for
   the scheme-word case).
3. It imports the fixture via `POST /tests` (no repairs, host rewrite on),
   asserts `POST /tests/{id}/validate?context=run` reports zero errors and
   zero warnings, and opens it in the workbench.
4. It sets the console to DEBUG, picks the shared environment, presses Run
   and waits for the run to pass and the bookend `os-auth-done`.
5. It reads the console and the session variables, then revokes the token,
   deletes the indexes and the Test.

### Cases

Each Search reads `-app-logs`, From `2026-09-25T10:00:00Z` To
`2026-09-25T10:04:59Z`, DQL `log.level: "ERROR"`, Fields `@timestamp`,
`log.level`, `message`; an Assert checks its outputs and a Log writes its
`os-auth-<case>` line.

| Case | Block | Expected |
|------|-------|----------|
| BASIC | `https://127.0.0.1:9477`, `wave` / `os-secret`, CA | Total 6 |
| CLIENT-CERT | No credentials; tls-lab Client Certificate and Client Key; CA | Total 6 |
| BEARER | Bearer Token = the checked-in JWT; CA | Total 6 |
| API-KEY | API Key = the token minted in `beforeAll`; CA | Total 6 |
| GATEWAY | `http://127.0.0.1:9478/os`, `wave` / `os-secret` | Total 6; every request path starts `/os/` |
| VERIFY-OFF | Verify Server Certificate off, no CA, `wave` / `os-secret` | Total 6 |
| VERIFY-NO-CA | Verify on, no CA, Record and continue | Reason `Unreachable`; error `Could not connect to OpenSearch at <host>:9477: ...CERTIFICATE_VERIFY_FAILED...` |
| SCHEME-WORD | API Key typed as `ApiKey <token>`, Record and continue | Reason `AuthFailed`, error `HTTP 401: Unauthorized` (sent as typed) |
| ANONYMOUS | No credentials, no client certificate, Record and continue | Reason `AuthFailed`, error `HTTP 401: Unauthorized` |
| NO-LEAK | - | The whole run log, DEBUG included, holds none of the secrets |

### Validation

- **Block states:** the six passing Searches, every Assert and every Log end
  success; the three recorded Searches end amber (`warning`); the run passes.
- **Passing Searches:** the block's only INFO line is
  `Search wave-e2e-<token>-app-logs from 2026-09-25T10:00:00.000Z to 2026-09-25T10:04:59.000Z: 6 results, 6 kept, <n.nn> s`
  (no result rows are printed); its DEBUG request lines are the
  `_field_caps` read, then the `_search`; Success true, Total results 6, and
  Results holds `@timestamp`, `log.level`, `message` for the six ERROR
  documents, newest first; the Log prints
  `os-auth-<case> total=6 first=Stock check failed`.
- **Gateway:** every DEBUG request line starts `GET /os/` or `POST /os/`.
- **Recorded Searches:** one WARN `Search failed (<reason>): <error>`; only the
  `_field_caps` request is attempted; Success false, Total results 0, Results
  empty; the Log prints `os-auth-<case> total=0 reason=<reason> error=<error>`.
  VERIFY-NO-CA also writes exactly one DEBUG line,
  `Trusting WAVE's built-in certificate list (<label>)`.
- **No leak:** each Search echoes its inputs once at DEBUG with every filled
  secret shown as `********`; the console holds none of `os-secret`, the JWT,
  the minted token, the base64 of `wave:os-secret` or a line of the client
  key.

## V-PLUGIN-OPENSEARCH-SEARCH-FUNCTIONAL

### Steps

1. `beforeAll` seeds, under the run token: `-app-logs` (MAP-LOGS, F-LOGS; the
   spec keeps the `_id` of document 10), `-bulk` (B-PAGE, 10,050 documents),
   `-daily-<YYYY.MM.DD>` for today and the two previous UTC days (D-DAILY, one
   document each), and creates `-live-a` and `-live-b` with MAP-LOGS and no
   documents (L-LIVE).
2. The spec replaces `__TOKEN__`, `__TODAY__` and `__DOC10_ID__`, checks the
   two save rules on every block (a `{{ }}` row is listed as a template; the
   expression rows are exactly `from` on the two wait Searches, `from` and
   `to` on the collecting Search, `query` on the expression case), checks each
   Search dials `https://127.0.0.1:9477` as `wave` with verify on, Fail the
   block and no stored secret, then fills the password and the CA.
3. It imports the fixture via `POST /tests` (no repairs, host rewrite on),
   asserts `POST /tests/{id}/validate?context=run` reports zero errors and
   zero warnings, opens it in the workbench, sets the console to DEBUG, picks
   the shared environment and presses Run.
4. While the run goes on it watches the console for the first round's INFO
   line on `-live-a` reporting `0 results`; only then it bulk-seeds the
   `-live-a` and `-live-b` documents (`@timestamp` = seed time plus i x 10 ms).
5. It waits for the run to pass and the bookend `os-search-done`, then reads
   the node states, the console (copy text) and the session variables.

### Cases

The fixed-window cases run first, then WAIT-A and WAIT-B. An If/Else has no
join, so the chain goes on from the branch each wait case expects (error for
`-live-a`, success for `-live-b`); the other branch ends at its own Log.

Unless a row says otherwise a Search reads `-app-logs`, From
`2026-09-25T10:00:00Z` To `2026-09-25T10:04:59Z`, Fields `@timestamp`,
`log.level`, `message`, Newest first, Max results 10000; a Log after it writes
the case's own `os-...` line.

| Case | Block | Expected |
|------|-------|----------|
| WAIT-A | Python saves `test_start` (UTC ISO); Log `os-live-waiting`; Wait Until (Retry, `found_a >= 1`, every 2000 ms, 120000 ms) whose retry lane is a Search on `-live-a`: From `test_start` with `{}`, To `now`, DQL `log.level: "ERROR" or message: "Batch complete"`, Oldest first, Max results 1 -> `final_a`, `found_a`; an If/Else on `final_a.cell(0, 'log.level') == 'ERROR'` | At least two rounds, the first `0 results`; `os-live-a-branch=error message=Payment failed` |
| WAIT-B | The same wait on `-live-b` -> `final_b`, `found_b`; If/Else; Delay 5000; a Search from `test_start` to `final_b.cell(0, '@timestamp')` (both `{}`), empty Query, Oldest first, Max results 0 -> `logs_b`, `logs_total_b`; three Asserts | `os-live-b-branch=success`; Total 4, `Batch started` first, `Batch complete` last |
| W2-TOTAL | DQL `log.level: "ERROR"`, Max results 1; Assert `w2_total == 6` | WARN `Kept 1 of 6 results (Max results)`; INFO `... 6 results, 1 kept, ...`; the block passes |
| W2-CELL | `trace` = `a1"b`; DQL `trace.id: "{{ trace }}"`; Assert on the cell | Rendered `trace.id: "a1\"b"`; Total 1, `Card declined` |
| ESC-WORD | `who` = `ann or bob`; DQL `user.name: {{ who }}` | Total 0 (one literal value) |
| DSL-VALUE | `limit` = 800; Query DSL `{"range": {"latency_ms": {"gte": {{ limit }}}}}` | Rendered with the number `800`; Total 3 |
| DSL-PASTED | Query DSL `{"query": {"term": {"log.level": "WARN"}}, "size": 5, "sort": ["@timestamp"]}` | INFO `Query: kept only "query" from the pasted request; dropped "size", "sort"`; Total 1 |
| EXPR | `lvl` = `INFO`; Query in expression mode `'log.level: "' + lvl + '"'` | Total 3 |
| BY-ID | DQL `_id: "<id of document 10>"`, Fields `_id`, `message` | Total 1, `Batch complete` |
| SHAPES | DQL `trace.id: "t-001"`, Fields `@timestamp`, `user`; then Fields empty | Columns `@timestamp`, `user.id`, `user.name`, `user.roles` with `["a","b"]`; then one `_source` column holding the document as JSON text |
| SORT | Sort by `latency_ms`, Newest first, Max results 1 | The kept row is `Timeout calling bank` (1500 ms) |
| PAGE-ALL | `-bulk`, `10:00:00Z` to `10:00:05Z`, Fields `_id`, `seq`, Max results 0 | Total 10050; 10050 rows, every `_id` and `seq` once, in sort order; no WARN; no row in the console |
| PAGE-CUT | The same with Max results 10001 | WARN `Kept 10001 of 10050 results (Max results)`; the first 10001 rows of PAGE-ALL; the block passes |
| DATE-MATH | `<wave-e2e-<token>-daily-{now/d}>`, From `now-3d`, To `now`; then `wave-e2e-<token>-daily-*,-wave-e2e-<token>-daily-<today>` | Total 1 (today), then Total 2 (the two days before) |
| SESSION | - | The run passes; no block failed or ended amber |

### Validation

- **Block states:** every block that runs ends success (the Searches cut by
  Max results included); the two branches not taken (`Live A success`,
  `Live B error`) never run.
- **Run log (OS-10):** each Search writes its INFO summary line
  `Search <index> from <from> to <to>: <n> results, <k> kept, <s> s`, its
  `Kept N of M results (Max results)` WARN when Max results cut, and the
  pasted-request note; nothing else above DEBUG, and no Results row at any
  level.
- **Wait-then-collect:** every round of both waits reads from `test_start`;
  the `-live-a` rounds before the seed report `0 results`; the last round
  counts the matching lines stamped up to its own To and keeps one; `found_a`,
  `final_a`, `found_b`, `final_b`, `logs_b` and `logs_total_b` hold the seeded
  lines; the `-live-a` wait's elapsed time covers one 2000 ms interval per
  round.
- **Outputs:** each case's Results columns and rows and its Total results
  match the seeded documents (`@timestamp` cells are the stored strings); the
  case's Log line carries the same values.
- **Paging:** PAGE-ALL keeps 10050 distinct `_id` values and every `seq` from
  1 to 10050, newest first across the page boundary; PAGE-CUT is the same
  list cut after 10001 rows.
- **Date math:** the date-math name's window is exactly three days wide and
  finds only today's document; the exclusion list finds the two older ones,
  newest first.

## V-PLUGIN-OPENSEARCH-SEARCH-ERRORS-FUNCTIONAL

### Steps

1. `beforeAll` seeds, under the run token: `-app-logs` (MAP-LOGS, F-LOGS),
   `-mixed-a` (`latency_ms` long, one document `5`) and `-mixed-b`
   (`latency_ms` keyword, one document `abc`), and two S-SLOW indexes,
   `-slow` (Timeout) and `-stop-slow` (Stop), 2,000 documents each. It then
   calibrates the slow query on `-slow` so one filter takes 3 to 5 s
   (`calibrateSlowQuery` in `helpers/opensearch-stack.ts`: the probe asks for
   no hits, because a shard container needs about 10 s to download a 300 KB
   answer); `errors-helpers.ts` repeats the calibrated filter.
2. The spec replaces `__TOKEN__`, checks every Search's On error and that
   every secret row is blank, then fills the CA, the passwords, an API Key
   that is never sent, the credentials inside the URL-CREDS address, and the
   slow query: three copies of the calibrated filter with distinct loop
   counts, so one search runs 9 to 15 s, well past the Timeout plus the 5 s
   check.
3. Each test imports its fixture via `POST /tests` (no repairs, host rewrite
   on), asserts `POST /tests/{id}/validate?context=run` reports zero errors
   and zero warnings, opens it, sets the console to DEBUG, picks the shared
   environment and presses Run.
4. **Errors test:** while the run goes on, the spec polls the cluster's
   search tasks for the Timeout search; it waits for the run to end failed on
   `Block 'Fail the block' failed: ...`, then reads the console and the
   session variables.
5. **Stop test:** once the slow Search runs on the cluster, the spec presses
   the canvas Stop, checks the `Stop execution immediately?` dialog and
   confirms with `Stop Immediately`.
6. `afterAll` deletes the Tests, clears the workbench session and deletes
   `wave-e2e-<token>-*`.

### Cases

`fixture-errors.json`: each Search is On error = Record and continue and is
followed by a Log `os-err-<case> reason={{ <case>_reason }} error={{ <case>_error }}`.

| Case | Block | Expected |
|------|-------|----------|
| URL-CREDS | Cluster URL `https://wave:<password>@127.0.0.1:9477`, a password no secret row holds, so run-wide masking cannot hide a leak | Validation `Cluster URL must not hold a username or password: put them in Username and Password`; that password text never appears in the run log, DEBUG included |
| UNREACH | `https://127.0.0.1:9479` | Unreachable `Could not connect to OpenSearch at 127.0.0.1:9479: [Errno 111] Connection refused` (9479 is never rewritten, so every mode dials its own loopback) |
| AUTH-401 | `wave` with a wrong password | AuthFailed `HTTP 401: Unauthorized` |
| AUTH-403 | `wave-limited` on `-app-logs` | AuthFailed, starting `security_exception: no permissions for [indices:data/read/` |
| SHARDS | Query DSL `{"term": {"latency_ms": "abc"}}` | RequestFailed `search_phase_execution_exception: all shards failed. First root cause: query_shard_exception: failed to create query: For input string: "abc". Query as sent: {"bool":{"filter":[<the range>,{"term":{"latency_ms":"abc"}}]}}` |
| PARSE | Query DSL `{"matchall": {}}` | RequestFailed, starting `parsing_exception: unknown query [matchall]` |
| TWO-CREDS | Username `wave` and an API Key | Validation `Set only one of Username and Password, API Key or Bearer Token: all three go in the one Authorization header` |
| EPOCH-S | From `1790332925` in expression mode | Validation `From 1790332925 reads as epoch seconds; the row takes epoch milliseconds: for seconds, multiply by 1000` |
| DQL-SYNTAX | DQL `log.level: (ERROR` | Validation `Query is not valid DQL at line 1, column 18: Expected ")", AND, OR, whitespace but end of input found.` |
| TIME-FIELD | Time field `log.level` | Validation `Time field log.level is not a date field in wave-e2e-<token>-app-logs: it is keyword` |
| NO-INDEX | Index pattern `wave-e2e-<token>-nothing-*` | amber; WARN `Index pattern wave-e2e-<token>-nothing-* matches no index`; Total 0 |
| UNKNOWN-FIELD | DQL `log.invalid: ERROR` | amber; WARN `Field log.invalid is not in the field list of wave-e2e-<token>-app-logs`; Total 0 |
| PARTIAL | Query DSL `{"term": {"latency_ms": "abc"}}` on `wave-e2e-<token>-mixed-*` | amber; WARN `Partial results: 1 of 2 shards failed. First failure: query_shard_exception: failed to create query: For input string: "abc"`; Total 1, the `-mixed-b` document |
| TIMEOUT | The slow query on `-slow`, Timeout 2 | Timeout `Timed out after 2 seconds; the connection was shut down, so OpenSearch ends the search`; within 5 s of the Timeout the search is canceled or gone on the cluster |
| FAIL | `https://127.0.0.1:9479`, On error = Fail the block, last | the block fails; the Log after it never prints; the run ends failed |

`fixture-stop.json`: STOP, one slow Search on `-stop-slow` with Timeout 300
and a Log `os-stop-after ...` after it.

### Validation

- **Recorded failures:** the block ends amber (`warning`); one WARN
  `Search failed (<Reason>): <error>` and no INFO summary; Success false,
  Total results 0, Results empty; Reason and Error as the table says; the
  DEBUG request lines show what was sent: nothing for URL-CREDS, TWO-CREDS,
  EPOCH-S and DQL-SYNTAX, only the `_field_caps` read for UNREACH, AUTH-401,
  AUTH-403 and TIME-FIELD, `_field_caps` then `_search` for SHARDS, PARSE and
  TIMEOUT; the Log prints exactly `os-err-<case> reason=<Reason> error=<error>`.
- **Amber outcomes:** the block ends amber with its WARN and the INFO line
  `Search <pattern> from 2026-09-25T10:00:00.000Z to 2026-09-25T10:04:59.000Z: <n> result(s), <n> kept, <s> s`;
  Success true, Reason and Error empty; the Log prints
  `os-err-<case> reason= error=`.
- **No leak:** the whole run log, DEBUG included, holds none of `os-secret`,
  the password typed in the URL-CREDS Cluster URL, the wrong password or the
  `wave-limited` password; a filled password echoes as `********`.
- **Fail the block:** the block ends `failed`, the Log after it has no run
  status and its line never prints, the run ends `failed`, and the only
  ERROR lines are `Block 'Fail the block' failed: Could not connect to OpenSearch at 127.0.0.1:9479: [Errno 111] Connection refused`
  and the run's own `Test '<name>' halted with status: failed`.
- **Stop:** within 5 s of `Stop Immediately` the search is canceled or gone
  on the cluster; the run ends `stopped` and the Search paints `stopped`; for
  5 s after the stop the block's only lines are the DEBUG `Inputs:` echo and
  its `_field_caps` and `_search` requests; no ERROR line; `os-stop-after`
  never prints.
