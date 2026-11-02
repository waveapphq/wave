---
id: halt
description: Stop workflow execution at a configurable scope level
versions:
  - version: "1.0.0"
    releaseDate: "2026-03-17"
    changelog:
      - "Halt control with configurable scope (test, suite, regression)"
      - "Status parameter (passed, failed, skipped) controls execution outcome"
      - "Optional message for halt reason logging"
      - "Terminating block - no output handle (dead-end)"
---

Stops workflow execution at a configurable scope level. The **scope** parameter determines what level of execution to halt (test, suite, or regression). The **status** parameter controls the final execution outcome - passed for intentional successful termination, failed for failure-driven termination, or skipped for conditional bypass. An optional **message** provides context for the halt reason, logged at the appropriate severity level (INFO for passed, ERROR for failed, WARN for skipped). Halt is a terminal block with no output handle - nothing executes downstream.
