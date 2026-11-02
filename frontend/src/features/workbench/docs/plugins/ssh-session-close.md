---
id: ssh-session-close
description: Close an open SSH session and its chained descendants
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-04"
    changelog:
      - "Full implementation released"
      - "Cascade close: sessions chained through the target close first (child before parent)"
      - "Idempotent: closing an unknown or already-closed session is a no-op"
      - "Outputs the closed session IDs"
---

The SSH Session Close plugin closes an SSH session opened by SSH Session Open, referenced through its Session ID, together with every session chained through it.

**Use Cases:**
- Release a session as soon as a test is done with the host
- Tear down a whole multi-hop chain by closing its root session
- Close sessions deterministically mid-test instead of relying on end-of-run cleanup

**Behavior:**
- Closes the named session and cascades to every descendant session (child before parent)
- Each closed session's bound Connected variable flips to false
- Closing an unknown or already-closed session is a no-op returning an empty list
- Sessions never explicitly closed are closed automatically when the run ends

**Parameters:**
- **Session ID**: Handle of the session to close, as produced by SSH Session Open (required)

**Outputs:**
- **Closed Session IDs**: Session IDs actually closed, descendants first; empty when nothing was open
