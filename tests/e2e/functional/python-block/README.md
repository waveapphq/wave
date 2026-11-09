# Python Block - functional E2E

End-to-end proof that the Python block works the way an author sees it: the typed
contract in and out, failure outcomes, logging to the run console, the Python-mode
script editor (live checks, F2 rename, Run, scroll containment), the plain-text-only
script bodies, Stop from the editor, and a run on a real remote host (REQ-3.4.1.2,
REQ-3.4.2.2; PYRUN-1 to PYRUN-21, SQL-13).

Every spec imports its own Test from a JSON fixture in this folder and deletes it in
`afterAll`. Markers a script prints are assembled from parts inside the script,
because the DEBUG `Inputs:` echo carries the script source and would otherwise
satisfy an assertion by itself.

The editor's completion list is parented to `document.body`, where an open one covers the
next control a spec clicks. Every spec that types into the Python editor leaves it with
`leaveExpressionEditor` from `helpers/code-editor.ts` before the click that follows.
`editor-helpers.ts` holds the editor's footer controls, the checks a run in flight must
pass, and the toolbar Stop; the SQL editor suite imports them too.

## Prerequisites

- Backend and frontend running on the functional-stack ports, and the shared
  execution environment (`ensureEnvironment` creates it if absent).
- `python3` on the machine the backend runs on. Blocks with an empty Interpreter
  row use WAVE's own interpreter; `v-plugin-start-line-functional` in the
  shell-blocks suite pins the wording for that case.
- `jedi` installed in the backend environment. Completion, the documentation panel
  and F2 rename all answer through the python-tools endpoints, which need it.
- The `sshd` service of the real-service stack, for `v-plugin-python-remote-functional`
  only (`tests/e2e/services/README.md`). It ships the `python3` that spec runs the
  script under; the spec never hardcodes a version.
- The Remote Execution container, brought up the way
  `tests/e2e/functional/file-io-remote/README.md` describes.

## Steps

```bash
# All specs, from the root of the clone
./scripts/ci-playwright-local.sh

# One spec, from the root of the clone
./scripts/e2e-targeted-local.sh functional/python-block/v-plugin-python-typed-functional.spec.ts
```

The suite runs inside the containerized Playwright CI
(`./scripts/ci-playwright-local.sh`); it is registered under the
`functional-workflow` project.

## Validation

| Spec | Fixture | What it proves |
|------|---------|----------------|
| `v-plugin-python-typed-functional` | `fixture-typed.json` | A script typed into the sheet and saved runs. A table Input Variable iterates as row dicts and a float arrives as a `Decimal`. Every Variable Export binds its WAVE variable at the declared type, a list of dicts comes back as a table, `sys.argv[1:]` equals the Arguments, `print` goes to Stdout, an unset export leaves its variable alone, and a wrong type fails the block with `Script variable 'n' is not a valid integer` without naming the value |
| `v-plugin-python-exception-functional` | `fixture-exception.json` | Under Record and continue an uncaught `ValueError` gives Success false, Error `ValueError: boom`, Reason Exception and Exit Code 1, with the traceback on Stderr and in the console at ERROR; an export set before the raise still lands. Under Fail the block the run fails. `sys.exit(2)` reads `Script exited with code 2`, `sys.exit()` and `sys.exit(0)` pass, `sys.exit("text")` puts the text on Stderr and reads `Script exited with code 1: text`, and an unparsable script fails with `SyntaxError: ... (line N)` |
| `v-plugin-python-logging-functional` | `fixture-logging.json` | With Log Output off, `logging` records reach the console at DEBUG / INFO / WARN / ERROR / ERROR while `print` and raw stderr stay quiet; with it on they arrive. The console attributes the lines to the source `Python` with no text prefix in the message, a logged exception carries its traceback at ERROR, a multiline message arrives whole, a secret input is masked, and logging does not disturb the exports |
| `v-plugin-python-live-checks-functional` | `fixture-live-checks.json` | An unknown name is underlined and listed in the expression field's wording, a wrong method or argument count and a rejected operator pair are warnings, and none of them blocks Save or Run or paints the block invalid. The checks stand down for a star import or a namespace reached through `globals` / `locals` / `vars` / `exec` / `eval` / builtins, only syntax errors show while the script does not parse, and a warning inside a Local Function leaves the enclosing Function valid |
| `v-plugin-python-run-functional` | `fixture-run.json`, `fixture-args.json`, `fixture-other-error.json` | Run executes only this block with the unsaved script and ends there, turning into Stop while it is in flight and leaving the saved script untouched on the canvas and on the server. Paused at the block, Run repeats it. Run uses the toolbar Environment and asks only when none is selected, sends the whole unsaved configuration, is refused only for this block's own non-script findings, and carries the parent's note when something else blocks Save |
| `v-plugin-python-stop-functional` | `fixture-run.json` | A script that prints a line and sleeps 60 s is run from the editor: Stop stands where Run was, the line reaches the console, F1 Help opens, Save stays dead on a changed draft and the config behind is read-only. The editor's Stop ends the run within 10 s with the block stopped and a WARN `Stopped by user`, and the line after the sleep never prints. Run comes back and a second run passes. Close during a run raises the unsaved prompt with its Save dead, closes the editor and leaves the run going until the toolbar Stop |
| `v-plugin-python-rename-functional` | `fixture-rename.json` | F2 opens the rename box at the symbol, pre-filled, with occurrences highlighted. A local renames in the script only; an export name renames the Variable Exports row and the persisted `script_variables` and `outputBindings`; an Input Variable name renames its `input_vars` key. One Ctrl+Z undoes the whole rename, Esc changes nothing, and an invalid name is refused inline |
| `v-plugin-script-body-plain-functional` | `fixture-script-body.json` | The Shell Script, K8s Script and SSH Session Script bodies take plain text only, so their value editor shows no Format control, shown against a row that still offers the whole Format menu. Template stays available as the value Kind, and a `noExpression` parameter shows no Kind dropdown |
| `v-plugin-python-scroll-functional` | `fixture-scroll.json` | With the Python editor open the page behind it gains no scrollable height and cannot be pushed, including after a completion tooltip mounts; the wheel over the editor scrolls the editor only; the expression editor modal leaves the page alone the same way |
| `v-plugin-python-remote-functional` | `fixture-remote.json`, `fixture-remote-refusals.json`, `fixture-remote-secret.json`, `testdata-remote/` | Inside a Remote Execution body against the real `sshd` host: a `testdata://` script is read on WAVE and shipped, a helper module beside it imports by name, the host's own `python3` runs it, typed exports come back, log lines arrive when the block ends, a plain path resolves on the host, the start line says the remote host, an empty Working Directory starts in the remote host's temp folder (`os.getcwd()` equals `tempfile.gettempdir()`), `sys.exit("text")` reads its text, and the worker's `/tmp/wave-worker-*` scratch dir, which held the script, is gone from the host after the run. A missing interpreter reads `Interpreter not found on the remote host: nosuchpython`, a `testdata://` Working Directory is refused with `testdata:// paths are not available on the remote host - use an absolute or relative path on the remote host`, and a secret Stdout or Stderr never reaches the console, the WS stream or a failure message |
