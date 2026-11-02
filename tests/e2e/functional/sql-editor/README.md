# V-PLUGIN-SQL-EDITOR-FUNCTIONAL: The SQL editor against a real PostgreSQL

End-to-end proof that the SQL block's editor works against the stack's
PostgreSQL the way an author uses it: Get Tables from the footer chip and from
the suggestion list, Stop and Refresh of a pull, the Tables popover's search and
insert, one pull shared by two blocks on the same connection, the server syntax
check per Database type, Run from the editor, Stop of a long statement on the
database, the one error toast of a failed Get Tables, and the editor's comment,
find and go-to-line keys (REQ-3.4.1.6, REQ-5.1.4; SQL-10 to SQL-13). A last
case pulls the tables of a SQLite File (REQ-3.4.1.19, SQL-12).

## Prerequisites

- The real-service stack is running with its `postgres` service (see
  `tests/e2e/services/README.md`): login `wave` / `sql-secret`, database
  `wave`, tables in `public`.
- The fixtures carry the `127.0.0.1` sentinel in each Host row; the spec
  fills Port, Database, Username and Password from `helpers/config.ts` and
  rewrites the Host with `injectServiceHost` and `SQL_TARGET_HOST`.
- Every table, statement tag and the blocks' `application_name` Driver option
  carry a per-run token, so parallel shards never see each other's objects and
  the catalog cache on the WAVE server starts empty for this run.
- The SQLite case needs no service: the spec builds a database with two tables
  (`customers`, `orders`) and uploads it to the Test's own Test Data as
  `sqled-<token>.db`.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/sql-editor/v-plugin-sql-editor-functional.spec.ts`.
2. `beforeAll` imports `fixture-admin.json` with a setup script and runs it as a
   tracked execution: it creates `sqled_<token>_orders` (two rows) and
   `sqled_<token>_order_items`.
3. Each test imports `fixture.json` (two SQL blocks on the same connection and
   a probe block that lists what they left in `pg_stat_activity`), validates it
   with zero errors, opens it in the workbench and selects the shared E2E
   environment.
4. Get Tables: the spec holds the pull's first poll, stops the pull from the
   chip, starts one from the Tables suggestion row after `FROM`, searches the
   Tables popover and inserts a table and a column, creates
   `sqled_<token>_late` with a Run from the same editor, refreshes, and opens
   the second block's editor.
5. Syntax check: `SELECT TOP 1 ...` on PostgreSQL is saved and run; the body is
   then switched to Template with `{{ sqled_table }}`; the Database type is then
   set to SQL Server and the editor reopened.
6. Run and Stop: the saved SELECT is run from the editor, then
   `SELECT 1 AS armed; SELECT pg_sleep(60) ...` is run and stopped from the
   editor, then run again, the editor closed, and the run stopped from the
   canvas toolbar. After each Stop the probe block runs alone (Run Current)
   until it reports `Statement 1: 0 rows`. A tracked run cannot start while
   the workbench run is live, and one started beside the open test takes the
   workbench over, so the admin fixture runs only in `beforeAll` and
   `afterAll` and the probe lives in the workbench fixture.
7. Failed Get Tables: the second block's Port is set to 9479 (nothing listens
   there) in the config sheet, its editor opened, and Get Tables clicked; the
   spec records every toast the page raises and the catalog job's answer.
8. Keys: the second block's editor gets `SELECT 1 AS one` / `WHERE 1 = 1`,
   Ctrl+/ on line 2, then Ctrl+F and Esc; the body is saved, the config saved
   and the test saved from the toolbar, then read back. A second test types the
   same body into a fresh editor and presses Ctrl+G on line 2.
9. `afterAll` drops the three tables and deletes the imported tests.
10. SQLite Get Tables: the spec imports `fixture-sqlite.json` (three SQLite
    blocks: `Two tables` and `Unsupported option` on
    `testdata://sqled-<token>.db`, the second with Driver option
    `isolation_level`, and `Missing file` on
    `testdata://sqled-<token>-missing.db`), uploads the database, validates
    the Test with zero errors, opens each block's editor in turn and clicks
    Get Tables, recording the catalog job's answer and every toast.
11. Get Tables over TLS: the second block of `fixture.json` gets TLS on, Verify
    on and the stack CA, and no client certificate or key (seeded, not typed);
    its editor opened and Get Tables clicked.

## Validation

- **Stop during a pull:** the chip's Get Tables starts a pull answered 202
  (not cached), the chip reads `Connecting...` with a square Stop, Stop sends
  `DELETE /sql-tools/catalog/{job}` for that job, the chip reads `Get Tables`
  again, and the pull's late answer never loads it.
- **Suggestion row:** after `SELECT * FROM ` the list has one section,
  `Tables`, offering `Get tables from the database`; choosing it leaves the
  text unchanged and the chip goes `Connecting...`, optionally
  `Getting tables...`, `Got N tables` for about three seconds, then
  `Tables · N`, where N is the number of tables the pull answered. The answer
  holds the spec's two tables with their columns, and the same position then
  suggests them instead of the action row.
- **Tables popover:** the search `<token>_order` lists `order_items` before
  `orders` (catalog order) with the match underlined and the columns under
  each; `<token>_orders` narrows it to one row; choosing it inserts the name at
  the cursor. After `sqled_<token>_orders.` the suggestion list offers `id`,
  `status` and `total`, and choosing `status` inserts it.
- **Refresh:** a table created after the pull is absent from the popover;
  Refresh starts a pull with `refresh: true` answered 202, a keystroke ends the
  `Got N tables` hold at once, and the new table is listed.
- **Shared catalog:** the second block's editor opens with the chip settled on
  the refreshed count and the new table listed, and no catalog pull starts.
- **Syntax check:** on PostgreSQL `SELECT TOP 1 ...` shows the amber strip
  `Line 1: Invalid expression / Unexpected token`; Save puts it into the
  config and Run runs it, and the block fails with the database's own
  `Statement 1 (...) failed: 42601: syntax error at or near "1"` at ERROR. In
  Template kind a body holding `{{ }}` sends no check and shows no warning. On
  SQL Server the same statement is checked with no finding and no strip.
- **Run from the editor:** only the first block runs and passes; its console
  lines are `Connected to PostgreSQL {version} at {host}:{port}`,
  `Statement 1: 2 rows, N ms` and the DEBUG `Outputs:` line with
  `"rows":"Table([id, status, total], 2 rows)"` and `"row_count":2`; the bound
  variables hold Row count 2 and both rows.
- **During the sleep** (`Statement 1: 1 rows` is on the console, so the sleep
  is the statement on the database): Kind switches to Template and back, F1
  Help opens and closes, Get Tables pulls and settles, Save stays dead on the
  changed draft, Stop stands where Run was, and the config behind shows the
  read-only pill, a frozen Name, Close and no Save.
- **Editor Stop:** the session and the block end `stopped` within 10 s with one
  WARN `Stopped by user` from the block and no `Statement 2` line, Run is
  back, and the probe finds in `pg_stat_activity` neither the tagged statement
  nor any connection with the blocks' `application_name`.
- **Close during a run:** the unsaved prompt shows with its Save dead,
  discarding closes the editor while the run goes on, and the toolbar Stop
  ends it with nothing left on the database.
- **Failed Get Tables:** the chip ends on `Could not get tables`, the catalog
  job answers `failed` with `Could not connect to PostgreSQL at {host}:9479: ...`,
  and exactly one error toast is raised, titled `Could not get tables`, with
  that reason as its message; closing the editor and the config raises no
  other.
- **SQLite Get Tables:** on the File that holds two tables the pull is a real
  one (not cached), the chip settles on `Tables · 2`, the answer is `customers`
  (`id` INTEGER, `name` TEXT) and `orders` (`id` INTEGER, `customer_id`
  INTEGER, `total` REAL), and the Tables popover lists both, in that order,
  with their columns. With Driver option `isolation_level` the chip ends on
  `Could not get tables` and the job's reason, shown in one error toast, is
  `SQLite Driver option 'isolation_level' is not supported: SQLite takes timeout and cached_statements`.
  With the File that is not there the reason is
  `Could not open the SQLite file testdata://sqled-<token>-missing.db: unable to open database file`
  and the Test's Test Data still lists the uploaded database alone.
- **Get Tables over TLS:** no start of the pull is refused (a client
  certificate or key the block does not hold is nothing given, as a run takes
  it), the chip loads the tables and the answer holds the spec's two tables.
- **Keys:** Ctrl+/ turns line 2 into `-- WHERE 1 = 1` and the saved Test's
  `sql` holds `SELECT 1 AS one` / `-- WHERE 1 = 1`; Ctrl+F opens the find panel
  with its search field focused and Esc closes it while the editor stays open;
  Ctrl+G opens the `Go to line` prompt, focused, holding the cursor's line 2,
  and no find panel.
