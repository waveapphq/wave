# V-PLUGIN-SQL-01: SQL Block Config Sheet

Verify the SQL config sheet in its three operation states (Run SQL, Call procedure, Load table), how Database type changes the Port default, TLS and the SQLite rows, the outputs of each operation, and the SQL row in expression mode (SQL-10).

## Prerequisites

No seed script. Each test persists its own Test through the admin bulk route (the block's empty required rows fail `POST /tests` on purpose), checks that the server names exactly those rows, and deletes the Test afterwards. The Test holds one SQL block with nothing stored but:

- run, selects, groups, types, outputs: nothing (Run SQL, PostgreSQL)
- call: Operation `call_procedure` and TLS on
- load: Operation `load_table`
- expression: a block that passes `POST /tests` (Host `db.example.com`, Database `shop`, Username `reader`, SQL `SELECT id, qty FROM orders WHERE qty >= :min_qty`, Parameters `min_qty` = `4` as an expression)

## Steps

1. Open the Test at http://localhost:3000/workbench?editTest=<id> and open the SQL config sheet
2. run: read the sheet, the Save button and the note under it
3. selects: open the Operation, Database type and Script Type selects; set Script Type to File, then back to Source
4. groups: expand TLS / Certificates, Advanced and Failure Handling
5. types: expand TLS / Certificates; set Database type to MySQL / MariaDB, Oracle, SQL Server, PostgreSQL, SQLite and back to PostgreSQL, opening Operation on SQLite and on PostgreSQL
6. call: read the sheet, open Out arguments from its expand and click Add argument, close the editor, expand TLS / Certificates, untick and tick TLS, expand Advanced, set Database type to SQLite, then back to PostgreSQL
7. load: read the sheet, open Mode, set it to Add or replace, Overwrite and Add or replace again; tick, untick and tick Commit each batch; expand Advanced
8. outputs: read the output section; set On error to Record and continue; set Operation to Call procedure, then Load table; set On error to Fail the block; set Operation to Run SQL
9. expression: open the SQL row's editor and close it; switch the SQL row to `{}` and answer the switch warning with Clear; type with `"SELECT id, qty FROM orders WHERE qty >= :min_qty"`; press Ctrl+E in the row and close the editor with Cancel; Save the sheet, then Save the Test from the toolbar

## Validation

- **Header:** Database glyph in purple, title "SQL - Edit Config", Version 1.0.0; input table columns Parameter / Type / Value
- **Run SQL:** Operation (Run SQL), Database type (PostgreSQL), Host*, Port (hint 5432, empty), Database*, Username*, Password (lock icon), Script Type (Source), SQL* (`{}` toggle), Parameters (`{}` in gray), Stop on error (ticked), Timeout (300 in gray), then TLS / Certificates, Advanced, Failure Handling and Secrets, all collapsed; Operation, Database type and Script Type have no toggle
- **Flagged on open:** Host, Database, Username and SQL each carry a row message as the sheet opens, and no other row does; Save disabled with the note "Save is disabled: the settings have errors"; the server names exactly those four rows as missing
- **Selects:** Operation offers Run SQL / Call procedure / Load table; Database type offers PostgreSQL / MySQL / MariaDB / Oracle / SQL Server / SQLite; Script Type offers Source / File, and File shows SQL File* (path hint, Browse) where SQL was
- **Groups:** TLS / Certificates holds only TLS (unticked, no toggle); Advanced holds Connect timeout (30 in gray), Max rows (10000 in gray) and Driver options (`{}` in gray); Failure Handling holds On error on Fail the block
- **Database type:** Port hint 3306 on MySQL / MariaDB, 1521 on Oracle, 1433 on SQL Server, 5432 on PostgreSQL; SQL Server ticks TLS and shows Verify Server Certificate (ticked), CA Certificate, Client Certificate and Client Key (lock icon); the other types leave TLS unticked with nothing under it
- **SQLite:** File* (path hint, Browse) replaces Host, Port, Database, Username and Password; no TLS / Certificates group; Operation offers Run SQL / Load table only; PostgreSQL brings everything back
- **Call procedure:** Procedure* (empty), Arguments (`{}` in gray) and Out arguments (`[]` in gray, no toggle) replace Script Type, SQL, Parameters and Stop on error; the server names Host, Database, Username and Procedure; the Out arguments list editor opens empty and its Add argument adds argument 1; TLS ticked shows its four rows, unticking removes them, ticking brings them back; Advanced keeps Max rows; on SQLite the Operation row keeps Call procedure and is flagged at once with "Operation 'Call procedure' is not available on SQLite"; PostgreSQL clears it
- **Load table:** Table* (typed Table, Browse), Target table*, Mode (Add; Add / Add or replace / Overwrite) and Commit each batch (unticked, no toggle); the server names Host, Database, Username, Table and Target table; Add or replace shows Key columns under Mode, Overwrite removes it; Commit each batch ticked shows Stop on error (ticked) under it; Advanced holds Connect timeout, Batch size (1000) and Driver options, no Max rows
- **SQL as an expression:** the literal SQL opens the SQL editor with `:min_qty` in the SQL coloring, the Get Tables chip and Run; with `{}` on (the switch warning asks first, and Clear starts the expression empty), the row is the inline expression editor (no text box, no SQL coloring) and Ctrl+E opens the "Edit SQL" expression editor with no SQL coloring, no Get Tables chip and no Run, while no SQL editor opens; the saved block lists `sql` and `parameters.min_qty` as its expression fields and stores the expression as its SQL
- **Outputs:** columns Parameter / Type / Secret / Assign to; Run SQL: Success (Boolean), Rows (Table), Row count (Integer), Rows changed (Integer); Call procedure: Success, Rows, Row count, Out values (Table); Load table: Success, Rows changed; Error and Reason (String) only under Record and continue; each row has an unticked Secret box and an empty `variable_name` input
