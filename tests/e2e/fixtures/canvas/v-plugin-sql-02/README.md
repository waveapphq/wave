# V-PLUGIN-SQL-02: SQL Editor States

Verify the SQL block's Edit value sheet in SQL mode: its footer, the Get tables suggestion, the Tables popover, the Parameters suggestion with the check warnings, a run in flight, and the Get Tables chip in its six states.

## Prerequisites

No seed script. The E2E PostgreSQL service must be up (`scripts/e2e-stack.sh up --wait postgres`). The spec creates a schema `v_sql02_<random>` holding 14 demo tables (among them `orders` with `id, customer_id, status, total, created_at` and `order_items` with `id, order_id, sku, qty, price`) through a tracked run, and drops it at the end. Each test imports its own Test through `POST /tests` with one SQL block on PostgreSQL (`127.0.0.1:9473`, database `wave`, user `wave`), validates it and deletes it afterwards:

- suggest-tables and tables: Driver options `startup_params` = `{"search_path": "<schema>"}`, SQL is the wireframe's query with line 2 left at `FROM `, Parameters `customer` and `status`
- suggest-params: the same connection, the six-line script ending on `SET search_path TO public;` with line 4 left at `  AND status = `, Parameters `customer`, `status` and `limit`
- running: `SELECT pg_sleep(60)`
- chip states: the schema connection with `SELECT 1`
- chip failed: a wrong password

## Steps

1. Open the Test at http://localhost:3000/workbench?editTest=<id>, open the SQL block's config sheet, then the SQL row's Edit value sheet
2. suggest-tables: read the footer, open Kind, open F1 Help; put the cursor after `FROM ` on line 2 and press Ctrl+Space; click the Get tables row
3. tables: click Get Tables and wait for it to settle; put the cursor after `FROM `; click the chip, type `ord`, click `orders`; then replace the SQL with `SELECT id FROM ordrs; SELECT id FROM WHERE id = 1` and open `(+N more)`
4. suggest-params: click Get Tables; type `:` at the end of line 4, click `status`; open `(+1 more)`
5. running: pick the E2E environment, click Run, then Stop
6. chip states: click Get Tables while the catalog answers are held on connecting, then reading; click the chip's Stop; click Get Tables for a real pull; click refresh and type a key while it reads Got 14 tables
7. chip failed: click Get Tables, hover the chip

## Validation

- **SQL mode:** STRING badge; footer Literal (Literal / Template), SQL locked, F1 Help, Get Tables, then Close, Save, Run in one row, Run the primary button
- **F1 Help:** popover headed KEYBOARD listing Autocomplete, Run, Save, Close, Toggle comment, Find and replace, Go to line, Indent / outdent, Undo / redo (no Rename symbol)
- **Get tables suggestion:** after `FROM ` the list holds one TABLES section with one row, `Get tables from the database`, with the database icon; clicking it pulls the catalog and inserts nothing, and the open list then shows the 14 tables under TABLES
- **Settled chip:** `Tables · 14` with the database icon and the refresh button right beside it
- **Tables popover:** opens above the chip with the search focused; `ord` lists `order_items` then `orders`, their columns under each, `ord` underlined, the first row highlighted; clicking `orders` closes it, line 2 reads `FROM orders` and the editor has focus
- **A keyword is no table:** the strip's list carries `Line 1: Table 'ordrs' is not in the loaded tables` and no `Table 'WHERE'` line
- **Parameters suggestion:** after `:` one PARAMETERS section listing `customer`, `limit`, `status`, each with the `:` icon; clicking `status` makes line 4 `  AND status = :status`
- **Check warnings:** amber strip `Parameter 'limit' is defined but not used in the SQL` followed by `(+1 more)`, whose list adds `Line 6: SET search_path ends the script; its effect ends with the block`; only line 6 is underlined, amber and wavy; Save and Run stay enabled
- **Running:** a spinner and a red Stop with a square icon replace Run; Save disabled; Literal, F1 Help, Get Tables, Close and Stop enabled at full opacity; Stop brings Run back
- **Chip states:** `Get Tables` (database icon); `Connecting...` and `Getting tables...` each with a spinner and a square Stop icon button, Stop returning the chip to `Get Tables`; `Got 14 tables` in the success color with a check; `Tables · 14` with refresh after three seconds, or at once on a keystroke; `Could not get tables` in the error color with an alert icon, its tooltip carrying `password authentication failed`
