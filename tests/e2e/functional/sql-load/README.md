# V-PLUGIN-SQL-LOAD-FUNCTIONAL: Load table on the real databases

End-to-end proof that the SQL block's Load table operation writes rows into
existing tables on PostgreSQL, MariaDB, Oracle, SQL Server and SQLite: Add, Add
or replace (on the primary key, on Key columns, and on MariaDB's unique key too)
and Overwrite, from table variables and from a Test Data CSV file, with Commit
each batch on and off, a batch whose COMMIT the database refuses, and the
refusals for a missing column and a missing key. On SQLite, which runs on WAVE's
bundled build, it also proves that a load is one transaction and that a load
waits for another writer on the same file (REQ-3.4.1.6, REQ-3.4.1.19; SQL-3,
SQL-5, SQL-7, SQL-8, SQL-9).

## Prerequisites

- The real-service stack is running (see `tests/e2e/services/README.md`,
  "Databases"): `postgres`, `mariadb`, `oracle` and `mssql`, all with the login
  `wave` / `sql-secret`. SQLite needs no service: its file is made in the run's
  own Artifacts.
- The SQL blocks in `fixture.json` carry only their Database type and the
  `127.0.0.1` host sentinel. `helpers/sql-stack.ts` fills the port, database and
  login from `helpers/config.ts` and rewrites the host to `SQL_TARGET_HOST` for
  the mode. SQL Server blocks set TLS off, since TLS is not what this suite is
  about.
- Every table name ends in a per-run token that the spec writes over
  `__TOKEN__`, so parallel runs never share a table. Nothing is seeded
  beforehand.
- `sql-load-overwrite.csv` is uploaded into the test's own Test Data by the
  spec.
- Each Load table block the spec reads by its console lines has its own Name, so
  its lines carry the source `SQL : {Name}` (EXEC-25). The other SQL blocks keep
  the Name `SQL` and are found by their Description.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/sql-load/v-plugin-sql-load-functional.spec.ts`.
2. The spec makes a token, fills the fixture's connection rows, imports it via
   `POST /tests` and opens it in the workbench.
3. It uploads `sql-load-overwrite.csv` to the root of the test's Test Data, then
   validates with `POST /tests/{id}/validate?context=run` (zero errors).
4. It sets the console to DEBUG, selects the shared E2E environment, presses Run
   and waits for the bookend `sql-load-done`, then reads the console and the
   session variables and deletes the imported test.

## Validation

- **Session outcome:** passed; the bookend `sql-load-done` is logged after the
  Finally path.
- **Sources:** `ld_seed` is a typed table from a Run SQL (integer, text,
  integer, boolean columns); `ld_keyed` is a CSV Parser table; `ld_gen` holds 7
  rows whose row 6 has a NULL name.
- **Add:** Rows changed 3; lines `Connected to PostgreSQL {version} at
  {host}:{port}`, `batch 1/1: 3 rows`, `3 rows into {table}, {s} s`; the INSERT
  printed once at DEBUG with `$1..$4`.
- **Add or replace, Key columns empty:** row 2 is replaced, row 4 added, rows 1
  and 3 untouched; the statement ends `ON CONFLICT ("id") DO UPDATE SET ...`.
- **Add clash under Fail, inside a Try/Catch:** the block paints failed with
  `Row 3: 23505: duplicate key value violates unique constraint "{table}_pkey"`;
  the ERROR line and the caught error carry it; rows 1 and 2 of that load did
  not land, and the block's console says `Transaction rolled back: 0 rows into
  {table}`.
- **Missing column (Record and continue):** `Column 'color' is not in {table}`,
  Reason Validation, no statement printed, the table unchanged.
- **Overwrite from Test Data:** only the CSV's two rows are left (the empty cell
  is NULL); the table keeps its comment `wave-keep` and both indexes, so it was
  emptied and not dropped.
- **Commit each batch off, bad row 6 (Overwrite, Record):** Rows changed 0,
  Reason DatabaseError, `Row 6: 23502: null value in column "name" ...`; the
  two CSV rows are still there, so the DELETE rolled back with the batches.
  After `batch 1/4` and `batch 2/4` the console says `Transaction rolled back:
  0 rows into {table}`, and no line claims rows landed.
- **Commit each batch on, Stop on error on (Record):** batches 1 and 2 stay,
  Rows changed 4, the block records the row 6 error.
- **Commit each batch on, Stop on error off:** `batch 3/4 failed: Row 6: ...`,
  `batch 4/4: 1 rows`, `5 rows into {table}`, Rows changed 5, the block passes;
  the table holds ids 1, 2, 3, 4 and 7.
- **Commit each batch on, COMMIT refused (Record):** a DEFERRABLE INITIALLY
  DEFERRED unique `name` holds a seeded `row-3`, so batch 2's COMMIT is
  refused with `23505: duplicate key value violates unique constraint
  "{table}_name_key"`; Rows changed 2, the table holds ids 1, 2 and 100, and
  the console has `batch 1/4: 2 rows` and the failure line only, no line for
  the rolled-back batch 2.
- **No primary key:** Key columns empty records
  `Key columns are required: {table} has no primary key` (Validation); Key
  columns `code` upserts both rows with `ON CONFLICT ("code")`.
- **Every other database:** Add or replace with each dialect's statement at
  DEBUG (MariaDB `ON DUPLICATE KEY UPDATE`, Oracle and SQL Server `MERGE`,
  SQLite `ON CONFLICT`); MariaDB also matches its unique `code` key, so row 9
  lands on row 1; Oracle, SQL Server and SQLite match the primary key only and
  add row 9; the boolean column reads back as 1 and 0.
- **SQLite, one transaction (Record and continue):** an Add of three rows whose
  last row carries an id the table holds, and an Overwrite of three rows whose
  last row repeats the id of its first, each record
  `Row 3: UNIQUE constraint failed: {table}.id`, Reason DatabaseError and Rows
  changed 0. Each block's console says `Transaction rolled back: 0 rows into
  {table}` and no line claims rows landed. A read back after each finds only
  the two rows from before, so the Overwrite's DELETE rolled back too.
- **SQLite, two writers:** a Parallel runs two branches on the one file. The
  `holder` branch runs `BEGIN IMMEDIATE`, inserts row 50, counts through a
  recursive query for about two seconds and commits. The `loader` branch waits
  500 ms, then loads three rows into the same table with Connect timeout 30. The
  load passes with Rows changed 3 and its usual lines, the holder writes its
  four Statement lines, and a read back after the join finds all four rows.
  Only the outcome is asserted, never how long the load waited.
- **Block states:** the recorded blocks paint the warning state, the clash block
  paints failed, every other block succeeds.
- **Bindings:** every bound value is echoed by a downstream Log.
- **Cleanup:** the Finally path drops every table and a count per database reads
  0.
