# V-FIELDERR-01: Field-Level Save Errors on the Config Sheet

Verify that every reason that disables Save shows on its own row of the SQL config sheet, at the right moment, without moving the row, and that an unknown variable in an expression is an amber warning that never blocks Save.

## Prerequisites

No seed script. Each test seeds its own Test with one SQL block (Run SQL, PostgreSQL) and deletes it afterwards:

- messages: nothing stored; persisted through the admin bulk route, since the empty required rows fail `POST /tests`
- warning only: Host, Port, Database and Username from the E2E stack settings and SQL `SELECT 1`, imported through `POST /tests` with zero validation errors

## Steps

1. Open the Test at http://localhost:3000/workbench?editTest=<id> and open the SQL config sheet
2. messages: read the sheet; focus Host, press Tab once, then again; type 70000 in Port and 0 in Timeout; focus SQL and press Tab; turn on the expression toggle of Username and type `usr`
3. warning only: turn on the expression toggle of Username, replace its text with `usr`, click Save, open the sheet again

## Validation

- **On open:** no row message; Save disabled with the note "Save is disabled: the settings have errors"
- **Leaving a row:** Host stays quiet while focus is on its own expression toggle and shows "Host is required" once focus moves to the next row; SQL shows "SQL is required" once left; Database and Username, never left, show nothing
- **Wrong values:** "Port must be between 1 and 65535" and "Timeout must be at least 1" show as soon as the value is typed, focus still in the field
- **Error style:** each of the four fields has the destructive border and is marked invalid; its message is in the destructive color directly under it; exactly four rows are flagged; the note stays generic
- **Alignment:** the info badge, label, type, field and expression toggle keep the position they had before the message; the label stays centered on the field; the row grows downward
- **Unknown variable:** Username reads `usr` and shows "Variable 'usr' is not defined" under the field in the Warning Text color, with the amber field outline; it is not counted: still four flagged rows
- **Warning only:** no note, Save enabled; after Save and reopening, Username is still an expression reading `usr` with the warning shown at once
