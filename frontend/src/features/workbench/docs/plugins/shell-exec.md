---
id: shell-exec
description: Run one command line on the WAVE server in the chosen shell and capture its stdout, stderr and exit code
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-12"
    changelog:
      - "Runs one command line on the WAVE server in the chosen shell; not remotable, so inside a Remote Execution body it runs on WAVE"
      - "Command, run as <shell> -c <command>, so pipes, redirects, globs and && work"
      - "Shell: the shell that runs the command, /bin/sh by default, and it may carry flags"
      - "Input Variables: exported into the command's environment; arrays, maps and tables arrive as JSON text"
      - "Working Directory (the system temp folder when empty, with Browse), Timeout (default 300 seconds) and Log Output"
      - "Stop on pattern, with Pass pattern and Fail pattern"
      - "On error: Fail the block, or Record and continue with Success, Error and Reason"
      - "Stdout, Stderr and Exit Code; a non-zero exit code is a failure whose message ends with the last line the command wrote to Stderr"
      - "The command inherits the WAVE server's environment, plus WAVE_TESTDATA_DIR and WAVE_ARTIFACTS_DIR"
      - "Stopping ends the command and everything it started"
---

The Shell Exec plugin runs one command line on the WAVE server through the chosen shell's `-c` option. It is the block for a single command, with pipes, redirects and globs written the way you would type them in a terminal. Use Shell Script for a multi-line program, arguments passed as `$1`, `$2` and on, or variable exports.

**Use Cases:**
- Run one command-line tool such as kubectl, helm or curl and read what it printed
- Chain a pipeline like `kubectl get pods -A | grep -c Running` and assert on the count
- Check that a file, a process or a port is there on the WAVE server before the test goes on
- Read the exit code of a command and branch on it under Record and continue

**Behavior:**
- Command is one line, run as `<shell> -c <command>`, so pipes, redirects, globs and `&&` work
- Shell is the shell that runs the command, `/bin/sh` by default. It may include flags, for example `/bin/bash -o pipefail`
- Input Variables are exported into the command's environment, so the command and every program it starts see them. Text, numbers and booleans arrive as text. Arrays, maps and tables arrive as JSON text. A name is letters, digits and underscores, not starting with a digit, and may not start with `WAVE_`
- The command runs as the WAVE server's own user and inherits the server's environment with nothing removed, plus two variables WAVE adds: `WAVE_TESTDATA_DIR`, the test's Test Data folder, and `WAVE_ARTIFACTS_DIR`, the run's artifacts folder
- Working Directory is where the command starts: a `testdata://` or `artifact://` path, or an absolute or relative path on the WAVE server. The folder must exist. Empty starts in the system temp folder of the WAVE server
- Timeout is how many seconds the command may run, 300 by default. When it runs out WAVE stops the command and the block fails with Reason Timeout
- As the block starts, the run console shows one INFO line naming the shell, for example `Running the command under /bin/sh on the WAVE server`; the command itself is not shown
- Log Output writes each output line to the run console as it arrives, stdout at INFO and stderr at WARN
- Stop on pattern ends the command as soon as a line of its output matches one of the two patterns. A Pass pattern match passes the block; a Fail pattern match fails it. While the toggle is on, at least one of the two patterns is required. A pass match is logged with the matching line
- A non-zero exit code is a failure. The error message ends with the last line the command wrote to Stderr, for example `Command exited with code 127: /bin/sh: 1: kubectl: not found`, cut to 200 characters; it stops at the code when Stderr is empty or marked secret. Exit Code is 137 when WAVE stopped the command and -1 when it never started
- On error decides what a failure does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. Under Fail the block no output is written; under Record and continue every output is written with what was captured
- Stopping the run ends the command and everything it started
- The block is not remotable. Inside a Remote Execution body it still runs on WAVE, and its Working Directory is a path on the WAVE server. A relative Working Directory starts at the home folder of the user the WAVE server runs as, a relative Shell program starts at the Working Directory, and a `..` segment is followed wherever it leads

**Parameters:**
- **Command**: One command line, run as `<shell> -c <command>` (required)
- **Shell**: The shell that runs the command; may include flags (default: /bin/sh)
- **Input Variables**: Exported into the command's environment
- **Working Directory**: Where the command starts, with Browse (default: empty, which starts in the system temp folder)
- **Timeout**: Seconds the command may run before WAVE stops it (default: 300)
- **Log Output**: Write each output line to the run console as it arrives (default: off)
- **Stop on pattern**: Stop the command as soon as a line of its output matches a pattern (default: off)
- **Pass pattern / Fail pattern**: Python regular expressions; a matching line stops the command and passes or fails the block
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Stdout**: Everything the command wrote to standard output
- **Stderr**: Everything the command wrote to standard error
- **Exit Code**: The command's exit code; 137 when WAVE stopped it, -1 when it never started
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue. Reason is NonZeroExit, Timeout, FailPattern or StartFailed
