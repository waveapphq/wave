---
id: for-each
description: Iterate over collection items (arrays, maps, or tables) with typed item envelopes
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-29"
    changelog:
      - "Collection iteration over array, map, and table variable types"
      - "Typed item envelope output with {type, value} structure"
      - "0-based iteration index output"
      - "Variable reference selector filtered by collection types"
      - "Optional timeout for maximum loop execution time"
      - "Break and continue signal hooks for loop modifier controls"
      - "Cyan scope coloring on body-chain blocks"
---

## ForEach Loop Control

Iterates over the items of a collection variable (array, map, or table), executing a body chain once per item with typed envelope outputs.

### Use Cases

- **API response processing**: Iterate over a JSON array returned by an HTTP call
- **Configuration rollout**: Apply settings from a map to each target
- **Data validation**: Check each row of a table result against assertions
- **Batch operations**: Process items from a collection one at a time with per-item error handling

### Collection Types

**Array**: Each item is an element of the array. The envelope contains `{type: "array", value: <element>}`.

**Map**: Each item is a key-value pair. The envelope contains `{type: "map", value: {key: <key>, value: <value>}}`.

**Table**: Each item is a row. The envelope contains `{type: "table", value: <row>}`.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| Collection | string | yes | - | Variable to iterate over (array, map, or table) |
| Timeout | float | no | - | Max execution time in seconds |

### Output

| Output | Type | Description |
|--------|------|-------------|
| item | map | Current item envelope: {type, value} |
| index | integer | Current iteration index (0-based) |

### Behavior

- The collection parameter uses a variable reference selector filtered to array, map, and table types
- The body chain is a dead-end scoped path (cyan left border on body blocks)
- After all items are processed, execution continues via the "then" handle
- Body block failure aborts the loop immediately (session fails)
- Timeout causes graceful exit after the current iteration (then-path executes)
- Break signal exits the loop and continues via then-path
- Continue signal skips remaining body blocks and advances to the next item
