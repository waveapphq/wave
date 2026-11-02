---
id: sql-client
description: Run SQL, call a stored procedure or load rows into a table on PostgreSQL, MySQL / MariaDB, Oracle, SQL Server or SQLite, and hand back what the database answered as typed values
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-22"
    changelog:
      - "Run SQL: runs one statement or a whole script, split the way each database's own tool splits it"
      - "Call procedure: calls a stored procedure or function with named arguments and reads the out arguments back as Out values"
      - "Load table: loads a table variable, or a CSV or Excel file, into an existing table with Add, Add or replace or Overwrite"
      - "Five databases: PostgreSQL, MySQL / MariaDB, Oracle, SQL Server and SQLite"
      - "Values reach the SQL as bound `:name` parameters, never pasted into the text"
      - "TLS with Verify Server Certificate, CA Certificate, Client Certificate and Client Key; on by default for SQL Server"
      - "SQL editor: dialect coloring, a syntax check while typing, suggestions, and Get Tables for the tables and their columns"
      - "Remotable: inside a Remote Execution body the block runs on the remote host, which needs nothing installed"
      - "On error: Fail the block, or Record and continue with Success, Error and Reason"
      - "SQL row takes the {} expression toggle: the expression gives the SQL text; :name parameters still bind"
---

The SQL plugin runs SQL against one database: a script, a stored procedure call or a table load. It works with PostgreSQL, MySQL / MariaDB, Oracle, SQL Server and SQLite, on the WAVE host, on a remote host inside a Remote Execution body, and through an SSH tunnel. What the database answers comes back as typed values: numbers stay numbers and dates stay dates.

**Use Cases:**
- Seed a database with rows before a test, or clean it up after one
- Check what a table holds after a pipeline ran, with Assert on Rows and Row count
- Wait until a row lands, with Wait Until in Retry mode around a Run SQL block
- Call a stored procedure and check what it wrote back in its out arguments
- Load a CSV or Excel file from Test Data into a table
- Reach a database that only a remote host or an SSH tunnel can see

**Behavior:**
- Every block opens its own connection, does its work and closes it. There is no connect block and no shared session: a test that needs the same database in several blocks gives each block the connection rows, or binds each one to the same database profile
- Session state ends with the block: a `USE`, a `SET` (such as `SET search_path`) or an `ALTER SESSION` lives only inside the script that ran it, and so does a temporary table. A script that ends on a `USE`, `SET` or `ALTER SESSION` statement gets a warning, in the editor and in the run console
- Values reach the SQL as bound parameters. Write `:name` where a value goes and add `name` to Parameters: the statement and the values travel to the database separately, so there is no quoting to get right, a number stays a number, empty text stays empty text, and a null value (the expression `None` or a variable holding null) is NULL. One entry serves every use of its name, and the `:name` form is the same on all five databases
- A `:name` with no Parameters entry fails the block before anything is sent: `Parameter '{name}' is used in the SQL but not defined`. `x::int` is a cast, not a placeholder, and a `:name` inside a string or a comment is left alone
- A table or column name cannot be bound. To vary one, switch the SQL to the Template kind and write a `{{ }}` expression in the text
- A script is split the way the database's own tool splits it (see Databases), so a script pasted from psql, the mysql client, SQL Developer or SSMS runs unchanged. Its statements run in order, and the log names a failing statement by its number and first line
- WAVE opens no transaction of its own: each statement commits on its own. Write `BEGIN` and `COMMIT` in the script for a transaction
- Max rows caps the rows kept from a result. When a result holds more, the rows so far are kept and the run console says `Stopped after {n} rows (Max rows)`. WAVE never adds a `LIMIT`, a `TOP` or a `FETCH FIRST` to the SQL
- Call procedure builds the call the way each database takes it and names every argument where the database allows it. Arguments go in the procedure's own order; Out arguments names the arguments the procedure writes back, and each becomes a column of Out values, typed as the database typed it
- Call procedure fills Rows and Row count with the last set of rows the procedure returns. On MySQL / MariaDB and SQL Server that is a `SELECT` the procedure runs. On Oracle the procedure hands its rows back as a cursor with `DBMS_SQL.RETURN_RESULT`
- On PostgreSQL a procedure returns no rows, only its out arguments; for rows, call a function. When `CALL` finds no procedure by that name, the block calls the function with `SELECT * FROM {function}(...)` and Rows holds what it returns, such as the rows of a `RETURNS TABLE` function; when the function's OUT parameters are named under Out arguments, they fill Out values the way a procedure's do and Rows stays empty
- Load table reads the target table's columns first and matches columns by name. A column of the rows with no match in the table fails the load at once, naming it; a table column with no match takes its default. The block creates no tables
- Mode Add inserts every row. Add or replace updates a row whose key already exists and inserts the rest, matching on Key columns, or on the table's primary key when Key columns is empty; a table with neither fails before any row is sent. Overwrite empties the table with `DELETE` in the same transaction and never drops it
- With Commit each batch off the whole load is one transaction: all rows or none. On, every batch commits on its own. Batch size is rows per round trip, never a commit
- A value the database refuses fails the load with the database's own text, the row number and the column
- Timeout bounds the whole block. When it runs out, the running statement is canceled on the database, not just abandoned
- TLS is on by default only for SQL Server, matching each driver's own default. Turning it on shows Verify Server Certificate, CA Certificate, Client Certificate and Client Key. SQLite is a file, so it has no TLS rows
- An Oracle `dsn` must agree with the TLS row. With TLS on it uses TLS: `tcps://`, or `PROTOCOL=TCPS` in a connect descriptor, and the certificate rows apply to it. With TLS off it does not use TLS. A `dsn` that disagrees fails the block before anything connects
- WAVE sends the program name "WAVE" to every database that accepts one. The driver calls it `application_name` on PostgreSQL, `program_name` on MySQL / MariaDB, `program` on Oracle and `appname` on SQL Server. A Driver options entry of the same name wins: its value is sent instead
- An Oracle session uses the database's own time zone (`DBTIMEZONE`), not the time zone of the WAVE host or of a remote host
- SQLite is WAVE's own bundled build, the same version on the WAVE host and on remote hosts, whatever SQLite the host itself has. The `Connected to SQLite` line in the run console names the version
- Inside a Remote Execution body the block runs on the remote host, which needs nothing installed. The drivers travel with the run; Oracle's driver, WAVE's own SQLite and the TLS layer SQL Server needs travel as prebuilt builds for Python 3.10 to 3.14 on x86_64 or aarch64 with glibc 2.17 or newer, or musl 1.2 or newer. A host with a newer Python, another processor or another C library, or one too old to load a build, fails the block with reason Unsupported. SQLite also needs glibc 2.28 or newer on the remote host; an older one fails the block the same way
- Through an SSH tunnel the block works as Netcat does: a Host of `127.0.0.1` or `localhost` on the Local Port of an open tunnel goes through that tunnel
- In the SQL editor, Get Tables reads the tables and views with their columns once, for the suggestions and the Tables list. It connects from the WAVE host with the block's rows, a bound profile and the Environment picked on the canvas. A row whose value only an earlier block sets cannot be read then, and the pull says which row
- On error decides what a failure does. Fail the block stops the test; Record and continue sets Success to false and fills Error and Reason
- Parameter values and row contents appear in the run console at DEBUG only, and the password and the client key never appear

**Parameters:**
- **Operation**: Run SQL, Call procedure or Load table; SQLite offers no Call procedure (default: Run SQL)
- **Database type**: PostgreSQL, MySQL / MariaDB, Oracle, SQL Server or SQLite. It picks the driver, the dialect the editor checks and suggests, and the default port (default: PostgreSQL)
- **Host**: Database server host name or address (required, except on SQLite)
- **Port**: 1 to 65535. Empty means the type's default: 5432, 3306, 1521 or 1433
- **Database**: The database to connect to; on Oracle, the service name (required, except on SQLite)
- **Username**: Login name (required, except on SQLite)
- **Password**: A secret, masked everywhere
- **File**: SQLite only. The database file: a file from Test Data or Artifacts chosen with Browse, or a path where the block runs (required on SQLite)
- **Script Type**: Source takes the SQL typed in the block; File reads it from a `.sql` file (default: Source) (Run SQL)
- **SQL**: One statement or a whole script, with `:name` where a value goes; with {}, an expression that gives the SQL text (required with Source) (Run SQL)
- **SQL File**: The `.sql` file: `testdata://`, `artifact://` or an absolute or relative path. A `testdata://` or `artifact://` file is read on WAVE; a plain path is read where the block runs (required with File) (Run SQL)
- **Parameters**: Name / value pairs for the `:name` placeholders; empty text binds as empty text and null binds NULL (Run SQL)
- **Stop on error**: On Run SQL, a failing statement stops the script and fails the block; off, every statement runs, each failure is a WARN line, and the block passes, with a warning when every statement failed. On Load table with Commit each batch on, a failing batch stops the load and fails the block, and the batches before it stay; off, the failing batch is skipped with a WARN line and the rest load (default: on)
- **Procedure**: The procedure or function to call, with its schema or package: `billing.apply_discount` (required) (Call procedure)
- **Arguments**: One entry per argument in the procedure's own order: the name as the procedure declares it and the value to pass; leave the value empty for an out argument (Call procedure)
- **Out arguments**: Names of the arguments the procedure writes back; each becomes a column of Out values (Call procedure)
- **Table**: The rows to load: a table variable, or a CSV or Excel file from Test Data or Artifacts chosen with Browse (required) (Load table)
- **Target table**: The existing table to load into (required) (Load table)
- **Mode**: Add, Add or replace, or Overwrite (default: Add) (Load table)
- **Key columns**: Columns that identify a row, comma-separated; empty means the table's primary key (Add or replace)
- **Commit each batch**: Off, the load is one transaction; on, every batch commits on its own (default: off) (Load table)
- **Timeout**: Seconds for the whole block; when it runs out the running statement is canceled on the database (default: 300)
- **TLS**: Encrypt the connection; off is a plain connection with no TLS (default: on for SQL Server, off otherwise) (TLS / Certificates, not on SQLite)
- **Verify Server Certificate**: Check the server's certificate against CA Certificate when one is given, otherwise against the certificates WAVE trusts (Settings > Network > Certificates) (default: on) (TLS on)
- **CA Certificate**: The CA certificate: a file path, a variable reference or a PEM string; when set, it is the only certificate this block trusts (TLS on)
- **Client Certificate**: A client certificate for mutual TLS: a file path, a variable reference or a PEM string (TLS on)
- **Client Key**: The private key of the client certificate: a file path or a PEM string; a secret (TLS on)
- **Connect timeout**: Seconds to wait for the database to accept the connection (default: 30) (Advanced)
- **Max rows**: Rows kept from a result; 0 keeps every row (default: 10000) (Advanced, Run SQL and Call procedure)
- **Batch size**: Rows sent per round trip (default: 1000) (Advanced, Load table)
- **Driver options**: Extra connection options handed to the driver under the driver's own names, except on SQLite: its two names are WAVE's own. See Databases for them and for the common ones. Each row picks its type (string, integer, float, boolean, array or map) and reaches the driver as that type, so `16` picked as integer is a number while `2024` left as string stays text (Advanced)
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Success**: True when the operation finished; false when the block failed and On error is Record and continue
- **Rows**: A table: the rows of the last statement that returned rows, or the rows the procedure returned; empty when there were none (Run SQL, Call procedure)
- **Row count**: How many rows Rows holds (Run SQL, Call procedure)
- **Rows changed**: The rows the script changed, summed over its statements, or the rows the load committed (Run SQL, Load table)
- **Out values**: A one-row table with a column per out or in-out argument, typed as the database typed it (Call procedure)
- **Error**: The failure message (Record and continue only)
- **Reason**: Unreachable, AuthFailed, DatabaseError, Timeout, Validation or Unsupported; empty when the block passed (Record and continue only)

**Databases:**
- **PostgreSQL**
  - Separator: `;` ends a statement; a `;` inside a string, a quoted name, a comment or a `$$` body does not
  - Placeholder in the DEBUG log: `$1`, `$2`, and so on
  - Booleans: bound as true and false
  - Add or replace: `INSERT ... ON CONFLICT (keys) DO UPDATE SET ...`
  - Driver options: passed to pg8000, for example `application_name` and `tcp_keepalive`
- **MySQL / MariaDB**
  - Separator: `;` ends a statement; a `DELIMITER` line changes the separator, as in the mysql client
  - Placeholder in the DEBUG log: `%s`
  - Booleans: bound as true and false; MySQL has no separate boolean type and stores them as 1 and 0
  - Add or replace: `INSERT ... ON DUPLICATE KEY UPDATE ...`; the database matches any unique key of the table, not only Key columns
  - Driver options: passed to PyMySQL, for example `charset`, `init_command` and `read_timeout`
- **Oracle**
  - Separator: `;` ends a SQL statement; a PL/SQL block (`DECLARE`, `BEGIN`, `CREATE PROCEDURE` and the like) ends at a line holding only `/`, as in SQL*Plus and SQL Developer
  - Placeholder in the DEBUG log: `:1`, `:2`, and so on
  - Booleans: bound as 1 and 0
  - Add or replace: `MERGE INTO ... WHEN MATCHED THEN UPDATE ... WHEN NOT MATCHED THEN INSERT ...`
  - Driver options: passed to python-oracledb in thin mode, for example `expire_time`; a `dsn` entry is a full connect descriptor or `host:port/service` and replaces Host, Port and Database; a TNS alias is refused, and so are a configuration provider address (`config-file://...`) and a directory address (`ldap://...`)
- **SQL Server**
  - Separator: a line holding only `GO` ends a batch, as in SSMS and sqlcmd; a `;` does not split, and each batch counts as one statement
  - Placeholder in the DEBUG log: `%s`
  - Booleans: bound as 1 and 0, the values of a `BIT` column
  - Add or replace: `MERGE INTO ... WHEN MATCHED THEN UPDATE ... WHEN NOT MATCHED THEN INSERT ...`
  - Driver options: passed to python-tds, for example `appname` and `readonly`
- **SQLite**
  - Separator: `;` ends a statement; a `CREATE TRIGGER` body runs up to the `;` after its `END`, as in the sqlite3 shell
  - Placeholder in the DEBUG log: `?`
  - Booleans: bound as 1 and 0, the way SQLite stores them
  - Add or replace: `INSERT ... ON CONFLICT (keys) DO UPDATE SET ...`
  - Driver options: `timeout`, seconds to wait on a locked file, and `cached_statements`; any other name is refused
  - Not available: Call procedure, since SQLite has no stored procedures, and TLS, since the database is a file
