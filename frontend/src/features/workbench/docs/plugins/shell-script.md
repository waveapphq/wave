---
id: shell-script
description: Run a shell script on the WAVE server, typed into the block or read from a file, and capture its stdout, stderr and exit code
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-12"
    changelog:
      - "Runs a script on the WAVE server; not remotable, so inside a Remote Execution body it runs on WAVE"
      - "Script Type: Source, typed into the block, or File, where Script File takes testdata://, artifact:// or an absolute or relative path on the WAVE server, with Browse"
      - "Shell: the shell that runs the script, /bin/bash by default, whatever the script's first line says"
      - "Arguments: an ordered list passed as $1 to $n, each row a value or an expression"
      - "Input Variables: exported into the script's environment; arrays, maps and tables arrive as JSON text"
      - "Variable exports: shell variables the script sets, each bound to one WAVE variable and read as that variable's type; an export the script never set leaves its variable alone"
      - "Working Directory (the system temp folder when empty, with Browse), Timeout (default 300 seconds) and Log Output"
      - "Stop on pattern, with Pass pattern and Fail pattern"
      - "On error: Fail the block, or Record and continue with Success, Error and Reason"
      - "Stdout, Stderr and Exit Code; a non-zero exit code is a failure whose message ends with the last line the script wrote to Stderr"
      - "The script inherits the WAVE server's environment, plus WAVE_TESTDATA_DIR and WAVE_ARTIFACTS_DIR"
      - "Stopping ends the script and everything it started"
---

The Shell Script plugin runs a script on the WAVE server under the shell you name. The script is typed into the block or read from a file, gets its arguments as `$1`, `$2` and on, and can hand values back to WAVE through shell variables it sets.

**Use Cases:**
- Run a setup or cleanup script around the other blocks of a test
- Call a command-line tool such as kubectl, helm or curl and read what it printed
- Compute a value in the shell and bind it to a WAVE variable through a variable export
- Watch a long-running script and stop it as soon as one line of its output shows it passed or failed

**Behavior:**
- Script Type picks where the script comes from. Source runs the script typed into the block. File runs a script file: a `testdata://` or `artifact://` path, or an absolute or relative path on the WAVE server, picked with Browse or typed in
- The script runs under the shell named in Shell, `/bin/bash` by default, even when its first line names another interpreter. Shell may include flags, for example `/bin/bash -o pipefail`
- Arguments reach the script as `$1` to `$n` in row order. An empty row is passed as an empty argument
- Input Variables are exported into the script's environment, so the script and every program it starts see them. Text, numbers and booleans arrive as text. Arrays, maps and tables arrive as JSON text. A name is letters, digits and underscores, not starting with a digit, and may not start with `WAVE_`
- The script runs as the WAVE server's own user and inherits the server's environment with nothing removed, plus two variables WAVE adds: `WAVE_TESTDATA_DIR`, the test's Test Data folder, and `WAVE_ARTIFACTS_DIR`, the run's artifacts folder
- A variable export names a shell variable the script sets and binds it to one WAVE variable, read as that variable's type. A WAVE Variable that does not exist yet is created at save with the type chosen in the row. A value that cannot be read as that type fails the block with Reason OutputVariable. An export the script never set does not fail the block: the WAVE variable keeps its value
- Exports are read when the script ends on its own or stops on a pattern. A script that WAVE stops for any other reason returns Stdout, Stderr and Exit Code but no exports. A script that sets its own `trap ... EXIT` replaces the one WAVE uses to read exports, so nothing is read and the block turns amber with a warning
- Working Directory is where the script starts: a `testdata://` or `artifact://` path, or an absolute or relative path on the WAVE server. The folder must exist. Empty starts in the system temp folder of the WAVE server
- Timeout is how many seconds the script may run, 300 by default. When it runs out WAVE stops the script and the block fails with Reason Timeout
- As the block starts, the run console shows one INFO line naming the shell and the script: `Running the script under /bin/bash on the WAVE server` for a typed script, whose text is never shown, or `Running testdata://setup.sh under /bin/bash on the WAVE server` for a script file
- Log Output writes each output line to the run console as it arrives, stdout at INFO and stderr at WARN
- Stop on pattern ends the script as soon as a line of its output matches one of the two patterns. A Pass pattern match passes the block; a Fail pattern match fails it. While the toggle is on, at least one of the two patterns is required. The exports are still read when the script stops on a pattern, so under Record and continue a fail match binds them
- A non-zero exit code is a failure. The error message ends with the last line the script wrote to Stderr, for example `Script exited with code 1: Permission denied`, cut to 200 characters; it stops at the code when Stderr is empty or marked secret. Exit Code is 137 when WAVE stopped the script and -1 when it never started
- On error decides what a failure does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on. Under Fail the block no output is written; under Record and continue every output is written with what was captured
- Stopping the run ends the script and everything it started
- The block is not remotable. Inside a Remote Execution body it still runs on WAVE, and its paths are paths on the WAVE server. A relative Working Directory starts at the home folder of the user the WAVE server runs as, a relative Script File or Shell program starts at the Working Directory, and a `..` segment is followed wherever it leads

**Parameters:**
- **Script Type**: Source or File (default: Source)
- **Script**: The script to run (required while Source)
- **Script File**: `testdata://`, `artifact://` or an absolute or relative path on the WAVE server, with Browse (required while File)
- **Shell**: The shell that runs the script; may include flags (default: /bin/bash)
- **Arguments**: An ordered list passed as `$1` to `$n`, each row a value or an expression
- **Input Variables**: Exported into the script's environment
- **Working Directory**: Where the script starts, with Browse (default: empty, which starts in the system temp folder)
- **Timeout**: Seconds the script may run before WAVE stops it (default: 300)
- **Log Output**: Write each output line to the run console as it arrives (default: off)
- **Stop on pattern**: Stop the script as soon as a line of its output matches a pattern (default: off)
- **Pass pattern / Fail pattern**: Python regular expressions; a matching line stops the script and passes or fails the block
- **On error**: Fail the block, or Record and continue (default: Fail the block)

**Outputs:**
- **Stdout**: Everything the script wrote to standard output
- **Stderr**: Everything the script wrote to standard error
- **Exit Code**: The script's exit code; 137 when WAVE stopped it, -1 when it never started
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue. Reason is NonZeroExit, Timeout, FailPattern, StartFailed or OutputVariable
- **Variable exports**: One extra output per row, the shell variable's value read as the bound WAVE variable's type
