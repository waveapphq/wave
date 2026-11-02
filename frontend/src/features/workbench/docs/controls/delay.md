---
id: delay
description: Pause execution for a specified duration
versions:
  - version: "1.0.0"
    releaseDate: "2026-01-10"
    changelog:
      - "Full implementation released"
      - "Duration input with seconds, minutes, hours units"
      - "Async non-blocking execution"
---

The Delay control pauses workflow execution for a specified amount of time.

**Use Cases:**
- Add timing between API calls to avoid rate limiting
- Wait for external systems to process data
- Simulate real-world timing in tests
- Pace execution for observability

**Behavior:**
- Uses async sleep (non-blocking, yields to event loop)
- Duration specified in seconds, minutes, or hours
- Supports decimal values (e.g., 0.1s = 100ms, 1.5m = 90s)
- Minimum resolution: 1 millisecond

**Parameters:**
- `duration`: Time to wait (e.g., "5s", "0.1s", "2m", "1h")
