---
id: json-parser
description: Parse JSON documents and execute JSONPath queries to extract data
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-10"
    changelog:
      - "Full JSON parsing with JSONPath query support"
      - "Combined mode: all results in a single map with type metadata"
      - "Individual mode: each query result as a separate output variable"
      - "Type coercion in individual mode (string, integer, float, boolean)"
      - "Per-query error collection - failed queries do not stop others"
      - "Client-side JSONPath testing in config modal"
      - "Inline query editor with expression toggle per query"
---

The JSON Parser plugin parses JSON documents and executes JSONPath queries to extract data for use in workflow variables.

**Use Cases:**
- Extract values from JSON API responses (REST, GraphQL)
- Validate JSON document structure with JSONPath assertions
- Parse configuration files in JSON format
- Query nested JSON data with wildcard and filter expressions
- Extract arrays, objects, and scalar values from complex JSON

**Behavior:**
- Parses the JSON document once, then executes all queries against it
- JSON parse errors are fatal (no document to query)
- Per-query JSONPath errors are collected in the errors array without stopping other queries
- Combined mode returns results as `{alias: {type, value}}`
- Individual mode returns each result as a separate output variable with optional type coercion

**Parameters:**
- `JSON Content`: The JSON document to parse (required)
- `Output Mode`: Combined (default) or Individual
- `Queries`: Map of alias/variable names to JSONPath expressions (required)

**Outputs:**
- `success`: Whether all queries executed without errors (boolean)
- `errors`: Per-query error details as [{query, error}] (array)
- `results`: Query results map (combined mode only)
