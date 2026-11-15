# V-ARTIFACT-BROWSER: Artifact browser and session artifact downloads

Two specs prove the artifact surfaces as a user experiences them. The first seeds
a real tracked execution that produces every artifact type, then drives the
artifact browser and asserts on observable output. The second runs a workflow in
the live workbench and asserts what the Session Artifacts sheet actually hands
back when a row is downloaded. A third spec proves that every artifact rule holds
when an id is spelled with a dot segment in front. A fourth proves that a link in
the live session's artifact folder reaches nothing outside that folder.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service, so nothing from `tests/e2e/services/` is required: the
  browser and session-artifacts specs get their files from the File I/O block on
  the WAVE side, and the two containment specs write theirs into the data folder
  themselves (see below)
- Clipboard permission is granted in-spec; the copy assertions need the
  localhost origin, where `navigator.clipboard` exists
- `../../fixtures/artifacts/fixture.json` - a failing test that writes
  `artifact://data/output.json` and a long-named artifact next to it (File I/O),
  logs an ERROR that `error.json` aggregates, and fails via
  `Assert(fail_current_scope)` so `error.json` is written. On completion the
  per-test log persists as `logs/<test>.log`; the spec then generates
  `report.html` + `report.json` via `POST /executions/{id}/report`
- `fixture-session-artifacts.json` - a passing test that writes one nested
  session artifact (`artifact://data/output.json`) and ends on a bookend Log
- The two containment specs reach the stack's own data folder on the file
  system: the dot-segment spec writes files into it, and the session-link spec
  plants links in the live session's folder
  (`<data>/artifacts/sessions/<session id>/`) and makes a folder outside it
  under the OS temp folder

## Isolation on the shared stack

Each spec imports its own uniquely named Test through `POST /tests` and asserts
only on that run's artifacts. The browser spec deletes its own execution as the
last step of the cascade case; the session-artifacts spec writes only into the
ephemeral workbench session directory. The dot-segment spec stops and deletes
every run it starts and removes the folder it creates under `sessions/`. The
session-link spec ends the workbench session it starts after every case, frees
the workbench slot, removes its outside folder and deletes its Test at the end.
No server state is reset and no other shard is affected.

## Steps

`v-artifact-browser-functional.spec.ts`

1. `POST /tests` (import) + `GET /tests/{id}/validate` (zero errors)
2. `POST /executions` (tracked) -> poll to terminal `failed`
3. Generate `report.html` and `report.json`
4. Drive `/artifacts` and `/artifacts/{executionId}` in the UI
5. A second test seeds its own execution the same way (steps 1 and 2) and reads
   `data/output.json` through `GET /artifacts/content/{id}` with `Range`
   headers; it deletes its execution and its Test when done

`v-artifact-browser-session-artifacts.spec.ts`

1. Import the fixture and open it on the workbench canvas
2. Pick the shared environment and Run to a terminal status
3. Open the Session Artifacts sheet from the breadcrumb chip
4. Download and copy the artifact row, watching the network response

`v-artifact-id-containment-functional.spec.ts`

1. `POST /tests` with one long Delay block; each case starts its own tracked run
   and stops and deletes it afterwards
2. Write `planted.txt` into the run's artifact folder (or into a spec-owned
   folder under `sessions/`) through the shared data folder
3. Call meta, content and delete with `./<id>` sent with encoded slashes

`v-session-artifact-containment-functional.spec.ts`

1. `POST /tests` with one long Delay block; each case starts its own workbench
   run of it through `POST /workbench/run`, so the session's folder exists
2. Plant the case's links in that folder: one to a file outside, one to a
   folder outside, two that point at each other, or one to a file inside
3. Call `GET /workbench/session/artifacts/content/{path}` and
   `DELETE /workbench/session/artifacts/{path}` on the link (content alone for
   the link inside)

## Validation

- **Landing list:** the execution appears with the API's live artifact count (6).
- **Section grouping:** opening it groups artifacts into Failure / Reports / Logs
  / Files, each holding its expected file (`error.json`,
  `report.html`/`report.json`, `*.log`, `output.json`).
- **Single-file download:** returns the exact fixture bytes.
- **Tree | Flat toggle (ARTIF-7):** exactly one option is pressed at a time;
  Flat lists every artifact under its full stored path with no folder to expand,
  and Tree brings the folder row back.
- **Folder disclosure (ARTIF-9):** the chevron's accessible name flips Collapse
  <-> Expand, `aria-expanded` follows the click, the subtree appears and
  disappears with it, and clicking the folder name toggles nothing.
- **Copy path (TDATA-7):** the clipboard holds `artifact://data/output.json` and
  the button shows the copied cue with its `Path copied` announcement, on both
  the drill row and the Session Artifacts sheet row.
- **Soft delete:** hides the row and drops the live count; Show removed reveals a
  tombstone with no restore affordance.
- **Download all:** streams a valid `.zip`.
- **Execution delete cascade:** the execution is absent from `/artifacts` and
  `/reports` and its artifact dir is purged; the row and bulk delete
  confirmations both warn about "artifacts and reports", and the bulk
  confirmation appears before deletion.
- **Byte ranges:** `Range: bytes=0-7` answers 206 with the first eight bytes
  and `Content-Range: bytes 0-7/35`; the last byte alone is still in range; a
  range that starts at the artifact's length, or past it, answers 416 with
  error code `RANGE_NOT_SATISFIABLE`; the artifact then still downloads whole.
- **Session artifact download:** the listing reports the written byte length; the
  row downloads under its bare file name; the response is 200 with
  `content-disposition: attachment` naming the file, `x-content-type-options:
  nosniff` and `cache-control: no-store`; the body equals the bytes the run
  wrote; `?disposition=inline` flips only the disposition.
- **Dot-segment ids:** a running execution's artifact stays protected (409
  naming the execution, the file kept); meta names the artifact and its
  execution as the plain id does; a delete records the artifact's own path in
  its tombstone; `./sessions/...` answers 400 `Invalid artifact identifier: <id>`
  for content and delete and the session file stays (ARTIF-11, REQ-5.2.4.12).
- **Session artifact links:** a link to a file outside the session's folder,
  and a path through a folder link that leads outside, answer 400
  `Invalid artifact path: <path>` for content and delete; the outside file
  keeps its bytes and the link to it stays; two links that point at each other
  answer the same 400, never a missing file; a link that stays inside is
  served with its target's bytes (ARTIF-14, ARTIF-16, REQ-5.2.4.12).
