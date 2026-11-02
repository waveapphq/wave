---
id: xml-parser
description: Parse XML documents and execute XPath queries to extract data
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-05"
    changelog:
      - "Full XML parsing with XPath 1.0 query support"
      - "Automatic namespace extraction from XML documents"
      - "Combined mode: all results in a single map with type metadata"
      - "Individual mode: each query result as a separate output variable"
      - "Type coercion in individual mode (string, integer, float, boolean)"
      - "Per-query error collection - failed queries do not stop others"
      - "Client-side XPath testing in config modal"
      - "Inline query editor with expression toggle per query"
---

The XML Parser plugin parses XML documents and executes XPath queries to extract data for use in workflow variables.

**Use Cases:**
- Extract values from XML API responses (SOAP, RSS, Atom)
- Validate XML document structure with XPath assertions
- Count elements or check existence with XPath functions
- Parse configuration files in XML format
- Query namespaced XML documents (namespaces auto-extracted from root element)

**Behavior:**
- Parses the XML document once, then executes all queries against it
- XML parse errors are fatal (no document to query)
- Per-query XPath errors are collected in the errors array without stopping other queries
- Combined mode returns results as `{alias: {type, value}}`
- Individual mode returns each result as a separate output variable with optional type coercion
- Supports XPath 1.0 functions: `count()`, `string()`, `boolean()`, `sum()`, etc.

**Parameters:**
- `XML Content`: The XML document to parse (required)
- `Output Mode`: Combined (default) or Individual
- `Queries`: Map of alias/variable names to XPath expressions (required)

**Outputs:**
- `success`: Whether all queries executed without errors (boolean)
- `errors`: Per-query error details as [{query, error}] (array)
- `results`: Query results map (combined mode only)
