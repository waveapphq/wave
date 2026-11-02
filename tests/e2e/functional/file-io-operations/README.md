# V-PLUGIN-FILEIO-OPERATIONS-FUNCTIONAL: The Eight File I/O Operations

Proves every File I/O operation does what the block promises, against files the
test uploaded to its own Test Data folder and against the artifacts the run
writes: Read (plain text and a file carrying a byte-order mark), Write with
Replace it and Append to it, Copy of a file and of a folder onto an existing
folder, Move, Delete with and without Ignore missing, Stats on a present and a
missing path in all three output formats, List by regular expression and by
depth, and Create folder twice. Three further workflows each prove one refusal:
a Write with Fail the block, a Write whose destination is a folder, and a Write
targeting a read-only `testdata://` path.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service: every path is a WAVE-side `testdata://` or `artifact://`
  reference, so nothing from `tests/e2e/services/` is required
- `operations.fixture.json` - 28 chained Blocks covering all eight operations,
  binding every readable output to a declared variable
- `abort-write-fail.fixture.json` - a Write creates a file, a second Write with
  If the file exists = Fail the block refuses it, a marker that must never run
- `abort-destination-folder.fixture.json` - Create folder, then a Write aimed at
  that folder, then a marker that must never run
- `abort-testdata-write.fixture.json` - a Write aimed at `testdata://customers.csv`,
  then a marker that must never run

## Isolation on the shared stack

Each spec creates its own Test through `POST /tests`, uploads its own files with
`POST /tests/{id}/testdata/upload` (one file per request, fields in the order
`path`, `replace`, then the file part), and deletes the Test in teardown, which
cascades to its Test Data folder. Every assertion reads that run's own console,
Block statuses, session variables and session artifacts. No server state is
reset and no other shard is affected.

## Steps

1. Import the fixture via `POST /tests` and confirm `/tests/{id}/validate`
   reports zero errors
2. Upload the fixture's Test Data files and folders, then read the listing back
3. Open the Test in the workbench, pick the shared environment, press Run
4. Wait for the terminal status and for the run's own bookend marker on the
   console
5. Read the console lines, the Block statuses and the session variables
6. Read `GET /workbench/session/artifacts` and the content of the files it lists
7. For the abort workflows, read back the bytes the refused Block was aimed at
8. Delete the Test

## Validation

- **Import and validate:** every fixture imports and validates with zero errors
- **Test Data round trip:** the flat listing carries the four uploaded files and
  the two folders in path order, with the uploaded byte totals
- **Read:** the uploaded CSV comes back byte for byte; the file written with a
  byte-order mark comes back without it
- **Write:** Append to it leaves the earlier content plus the new content;
  Replace it leaves only the new content
- **Copy, file:** the artifact copy reads back as the Test Data source
- **Copy, folder merge:** listing the destination afterwards shows the entry
  that was already there and both copied entries
- **Move:** the target holds the content and the source path reports Exists false
- **Delete:** a missing path with Ignore missing on succeeds and creates nothing;
  an existing path is gone from the session artifacts afterwards
- **Stats:** individual, map and table forms all report the real Exists, Type,
  Modified, Size and Checksum, with the checksum equal to the digest of the
  bytes; a missing path reports absent instead of failing
- **List:** the regular expression, Include subfolders off and on, and the Size
  column each return the expected table columns, rows and Count
- **Create folder:** the first call creates it, the second succeeds and says so
- **Write with Fail the block:** the Block fails with
  `File exists and if_exists=fail: <path>`, the run stops, and the file still
  holds what the first Write put there
- **Write onto a folder:** the Block fails with `Destination is a folder: <path>`
  and the folder is still a folder
- **Write onto test data:** the Block fails with
  `testdata:// paths are read-only. Cannot write, move, or delete testdata files.`
  and the uploaded file is unchanged
- **Session outcome:** the operations workflow ends `passed` with every Block
  successful and the `fileio-ops-complete` bookend on the console; each abort
  workflow ends `failed` with the marker after the refused Block never running
