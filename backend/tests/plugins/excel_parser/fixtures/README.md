# Excel reader fixtures

These workbooks were produced by **LibreOffice Calc 7.3.7.2**, not by WAVE's own
writer. A workbook we wrote could only prove we read back what we emit: it would
carry no shared-string table, no cached formula results, no application date
encoding, and no merges unless we deliberately added them. Reading a genuine
spreadsheet file is the point of these fixtures.

Authoring route: a flat OpenDocument source was converted with
`soffice --headless --convert-to xlsx` (and `xlsm` for the macro-enabled book).

## sample_workbook.xlsx

Five sheets, in workbook order.

| Sheet | Contents |
|-------|----------|
| `People` | A1-origin table: `name` (text), `age` (whole numbers), `score` (mixed whole and fractional), `active` (booleans), `notes` (header only, every cell empty) |
| `Offset` | Title merged across `A1:D1`, blank row 2, header at row 3, data block `B3:D6`; `C6` is empty inside a whole-number column |
| `Formulas` | `doubled` holds formulas with cached results, except `C4` which has none; `broken` holds a `#DIV/0!` error value |
| `Dates` | A date, a date-and-time, and a time-only column, stored as serial numbers with date number formats |
| `Empty` | No content |

`C4` on the `Formulas` sheet is the one deliberate post-processing step: its
cached `<v>` was removed from the sheet XML, leaving the formula with no stored
result. That is exactly what a workbook written by a tool that never computed
its formulas looks like, and it is the input that must be reported in `errors`
rather than returned as an empty cell. Every other byte is LibreOffice output.

## macro_book.xlsm

A single `Inventory` sheet in the macro-enabled format, proving `.xlsm` reads
through the same path as `.xlsx`.
