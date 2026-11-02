# V-MCP-TESTDATA-FUNCTIONAL: Test Data over MCP

Verify an assistant can manage a test's own data files through the MCP tools and
that what it writes is the same folder the person sees: the five tools round
trip, a refusal stays a finding while a raise stays a raise, a run in progress
locks the folder, and a recipe whose `testdata://` reference is missing warns
without blocking - then runs green once the file is supplied.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service: everything runs against the WAVE stack itself, so
  nothing from `tests/e2e/services/` is required
- `fixture.json` - a one-block Log test whose only job is to own a Test Data
  folder for the round-trip leg
- `../recipe-authoring/mcp_tool_client.py` - the shared one-shot MCP client
  (tool name in argv, JSON args on stdin), run through the backend poetry env
- The packaged recipe example `08-files-testdata`, read at run time through
  `get_recipe_guide` rather than copied into this suite

## Isolation on the shared stack

Each test creates its own Test - imported from `fixture.json` or created through
`create_test_from_recipe` under a unique name - and deletes it in teardown; the
delete cascades and removes that test's data folder. Uploads go through
`POST /tests/{id}/testdata/upload`, one file per request, with the multipart
fields in the order `path`, `replace`, then the file part. The MCP listener runs
until-restart on a per-stack port and is reset in teardown. No server state is
reset and no other shard is affected.

## Steps

1. Enable the MCP listener until-restart via `PUT /mcp/settings` (per-stack port)
2. Import `fixture.json`, upload one file through the HTTP API, and list it back
   with `list_testdata`
3. Create a folder, write a text file, a base64 file and a scratch file, retry
   an existing name with and without `replace`, and send both content forms and
   neither
4. Rename the text file, delete the scratch file, and list after each
5. Call `get_test`, `write_testdata` and `list_testdata` with an unknown test
   reference
6. Open the test in the workbench and open the Test Data sheet from the chip
7. Create a second test that loops on short delays, start it as a tracked
   execution, call all four write tools while it runs, then stop it and retry
8. Read `08-files-testdata` from `get_recipe_guide`, validate it with and
   without a target test, create it, supply its fixture with `write_testdata`,
   validate again, and run it as a tracked execution
9. Reset the MCP settings and delete every test the spec created

## Validation

- **Listing:** `list_testdata` reports the file the HTTP upload stored, with the
  same relative path and byte count the upload answered
- **Text and base64:** the stored bytes read back byte-identical through
  `GET /tests/{id}/testdata/content/{rel}`; the text write is UTF-8 encoded and
  the base64 write carries bytes that are not valid UTF-8
- **Replace:** writing an existing name without `replace` answers
  `written: false` with the `File already exists: ...` finding and leaves the
  stored bytes untouched; with `replace` it answers `written: true` and the
  bytes change
- **Argument errors:** both content forms, or neither, raise
  `Provide exactly one of content or content_base64` and carry no `written`
  envelope; nothing is stored
- **Folder, rename, delete:** each answers its own boolean true and the next
  `list_testdata` shows the change - the folder as a `dir` entry, the new path
  present and the old absent, the deleted path gone
- **Sheet:** the Test Data sheet renders exactly the entries the tools left -
  the uploaded file, the folder, the renamed text file and the base64 file -
  and neither the renamed-away name nor the deleted one
- **Unknown reference:** `get_test`, `write_testdata` and `list_testdata` all
  raise `Test '<ref>' not found`; none answers a finding
- **Running test:** while a tracked execution holds the test, all four write
  tools answer their boolean false with the
  `Test '<name>' is running; test data cannot be changed until it finishes`
  finding, nothing is stored, and the same write succeeds once the run is
  terminal
- **Warning, not error:** `TESTDATA_NOT_FOUND` is a warning naming the literal
  reference; `valid` stays true in every dry run, and `create_test_from_recipe`
  still creates the test and carries the warning
- **The loop closes:** validating with the target test still warns while the
  file is missing, stops warning once `write_testdata` supplies it, and the
  packaged example then runs `passed` and logs the row count it parsed out of
  the file the tool wrote
