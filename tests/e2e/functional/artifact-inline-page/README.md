# V-ARTIFACT-INLINE-PAGE: A file opened inline never runs in WAVE's origin

A run can leave a page in its artifacts: an HTTP download, an SFTP fetch or a
File I/O write of something a system under test produced. A Test's data and the
workbench session's artifacts can hold the same files. Opened with
`disposition=inline`, such a page still renders and its scripts still run, so
WAVE's own HTML report works from the artifact endpoint (REPORT-1). The page
runs walled off from WAVE, so its scripts cannot read WAVE's API
(REQ-5.2.4.12).

| Spec | File surface |
|------|--------------|
| `v-artifact-inline-page-functional.spec.ts` | a tracked run's artifacts (`/artifacts/content/{id}`) |
| `v-file-surfaces-inline-page-functional.spec.ts` | a Test's data (`/tests/{id}/testdata/content/{name}`) and the workbench session's artifacts (`/workbench/session/artifacts/content/{name}`) |

`inline-page.ts` holds what both specs share: the page files, their text from
`fixture.json`, and the check that a page opened inline cannot read WAVE.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service: the File I/O block writes both files on the WAVE side
- `fixture.json` - a passing Test that writes `artifact://page.html` and
  `artifact://drawing.svg`. Each holds a `verdict` element and a script that
  fetches `/artifacts?per_page=1` and sets the verdict to `read` when WAVE
  answers and to `blocked` when the browser refuses the read

## Isolation on the shared stack

Each spec imports its own uniquely named Test through `POST /tests`, reads only
its own run's artifacts or its own Test's data, and deletes its execution, its
workbench session and its Test when done.

## Steps

`v-artifact-inline-page-functional.spec.ts`

1. Import the fixture, validate it for a run, and run it as a tracked execution
2. Open each page from the run's artifacts inline in the browser and read its
   verdict
3. Download each page from the same artifact link without a disposition

`v-file-surfaces-inline-page-functional.spec.ts`

1. A Test's data: import the fixture, upload each page with the fixture's text
   to the Test's own data, and open it from there inline in the browser and
   read its verdict
2. The workbench session: open the fixture on the workbench canvas, run it
   until it passes, and open each page from the session's artifacts inline in
   the browser and read its verdict

## Validation

- The fixture validates with zero errors, and both the tracked run and the
  workbench run pass.
- Each inline page's verdict leaves `pending` and reads `blocked`, on every
  file surface: the script ran, and its read of WAVE's API was refused.
- Each download of a tracked run's page answers 200 with the file's own type
  (`text/html`, `image/svg+xml`) and `attachment; filename="<name>"`.
