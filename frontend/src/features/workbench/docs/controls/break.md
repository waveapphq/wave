---
id: break
description: Exit the current loop immediately
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-31"
    changelog:
      - "Target loop parameter for multi-level break"
      - "Works with For, For Each, and While loops"
---

## Break

Exits the enclosing loop immediately. When a Break control executes, the current loop iteration stops and no further iterations run. The loop's then-path executes normally.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| target_loop | string | Yes | The loop to break out of. In nested loops, you can target any enclosing loop - not just the innermost one. |

### Behavior

- Execution of blocks after Break in the loop body is skipped
- The targeted loop exits immediately
- The targeted loop's then-path still executes
- In nested loops, intermediate loops are also exited when targeting an outer loop
- Break outside of any loop is a validation error
