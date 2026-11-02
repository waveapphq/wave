---
id: ssh-session-exec
description: Execute a command on an open SSH session
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-04"
    changelog:
      - "Full implementation released"
      - "Runs one independent command per block on a live session"
      - "Captures Stdout, Stderr, and Exit Code as outputs"
      - "Non-zero exit codes are returned, not raised"
---

The SSH Session Exec plugin runs one command on an SSH session opened by SSH Session Open, referenced through its Session ID.

**Use Cases:**
- Run commands on a remote host over an already-authenticated session
- Chain several commands on the same host as separate blocks, each with its own outputs
- Assert on a command's output or exit code with downstream Assert blocks
- Execute through a multi-hop chain by targeting a chained session's Session ID

**Behavior:**
- Looks the session up by Session ID in the run's live session registry; an unknown, closed, or dropped session fails the block
- Each command runs independently on the shared connection - environment variables and working directory do not carry over between Execute blocks
- Captures stdout, stderr, and the exit code; a non-zero exit code is returned as an output, not raised as a failure
- Fails when the command exceeds the timeout

**Parameters:**
- **Session ID**: Handle of the open session, as produced by SSH Session Open (required)
- **Command**: Command line to execute on the remote host (required)
- **Timeout**: Execution timeout in seconds (default: 300)

**Outputs:**
- **Stdout**: Standard output captured from the command
- **Stderr**: Standard error captured from the command
- **Exit Code**: Exit code returned by the command
