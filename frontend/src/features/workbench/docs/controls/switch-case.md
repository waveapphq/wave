---
id: switch-case
description: Multi-way branching with condition-guarded cases
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-31"
    changelog:
      - "Condition-guarded cases evaluated in author order"
      - "Per-case Break toggle: off resumes at the next case and tests its own condition"
      - "Optional Default branch: runs when nothing matched, and as the last stop of a fall-through chain"
      - "Always-present then egress: the flow continues no matter what matched"
      - "Stable branch ids so renaming or reordering never re-points a wired edge"
---

## Switch/Case Control

A container control. Cases are evaluated top-to-bottom; a matching case runs its
own sub-flow and returns to the Switch. Break decides whether the Switch ends
there or carries on to the next case.

### Branch Types
- **Case**: One or more, ordered, each with its own conditions and a Break toggle.
- **Default**: Optional, always last, max 1. No conditions, no Break. It runs when no case matched, and also when a case above it falls through - carrying no condition, it has nothing to refuse with.

### Break
- **On** (the default for a new case): the Switch ends after that case's sub-flow.
- **Off**: execution resumes at the NEXT branch and evaluates its own conditions. A case never runs on another case's condition; the Default has none, so falling into it always runs it.

### Conditions
Each case uses the full assertion builder:
- Literal comparisons with typed operators
- Python boolean expressions
- AND/OR combinators with group support

Conditions are evaluated at the moment the case is reached, so a case's sub-flow can change what a later case sees.

### Behavior
- Several case lanes may run in a single pass when Break is off
- The `then` egress is always taken - a Switch never halts the flow
- A disabled Switch skips every case and the default and continues through `then`

### Parameters
| Name | Type | Required | Description |
|------|------|----------|-------------|
| branches | array | Yes | Ordered case branches with conditions and break, plus an optional default |
