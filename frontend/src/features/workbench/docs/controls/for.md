---
id: for
description: Iterate over a numeric range or count with a counter variable
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-28"
    changelog:
      - "Count and Range iteration modes with mode selector"
      - "Scoped body chain with dead-end path and egress handle (body + then)"
      - "Required step parameter (integer, default 1)"
      - "Optional timeout for maximum loop execution time"
      - "Break and continue signal hooks for future loop modifier controls"
      - "Cyan scope coloring on body-chain blocks"
      - "Live iteration counter badge during execution"
---

## For Loop Control

Executes a body chain of blocks repeatedly with a counter variable that increments on each iteration.

### Use Cases

- **Stress testing**: Repeat HTTP requests N times to validate consistency
- **Data generation**: Create N records with sequential identifiers
- **Port scanning**: Iterate through a port range (e.g., 8080-8085)
- **Parameterized testing**: Run test variations with different input values

### Iteration Modes

**Count mode** (default): Specify the number of iterations. The counter starts at 0 and increments by the step value.

**Range mode**: Specify start (inclusive) and end (exclusive) values. The counter traverses the range with the configured step.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Mode | string | yes | count | Iteration mode (count or range) |
| Count | integer | yes (count) | - | Number of iterations |
| Start | integer | yes (range) | - | Starting value (inclusive) |
| End | integer | yes (range) | - | Ending value (exclusive) |
| Step | integer | no | 1 | Increment per iteration |
| Timeout | float | no | - | Max execution time in seconds |

### Output

| Output | Type | Description |
|--------|------|-------------|
| index | integer | Current iteration value |

### Behavior

- The body chain is a dead-end scoped path (cyan left border on body blocks)
- After all iterations complete, execution continues via the "then" handle
- Body block failure aborts the loop immediately (session fails)
- Timeout causes graceful exit after the current iteration (then-path executes)
- Break signal exits the loop and continues via then-path
- Continue signal skips remaining body blocks and advances to the next iteration
