# V-PLUGIN-EXCEL-01: Excel Parser config sheet

Verify the Excel element's canvas appearance and its configuration form in both
operations against the Read and Write wireframes, and that an element binding a
table variable is not flagged as incomplete.

## Prerequisites

None. Six of the seven cases drag the element out of the palette; the badge case
imports `fixture.json` via `POST /tests` and opens it in the workbench. No
database reset and no seed script.

## Steps

1. Open http://localhost:3000/workbench and drag the Excel element onto the canvas.
2. Open its configuration and read the Read form top to bottom.
3. Uncheck and re-check "Has header row".
4. Set Column types to Schema.
5. Switch Operation to Write.
6. Import `fixture.json` and open it in the workbench.

## Validation

- **Canvas node:** carries the grid Sheet glyph in the Data category, and never
  the spreadsheet-file glyph the CSV element keeps.
- **Read form:** exactly nine rows, in order - Operation, Workbook, Sheet, Range,
  Has header row, Header row, Column types, Empty cells, On type mismatch - with
  no collapsible parameter group; the red asterisk is on Workbook only.
- **Placeholders:** Workbook shows `artifact://..., testdata://..., or /abs/path`;
  Range shows `A1:F200`.
- **Header row:** a number field carrying `1`; it disappears while "Has header
  row" is unchecked and comes back carrying `1`.
- **Schema source:** appears only for Column types = Schema, is required, is a
  variable picker, and offers no expression toggle.
- **Transform:** Sorts and Filters collapsibles, each with its `(i)` tooltip.
- **Write form:** Range, the header controls and the typing controls disappear;
  Table (required), Write header row, Start cell (value `A1`) and "If the file
  exists" (Keep other sheets) appear; the Table row offers the expression toggle
  and Transform is still shown.
- **Outputs:** Read offers Table, Row Count, Schema, Sheets, Success, Errors and
  no File; Write offers File, Success, Errors and none of the table trio.
- **Validation badge:** the imported Test shows no `node-validation-alert` on the
  Excel Read using a schema source, the Excel Write binding a table, or the CSV
  Serialize binding a table.
