---
id: ssh-session-script
description: Run a script on an open SSH session via a chosen interpreter
versions:
  - version: "1.0.0"
    releaseDate: "2026-07-05"
    changelog:
      - "Full implementation released"
      - "Pipes the script to a chosen interpreter's stdin (default /bin/sh)"
      - "Runs over a live session opened by SSH Session Open"
      - "Captures Stdout, Stderr, and Exit Code as outputs"
      - "Non-zero exit codes are returned, not raised"
---

The SSH Session Script plugin runs a script on an SSH session opened by SSH Session Open, referenced through its Session ID. The script is piped to a chosen interpreter's stdin - no file is uploaded to the remote host.

**Use Cases:**
- Run a multi-line shell or scripting-language program on a remote host over an already-authenticated session
- Target hosts that lack SFTP or a writable temp directory - the script never touches the filesystem
- Pick the interpreter per block (/bin/sh, bash, python3, perl, node) without installing anything extra on the host
- Execute through a multi-hop chain by targeting a chained session's Session ID

**Behavior:**
- Looks the session up by Session ID in the run's live session registry; an unknown, closed, or dropped session fails the block
- Pipes the script to the interpreter on stdin; the interpreter reads and runs it directly, so no file is written, chmod'd, or exec'd on the remote host
- Optionally changes into a working directory before launching the interpreter
- Captures stdout, stderr, and the exit code; a non-zero exit code is returned as an output, not raised as a failure
- Fails when execution exceeds the timeout

**Parameters:**
- **Session ID**: Handle of the open session, as produced by SSH Session Open (required)
- **Script**: Script piped to the interpreter on stdin (required)
- **Interpreter**: Interpreter that reads the script, e.g. /bin/sh, bash, python3, perl, node (default: /bin/sh)
- **Working Directory**: Directory to change into before running the interpreter (optional)
- **Timeout**: Execution timeout in seconds (default: 300)

**Outputs:**
- **Stdout**: Standard output captured from the script
- **Stderr**: Standard error captured from the script
- **Exit Code**: Exit code returned by the interpreter
