# V-FILE-PICKER: the file-reference picker behind every Browse button

Proves that Browse writes a real reference into the parameter it was opened
from, that the picker offers exactly the sources and the choices each field
allows, and that a run resolves what was picked: the read returns the uploaded
bytes, the write lands where the picker said, and a Helm install deploys the
chart archive that traveled with the test.

Every row is imported holding a placeholder nobody picked, so a leg that fails
to write its reference fails the run instead of passing on a seeded value.

- `v-file-picker-functional.spec.ts` - the File I/O path rows, then the Excel
  and HTTP file rows, filled through Browse and resolved by a run, plus the
  rows where Browse is withheld and the tab the picker opens on.
- `v-file-picker-helm.spec.ts` - Helm Install's Chart picked out of the test's
  own data, and the install that runs from that archive.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- `http-echo` (127.0.0.1:9449) for the HTTP leg; `kwok` and the shared cluster
  for the Helm spec. The File I/O and gating legs need no external service.
- The checked-in workbook `backend/tests/plugins/excel_parser/fixtures/sample_workbook.xlsx`
  and chart archive `tests/e2e/services/tls-lab/charts/wave-demo-0.1.0.tgz` are
  read from disk and uploaded as the test's own data.
- `fixture.json` - eight File I/O Blocks: read, copy, list, write, move and the
  markers, every path row on a placeholder.
- `fixture-plugins.json` - Excel read and write, one HTTP POST that sends a file
  and saves the reply to a file, and the markers.
- `fixture-gating.json` - a File I/O Block whose path is an expression, both K8s
  Copy directions, and an SSH session with a Remote Execution body. Never run.
- The opening-tab test imports `fixture.json` again with the Read Path set to
  `/srv/in.csv` and the List Path set to `artifact://x`. Never run.

## Isolation on the shared stack

Each test imports its own Test through `POST /tests`, uploads its own files one
per request into that test's own data folder, and deletes the Test in teardown -
the delete cascades and removes the folder. The Helm spec installs into a
namespace it seeds and removes, under a release name carrying the run suffix.
No server state is reset and no other shard is affected.

## Steps

1. Import the fixture and confirm `POST /tests/{id}/validate` reports zero errors
2. Upload the test's files (`POST /tests/{id}/testdata/upload`, one file per
   request, fields in the order `path`, `replace`, then the file part)
3. Open the test in the workbench and, on each Block in turn, press Browse,
   drive the picker and press Select
4. Apply each config sheet, then save the workbench
5. Read `GET /tests/{id}/workflow` back and check what the server stored
6. Pick the shared environment, press Run, and read the console once the session
   reaches a terminal state
7. Read `GET /workbench/session/artifacts` and the content of what the run wrote

## Validation

The picker's Reference line is read in two parts: the fixed scheme of the tab in
front (`testdata://` on Test Data, `artifact://` on Artifacts and in save-as)
and the path box under it, which is the only part a spec types into.

- **Read Path (file):** the picker opens titled `Choose a file` on the Artifacts
  tab with the placeholder's path, since the row holds an artifact; on Test Data
  the path starts empty, a folder answers nothing, on a click or a double click,
  and the picker stays open; the stored value is `testdata://inputs/greeting.txt`
  and the run's Read prints the bytes that were uploaded.
- **Copy Source (file or folder):** Select is dead while the path is empty and
  live for a folder and for a file alike; emptying the path leaves the scheme in
  place; the stored Source is the file that was picked.
- **Copy Destination (save as):** the Name opens on the Source's own file name,
  renaming recomposes the Reference, and the run writes the artifact under the
  composed name.
- **List Path (folder):** file rows render muted, aria-disabled and outside the
  tree; a click on one changes nothing; the run lists the picked folder and
  reports two entries.
- **Write Path (save as):** the session's artifacts are the only source, an
  empty Name leaves Select dead, and the run writes to the composed artifact.
- **Move Source:** the picker offers no Test Data tab at all and takes a path
  typed under `artifact://`; the run moves the artifact the Copy wrote, and the
  source artifact is gone afterwards.
- **Excel and HTTP:** a double-click on a Test Data row chooses and closes; the
  run reads three rows out of the picked workbook, sends the picked payload as
  the request body, and saves the reply at the composed artifact path.
- **Where Browse is withheld:** an expression row, the pod-side K8s Copy rows and
  every row inside a Remote Execution body carry no Browse; switching expression
  mode off brings it back on the same row and the pick then persists.
- **Opening tab (FP-12):** Browse on a row holding `/srv/in.csv` opens with
  `testdata://` and an empty path and Select disabled, and after Cancel the row
  still holds `/srv/in.csv`; a row holding `artifact://x` opens on the Artifacts
  tab with the path `x`; the workbench is left with nothing to save.
- **Helm Install:** the Chart row picks the uploaded archive and the install
  reports revision 1 with Chart `wave-demo-0.1.0`, App Version `1.0.0` and
  Status `deployed`.
- **Session outcome:** `passed` for both runs, with `file-picker-fileio-done`,
  `file-picker-plugins-done` and `file-picker-helm-done` bookending them.
