---
id: continue
description: Skip to next loop iteration
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-31"
    changelog:
      - "Target loop parameter for multi-level continue"
      - "Works with For, For Each, and While loops"
---

## Continue

Skips the remainder of the current loop iteration and advances to the next one. When a Continue control executes, blocks after it in the loop body are skipped, and the loop proceeds to its next iteration.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| target_loop | string | Yes | The loop to continue. In nested loops, you can target any enclosing loop - not just the innermost one. |

### Behavior

- Execution of blocks after Continue in the loop body is skipped
- The targeted loop advances to its next iteration
- If it was the last iteration, the loop completes normally via its then-path
- In nested loops, targeting an outer loop causes intermediate loops to exit
- Continue outside of any loop is a validation error
