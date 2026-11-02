# V-PLUGIN-EXCEL-FUNCTIONAL: Excel Parser execution

Verify the Excel Parser end-to-end: the write/read round trip, every sheet and
range selection mode, reading workbooks authored by a spreadsheet application,
looping over the rows a workbook was read into, and the permutations that abort
the run.

## Pre-requisites

No seed. Each test imports its own fixture via `POST /tests`, validates it (zero
errors), then runs it in the workbench. No external service: the workbooks are
written into the run's own artifacts directory, and the two genuine workbooks
are carried in the fixture as base64 and seeded by a File I/O binary write.

## Fixtures

| Fixture | Covers |
|---------|--------|
| `roundtrip` | table -> workbook -> table; four sheets in one workbook (`keep_sheets` leaves the earlier ones untouched); read by name, by 1-based position with a range, from an offset start cell through its header row, and header-less as spreadsheet letters |
| `real-file` | `sample_workbook.xlsx` and `macro_book.xlsm` (LibreOffice Calc output, checked in under `backend/tests/plugins/excel_parser/fixtures/`) uploaded as the test's own test data and read through `testdata://`: auto column typing, ISO 8601 dates, an empty cell inside a whole-number column, a `#DIV/0!` error value, an uncomputed formula reported in `errors`, and the macro-enabled format |
| `loop-rows` | an Excel-read table bound from the variable picker drives a For Each; each iteration logs its row, stores it (and the whole table) through a Variable Setter, and writes its own sheet into a second workbook that the then-path reads back |
| `abort-xls` | a legacy `.xls` workbook aborts the run |
| `abort-missing-sheet` | a named sheet the workbook does not carry aborts the run |
| `abort-mismatch` | a text cell under a schema declaring whole numbers aborts the run with the fail policy |

`expected.json` holds the ground-truth console lines, which the spec asserts
verbatim.

## Steps

1. `./scripts/e2e-targeted-local.sh functional/excel-parser/<spec>.spec.ts` from the root of
   the clone, or the whole suite via `./scripts/ci-playwright-local.sh`.

## Validation

- **Passing fixtures:** run reaches `passed`; every `expected.json` line for that
  fixture appears in the console.
  - `roundtrip`: the read-back rows, resolved column types and row count match
    what was written; the workbook lists `Orders,Summary,Placed,Bare` in write
    order; a range read returns one named row; the offset sheet reads through
    header row 3; the header-less sheet names its columns `A,B,C`.
  - `real-file`: the People sheet types as `string,integer,float,boolean,string`,
    dates arrive as `2024-01-15T00:00:00` / `14:30:00`, the offset sheet keeps its
    empty cell as `None`, the uncomputed formula produces exactly one `errors`
    entry at `doubled@2` with `success` false, and the `.xlsm` reads identically.
  - `loop-rows`: one iteration per row with `item.value.<column>` resolving, the
    stored table readable downstream after the loop, and the second workbook
    holding `S0,S1,S2` - one sheet per iteration.
- **Aborting fixtures:** run reaches `failed`; the failing node shows
  `data-execution-status="failed"`; the console carries the exact error
  (`Unsupported workbook format: legacy.xls. Excel supports .xlsx and .xlsm - save the file as .xlsx`,
  `Sheet not found: Nope. Available sheets: Orders`,
  `Type mismatch in column 'code': 'abc' is not a valid integer`).

## Notes

- The two genuine workbooks are the same bytes the backend unit tests read, so a
  reader regression fails in both suites at once. They are carried as base64
  because a run can only reach files inside its own artifacts directory.
- `loop-rows` binds its collection as a literal variable reference (the picker
  path a user takes), not as an expression.

---

# V-PLUGIN-EXCEL-UI-TRANSFORM: sorts and filters built in the sheet

- Spec: `v-plugin-excel-ui-transform-functional.spec.ts`; fixture: none.
- Seed: blank Tests (`POST /tests`), each with a one-sheet workbook the spec writes itself
  (`helpers/table-transform.ts` `buildWorkbook`) uploaded as its own Test Data: `amounts.xlsx`
  (id / amount rows a 3, b 8, c 12), `filters.xlsx` and `sorts.xlsx` (the shared filter and
  sort rows, a null cell left out). The Excel Read blocks, the workbook picked from Test Data,
  sorts, filter blocks with literal conditions, the Table outputs bound to new variables and a
  Log printing the kept ids are all built through the UI. Per "as" type one more Test holds one
  Excel block per operator and column, its filter generated in the shape the sheet stored.
- Validation: the Excel block ends `success` and the Log prints `c,b` (CSV-12, REQ-3.4.1.13).
- Validation: per "as" type (String, Integer, Float, Boolean) a filter built in the sheet keeps
  its ids and stores exactly the generated shape; every operator of the type keeps the expected
  ids on a held column and on a column whose row b holds null (REQ-3.1.3.25).
- Validation: sorts built in the sheet by name and by index, ascending and descending, order
  the rows; two keys keep their priority; a null cell sorts last (CSV-7).
