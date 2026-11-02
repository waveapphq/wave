---
id: while
description: Repeat while condition remains true. Supports While-Do (pre-check) and Do-While (post-check) modes.
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-31"
    changelog:
      - "Initial implementation with While-Do and Do-While modes"
      - "Condition builder using assertion items (same format as If/Else)"
      - "Max iterations and timeout safety guards (session fails if reached)"
      - "Output: index (0-based iteration counter)"
---

## While Loop

Repeats the loop body while a condition remains true.

### Modes

- **While-Do** (default): Evaluates condition before each iteration. May execute 0 times.
- **Do-While**: Executes body first, then evaluates condition. Always executes at least once.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| mode | string enum | yes | while-do | while-do or do-while |
| conditions | array | yes | - | Assertion conditions (same format as If/Else) |
| max_iterations | integer | no | none | Session FAILS if reached |
| timeout | float | no | none | Session FAILS if reached |

### Output

| Name | Type | Description |
|------|------|-------------|
| index | integer | 0-based iteration counter, updates each iteration |

### Behavior

- Body block failure aborts the loop and fails the session
- Max iterations hit fails the session (not graceful)
- Timeout hit fails the session (not graceful)
