V-EXEC-HISTORY-01: Historical Test Canvas for a test-type execution

Short description:
Renders the Historical Test Canvas for a terminal single-test execution. A test-type execution reuses its execution id as the run_id, and `/executions/<id>` redirects to `/executions/history/<id>`, which renders no Components table.

Pre-requisites:
- Backend and frontend running; admin API enabled.
- `01-seed.sh` executed.

Execution steps:
1. Navigate to `/executions/history/d0000003-0000-0000-0000-000000000003`.
2. Wait for the workbench page to load.

Validation criteria:
- The page mounts in history mode (`workbench-page`, data-mode=history).
- The action bar shows the environment label pill (disabled) and the "Open in Workbench" button.
- The palette is collapsed and disabled.
- The console panel is visible with Clear disabled.
- The variable manager panel is visible.
- The Log node from the seeded workflow_snapshot paints.
