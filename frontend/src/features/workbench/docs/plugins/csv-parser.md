---
id: csv-parser
description: Convert delimited text to a WAVE table and back, with typing and transforms
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-23"
    changelog:
      - "Parse: delimited text to a WAVE table; Serialize: table back to text"
      - "Configurable delimiter and header row"
      - "Column typing: auto (per-column widening with guards), all-string, or schema-driven"
      - "Empty-cell policy (null or column default) and type-mismatch policy (fail / skip row / replace with default)"
      - "Declarative Transform: sort keys and per-column filter blocks applied to the table, on parse or on serialize"
      - "Schema output renamed from headers; parsed data binds a table variable"
---

The CSV Parser plugin is a pure format converter between delimited text and WAVE's table type. It performs no file I/O - it reads from and writes to variables.

**Use Cases:**
- Turn a CSV/TSV response or fixture into a typed table variable
- Reshape a table with declarative sort and filter, before downstream steps or before it is written out
- Serialize a table back to CSV text for export or a request body
- Conform incoming data to a known schema, choosing how to handle bad cells

**Behavior:**
- Parse reads the text with the configured delimiter and header setting into a table
- Column typing is automatic (integers widen to floats, mixed columns fall back to string, leading-zero and non-finite values stay text), all-string, or driven by a supplied schema table
- Empty cells map to null by default, or to the column type default
- Under a schema, a cell that violates its declared type either fails the run, skips the row, or is replaced with the column default - the collected errors report which cells were affected
- Declarative sorts and filters shape the table on either operation: the table Parse returns, or the table Serialize writes out - the source variable is never changed
- Serialize writes the table back to delimited text with the configured delimiter and header setting

**Parameters:**
- `Operation`: Parse (text to table) or Serialize (table to text)
- `CSV Content`: The delimited text to parse (Parse)
- `Table`: The table to serialize - a table variable, or an expression such as `orders.order_by('sku')` (Serialize)
- `Delimiter`: Single-character field delimiter (default comma)
- `Has header row`: Whether the first row holds column names
- `Column types`: Auto, String, or Schema
- `Schema source`: Schema table used when Column types is Schema
- `Empty cells`: Map empty cells to null or the column default
- `On type mismatch`: Fail, Skip row, or Replace with default
- `Sorts` / `Filters`: The Transform section's declarative sort keys and filter blocks

**Outputs:**
- `Table`: The parsed table (Parse)
- `Row Count`: Number of rows in the parsed table (Parse)
- `Schema`: Column name/type descriptors for the parsed table (Parse)
- `CSV Content`: The serialized text (Serialize)
- `Success`: Whether no cell errors occurred (boolean)
- `Errors`: Per-cell type-mismatch details as [{row, column, error}] (array)
