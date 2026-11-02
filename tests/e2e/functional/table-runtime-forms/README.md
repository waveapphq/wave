# V-TABLE-RUNTIME-FORMS Table Runtime Forms - Functional

End-to-end coverage of the two runtime forms a table reaches a consumer in: the
live table a converter plugin produces, and the stored form of a table variable
declared in the Variable Manager. Every consumer that accepts a table asks one
shared question about it, so both forms work everywhere: the For Each loop, the
Variable Setter, the CSV converter's table and schema-source parameters, and the
collection row's type selector in the configuration form.

## Pre-requisites

- Backend on the per-worker port (Playwright fixtures).
- Frontend on the matching per-worker port.
- No external service: every fixture converts text in-process.

## Execution Steps

1. `loop-plugin-table` - a CSV converter parses `sku,qty` and binds its table
   output to the `orders` table variable; For Each iterates `orders` and a body
   Log reads `item.value.sku` / `item.value.qty` plus the index; a then Log runs
   after the loop.
2. `setter-plugin-table` - the same converter output is stored by a Variable
   Setter into `stored_orders`, and its `filter('qty', 'greater_than', 5)`
   derivative into `big_orders`; two Logs read a cell and the row count of each.
3. `csv-serialize-declared-table` - a table variable declared in the Variable
   Manager (never written by a plugin) is serialized to CSV text and logged.
4. `csv-schema-declared-table` - a declared table variable drives schema-mode
   typing; the resolved column descriptors and row count are logged.
5. `foreach-collection-type` - a For Each node whose collection binds a declared
   table variable is opened in the configuration form, then the workflow runs.

## Validation Criteria

- Every fixture validates with zero errors before it is executed.
- Step 1: the run passes and the console carries `loop-row-A-1-3-at-0`,
  `loop-row-B-2-7-at-1` and `loop-done` - one iteration per table row, each row
  exposed as a map of its columns.
- Step 2: the run passes and the console carries `stored-A-1-rows-2` and
  `derived-B-2-rows-1` - the stored table is readable downstream, and a derived
  table stores just as well as the one that was read.
- Step 3: the run passes and the console carries
  `declared-csv=sku,qty~A-1,3~B-2,7~`.
- Step 4: the run passes and the console carries
  `declared-schema=id:integer,name:string-rows-1`.
- Step 5: the collection row's Type reads `table`, the row raises no alert, Save
  is enabled (a row-level mismatch would block the whole form), and after
  canceling, the run passes with `bound-row-A-1`, `bound-row-B-2` and
  `bound-loop-done`.

## Notes

- The loop fixture binds its collection as an expression and the collection-type
  fixture binds it as a literal variable reference, so both entry paths into the
  loop are exercised.
- The declared-table fixtures deliberately never let a plugin write the variable:
  that is what keeps them in the stored form at execution time.

---

# V-TABLE-FILTER-NULL: table.filter() on a null cell

- Spec: `v-table-filter-null-functional.spec.ts`; fixture: none.
- Seed: a `zz-` Test (`POST /tests`) with one CSV block whose Table output binds `t` (rows a
  apple 3, b with both cells null, c cherry 12). The Variable Setter under it and its nine
  expression rows, one per filter operator, are typed in its sheet.
- Validation: the saved Setter holds the rows as typed in expression mode; the run passes and
  each row keeps the ids the check rule gives (REQ-3.1.3.25): on row b, equals, contains,
  greater than, is not empty and not null drop it; not equals, does not contain, is empty and
  is null keep it.

---

# V-TABLE-SANDBOX-NAMES: the table types an expression may use

- Spec: `v-table-sandbox-names-functional.spec.ts`; fixture: none.
- Seed: a blank `zz-` Test (`POST /tests`) per test. The variable, the Log and its expression are
  built in the UI.
- Validation: a Table Expression variable `Table([('k', 'integer')])` is created and a Log reading
  it prints `k:integer`; a Log expression calling `Table`, `TableRowView` and `ColumnType` shows no
  warning or error, passes the pre-run check and prints `b7float`; typing the start of each name
  offers it in the suggestion list. The names an expression may use undeclared are one list pinned
  to the backend sandbox (`SAFE_BUILTINS`).
