---
id: excel-parser
description: Convert a spreadsheet worksheet to a WAVE table and back, with typing and transforms
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-27"
    changelog:
      - "Read: a worksheet to a WAVE table; Write: a table back into a workbook"
      - "Modern formats only - .xlsx and .xlsm; a legacy .xls file is rejected with the format to save as"
      - "Sheet selection by name or position, A1 range selection, and an addressable header row"
      - "Column typing: auto (from each cell's stored type), all-string, or schema-driven"
      - "Empty-cell policy (null or column default) and type-mismatch policy (fail / skip row / replace with default)"
      - "Declarative Transform: sort keys and per-column filter blocks applied to the table, on read or on write"
      - "Non-destructive writes: an existing workbook keeps its other sheets unless the file is replaced"
---

The Excel Parser plugin converts between spreadsheet workbooks and WAVE's table type. Unlike the text converters it works on files: it resolves a workbook path (`artifact://`, `testdata://`, or an absolute or relative path) and reads or writes that file.

**Use Cases:**
- Read a spreadsheet of test data into a table variable and loop over its rows
- Read one row or one block of a sheet by range, with the header row still naming the columns
- Assemble a multi-sheet report across several steps, or fill a corporate template
- Conform a sheet to a known schema, choosing how to handle cells that violate it

**Behavior:**
- Read opens the workbook, selects a sheet (by name, by position, or the first one) and a range (or the whole used area), and returns the cells as a table
- Column typing is automatic from each cell's stored type, with a mixed column widening to the narrowest type that fits; dates, times and error values arrive as text; a formula reads as its stored result
- A formula with no stored result is reported in `Errors` rather than returned as an empty cell, so a missing calculation is never mistaken for missing data
- Without a header row, columns take their spreadsheet letters
- Empty cells map to null by default, or to the column type default
- Under a schema, a cell that violates its declared type either fails the run, skips the row, or is replaced with the column default
- Declarative sorts and filters shape the table on either operation: the table Read returns, or the table Write puts into the sheet - the source variable is never changed
- Write places the table into a named sheet: an existing workbook keeps its other sheets and the named sheet is added or replaced, unless the whole file is replaced

**Parameters:**
- `Operation`: Read (workbook to table) or Write (table to workbook)
- `Workbook`: The workbook file to read from or write to
- `Sheet`: Sheet name or position; blank picks the first sheet (Read) or names it Sheet1 (Write)
- `Range`: Cell range to read; blank reads the whole used area (Read)
- `Has header row` / `Header row`: Whether column names come from a sheet row, and which row (Read)
- `Column types`: Auto, String, or Schema (Read)
- `Schema source`: Schema table used when Column types is Schema (Read)
- `Empty cells`: Map empty cells to null or the column default (Read)
- `On type mismatch`: Fail, Skip row, or Replace with default (Read)
- `Sorts` / `Filters`: The Transform section's declarative sort keys and filter blocks
- `Table`: The table to write - a table variable, or an expression such as `orders.filter('qty').greater_than(5)` (Write)
- `Write header row`: Whether the column names are written as the first row (Write)
- `Start cell`: Top-left cell the table is written from (Write)
- `If the file exists`: Keep the other sheets, or replace the file (Write)

**Outputs:**
- `Table`: The table read from the sheet (Read)
- `Row Count`: Number of rows in that table (Read)
- `Schema`: Column name/type descriptors for that table (Read)
- `Sheets`: Every sheet name in the workbook, in workbook order (Read)
- `File`: Path of the workbook that was written (Write)
- `Success`: Whether no cell errors occurred (boolean)
- `Errors`: Per-cell read details as [{row, column, error}] (array)

**Limits:**
- Cell formatting, styling, charts, images and macros are not converted - the plugin moves data, not presentation
- A workbook is bounded by its compressed size, its expanded size and its cell count; a file above any of those limits is refused with the limit it exceeded
