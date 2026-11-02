---
id: try-catch-finally
description: Structured error handling with catch and cleanup paths
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-17"
    changelog:
      - "Scoped sequential control with dead-end path chains and explicit egress handle"
      - "Configurable catch path (enabled by default) for error handling blocks"
      - "Optional finally path for guaranteed cleanup execution"
      - "Error variable with full diagnostic schema (type, message, node, category, stack_trace)"
      - "Path scope isolation - cross-path connections prevented at edge creation time"
---

## Try/Catch Control

Provides structured error handling within visual workflows. Wraps a try path in error interception - if any block in the try path throws, the error is caught, a structured error object is populated, and execution routes to the catch path (if enabled) then finally path (if enabled) before continuing via the egress handle.

### Path Handles
- **try** (blue): Protected scope - blocks here execute first. Dead-end chain.
- **catch** (red, optional): Error handling path - executes only when try fails. Dead-end chain.
- **finally** (amber, optional): Cleanup path - always executes regardless of success/failure. Dead-end chain.
- **then** (gray): Egress handle - the only exit to the main flow. Always present.

### Error Object Schema
When a try-path block throws, the error object is available via the `error` output binding. It is
bound before the catch path runs, so blocks in the catch and finally paths can read it while they
execute:

| Field | Type | Description |
|-------|------|-------------|
| type | string | Python exception class name |
| message | string | Human-readable error message |
| node | string | Name of the failed block |
| node_id | string | ID of the failed block |
| element_type | string | Plugin/control type identifier |
| timestamp | string | ISO 8601 timestamp |
| is_retryable | boolean | Whether the error is transient |
| category | string | transient, permanent, or critical |
| stack_trace | array | Full Python traceback, one entry per line. Join it before matching text against it |

### Parameters
| Name | Type | Default | Description |
|------|------|---------|-------------|
| enable_catch | boolean | true | Show catch output handle |
| enable_finally | boolean | false | Show finally output handle |

### Outputs
| Name | Type | Description |
|------|------|-------------|
| error | map | Caught error object (null if try succeeded) |
| caught | boolean | Whether an error was caught |

### Behavior
- Errors are always caught regardless of catch enabled/disabled
- Empty catch path (no blocks connected) = error silently suppressed
- If catch path also fails, finally still runs, then catch error propagates
- If finally fails after success, success is converted to failure
