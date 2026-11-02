---
id: wait-until
description: Wait until condition becomes true or timeout expires
versions:
  - version: "1.0.0"
    releaseDate: "2026-08-01"
    changelog:
      - "Condition authored with the full assertion builder, checked once per round"
      - "Required timeout bounding the whole wait, with a configurable check interval"
      - "Retry mode: a sub-flow lane that runs every round to make the condition true"
      - "Watch mode: re-check only, for a condition something else in the run satisfies"
      - "Assert-shaped timeout outcome: informational by default, or fail the current scope"
      - "Outputs: passed and elapsed"
---

## Wait Until

A container control. It checks its condition, and while the condition is false it
keeps re-checking until the timeout expires. The flow continues past it unless it
gives up with Fail Current Scope on.

### Round Order
1. Evaluate the condition. If it already holds, the wait ends immediately and the
   retry lane never runs.
2. Otherwise run the retry lane once (Retry mode only).
3. Wait the check interval, measured from the end of the lane, and evaluate again.

The timeout bounds the whole wait, including a retry lane still in flight: blocks
still running when it expires are marked stopped.

### Modes
- **Retry** (default): the block carries a retry lane plus the `then` egress. The
  lane is what makes the condition become true - re-reading a system, restarting a
  service, polling an endpoint. An empty lane is legal and behaves like Watch.
- **Watch**: the block carries a single egress. Nothing runs between checks, so
  something else in the run has to satisfy the condition.

### Conditions
The full assertion builder: literal comparisons with typed operators, Python
boolean expressions, and AND/OR combinators with group support. Conditions are
re-evaluated every round, so a retry lane that changes a variable changes the answer.

### Giving Up
When the timeout expires the wait gives up. By default that is informational: it
logs a warning with the timeout message, paints the block amber, the flow continues
through the egress, and the run still ends passed. With Fail Current Scope on it logs
an error and the block fails like any failed block: the flow stops there, a
surrounding Try/Catch catches it, and otherwise the Function or Test it runs in ends
failed.

### Parameters
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| conditions | array | Yes | - | Assertion conditions evaluated each round |
| timeout | integer | Yes | - | Milliseconds bounding the whole wait |
| check_interval | integer | No | 1000 | Milliseconds between checks |
| message | string | No | - | Logged when the wait gives up |
| mode | string enum | No | retry | retry or watch |
| fail_current_scope | boolean | No | false | Fail the block and stop the flow on giving up |

### Outputs
| Name | Type | Description |
|------|------|-------------|
| passed | boolean | Whether the condition became true |
| elapsed | integer | Time waited, in milliseconds |
