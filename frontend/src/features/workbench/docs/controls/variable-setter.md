---
id: variable-setter
description: Set variables in the execution context
versions:
  - version: "1.0.0"
    releaseDate: "2026-02-27"
    changelog:
      - "Set variables in the flow the setter runs in, one row per variable name and its value"
      - "Supports all variable types: string, integer, float, boolean, array, map, table"
      - "Existing variables are updated while preserving their original scope"
      - "New variables are created in the scope of the flow the setter runs in"
      - "Expression evaluation support for dynamic values"
---

The Var Setter control provides declarative variable management within workflows.

**Use Cases:**
- Initialize configuration variables before executing dependent blocks
- Store intermediate results for use in later workflow steps
- Reset variables to specific states for test repeatability
- Create variable snapshots for comparison
- Set baseline values for conditional logic

**Behavior:**
- Each row sets one variable: its name, its type, whether it is secret, and its value
- New variables are created automatically in the scope the setter runs in (the test, or the Function that holds it), with the type the row picks (String by default)
- Existing variables are updated in place, preserving their original scope and their declared type
- A value is typed as is, written as an expression, or, for text, written as a template whose `{{ }}` parts are filled in when the setter runs; inside a list or map each entry can be an expression
- The null button writes null into the variable
- A secret row's value is stored protected and is never shown again
- All assignments are logged at DEBUG level for audit trails

**Parameters:**
- `variables`: Key-value map of variable names and values to set (required)
