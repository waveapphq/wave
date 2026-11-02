# V-PLUGIN-SHELLEXEC-01: Shell Exec Config Sheet and Palette Placement

Verify the Shell Exec config sheet and where the block sits in the palette.

## Prerequisites

No seed script. Each test imports its own Test through `POST /tests`, validates it and deletes it afterwards. The Test carries the variables `pod_count` (integer), `deploy_status` (string) and `env` (map `{name: blue}`) and one Shell Exec:

- Command `kubectl get pods -A | grep -c Running`, Shell `/bin/sh`
- Input Variables `{NAMESPACE: default, LOG_LEVEL: info}`
- Stop on pattern off, no patterns, no timeout

The remote-body test imports a second Test with the same block inside a Remote Execution body.

## Steps

1. Open the Test at http://localhost:3000/workbench?editTest=<id> and open the Shell Exec config sheet
2. Read the default sheet
3. Expand Execution and Stop on Pattern, then tick Stop on pattern
4. Expand Failure Handling and set On error to Record and continue
5. With no sheet open, expand the palette and open System; collapse the palette and open the plugins flyout
6. Open the version selector and the Changelog dialog
7. Open the remote-body Test and the Shell Exec inside the body

## Validation

- **Header:** red Terminal glyph, title "Shell Exec - Edit Config"
- **Cards:** Command, Variables, Execution, Stop on Pattern, Failure Handling, Secrets; only Command and Variables open, with footers "The command line and the shell that runs it" and "Values passed in as environment variables"
- **Rows:** Command (required, cut at the end), Shell (`/bin/sh`), Input Variables (one line with its two entries), each with a toggle; no Arguments row
- **Absent:** no Script Type, Script, Script File, Arguments or variable exports
- **Execution:** footer "Where and how long it runs"; Working Directory with no value, showing the italic hint "System temp folder" (empty starts in the temp folder Python reports on the machine the block runs on), with Browse, Timeout showing its default 300 in gray, Log Output checkbox with a toggle
- **Stop on Pattern:** footer "End the command early when a line matches"; ticking shows Pass and Fail pattern, Fail pattern with the asterisk and "Set a pass pattern, a fail pattern or both"
- **Outputs:** Stdout, Stderr, Exit Code, Success only; Error and Reason added under Record and continue; never an export table or add button
- **Palette:** System reads Shell Script, Shell Exec, Python, File I/O, Log; Shell Exec carries the Terminal glyph in the palette and in the plugins flyout
- **Labels:** Input Variables and Shell untruncated
- **Version:** exactly one, 1.0.0, no newer-version arrow
- **Changelog:** names Command, Shell, Input Variables, Working Directory, Timeout, Log Output, Stop on pattern, Pass pattern, Fail pattern, On error
- **Remote body:** L badge; Browse stays on Working Directory
