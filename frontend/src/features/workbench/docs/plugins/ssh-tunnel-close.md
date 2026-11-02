---
id: ssh-tunnel-close
description: Close an open SSH tunnel by its tunnel handle
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-04"
    changelog:
      - "Full implementation released"
      - "Closes by Tunnel ID through the run's session registry"
      - "Idempotent: closing an unknown or already-closed tunnel is a no-op"
      - "Outputs whether a tunnel was actually closed"
---

The SSH Tunnel Close plugin closes a tunnel opened by SSH Tunnel Open, referenced through its Tunnel ID, stopping its local listener.

**Use Cases:**
- Release a forwarded port as soon as a test is done with the service behind it
- Free a fixed local port for a later tunnel in the same run
- Close tunnels deterministically mid-test instead of relying on session or end-of-run cleanup

**Behavior:**
- Stops the tunnel's local listener and detaches it from its owning session
- Closing an unknown or already-closed tunnel is a no-op returning Closed = false
- Tunnels never explicitly closed are closed automatically when their session closes or the run ends

**Parameters:**
- **Tunnel ID**: Handle of the tunnel to close, as produced by SSH Tunnel Open (required)

**Outputs:**
- **Closed**: True when the tunnel was open and is now closed; false when it was unknown or already closed
