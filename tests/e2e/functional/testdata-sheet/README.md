# V-TESTDATA-SHEET: Test Data Sheet End-to-End

Verify that a test's own files are managed entirely from the Test Data sheet and
that what the sheet shows is what is really on the server: the breadcrumb chip
opens the sheet, Upload and New folder follow the row that is selected, entries
rename, download and delete, Copy path writes the `testdata://` reference, an
upload over a name that already exists asks once before anything is sent, a file
the server refuses keeps its own row while the rest of the batch lands, files
dropped on a folder row go into that folder, test data cannot be changed while
the test is running, and a run resolves `testdata://folder/file` to the bytes
that were uploaded.

The sheet's own work is split across three suites:

| Spec | Covers |
|---|---|
| `v-testdata-sheet-manage.spec.ts` | The chip opening the sheet and the empty state; New folder and Upload following the selected row; rename and delete; a file downloading its bytes and a folder downloading as a zip; Copy path; the unsaved test that says to save first |
| `v-testdata-sheet-uploads.spec.ts` | A name the listing already holds caught before anything is sent and Replace all sending one request with `replace=true`; three files at once, each with its own row, a spinner first and then percent, time left and Cancel; a refused file keeping its row while the rest of the batch lands; a file dropped on a folder row landing inside that folder |
| `v-testdata-sheet-run.spec.ts` | A run resolving `testdata://folder/file` to the bytes that were uploaded, and test data refused while the test is running and accepted once it stops |

Changing a test's files is workbench work, so two more suites cover what other
sessions see and what a file that did not land offers:

| Spec | Covers |
|---|---|
| `v-testdata-sheet-sessions.spec.ts` | A session that follows the holder reads the files and cannot change them; an upload shows up in both sessions and survives a take-over; who may stop one; the amber row a stopped upload leaves and its disposal on close; the chip's state; the close warning naming the uploads |
| `v-testdata-sheet-recovery.spec.ts` | The notice a refused file leaves, Retry from the tab that still holds the bytes, and Choose file once the test is reopened - including a file offered under the wrong name |

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service: the sheet talks only to WAVE's own Test Data API and the
  runs use Log, Delay and File I/O, so nothing from `tests/e2e/services/` is
  required
- `fixture.json` - one Log block; the workflow exists only so the sheet has a
  saved test to hang files on
- `resolve.fixture.json` - File I/O Read of `testdata://fixtures/payload.txt`
  with Content bound to the `payload` variable, a Log of that variable, and a
  bookend Log so the console harvest has a marker
- `running.fixture.json` - a Log, a 20 second Delay that holds the run open long
  enough to drive the sheet, and a bookend Log

## Isolation on the shared stack

Each case creates its own Test through `POST /tests` under a unique name,
uploads its own files with `POST /tests/{id}/testdata/upload` (one file per
request), and deletes the Test in teardown; the delete cascades and removes the
test's data folder. No server state is reset and no other shard is affected.

## Steps

1. Import a fixture via `POST /tests` and confirm `POST /tests/{id}/validate`
   reports zero errors
2. Seed the test's files through the Test Data API where a case needs them
3. Open the test in the workbench and click the Test Data chip
4. Drive the sheet: upload, new folder, rename, delete, download, copy path,
   drag and drop
5. Read the result back from `GET /tests/{id}/testdata`,
   `GET /tests/{id}/testdata/content/{path}` and the download stream
6. For the run cases: pick the shared environment, press Run, and read the
   console and the session variables once the session reaches a terminal state

## Validation

- **Chip and empty state:** the chip opens the sheet, the sheet is labeled
  `Test Data`, and a saved test with no files reads "No test data yet" while the
  listing reports zero files
- **New folder targets:** with nothing selected the dialog says "New folder in
  the root" and the folder is created at the root; with a folder selected it
  says "New folder in fixtures" and the folder is created inside it; with a file
  selected it names that file's folder
- **Empty folder:** a folder with no children shows the muted "Empty folder" row
- **Selection:** clicking a row marks it selected on both the wrapper and the
  inner row; a second click on the same row clears it, and New folder targets
  the root again
- **Upload of two files:** both land inside the selected folder, neither lands
  at the root, and the stored bytes equal what the spec sent
- **Rename:** a renamed file keeps its bytes at the new path and the old path is
  gone; a renamed folder carries its children
- **Delete:** the confirmation names the entry, Cancel leaves it in the listing,
  Delete removes it
- **Download:** a file downloads under its own name with the stored bytes; a
  folder downloads as `testdata-fixtures.zip` whose first bytes are the zip
  signature
- **Copy path:** the clipboard holds exactly `testdata://fixtures/report.json`
  for a file and `testdata://fixtures` for a folder, and the row shows the
  copied state
- **Replace conflict:** the prompt names the conflicting file and appears before
  any request; Cancel sends no request and leaves the stored bytes untouched;
  Replace all sends exactly one request whose multipart body carries `path`,
  then `replace=true`, then the file, and the stored bytes change
- **Concurrent uploads:** three selected files start three rows inside the tree,
  Upload and New folder stay enabled, and all three files land with their own
  bytes
- **Progress detail:** under three seconds a row shows a spinner only; from
  three seconds it shows the percent and the time left the server worked out,
  plus Cancel. Neither figure is computed in the browser, so every session
  watching shows the same one
- **Where the row sits:** a file being uploaded, one that was stopped and one
  that did not land all sit in the tree under the folder they were going to,
  never above it; a folder the person had closed opens while a file arrives into
  it
- **One refusal does not stop the rest:** the refused file keeps its own row
  with the server's message and a Dismiss button, the other two files are in the
  listing, and the refusal never reaches the sheet's blocked notice
- **Drop on a folder row:** the hovered folder is marked as the drop target, the
  row for the file appears inside that folder while it arrives, and the dropped
  file's path is inside that folder, not at the root
- **Save first:** an unsaved test reads "Save the test first to add files." with
  Upload and New folder disabled and no drop zone
- **Running test:** creating a folder mid-run is refused with
  `Test '<name>' is running; test data cannot be changed until it finishes` on
  the blocked notice and nothing is created; after the run ends the same action
  succeeds and the folder is in the listing
- **Reference resolution:** the run passes, the Read block logs exactly the body
  the spec uploaded, every block ends successful, and the bound session variable
  carries the same body
- **Read-only for a follower:** the follower's browser carries
  `data-read-only="true"`, shows
  `Only the session holding this test can change its files.`, offers no Upload,
  no New folder, no upload input and no row kebab, and still offers Download
- **An upload belongs to the test:** the follower renders a row it did not
  start, `GET /tests/{id}/testdata/uploads` lists it, and the file still lands
  after the follower takes the session over
- **Stopping an upload:** the follower has no Cancel; the holder's Cancel leaves
  an amber `Canceled` row in both sessions at once - the server announces it
  when it is asked, not when the transfer finally stops - the file never lands,
  nothing is kept in the interruptions list, and closing the sheet removes the
  row for good
- **Chip state:** no mark while idle, `data-uploading="true"` while a file is on
  its way in, `data-interrupted="true"` alone once the uploads are over, and no
  mark once the notice is dismissed
- **Close warning:** the dialog names the uploads still going and says leaving
  the test does not stop them
- **Retry:** the refused row carries the server's reason, a Retry and a Dismiss,
  and no Choose file while the tab still holds the bytes; once the obstacle is
  gone Retry lands the same bytes and clears the notice
- **Choose file:** reopening the test brings the same notice back with Choose
  file and no Retry; a file under another name is reported on the row as
  `That is <chosen>, not <expected>.` and nothing is sent; the expected name
  lands where the original was going
