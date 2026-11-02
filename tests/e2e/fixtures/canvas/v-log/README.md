# V-LOG: Log Plugin Configuration

Verify the Log plugin configuration modal renders with correct parameters, version info, changelog, and details.

## Prerequisites

```bash
./tests/e2e/scripts/reset.sh
./tests/e2e/fixtures/canvas/v-log/01-seed.sh
```

## Steps

1. Open http://localhost:3000/workbench
2. Drag Log plugin from palette to canvas
3. Select the Log node and open config modal
4. Verify parameters, version, changelog, and details

## Validation

### V-LOG-001: Message Parameter
- Message parameter renders as expression input
- Expression input accepts Python expressions in expression mode
- Level parameter has enum dropdown with 5 options (DEBUG, INFO, WARN, ERROR, FATAL)

### V-LOG-002: Version Display
- Version selector shows "1.0.0"
- Only 1 version available in dropdown
- No green update arrow (since on latest/only version)

### V-LOG-003: Details Section
- Details dialog opens with Documentation title
- Version badge shows "1.0.0"
- Markdown bold renders as `<strong>` not **text**
- Markdown code renders as `<code>` not \`code\`
- Contains "Use Cases:" section
- Contains "Log Levels:" documentation

### V-LOG-004: Changelog
- Changelog dialog opens
- Exactly 4 changelog items displayed
- Contains: "Initial release"
- Contains: "Configurable log level"
- Contains: "Expression evaluation"
- Contains: "Integration with execution artifact"
- Shows release date "2026-01-12"
