---
id: assert
description: Validate assertions and branch on pass/fail
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-12"
    changelog:
      - "Full implementation released"
      - "Multiple typed assertions with AND/OR grouping"
      - "Literal and expression assertion rows"
      - "Single mode (always continues) and split mode (pass/fail branching)"
      - "Typed comparison operators for integer, float, string, boolean, array, map"
---

The Assert control validates one or more assertions against workflow variables and produces a pass/fail result.

**Assertion Types:**
- **Literal**: Compare a variable against a value using typed operators (equals, contains, matches regex, etc.)
- **Expression**: Evaluate a Python boolean expression directly

**Operating Modes:**
- **Single**: One output handle. A failure is shown in the logs and the flow continues. With Fail Current Scope on, a failure fails the block and the flow stops there.
- **Split**: Two output handles (pass/fail). Execution branches based on assertion result. With Fail Current Scope on, a failure also makes the Test or Function it runs in end failed, while the flow continues down the fail branch.

**Grouping:**
- Assertions can be combined with AND/OR logic
- Groups support arbitrary nesting for complex conditions

**Output:**
- `passed`: Boolean indicating whether all assertions passed
