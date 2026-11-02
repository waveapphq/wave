---
id: ssh-session-open
description: Open a stateful SSH session for downstream Exec, Script, Close, Tunnel Open, SFTP and Remote Execution blocks
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-04"
    changelog:
      - "Full implementation released"
      - "Connection group: Host, Port, Username, Password, Private Key, Parent Session"
      - "Advanced group: Passphrase, Host Key Verification, Connect Timeout, Keep-Alive, Compression"
      - "Multi-hop chaining through Parent Session (tunnels over the parent connection)"
      - "Keepalive-refreshed Connected output flips to false when the connection drops"
      - "Outputs: Session ID, Connected, Server Banner, Hop Count"
---

The SSH Session Open plugin opens a stateful SSH connection that stays alive across the run. Downstream SSH Session Exec, SSH Session Script, SSH Session Close, SSH Tunnel Open, SFTP and Remote Execution blocks reference it by its Session ID output.

**Use Cases:**
- Run several commands on the same host without reconnecting for each one
- Reach hosts behind a bastion by chaining sessions (Parent Session multi-hop)
- Keep long-lived connections under test while monitoring liveness via Connected
- Bind credentials from an SSH profile using expression mode (e.g. `bastion.password`)

**Behavior:**
- Authenticates once with a password, a private key, or both; at least one is required. It logs in only with what the block names: the SSH config file, default keys and SSH agent of the account WAVE runs under are never used
- The host key is checked against WAVE's trusted hosts list (Settings > Network > SSH Hosts). Accept New adds an unknown host's key to that list the first time and refuses the host later if its key changes; while trusted hosts are locked in Settings, Accept New acts as Strict. A refused host fails the block, and the error names Settings > Network > SSH Hosts
- A newly placed block takes the default block action set in Settings > Network > SSH Hosts; an existing block keeps its own setting
- Bind the Session ID output to a variable - Exec, Script, Close, Tunnel Open, SFTP, Remote Execution, and a chained Open's Parent Session reference that variable
- With Parent Session set, the new connection tunnels over the parent session (hop count grows by one per parent in the chain)
- Closing a session closes every session chained through it (child before parent); any session still open when the run ends is closed automatically
- Connection failure fails the block; wrap in Try-Catch for optional connectivity
- The bound Connected variable flips to false whenever the session ends: silently on close (direct, cascaded, or end-of-run), or with a warning when Keep-Alive detects the connection dropped; the next Execute on that session fails

**Parameters:**
- **Host**: Target host name or IP address (required)
- **Port**: SSH port; blank falls back to 22 (default: 22)
- **Username**: Login user on the target host (required)
- **Password**: Password authentication (secret)
- **Private Key**: Inline PEM content or the path of a key file on the WAVE host; a relative path starts at the home folder of the account WAVE runs under (secret)
- **Parent Session**: Session ID of an open session to chain through (multi-hop)
- **Passphrase**: Unlocks an encrypted private key (secret)
- **Host Key Verification**: strict / accept-new / disabled, checked against WAVE's trusted hosts list; while trusted hosts are locked in Settings, accept-new acts as strict (default: disabled; a newly placed block takes the Settings default)
- **Connect Timeout**: Connection timeout in seconds (default: 30)
- **Keep-Alive Interval**: Seconds between keepalive probes; 0 disables (default: 0)
- **Keep-Alive Max Count**: Unanswered probes before the connection counts as lost (default: 3)
- **Compression**: Enable zlib compression (default: off)

**Outputs:**
- **Session ID**: Handle for this session - bind it to a variable for Exec, Script, Close, Tunnel Open, SFTP, Remote Execution, or a chained Open's Parent Session
- **Connected**: true while the session is open; false once it closes or keepalive detects a drop
- **Server Banner**: SSH identification string reported by the server
- **Hop Count**: 1 for a direct connection, 2+ when chained through parents
