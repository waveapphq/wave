# V-PLUGIN-FILEIO-ARTIFACTS-FUNCTIONAL: File I/O artifact:// Session Round-Trip

Verify the File I/O plugin resolves the artifact:// scheme into the workbench
session's artifact directory: a workflow writes a JSON artifact, reads it back,
propagates the content to a Log node, writes into an artifact subdirectory, and
the session artifacts API lists and serves the written files.

## Prerequisites

- Backend running on the worker's backend port.
- Frontend running on the worker's frontend port.
- No fixtures need to be pre-seeded; the spec imports its own fixture.

## Fixtures

- `fixture.json` - One test with 4 chained nodes:
  - File I/O write `artifact://result.json` (JSON content, `if_exists` overwrite)
  - File I/O read `artifact://result.json` (`content` bound to the
    `file_content` variable)
  - Log `file_content` (INFO)
  - File I/O write `artifact://logs/service.log` (subdirectory auto-creation)

## Steps

1. Import `fixture.json` via `POST /tests`.
2. Call `POST /tests/{testId}/validate?context=run`.
3. Navigate to `/workbench?editTest=<testId>` and wait for the canvas to load.
4. Select the shared E2E environment and click Run.
5. Wait for the workflow to reach a terminal status.
6. Call `GET /workbench/session/artifacts`.
7. Call `GET /workbench/session/artifacts/content/result.json`.

## Validation

- Step 1: Import succeeds.
- Step 2: Validation returns HTTP 200 with zero errors.
- Step 5: Workflow status is `passed`; all 4 nodes show execution status
  `success`; the console shows the exact round-tripped JSON content
  `{"status": "complete", "count": 42}`.
- Step 6: Listing contains `result.json` and `logs/service.log`; each entry's
  `size_bytes` equals the byte length of the content written by the workflow.
  A write produces no output of its own, so the written size is only
  observable here.
- Step 7: Response body equals the exact JSON content written by the workflow.
