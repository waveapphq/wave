# V-CTRL-HALT-01: Halt Control Functional Test

Verify Halt control stops workflow execution, marks downstream nodes as skipped,
and sets correct session/block statuses for all 3 status values.

## Prerequisites

- Backend running on port 8000 (or `WAVE_E2E_BACKEND_PORT`)
- Frontend running on port 3000 (or `WAVE_E2E_FRONTEND_PORT`)

## Steps

1. Import fixture via POST /tests API
2. Navigate to workbench with imported test
3. Run workflow
4. Verify halt behavior for each status variant (passed/failed/skipped)

## Validation

- **Halt status=failed:** Session fails, halt node shows failed status, downstream nodes not executed
- **Halt status=passed:** Session passes, halt node shows success status, downstream nodes not executed
- **Halt status=skipped:** Session shows skipped, halt node shows warning status, downstream nodes not executed
- **Halt badge on amber:** The skipped Halt Block carries the SKIP badge
  (`data-state="skip"`, text `SKIP`), never the WARN badge every other amber
  Block now carries
- **Log output:** "before-halt-executed" present in logs, "should-not-run" absent
- **Halt message:** Halt message "stopping execution" appears in execution log
- **No message:** Halt executes cleanly without a message
