# Text encoding functional tests

WAVE reads and writes all text as UTF-8 and never alters the text it sends over an SSH session
(REQ-4.6.9). Three specs share this folder.

## V-TEXT-ENCODING-FUNCTIONAL

`v-text-encoding-functional.spec.ts`: the text `Grüße 測試` keeps every character through a run,
a run log, a download name, an export and import, a Python block and an SSH session; SSH text
that UTF-8 cannot write fails its block before anything is sent, and a Test that holds such text
is refused at save.

### Prerequisites

- The stack's `sshd` service (port 9445): `./scripts/e2e-stack.sh up --wait sshd`.
- The shared E2E environment (made by the spec when it is missing).
- `fixture.json`: a Test named `Grüße 測試` holding a Log block named `Grüße 測試` that writes
  `Grüße 測試`, a Python block that prints it, SSH Session Open / Exec / Close where the Exec runs
  `printf 'ok\377'`, and two Log blocks that show the Python Stdout and the SSH Stdout.
- `fixture-unencodable.json`: SSH Session Open, a block that makes a marker folder on the remote
  host with one folder named `?` in it, then four blocks, each in its own Try/Catch, whose Command,
  Script, Interpreter and Working Directory are expressions that give a character UTF-8 cannot
  write at column 7. Each text would leave a file in the marker folder if it were sent with the
  character replaced by `?`. The last blocks list the folder, remove it and close the session.
- The SSH login comes from `helpers/config.ts`; the marker folder name is new for every run.
- The spec starts its browser with a UTF-8 locale (`LC_ALL=C.UTF-8`). The container's locale is
  POSIX, and a browser on a POSIX locale saves a file whose name is outside ASCII as `download`.

### Steps

1. **TEXT-1:** import `fixture.json`, open the Test in the Workbench and run it.
2. **TEXT-2:** import `fixture.json`, run the Test from the Tests list, open its run on the
   Artifacts page and download the log from the Logs section.
3. **TEXT-3:** the same run, then Download all on the Artifacts page.
4. **TEXT-4:** import `fixture.json` under a plain name; export the Test from the Tests list as
   YAML, delete it, import the file through the Import dialog; then the same through JSON.
5. **TEXT-5:** the same as TEXT-4 with the Test named `Grüße 測試`.
6. **TEXT-6:** import `fixture-unencodable.json`, open it in the Workbench and run it.
7. **TEXT-7:** POST `fixture-unencodable.json` to `/tests` seven times, each time under its own
   name and with an id of its own in the body: once per row with the character itself saved in
   that row's text in place of the expression, once with all four rows saved that way, then the
   Command case again as `text/plain`, under the two upload content types and with no content
   type.
8. **TEXT-8:** import `fixture.json` under the name `हिंदी परीक्षण`; export the Test from the
   Tests list as YAML; add a Test Data folder named `हिंदी परीक्षण` with one file, open the Test
   in the Workbench and download the folder from the Test Data sheet; GET the archive of the
   Test's whole Test Data.

### Validation

- **TEXT-1:** zero validation errors and no repairs; the run passes and every block succeeds. The
  canvas block is named `Grüße 測試`. The console holds `Test '<name>' execution started (8
  blocks)` with the Test's name, and the line `Grüße 測試` under the source `Log : Grüße 測試`.
  The Python Stdout is `Grüße 測試` and a newline with exit code 0. The SSH Stdout is `ok` and the
  replacement character U+FFFD, Stderr is empty and the exit code is 0.
- **TEXT-2:** the run passes; the download answers 200 with the header `attachment;
  filename="<plain fallback>"; filename*=UTF-8''<the whole name, percent-encoded>` and hands the
  browser the file. Its bytes are valid UTF-8 and hold the start line with the Test's name,
  `Grüße 測試`, `python stdout=Grüße 測試 code=0`, `ssh stdout=ok` with U+FFFD, and the completed
  line. The browser saves the file as `<Test name>.log`, the whole name.
- **TEXT-3:** the browser is handed a `.zip`; its member `logs/<Test name>.log` carries the whole
  name and holds the same UTF-8 lines. The archive is saved as
  `<stamp>-Grüße-測試-<rest of the name>.zip`, and the answer carries that name in the
  `filename*=UTF-8''` header form.
- **TEXT-4 and TEXT-5:** each export answers 200 and hands the browser a file in the chosen
  format, valid UTF-8. After each import the Test has the same name, the Log block's Name and
  Message are `Grüße 測試`, the Python script is unchanged and the canvas block is named
  `Grüße 測試`. TEXT-4, a plain file name: the header is `attachment; filename="<file name>"` and
  the browser saves the file under that name. TEXT-5: the header is the `filename*=UTF-8''` form
  with the whole file name percent-encoded, and the browser saves the file as
  `Grüße-測試-<rest of the name>.<format>`.
- **TEXT-6:** each of the four blocks fails and its Try/Catch holds exactly
  `<Row> has a character at line 1, column 7 that cannot be encoded as UTF-8, so nothing was sent
  to the remote host: remove or replace it`, with `<Row>` being `Command`, `Script`, `Interpreter`
  and `Working Directory`. The console holds `Block '<Name>' failed: <that sentence>` for each.
  The listing of the marker folder is `?` alone, so none of the four texts reached the remote
  host; the listing and the removal run on the same session after the four blocks; the run passes.
- **TEXT-7:** every save answers 422 with error code `VALIDATION_ERROR`, the request id in the
  body and in both headers, and exactly `The request has a character at <where> that cannot be
  encoded as UTF-8, so it was refused: remove or replace it`. `<where>` is the path of the saved
  text in the request, `workflow.nodes[<n>].data.config.values.<row>`, for `command`, `script`,
  `interpreter` and `working_dir` in turn; with all four saved it is the Command's, the first in
  document order. Sent as `text/plain`, under an upload's content type or with no content type the answer is the same. Nothing
  is stored: a search of the Tests list for this run's name finds nothing, the list holds as many
  Tests as before, and reading a Test under any of the seven ids answers 404.
- **TEXT-8:** the YAML export is saved as `हिंदी-परीक्षण-<rest of the name>.yaml`; the folder
  archive is saved as `testdata-हिंदी-परीक्षण.zip` and holds `हिंदी परीक्षण/note.txt` with its
  bytes; the archive of the whole Test Data answers under
  `testdata-हिंदी-परीक्षण-<rest of the name>.zip`. Every mark of the script is in each name, and
  each answer carries its name in the `filename*=UTF-8''` header form.

## V-TEXT-REFUSAL-FUNCTIONAL

`v-text-refusal-functional.spec.ts`: text that cannot be written as UTF-8 (half of a character
pair, U+DCE9) is refused at every way into WAVE, and nothing of it is stored or started. The text
travels as its escape, so every file and message of the spec is plain ASCII.

### Prerequisites

- None on the stack beyond the E2E backend and frontend. REFUSE-3 turns the MCP listener on
  (until restart, on the backend port plus 765) and resets the MCP settings afterwards; it calls
  the tools with `recipe-authoring/mcp_tool_client.py`.
- Every test names its own Tests and environments with a per-run token and removes them.

### Steps

1. **REFUSE-1:** create a Test, export it as YAML and as JSON, delete it; in each file rewrite
   the description as a double-quoted text holding the escape; choose each file in the Import
   dialog of the Tests page and press Validate; POST each file to `/tests/import`.
2. **REFUSE-2:** the same YAML file with the description holding U+1F600 written as its two
   escapes; Validate, then Import.
3. **REFUSE-3:** call `validate_recipe` and `create_test_from_recipe` with a one-step recipe
   whose Log message holds the YAML escape; then `create_test_from_recipe` with a plain message.
4. **REFUSE-4:** open a second live connection from the page; send a subscribe frame whose topic
   holds the escape, then a clean subscribe frame.
5. **REFUSE-5:** create two environments, take a JSON backup of the environments, and rebuild
   the archive with the manifest and those two members, the description of one rewritten to hold
   the escape; delete both environments; upload the archive in Settings > Backup > Restore and
   press Restore.
6. **REFUSE-6:** POST a Test Data upload with the content type
   `multipart/form-data; boundary=...; charset=unicode_escape`, then the same form with
   `charset=utf-8`.

### Validation

- **REFUSE-1:** the dry run answers 400 with code `PARSE_ERROR` and exactly `The file has a
  character at description that cannot be encoded as UTF-8, so it was not imported: remove or
  replace it`; the dialog shows that sentence as its alert, shows no review list and no Import
  button. `/tests/import` answers the same for the same file. The Tests list holds no Test of
  that name, by its API and on the page.
- **REFUSE-2:** the dialog reads `1 importable, 0 blocked` and imports; the stored description
  ends in the one character U+1F600.
- **REFUSE-3:** both tools answer one finding: step `recipe`, code `RECIPE_PARSE_ERROR`,
  severity `error`, `Recipe has a character at flow[0].settings.message that cannot be encoded
  as UTF-8: remove or replace it`, no fix. `created` is false and no Test of that name exists.
  The plain recipe creates its Test.
- **REFUSE-4:** the first answer is `{type: error, error_code: INVALID_MESSAGE}` with exactly
  `The message has a character at topic that cannot be encoded as UTF-8, so it was refused:
  remove or replace it`; no `subscribed` frame comes for that topic; the clean frame is
  answered with `subscribed` and its topic on the same connection.
- **REFUSE-5:** the Entity Summary counts 2 environments, 1 of them under Errors; the
  Environments row starts open and names the member by its file name with `Cannot be restored.
  Cannot be read`; the result reads `Environments: 1 imported, 0 skipped, 1 failed` and names it
  again with `Not restored. Cannot be read`; afterwards the environment with the plain
  description exists and the other does not.
- **REFUSE-6:** the first upload answers 422 with code `VALIDATION_ERROR`, the request id in
  the body and the header, and exactly `The upload names the charset unicode_escape, and WAVE
  reads UTF-8 only, so it was refused: send it as UTF-8`; the Test Data listing is empty. The
  second answers 201; the listing holds `stored.txt` and its content is the bytes sent.

## V-STARTUP-ENCODING-FUNCTIONAL

`v-startup-encoding-functional.spec.ts`: WAVE refuses to start on a host whose text encoding is
not UTF-8 and names the setting that turns it on.

### Prerequisites

- None on the stack. Each test starts its own backend with `spawnBackend`
  (`helpers/spawn-backend.ts`) on a free port, with a config file and a data folder in a new
  folder under the temp folder. `removeSpawnedBackends` stops it and removes the folder.

### Steps

1. **ENCODING-1:** start a backend with `LC_ALL=C`, `PYTHONUTF8=0` and `PYTHONCOERCECLOCALE=0`.
2. **ENCODING-2:** start one with `LC_ALL=C`, `PYTHONUTF8=1` and `PYTHONCOERCECLOCALE=0`.

### Validation

- **ENCODING-1:** the process exits with code 1. Its output holds one FATAL line: `WAVE needs
  UTF-8 and this host's encoding is <encoding>: set PYTHONUTF8=1 in the environment that starts
  WAVE`, where `<encoding>` is not UTF-8. The output names no config file and no data folder, and
  no data folder exists.
- **ENCODING-2:** the backend runs, `/health` answers 200, the output names the config file and
  the data folder and holds no refusal.
