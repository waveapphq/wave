---
id: variable-setter
description: Set variables in the execution context
versions:
  - version: "1.0.0"
    releaseDate: "2026-02-27"
    changelog:
      - "Set variables in the execution context with a key-value map"
      - "Supports all variable types: string, integer, float, boolean, array, map, table"
      - "Existing variables are updated while preserving their original scope"
      - "New variables are created at test scope"
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
- Accepts a map of variable names to values
- New variables are created at test scope automatically
- Existing variables are updated in place, preserving their original scope
- Variable types are inferred from values (string, integer, float, boolean, array, map, table)
- All assignments are logged at DEBUG level for audit trails

**Parameters:**
- `variables`: Key-value map of variable names and values to set (required)
