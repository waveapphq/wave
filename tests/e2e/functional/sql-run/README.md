# SQL block: Run SQL functional suite

Two specs prove the SQL block's Run SQL operation against the real databases of
the E2E stack, WAVE connecting itself (REQ-3.4.1.6; SQL-1 to SQL-5, SQL-8 to
SQL-10).

| Case id | Spec | Fixture | Proves |
|---------|------|---------|--------|
| V-PLUGIN-SQL-RUN-FUNCTIONAL | `v-plugin-sql-run-functional.spec.ts` | `fixture.json` | Happy paths on PostgreSQL, MariaDB, Oracle, SQL Server and SQLite: scripts split the database's own way, bound `:name` values, typed rows, Row count and Rows changed, no WAVE transaction, a Template body, an expression SQL row, TLS with a verified certificate, and Driver options |
| V-PLUGIN-SQL-RUN-FUNCTIONAL (sheet) | `v-plugin-sql-run-functional.spec.ts` | none (built through the UI) | A SQL block built through the canvas and its sheet, its SQL row switched to `{}`: the expression gives the SQL text and `:min_n` still binds (SQL-10) |
| V-PLUGIN-SQL-RUN-FUNCTIONAL (errors) | `v-plugin-sql-run-errors-functional.spec.ts` | `fixture-errors.json` | Failure paths: Stop on error off/on, all-failed amber, database error text, undefined `:name`, Max rows, Unreachable, AuthFailed, Timeout, the session-state warning, and a script's own BEGIN / ROLLBACK and BEGIN / COMMIT |
| V-PLUGIN-SQL-SQLITE-FUNCTIONAL | `v-plugin-sql-sqlite-functional.spec.ts` | `fixture-sqlite.json`, `fixture-sqlite-missing-testdata.json` | SQLite on WAVE's bundled build: the Connect timeout as the busy timeout, the script's own BEGIN / ROLLBACK, Max rows followed by a DELETE, Timeout on an endless query, a File in a folder that is not there, placeholders with no value, `CREATE VIRTUAL TABLE`, the refused Driver option `isolation_level`, a read-only `testdata://` database, and a `testdata://` name that is not there under Record and continue and under Fail the block (REQ-3.4.1.19) |
| V-PLUGIN-SQL-DRIVER-IDENTITY-FUNCTIONAL | `v-plugin-sql-driver-identity-functional.spec.ts` | `fixture-driver-identity.json`, `fixture-driver-identity-timezone.json` | The program name `WAVE` on PostgreSQL, MariaDB, SQL Server and Oracle; an Oracle `dsn` that connects as an address, as a connect descriptor and with spaces around it; every Oracle Driver option refused before connecting (a TNS alias, a configuration provider, a directory address, a `dsn` or `protocol` that disagrees with the TLS row); and the Oracle session time zone on a backend started in `Asia/Tokyo` (REQ-3.4.1.19) |

## Prerequisites

- Backend and frontend running, and the shared execution environment
  (`ensureEnvironment` creates it if absent).
- The real-service stack (see `tests/e2e/services/README.md`): `postgres`
  (9473), `mariadb` (9474), `oracle` (9475) and `mssql` (9476), logging in as
  the stack user. TLS on PostgreSQL, MariaDB and SQL Server uses the database
  leaf signed by the WAVE Test CA; PostgreSQL verifies the tls-lab client
  certificate when one is sent. Oracle is plain TCP only.

  ```bash
  ./scripts/e2e-stack.sh up --wait postgres mariadb oracle mssql
  ```

- The fixture carries the `127.0.0.1` sentinel in every Host row;
  `injectServiceHost(fixture, SQL_TARGET_HOST)` rewrites it per mode. Ports,
  database, service name and user are the `helpers/config.ts` constants; the
  spec fills the password, the CA certificate and the client certificate and
  key from config at load, so the fixture stores none of them.
- Every table carries a per-run token (`__TOKEN__` in the fixture). The run's
  Try/Catch has a Finally path that drops each table and checks it is gone, so
  nothing is left behind even when a block fails. SQLite opens
  `artifact://sqlrun-<token>.db`, a file in the workbench session's artifacts,
  which clearing the session removes.
- Nothing listens on port 9479; the errors spec's Unreachable block dials it
  on `localhost`, which the host rewrite never touches.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/sql-run/v-plugin-sql-run-functional.spec.ts`
   (or `functional/sql-run/v-plugin-sql-run-errors-functional.spec.ts`, which
   waits for the bookend `sqlerr-run-errors-done` instead).
2. The spec replaces the token, checks the connection rows against config,
   fills the secrets and PEMs, rewrites the host and imports the fixture via
   `POST /tests` (no repairs), then opens it in the workbench.
3. It confirms `POST /tests/{id}/validate?context=run` reports zero errors.
4. It picks the shared environment, presses Run and waits for the run to pass
   and the bookend `sql-run-done` line.
5. It reads the console, the session variables and the session's artifacts,
   then clears the session and deletes the imported test.
6. The sheet case creates an empty test through `POST /tests` and opens it; it
   adds the integer variable `limit` = 10 from the Variable Manager, drops a SQL
   block just under Start, fills Host, Port, Database, Username and Password
   from `helpers/config.ts`, turns TLS on and pastes the WAVE Test CA into CA
   Certificate, switches the SQL row to `{}` and types
   `f"SELECT n FROM generate_series(1, {limit}) AS n WHERE n >= :min_n"`, opens
   its full editor with Ctrl+E and cancels it, adds the Parameters entry
   `min_n` = `7` with its `{}` on, types `series_rows` and `series_count` into
   Assign Rows to and Assign Row count to, saves the sheet and the test, and
   runs it. It needs no table: `generate_series` is built in.

## Validation

- **Scripts, per database:** the script creates the table, inserts two rows
  with `:name` values, updates both, selects them and updates one again. The
  console shows `Connected to {type} {version} at {host}:{port}` (the file on
  SQLite), then one `Statement {i}: {n} rows changed, {ms} ms` or
  `Statement {i}: {n} rows, {ms} ms` line per statement, in order. PostgreSQL,
  MariaDB and SQLite split on `;` (six statements); Oracle runs a PL/SQL block
  ended by a `/` line, then five `;` statements; SQL Server splits on `GO`
  lines only, so the batch holding both inserts is one statement with 2 rows
  changed (five statements). A `;` inside a string never splits.
- **Bound values:** `:label` is used twice in one statement and arrives as
  written, quote and semicolon included; `:qty` is an expression entry and
  binds the number 3; the empty `:note` binds empty text (Oracle stores empty
  text as NULL); `:memo`, an expression entry giving `None`, binds NULL.
- **Outputs:** Success true; Row count 2; Rows changed 5, the sum over every
  statement; Rows holds the SELECT, not the UPDATE after it, with typed columns
  `id` integer, `name` string, `qty` integer, `price` float, `active` boolean
  (integer on MariaDB and SQLite, which have no boolean), `note` string with
  empty text in row 2 (null on Oracle), `created` string (ISO timestamp; the
  stored text on SQLite), `memo` string with `given` in row 1 and null in row 2.
  The price reaches the variables as exact decimal text worth 12.5 and 7.25.
  Oracle names the columns in upper case.
- **No WAVE transaction:** an insert, then an insert into a table that does not
  exist, under Record and continue: the block ends amber with Success false,
  Reason `DatabaseError` and the database's own text (`42P01: relation ...`,
  `1146: Table ...`, `ORA-00942: ...`, `208: Invalid object name ...`,
  `no such table: ...`); the console shows statement 1 with 1 row changed, the
  ERROR line naming statement 2 by its first line, and the Record WARN line.
- **Template read-back:** a Template body `SELECT ... FROM {{ <db>_table }}`
  returns row 2 with qty 16 (the trailing update ran) and row 3 (the insert
  before the failure stayed).
- **TLS:** TLS on, Verify Server Certificate on, CA Certificate = the WAVE
  Test CA: PostgreSQL's `pg_stat_ssl` shows the session encrypted with TLS 1.2
  or 1.3 and the `wave-e2e-client` certificate; MariaDB's `Ssl_version` is TLS
  1.2 or 1.3; SQL Server's `encrypt_option` is `TRUE`.
- **Driver options:** `application_name` on PostgreSQL, `init_command` on
  MariaDB, `program` on Oracle and `appname` on SQL Server each read back as
  `sqlrun-<token>`; `timeout` 7 on SQLite reads back as a busy timeout of 7000
  ms. A Plain body keeps `{{ pg_table }}` as literal text.
- **SQLite file:** the session's artifacts list `sqlrun-<token>.db`, and its
  first bytes are the SQLite header.
- **Bindings:** one Log line per database prints Success, Row count, Rows
  changed, cells of Rows, the recorded reason, the read-back and the session
  probe.
- **Expression SQL row (PostgreSQL):** `PG expression` has `sql` and
  `parameters.min_qty` as expressions; its SQL is
  `f"SELECT id, qty FROM {pg_table} WHERE qty >= :min_qty ORDER BY id"` and
  `min_qty` binds the number 4, so Rows holds `[1, 4]` and `[2, 16]` (not id 3
  with qty 1); the console shows the Connected line and
  `Statement 1: 2 rows, {ms} ms`.
- **Cleanup and outcome:** every drop succeeds and its check counts 0 tables;
  the Try/Catch reports nothing caught; every block ends success except the
  five amber no-transaction blocks; no console line carries the password; the
  run passes.

## Validation - sheet

- **Built through the UI:** the dropped block is linked from Start; with `{}`
  on, the SQL row has no `Edit…` preview (no SQL editor), its inline editor
  holds the expression with no SQL coloring (no `:name` mark), and Ctrl+E opens
  the "Edit SQL" expression editor with no SQL coloring, no Get Tables chip and
  no Run.
- **Saved:** the node's expression fields are `sql` and `parameters.min_n`; its
  values hold the Host, Database, Username and Port typed, TLS on, the
  expression as its SQL and Parameters `{"min_n": "7"}`; Rows and Row count are
  bound to `series_rows` and `series_count`; the only link is Start to the
  block; `limit` is an integer 10.
- **Run:** passes; `series_rows` is the table `n` (integer) with rows 7, 8, 9
  and 10; `series_count` is 4; the only Statement line is
  `Statement 1: 4 rows, {ms} ms` at INFO.

## Validation - errors

- **Validation:** zero errors, although two blocks name a `:name` with no
  Parameters entry; that check runs at run time.
- **Stop on error off, two of five statements failing:** every statement runs;
  each failure is a WARN `Statement {i} ({first line}) failed: 42P01: relation "..." does not exist`;
  Rows holds the SELECT (ids 1 and 3), Row count 2, Rows changed 2; the block
  succeeds.
- **Stop on error off, every statement failing:** one WARN line per statement,
  Success true, Rows empty, Row count and Rows changed 0; the block is amber.
- **Stop on error on, Fail the block inside a Try/Catch:** statement 1 commits;
  ERROR `Statement 2 (UPDATE ... SET id = 0) failed: 42P01: ...`; statement 3
  is never sent; ERROR `Block 'Stop on error fail' failed: {text}`; the caught
  error carries the same text.
- **Stop on error on, Oracle, Record and continue:** Reason `DatabaseError`,
  Error `ORA-00942: table or view "WAVE"."..." does not exist` with Oracle's
  `Help:` line, unchanged; no statement 3 line; amber.
- **Undefined `:name`, Record and continue:** Reason `Validation`, Error
  `Parameter 'unknown_note' is used in the SQL but not defined`; the Record
  WARN is the block's only line (it never connects); amber; the next Log runs.
- **Undefined `:name`, Fail the block:** no SQL line at all; ERROR
  `Block 'Undefined name fail' failed: Parameter 'unknown_id' is used in the SQL but not defined`;
  caught.
- **Max rows 4 on nine rows:** `Statement 1: 4 rows`, WARN
  `Stopped after 4 rows (Max rows)`, Row count 4, rows 1 to 4; success.
- **Unreachable (`localhost:9479`):** Reason `Unreachable`, Error
  `Could not connect to PostgreSQL at localhost:9479: Can't create a connection to host localhost and port 9479 (timeout is 5 and source_address is None).`
- **AuthFailed (wrong password):** Reason `AuthFailed`, Error
  `Authentication failed for wave at {host}: password authentication failed for user "wave"`.
- **Timeout 3 on `pg_sleep(60)`:** Reason `Timeout`, Error
  `Statement timed out after 3 seconds`; the Record line lands 3 to 8 seconds
  after the Log before the block; a later block counts 0 active queries with
  the sleep's tag in `pg_stat_activity`.
- **Session state:** WARN `Statement 2 (SET) ends the script; its effect ends with the block`
  (PostgreSQL), `Statement 2 (ALTER SESSION) ...` (Oracle) and
  `Statement 1 (SET) ...` (a SQL Server batch ending on SET); none when SET
  comes first (PostgreSQL, and SQL Server with a GO line).
- **The script's own transaction:** `BEGIN`, an insert of id 8, `ROLLBACK`,
  `BEGIN`, an insert of id 9, `COMMIT` run as six statements with 1 row changed
  on each insert; Rows changed 2; no session-state warning for the closing
  `COMMIT`.
- **Nothing sent, cleanup:** the read-back holds ids 1, 3, 4 and 9 only (never
  the rolled-back 8); the Finally drops the table, the check counts 0 tables,
  and the outer Try/Catch caught nothing.
- **Block states and bindings:** six amber blocks, two failed inside their
  Try/Catch, every other block succeeds; every bound value reaches a
  downstream Log; no console line carries either password; the run passes.

## V-SQL-DRIVER-OPTIONS-TYPED

- Spec: `v-sql-driver-options-typed.spec.ts`; fixture: `fixture-driver-options.json`.
- Driver options rows pick one of six types (Parameters stays text-only): SQLite and PostgreSQL receive the float, whole number, map and boolean rows as those types while `2024` stays text, an expression row carries no type and its exact decimal (`wait + 10` over a float variable) reaches the driver as a platform number, the rows read back after a reload, and Get Tables connects with the same typed options (REQ-3.1.3.19, SQL-8).

## V-PLUGIN-SQL-SQLITE-FUNCTIONAL

SQLite on WAVE's bundled build (REQ-3.4.1.19, REQ-3.4.1.6; SQL-2 to SQL-5,
SQL-8, SQL-9). Spec: `v-plugin-sql-sqlite-functional.spec.ts`; fixtures:
`fixture-sqlite.json` (every case chained in one run) and
`fixture-sqlite-missing-testdata.json` (two blocks whose File names a Test
Data database that is not there: one under Record and continue, then one under
Fail the block, which ends that run).

### Prerequisites

- Backend and frontend running, and the shared execution environment
  (`ensureEnvironment` creates it if absent). No stack service: SQLite is a
  file.
- The read-write file is `artifact://sqlite-<token>.db`, in the workbench
  session's artifacts, which clearing the session removes.
- The read-only database is built by the spec with Node's own `node:sqlite`
  (table `readonly_items`, three rows) in a folder of its own under the temp
  folder, uploaded to the Test's Test Data as `sqlite-readonly.db`, and the
  folder is removed.
- Every block that must fail is under Record and continue, so each Reason and
  Error is read from the block's outputs and the next block runs. The one
  exception is the last SQL block of the second Test, under Fail the block.

### Steps

1. Run `./scripts/e2e-targeted-local.sh functional/sql-run/v-plugin-sql-sqlite-functional.spec.ts`.
2. The spec replaces the token, imports the fixture via `POST /tests` (no
   repairs), opens it in the workbench, uploads the database to its Test Data
   and confirms `POST /tests/{id}/validate?context=run` reports zero errors.
3. It picks the shared environment, presses Run and waits for the run to pass
   and the bookend `sqlite-functional-done`. For the second Test it first sets
   the console to DEBUG, then waits for the run to fail and the line
   `halted with status: failed`.
4. It reads the console, the session variables, the session's artifacts and the
   Test Data listing, then clears the session and deletes the imported Tests.

### Validation

- **Busy timeout:** with no `timeout` Driver option, `PRAGMA busy_timeout`
  returns one row: `30000` for Connect timeout 30 and `12000` for 12.
- **The script's own transaction:** `BEGIN`, an insert, `ROLLBACK`, then
  `SELECT count(*)` log `Statement 1: 0 rows changed`,
  `Statement 2: 1 rows changed`, `Statement 3: 0 rows changed` and
  `Statement 4: 1 rows`; the count is 5, as seeded; Rows changed 1.
- **Max rows 2 on five rows, then a DELETE:** `Statement 1: 2 rows`, WARN
  `Stopped after 2 rows (Max rows)`, Row count 2, rows 1 and 2 kept, and
  `Statement 2: 1 rows changed`.
- **Timeout 3 on an endless recursive query:** Reason `Timeout`, Error
  `Statement timed out after 3 seconds`; the Record line lands 3 to 8 seconds
  after the Log before the block; the next block reads the same file and
  counts 4 rows.
- **A File in a folder that does not exist:** Reason `Unreachable`, Error
  `Could not open the SQLite file {file}: unable to open database file`; the
  Record WARN is the block's only line (no Connected line).
- **Placeholders with no value, each beside a bound `:bound`:** Reason
  `Validation`; `@at_name` and `$dollar_name` give
  `Placeholder {name} has no value: write :{name} and add {name} to Parameters`;
  `?1` and `:1` give
  `Numbered placeholder 1 has no value: write :name and add name to Parameters`;
  `?` gives `A ? placeholder has no value: write :name and add name to Parameters`.
  Each block logs the Connected line, the ERROR `Statement 1 (...) failed: ...`
  line and the Record WARN line.
- **`CREATE VIRTUAL TABLE`:** `Statement 1: 0 rows changed`; Rows changed 0.
- **Driver option `isolation_level`:** Reason `Validation`, Error
  `SQLite Driver option 'isolation_level' is not supported: SQLite takes timeout and cached_statements`;
  no Connected line; the session's artifacts hold `sqlite-<token>.db` alone, so
  neither the refused block's file nor anything in the absent folder was made.
- **Read-only Test Data database:** the SELECT returns the three rows; the
  INSERT gives Reason `DatabaseError` and
  `attempt to write a readonly database`; a read-back counts 3 rows; Test Data
  lists `sqlite-readonly.db` alone and its bytes are the uploaded ones.
- **A Test Data name that is not there, Record and continue (second Test):**
  Reason `Unreachable`, Error
  `Could not open the SQLite file testdata://sqlite-missing-<token>.db: unable to open database file`
  (the File as typed), Success false, Rows empty, Row count 0, Rows changed 0;
  the block ends amber and its only line above DEBUG is the WARN
  `Run SQL failed (Unreachable): {Error}` with Source `SQL : Missing recorded`;
  the Log after it writes its line (Source `Log : After recorded`).
- **The same under Fail the block (second Test):** the engine writes ERROR
  `Block 'Missing fail' failed: Could not open the SQLite file testdata://sqlite-missing-fail-<token>.db: unable to open database file`
  with Source `SYSTEM`; the block writes no line of its own above DEBUG and
  ends failed; the run fails there and the Log after it never runs.
- **No server path (second Test):** with the console at DEBUG, no line and no
  bound output holds a `Connected to` line, a `Searched paths` text, a
  `/testdata/` folder or the missing file's name in any form but
  `testdata://...`; Test Data still lists `sqlite-readonly.db` alone.
- **Block states:** eleven blocks succeed and nine end amber in the first
  Test, whose run passes.

## V-PLUGIN-SQL-DRIVER-IDENTITY-FUNCTIONAL

What the SQL block's drivers take from the block alone, on PostgreSQL, MariaDB,
SQL Server and Oracle (REQ-3.4.1.19; SQL-5, SQL-8).

- Spec: `v-plugin-sql-driver-identity-functional.spec.ts`; fixtures:
  `fixture-driver-identity.json` (run through the Workbench) and
  `fixture-driver-identity-timezone.json` (run through the API on a backend the
  spec starts).

### Prerequisites

- Backend and frontend running, the shared execution environment, and the four
  database services up:

  ```bash
  ./scripts/e2e-stack.sh up --wait postgres mariadb oracle mssql
  ```

- Nothing is written to a database, so nothing is left behind. Nothing listens
  on port 9479, the Port row of the three blocks that connect through a `dsn`.
- The fixtures carry the `127.0.0.1` sentinel in every Host row and inside
  every Oracle `dsn`. The spec checks each stored Driver option against
  `helpers/config.ts`, writes the Oracle host of the mode into it, and fills the
  password at load. Every block has its own Name, so each is found by its
  console Source `SQL : {Name}`.
- The time zone test starts its own backend (`helpers/spawn-backend.ts`) with
  `TZ=Asia/Tokyo` on a free port, with its own config file and data folder, and
  removes both afterwards. The machine needs the `Asia/Tokyo` zone file.

### Steps

1. Run `./scripts/e2e-targeted-local.sh functional/sql-run/v-plugin-sql-driver-identity-functional.spec.ts`.
2. Workbench test: the spec imports `fixture-driver-identity.json` through
   `POST /tests` (no repairs), confirms `POST /tests/{id}/validate?context=run`
   reports zero errors, opens the Test, sets the console to DEBUG, picks the
   shared environment, presses Run and waits for the run to pass and the
   bookend `sqlid-driver-identity-done`. It reads the console and the session
   variables, then clears the session and deletes the Test.
3. Time zone test: the spec starts the backend, creates an environment on it,
   imports and validates `fixture-driver-identity-timezone.json` there, starts
   the run with `POST /executions`, waits for its verdict and reads
   `GET /executions/{id}/logs`.

### Validation

- **Program name:** `SELECT current_setting('application_name')` (PostgreSQL),
  `SELECT ATTR_VALUE FROM performance_schema.session_connect_attrs WHERE PROCESSLIST_ID = CONNECTION_ID() AND ATTR_NAME = 'program_name'`
  (MariaDB), `SELECT APP_NAME()` (SQL Server) and
  `SELECT SYS_CONTEXT('USERENV', 'CLIENT_PROGRAM_NAME') FROM dual` (Oracle) each
  return one row holding `WAVE`; none of the four blocks carries a Driver
  option.
- **A full dsn connects:** `{host}:9475/FREEPDB1`, the same target as a
  `(DESCRIPTION=...)` connect descriptor, and the first form with two spaces on
  each side, each beside Port 9479. Each block succeeds with Row count 1 and
  logs `Connected to Oracle {version} at {dsn}`, the version the Oracle program
  name block names, the dsn without the spaces; the block's DEBUG `Inputs:`
  line still shows them.
- **TNS alias:** `dsn` = `FREEPDB1`, Record and continue: Success false,
  Reason `Validation`, Error
  `Oracle Driver option dsn 'FREEPDB1' is a TNS alias, which WAVE does not look up: use Host, Port and Service name, or paste the full connect descriptor`;
  the block's only line is `Run SQL failed (Validation): {that text}` at WARN;
  amber. With On error left at Fail the block inside a Try / Catch: no SQL
  line, ERROR `Block 'Oracle alias fail' failed: {that text}`, the block
  failed, and the caught error carries the text, the block's Name and its id.
- **Help page:** the Details dialog of a SQL block shows the Oracle
  time zone line (`An Oracle session uses the database's own time zone
  (DBTIMEZONE), ...`) and the Remote Execution line (`Inside a Remote Execution
  body the block runs on the remote host, which needs nothing installed. ...`)
  word for word, and the Driver options line starts with `Driver options: Extra
  connection options handed to the driver under the driver's own names, except
  on SQLite: its two names are WAVE's own. See Databases for them and for the
  common ones.`
- **Configuration provider:** `config-file:///srv/ora/app.json` gives
  `... names a configuration provider, which WAVE does not use: use Host, Port and Service name, or paste the full connect descriptor`.
- **Directory address:** `ldap://...` and `LDAPS://...` give
  `... is a directory address, which WAVE does not look up: use Host, Port and Service name, or paste the full connect descriptor`.
- **Host and port only:** `  {host}:9475  ` gives the alias text with
  `'{host}:9475'`, the spaces gone; no Connected line although the listener is
  there.
- **TLS on, plain dsn:** a connect descriptor with a TCP address, alone
  or beside a TCPS one, gives
  `... does not use TLS but TLS is on: use PROTOCOL=TCPS in it, or turn TLS off`;
  `{host}:9475/FREEPDB1` gives
  `... does not use TLS but TLS is on: start it with tcps://, or turn TLS off`.
- **TLS off, TLS dsn:** `tcps://{host}:9475/FREEPDB1`, and a connect
  descriptor with one TCPS address among two, give
  `... uses TLS but TLS is off: turn TLS on, so the block's certificate rows apply`.
- **Protocol option:** ` TCP ` under TLS on gives
  `Oracle Driver option protocol 'TCP' does not use TLS but TLS is on: remove it, or turn TLS off`;
  `tcps` under TLS off gives
  `Oracle Driver option protocol 'tcps' uses TLS but TLS is off: turn TLS on, so the block's certificate rows apply`.
- **Every refusal:** Reason `Validation`, Success false, the Record WARN line
  as the block's only line, amber, and the next block runs.
- **Outcome:** twelve amber blocks, one failed inside its Try / Catch, every
  other block succeeds; no console line carries the password, DEBUG included;
  the run passes.
- **Time zone:** on the backend started with `TZ=Asia/Tokyo` the Shell Exec
  block's `date +%z` reads `+0900`; the Oracle block running
  `SELECT SESSIONTIMEZONE, DBTIMEZONE FROM dual` connects and the run passes;
  `SESSIONTIMEZONE` equals `DBTIMEZONE` and is not `+09:00`.
