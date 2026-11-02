# V-REPORT-02: In-App Report Viewer

Verify the in-app report viewer flow: a finished execution appears on the
reports list as "Not generated", opening the viewer generates the JSON report
on demand, the document renders Summary/Timeline/Errors/Logs, the log level
filter works, the list flips to "Generated", the historical-canvas entry
button opens the viewer, and Download JSON triggers a file download.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No fixtures need to be pre-seeded; the spec imports `fixture.json` via
  `POST /tests` under a unique name, runs it tracked, and waits terminal.

## Fixtures

- `fixture.json` - One test with 6 nodes:
  - Log `Startup_Log` ("Viewer run started", INFO)
  - Log `Debug_Log` ("Viewer debug diagnostics", DEBUG)
  - Log `Warn_Log` ("Viewer warning threshold", WARN)
  - For `Viewer_Loop` (count=2) with body Log `Nested_Log`
    ("Nested iteration log", INFO) for the nested-path timeline row
  - Log `Error_Log` ("Viewer simulated error", ERROR) after the loop

## Steps

1. Import `fixture.json` via `POST /tests`; validate with zero errors;
   `POST /executions` tracked; poll to terminal `passed`.
2. Open `/reports?search=<name>`.
3. Open the viewer via the row's Generate action.
4. Drive the log level filter (INFO -> DEBUG).
5. Return to `/reports?search=<name>`.
6. Open `/executions/history/<execution_id>` and click the Report button.
7. Click Download JSON.

## Validation

- **Step 2:** Row shows italic "Not generated" Report cell and the
  file-plus Generate action.
- **Step 3:** URL becomes `/reports/<execution_id>`; the generating
  interstitial or the ready document renders (generation may complete
  fast); the document shows the execution name, Summary meta grid, Block
  Results count cards (6 blocks, 6 passed), Timeline table with 6 block
  rows (nested row carries the muted "Viewer_Loop /" path prefix), 6
  chart bars, one ERROR card with the "Viewer simulated error" message.
- **Step 4:** Level defaults to INFO and the DEBUG entry is absent; at
  DEBUG the live count reads "N of N entries" and the DEBUG entry is
  visible (REQ-3.7.2.8).
- **Step 5:** Report cell now reads "Generated <relative> · <size>" with
  the eye View action.
- **Step 6:** The history action bar Report button navigates to the
  viewer; the existing report loads without regeneration.
- **Step 7:** A download event fires with a `.json` filename.
