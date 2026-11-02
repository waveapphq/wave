---
id: ssh-tunnel-open
description: Forward a local port to a remote destination through an open SSH session
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-04"
    changelog:
      - "Full implementation released"
      - "Rides an open SSH session: forwarding inherits the session's auth, host-key policy, and multi-hop chain"
      - "Works like ssh -L: each connection to the Local Port reaches the destination afresh, and one the SSH host refuses or cannot complete is logged as a warning without failing the tunnel"
      - "Loopback-only local listener; a blank or 0 Local Port auto-assigns a free port"
      - "Advanced group: Validate Target checks the destination once at open and hands that connection to the first block that uses the tunnel"
      - "Outputs the tunnel handle and the resolved local port"
---

The SSH Tunnel Open plugin forwards a local port to a remote host and port through an SSH session opened by SSH Session Open, referenced through its Session ID.

**Use Cases:**
- Reach a service only visible from the remote host (a database, an internal API) as if it were local
- Test services behind a bastion by chaining the tunnel over a multi-hop session
- Probe a remote port without exposing it beyond the local machine

**Behavior:**
- Looks up the open session by Session ID and forwards through its live connection - the tunnel adds no credentials or host-key policy of its own
- Works like plain `ssh -L`: opening binds the Local Port on 127.0.0.1 and checks nothing else; the forwarded destination is never exposed to the network
- Each connection to the Local Port asks the SSH host to connect to the destination afresh, so a destination that comes up later is reached by later connections
- A connection the SSH host refuses or cannot complete fails only that connection and never fails the tunnel. It is logged as a warning in the run log: `Connection through SSH tunnel 127.0.0.1:{local_port} to {host}:{port} failed: {cause}`, where the cause names what went wrong, such as `bastion could not connect (Connection refused)`
- With Validate Target checked, opening also connects to the destination once, bounded by the session's Connect Timeout, and fails the block if the SSH host refuses or cannot reach it. That connection is handed to the first block that uses the tunnel; later connections reach the destination afresh
- A blank Local Port falls back to 0, which auto-assigns a free port; the resolved port is returned as an output
- The tunnel lives until closed by SSH Tunnel Close or automatically when its session closes or the run ends
- Fails when the session is unknown or already closed, or when the listener cannot be established

**Parameters:**
- **Session ID**: Handle of the open session to forward through, as produced by SSH Session Open (required)
- **Local Port**: Local port to listen on; blank or 0 auto-assigns a free port (default: 0)
- **Remote Host**: Destination host to forward to, resolved from the session's remote end (required)
- **Remote Port**: Destination port to forward to (required)
- **Validate Target**: Connects to the destination once when the tunnel opens and fails if the SSH host refuses or cannot reach it; that connection is handed to the first block that uses the tunnel (default: off)

**Outputs:**
- **Tunnel ID**: Handle identifying the open tunnel; SSH Tunnel Close references it
- **Local Port**: Local port the tunnel listens on; the auto-assigned port when 0 was requested
