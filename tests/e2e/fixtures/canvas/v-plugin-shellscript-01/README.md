# V-PLUGIN-SHELLSCRIPT-01: Shell Script Config Sheet

Verify the Shell Script config sheet in its Source, File, stop-pattern and output states.

## Prerequisites

No seed script. Each test imports its own Test through `POST /tests`, validates it and deletes it afterwards. The Test carries the variables `pod_count` (integer), `deploy_status` (string) and `env` (map `{name: blue}`) and one Shell Script:

- Script Type Source, script `STATUS=$(./deploy.sh "$@") COUNT=$(pgrep -c nginx)`, Shell unset
- Arguments `--env`, `env.name` (an expression) and `3`
- Input Variables with two entries, Stop on pattern off, no patterns, no timeout
- Variable exports `COUNT` bound to `pod_count` and `STATUS` bound to `deploy_status`

The remote-body test imports a second Test with the same block inside a Remote Execution body.

## Steps

1. Open the Test at http://localhost:3000/workbench?editTest=<id> and open the Shell Script config sheet
2. Read the default sheet
3. Set Script Type to File, set Script File to `testdata://scripts/deploy.sh`, then set Source again
4. Expand Execution and Stop on Pattern, tick Log Output and Stop on pattern, then set Pass pattern `^Server started` and Fail pattern `ERROR|FATAL`
5. Scroll to Output Variables, press "Add variable export", leave the name field, type `SPARE`
6. Expand Failure Handling and set On error to Record and continue
7. Open the version selector and the Changelog dialog
8. Open the remote-body Test and the Shell Script inside the body

## Validation

- **Header:** red FileTerminal glyph, title "Shell Script - Edit Config"
- **Cards:** Script, Variables, Execution, Stop on Pattern, Failure Handling, Secrets; only Script and Variables open, with footers "What to run and the arguments it gets" and "Values passed in as environment variables"
- **Source rows:** Script Type (Source), Shell (`/bin/bash` in gray, not set), Script (required, cut at the end), Arguments (one line `["--env", {{ env.name }}, "3"]`), Input Variables (one line with its two entries)
- **Arguments:** the row's expand opens the shared list editor: `$1` `--env`, `$2` `env.name` in expression mode, `$3` `3`; first up and last down arrows off; each trash named `Remove argument $n`; "Add argument" under the items; no whole-row expression toggle
- **File rows:** Script File replaces Script under Shell, required, placeholder `testdata://…, artifact://…, or /abs/path`, Browse between the value and the toggle, the whole path in the hover title and a long path showing its end (the file name) while the field has no focus; the Script draft returns on Source
- **Execution:** footer "Where and how long it runs"; Working Directory with no value, showing the italic hint "System temp folder" (empty starts in the temp folder Python reports on the machine the block runs on), with Browse, Timeout showing its default 300 in gray, Log Output checkbox with a toggle
- **Stop on Pattern:** footer "End the script early when a line matches"; Stop on pattern has no toggle; Pass and Fail pattern only while ticked
- **Pattern rule:** both patterns empty puts the asterisk on Fail pattern, one alert "Set a pass pattern, a fail pattern or both", and a disabled Save in the sheet and in the unsaved-changes prompt; a Pass pattern clears all three
- **Outputs:** Stdout, Stderr, Exit Code, Success; Error and Reason only under Record and continue
- **Export table:** columns Script Variable, Type, Secret, WAVE Variable; `COUNT` Integer and `STATUS` String in disabled Type selects; "Add variable export" is the table footer row
- **Added export:** takes focus with no error; "Name is required" shows on its own row only after the field is left and clears as `SPARE` is typed; Type is an enabled select on String; no "from variable" text
- **Labels:** Log Output, Working Directory, Stop on pattern, Input Variables, Script Type and Shell untruncated
- **Browse:** Script File and Working Directory only, gone in expression mode
- **Version:** exactly one, 1.0.0, no newer-version arrow
- **Changelog:** names every setting and the variable exports
- **Remote body:** L badge; Browse stays on Working Directory and Script File
