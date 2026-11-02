# V-PLUGIN-SQL-PROCEDURE-FUNCTIONAL: Call procedure on the real databases

End-to-end proof that the SQL block's Call procedure operation calls stored
procedures on PostgreSQL, MariaDB, Oracle and SQL Server and hands back Out
values as a one-row typed table, takes Arguments in the list's order, fills
Rows from a routine that returns rows, writes one `Called ...` line per finished
call, shows a refusal as the database's own code and text, and is refused on
SQLite (REQ-3.4.1.6; SQL-1, SQL-4, SQL-5, SQL-6, SQL-9; FIELDERR-1 for the
sheet's refusal).

| Spec test | Fixture | Proves |
|-----------|---------|--------|
| the seed procedure, an in-out argument and rows on four databases | `fixture.json` | Out values, argument order, in-out, Rows, the `Called` line, Max rows, a refused call |
| SQLite has no procedures | `fixture-sqlite.json` | The sheet and the Block refuse Call procedure |

## Prerequisites

- The real-service stack is running (see `tests/e2e/services/README.md`,
  "Databases"): `postgres`, `mariadb`, `oracle` and `mssql`, each with the seed
  procedure `wave_add` (in `a`, `b`; out `total` = a + b, `label` = `sum`).
- The SQL blocks carry only their Database type and the `127.0.0.1` host
  sentinel. `helpers/sql-stack.ts` fills the port, database and login from
  `helpers/config.ts` and rewrites the host to `SQL_TARGET_HOST`; the spec
  writes `SQL_SEED_PROCEDURE` over `__SEED_PROCEDURE__`. SQL Server blocks set
  TLS off.
- The procedures and the function the run makes end in a per-run token that the
  spec writes over `__TOKEN__`; the seed procedure is never changed.
- Every Call procedure block has its own Name, so its console lines carry the
  source `SQL : {Name}` (EXEC-25). The setup, cleanup and leftovers blocks keep
  the Name `SQL`.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/sql-procedure/v-plugin-sql-procedure-functional.spec.ts`.
2. The spec fills the fixture, imports it via `POST /tests`, validates it with
   `POST /tests/{id}/validate?context=run` (zero errors) and opens it in the
   workbench.
3. It selects the shared E2E environment, presses Run and waits for the bookend
   `sql-procedure-done`, then reads the console and the session variables.
4. For SQLite it saves `fixture-sqlite.json` through the admin bulk route, opens
   the test, opens the SQLite block's config sheet and cancels it, then presses
   Run and waits for the bookend `sql-procedure-sqlite-done`.
5. It deletes the imported tests.

## Validation

- **Session outcome:** passed; the bookend `sql-procedure-done` is logged after
  the Finally path.
- **Seed call, each database:** Out values has one row and the columns `total`
  (integer) and `label` (text), in the Out arguments order, holding `5` and
  `sum`; Rows is empty and Row count 0; the block writes two console lines,
  `Connected to {database} {version} at {host}:{port}` and then
  `Called wave_add: 0 rows, 2 out values, {ms} ms`.
- **In-out call, each database:** Arguments are `later` 10, `earlier` 3 and
  `acc`, an expression over the seed call's Out values (`total * 20` = 100); Out
  values reads `acc` 107. MariaDB calls positionally, so the result also proves
  the list order is the call order. Oracle takes `wave.` and SQL Server `dbo.`
  before the name.
- **Rows call:** a PostgreSQL function returning a table, an Oracle procedure
  handing back an implicit result (`DBMS_SQL.RETURN_RESULT`), and MariaDB and
  SQL Server procedures ending in a SELECT each give Rows `k`, `sq` =
  `1 1`, `2 4`, `3 9`, Row count 3 and an empty Out values.
- **Called line, every finished call:** the block's lines are the Connected
  line and then `Called {procedure}: {rows} rows, {n} out values, {ms} ms`, in
  that order, read from the console in its own order. The procedure reads as
  typed in the Procedure row (`wave.` on Oracle and `dbo.` on SQL Server for the
  routines the run makes), `{rows}` is the Row count (3 for a rows call) and
  `{n}` the number of Out arguments (1 for the in-out call, 2 for the function).
- **Max rows:** a PostgreSQL rows call with Max rows 2 keeps the first two rows,
  Row count 2, and writes `Called {procedure}: 2 rows, 0 out values, {ms} ms`
  and then `Stopped after 2 rows (Max rows)` at WARN.
- **No Arguments (Record and continue):** a PostgreSQL call of the seed
  procedure with empty Arguments and Out arguments records Reason
  DatabaseError and exactly `42883: procedure wave_add() does not exist`, with
  no hint line. The block paints the warning state and writes the Connected line
  and `Call procedure failed (DatabaseError): ...`, and no `Called` line.
- **Bindings:** the Log lines `pr-seed ...`, `pr-inout ...`, `pr-rows ...` and
  `pr-more ...` echo the bound values.
- **Cleanup:** the Finally path drops every routine the run made and a count per
  database reads 0.
- **SQLite, config sheet:** the Operation row shows
  `Operation 'Call procedure' is not available on SQLite` under the field, the
  note reads `Save is disabled: the settings have errors`, Save is disabled, and
  the Operation list offers only Run SQL and Load table.
- **SQLite, run:** the block paints failed with the same message, which the
  Try/Catch catches (`pr-lite-caught ...` is logged); the block writes no
  `Connected to SQLite` line, so it never opened the file; Out values stays
  empty and the run passes.
