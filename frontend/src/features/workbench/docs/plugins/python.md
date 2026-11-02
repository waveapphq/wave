---
id: python
description: Run a Python script on the WAVE server or on a remote host, typed into the block or read from a file, with WAVE values as globals and the globals it sets bound back to WAVE variables
versions:
  - version: "1.0.0"
    releaseDate: "2026-09-16"
    changelog:
      - "Runs a Python script on the WAVE server, and on the remote host when the block sits inside a Remote Execution body"
      - "Script Type: Source, typed into the block, or File, where Script File takes testdata://, artifact:// or an absolute or relative path, with Browse"
      - "Interpreter: a command line, program plus flags, that WAVE appends the script path and the arguments to; empty runs WAVE's own interpreter"
      - "The Interpreter row takes an expression, so a global variable can give each Environment its own interpreter path"
      - "WAVE installs nothing: no packages, no environments, no copied libraries. The interpreter decides what the script can import"
      - "The bridge that runs inside the interpreter needs Python 3.8 or newer and uses only the standard library"
      - "Arguments: an ordered list reaching the script as sys.argv[1:], each row a value or an expression"
      - "Input Variables become globals before the first line runs; a WAVE float arrives as a decimal.Decimal and a table as a row-by-row object"
      - "Environment: entries exported into the process environment, beside WAVE_TESTDATA_DIR and WAVE_ARTIFACTS_DIR"
      - "Variable exports: globals the script sets, each bound to one WAVE variable and read as that variable's type; they are read even when the script ends on an uncaught exception"
      - "An uncaught exception fails the block with its traceback in Stderr and in the run console, and Exit Code 1"
      - "sys.exit(n) ends the script with exit code n; a non-zero code is a failure, and any other value is written to Stderr with exit code 1"
      - "The script's standard logging reaches the run console at its own level; print goes to Stdout"
      - "The Working Directory is first on sys.path, so a helper module beside the data imports by name"
      - "The script body is never template-expanded: {{ in the script is just Python"
      - "Working Directory (the system temp folder when empty, with Browse), Timeout (default 300 seconds) and Log Output"
      - "Stop on pattern, with Pass pattern and Fail pattern"
      - "On error: Fail the block, or Record and continue with Success, Error and Reason"
      - "Stdout, Stderr and Exit Code; a non-zero exit code is a failure whose message ends with the last line the script wrote to Stderr"
      - "On a remote host paths and the interpreter resolve there, and the output, the console lines and the exports arrive when the block ends"
      - "Editor completion asks the WAVE server, which introspects the block's interpreter; a command-line Interpreter, an expression that does not resolve to a local path, and a remote host's interpreter are never introspected, so completion falls back to WAVE's own interpreter"
---

The Python plugin runs a Python script under the interpreter you name. The script is typed into the block or read from a file, gets WAVE values as globals, and hands values back to WAVE through the globals it sets.

**Use Cases:**
- Compute a value that an expression cannot: parse a payload, do the arithmetic, walk a table
- Call a vendor SDK from the virtual environment that SDK is installed in
- Shape a table before the next block reads it, and bind the result to a WAVE variable
- Check a condition that needs real code, and fail the block with an assert when it does not hold

**Behavior:**
- Script Type picks where the script comes from. Source runs the script typed into the block. File runs a script file: a `testdata://` or `artifact://` path, or an absolute or relative path, picked with Browse or typed in. A `testdata://` or `artifact://` file is read on WAVE and sent with the request, so File mode works on a remote host too; a plain path is read where the block runs, relative to the Working Directory
- Interpreter is a command line, program plus flags, that WAVE appends the script path and the arguments to: `/opt/venv311/bin/python`, `uv run --project /opt/lab-env`, `conda run -n lab python`. A bare program name is looked up on PATH; a relative path starts at the Working Directory. Empty runs WAVE's own interpreter, the one the WAVE server runs on, or on a remote host the one the worker runs on
- The Interpreter row takes an expression, so a global variable such as `{{py}}` makes one interpreter the default for every test and lets each Environment - a lab PC, a CI runner - name its own path
- WAVE installs nothing. It never adds packages, creates a virtual environment or copies libraries. What the script can import is what the interpreter you named already has
- The small WAVE program that runs inside your interpreter needs Python 3.8 or newer and uses only the standard library, so an interpreter older than WAVE's own still works. The script is sent as source, never as bytecode
- The script body is never template-expanded. A `{{` in the script is just Python, and the body's value editor offers no Kind or Format choice
- Arguments reach the script as `sys.argv[1:]` in row order. Standard input is empty
- Input Variables are globals in the script's namespace before the first line runs; nothing is exported into the process environment for them. A name must be a Python identifier and may not start with `__`. Text arrives as `str`, an integer as `int`, a float as `decimal.Decimal` because WAVE floats are exact, a boolean as `bool`, null as `None`, an array as `list`, a map as `dict`, and a table as an object you iterate row by row as dicts, index, take the `len` of, and read `.columns` and `.rows` from
- Environment entries are exported into the process environment, so the script and every program it starts see them. A name is letters, digits and underscores, not starting with a digit, and may not start with `WAVE_`. The script also inherits the environment of the server or host it runs on; running on WAVE it gets `WAVE_TESTDATA_DIR`, the test's Test Data folder, and `WAVE_ARTIFACTS_DIR`, the run's artifacts folder, while on a remote host it gets that host's own environment plus these Environment rows only
- The Working Directory is first on `sys.path`, so a helper module beside the data - a Test Data folder chosen as Working Directory - imports by name. In File mode the script's own folder is on the path as well, by Python's own rule. In Source mode the private temporary folder the typed script is written to is not on the path
- A variable export names a global the script sets and binds it to one WAVE variable, read as that variable's type. Exports are read whenever the script ends on its own: a normal end, a `sys.exit`, or an uncaught exception, so a failed script still hands back what it set. An export the script never set leaves its WAVE variable alone. A value that does not fit the bound type fails the block with Reason OutputVariable: a `str` for string, an `int` for integer, an `int`, `float` or `Decimal` for float, a `bool` for boolean, a `list` for array, a `dict` for map, and for table either the row object or a list of dicts
- An uncaught exception fails the block with `{ExceptionType}: {message}` and Reason Exception. The traceback is written to Stderr and to the run console at ERROR, and Exit Code reads 1
- `sys.exit(n)` ends the script with exit code n. `sys.exit()`, `sys.exit(None)` and `sys.exit(0)` pass; any other code is a failure with Reason NonZeroExit. Any other value, such as `sys.exit("no rows")`, is written to Stderr and ends the script with exit code 1, so Error reads `Script exited with code 1: no rows`
- Everything the script logs through the standard `logging` module reaches the run console at its own level: DEBUG to DEBUG, INFO to INFO, WARNING to WARN, ERROR and CRITICAL to ERROR. `print` goes to Stdout. A record logged with the exception attached, the way `logging.exception` does it, carries that traceback into the console line. Log records always reach the console; Log Output governs stdout and stderr lines only
- As the block starts, the run console shows one INFO line naming the interpreter and the script: `Running the script under WAVE's own interpreter on the WAVE server` for a typed script, whose text is never shown, or `Running testdata://report.py under /opt/venv311/bin/python on the WAVE server` for a script file. Inside a Remote Execution body WAVE writes it as the request leaves, ending `on the remote host`
- Timeout is how many seconds the script may run, 300 by default. When it runs out WAVE stops the script and everything it started, and the block fails with Reason Timeout
- Stop on pattern ends the script as soon as a line of its output matches one of the two patterns. A Pass pattern match passes the block; a Fail pattern match fails it. While the toggle is on, at least one of the two patterns is required
- A non-zero exit code is a failure. The error message ends with the last line the script wrote to Stderr, for example `Script exited with code 2: no rows to read`, cut to 200 characters; it stops at the code when Stderr is empty or marked secret. Exit Code is 137 when WAVE stopped the script and -1 when it never started
- On error decides what a failure does: Fail the block, or Record and continue, which sets Success, Error and Reason and lets the test go on
- Inside a Remote Execution body the block runs on the remote host. The interpreter, the Working Directory and a plain Script File path resolve there, and the script runs as the user the worker runs as. Stop on pattern and the timeout act on the host, and the output, the console lines and the exports arrive when the block ends rather than line by line
- Completion and the documentation panel in the script editor come from the WAVE server, which introspects the block's interpreter. An Interpreter row that is a command line such as `uv run`, or an expression that does not resolve to a local interpreter path, cannot be introspected, and a remote host's interpreter is never introspected; in those cases completion falls back to WAVE's own interpreter. Requests never block typing, and a failed request quietly falls back to the built-in catalog

**Parameters:**
- **Script Type**: Source or File (default: Source)
- **Script**: The Python script to run (required while Source)
- **Script File**: `testdata://`, `artifact://` or an absolute or relative path, with Browse (required while File)
- **Interpreter**: The command line that runs the script; may include flags (default: WAVE's own interpreter)
- **Arguments**: An ordered list reaching the script as `sys.argv[1:]`, each row a value or an expression
- **Input Variables**: Globals set before the first line runs
- **Environment**: Entries exported into the process environment
- **Working Directory**: Where the script starts, and the first entry on `sys.path`, with Browse (default: empty, which starts in the system temp folder of the machine the block runs on)
- **Timeout**: Seconds the script may run before WAVE stops it (default: 300)
- **Log Output**: Write each output line to the run console as it arrives (default: off)
- **Stop on pattern**: Stop the script as soon as a line of its output matches a pattern (default: off)
- **Pass pattern / Fail pattern**: Python regular expressions; a matching line stops the script and passes or fails the block
- **On error**: Fail the block, or Record and continue (default: Fail the block)
- **Variable Exports**: Globals the script sets, each bound to one WAVE variable and read as that variable's type

**Outputs:**
- **Stdout**: Everything the script wrote to standard output
- **Stderr**: Everything the script wrote to standard error, including the traceback of an uncaught exception
- **Exit Code**: The script's exit code; 1 after an uncaught exception, 137 when WAVE stopped it, -1 when it never started
- **Success / Error / Reason**: The outcome. Error and Reason are offered only when On error is Record and continue. Reason is NonZeroExit, Exception, Timeout, FailPattern, StartFailed or OutputVariable
- **Variable exports**: One extra output per row, the global's value read as the bound WAVE variable's type
