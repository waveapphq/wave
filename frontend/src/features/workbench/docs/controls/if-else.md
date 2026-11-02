---
id: if-else
description: N-branch conditional routing with assertion-style conditions per branch
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-14"
    changelog:
      - "N-branch conditional with if/else-if/else support"
      - "Assertion-style conditions per branch (literal + expression + AND/OR)"
      - "Dynamic output handles per branch on canvas"
      - "User-defined branch labels"
      - "Controlled halt when no branch matches"
---

## If/Else Control

Evaluates conditions on each branch top-to-bottom. The first branch whose conditions pass is taken. Supports any number of else-if branches between the mandatory if and the optional else.

### Branch Types
- **If**: Always first, required. Has conditions.
- **Else If**: Optional, 0 to N. Each has its own conditions. Can be reordered.
- **Else**: Optional, always last, max 1. No conditions - catch-all.

### Conditions
Each branch (except else) uses the full assertion builder:
- Literal comparisons with typed operators
- Python boolean expressions
- AND/OR combinators with group support

### Behavior
- Evaluation is top-to-bottom, first match wins
- If no branch matches and no else exists, execution halts
- Each branch produces a separate output handle on the canvas

### Parameters
| Name | Type | Required | Description |
|------|------|----------|-------------|
| branches | array | Yes | Ordered branch definitions with type, label, and conditions |
