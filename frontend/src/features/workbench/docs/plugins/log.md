---
id: log
description: Write messages to the execution log
versions:
  - version: "1.0.0"
    releaseDate: "2026-01-12"
    changelog:
      - "Write messages to the execution log with level-based filtering"
      - "Configurable log level (DEBUG, INFO, WARN, ERROR, FATAL)"
      - "Expression evaluation for dynamic values"
      - "Integration with execution artifact logging"
---

The Log plugin writes messages to the workflow execution log with configurable severity levels.

**Use Cases:**
- Debug workflow execution by logging variable values
- Track execution progress with informational messages
- Record warnings for non-critical issues
- Log errors for troubleshooting failed executions
- Mark fatal conditions before halting

**Behavior:**
- Messages appear in the execution log with timestamps
- Log level determines visibility in filtered log views
- Supports f-string syntax: `f"Value: {variableName}"`
- Integrates with execution artifacts for post-run analysis

**Parameters:**
- `message`: Text to log (use expression mode for dynamic values)
- `level`: Severity level (DEBUG, INFO, WARN, ERROR, FATAL) - default: INFO

**Log Levels:**
- **DEBUG**: Detailed diagnostic information
- **INFO**: General informational messages (default)
- **WARN**: Warning conditions that don't stop execution
- **ERROR**: Error conditions that may affect results
- **FATAL**: Critical errors requiring immediate attention
