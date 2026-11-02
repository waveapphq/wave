# historical-test-canvas (functional)

Historical Test Canvas painted replay, read-only Variable Manager and
Console, and post-deletion viewability.

## Pre-requisites
- Shared `E2E Execution Env` environment (auto-created by the spec via `ensureEnvironment`).
- A running backend that accepts `POST /tests`, `POST /executions`, and
  `GET /executions/history/{runId}`.

## Execution steps
1. Import `fixture.json` (a one-Log-node test) via `POST /tests`.
2. Validate it with `POST /tests/{testId}/validate` - zero errors.
3. Start a test-type execution via `POST /executions`.
4. Poll `GET /executions/{id}` until the status is terminal.
5. Navigate to `/executions/history/{executionId}`  (test-type runs use
   `run_id == execution_id`).
6. Delete the source test via `DELETE /tests/{testId}` and reload the
   page to prove the snapshot survives the delete.

## Validation criteria
- The historical canvas page renders (`workbench-page` with `data-mode="history"`).
- Canvas, palette, action-bar chrome from the real Workbench are reused.
- The palette is collapsed and disabled (`data-state="collapsed"`, `data-disabled="true"`).
- The Open-in-Workbench button and the disabled environment pill are visible.
- The Console panel is visible.
- The Clear button in the console header is disabled.
- The Variable Manager panel is visible.
- The canvas still paints after the source test is deleted.

## V-EXEC-HISTORY-FN-DRILL

`v-exec-history-fn-drill-functional.spec.ts` - a run's history canvas drilled into a Function shows that
Function's own variables in the Variable Manager (REQ-3.1.3.1). No fixture file: the spec builds the Test in code.

### Pre-requisites
- Shared `E2E Execution Env` environment.
- A running backend that accepts `POST /tests`, `POST /executions`, and `GET /executions/history/{runId}`.

### Execution steps
1. Seed a Test via `POST /tests`: a Test variable `count` and a Local Function `Scoped_Fn` (input `region`
   with a default, output `result`, local `loc_n`) whose body sets `result`, then a Log of `count`.
2. Validate it with `POST /tests/{testId}/validate` - zero errors.
3. Run it as a tracked execution (`POST /executions`) to a terminal status.
4. Open the run's history canvas and read the Variable Manager rows.
5. Drill into `Scoped_Fn` and read the rows; go back with the back arrow and read them again.

### Validation criteria
- At the history root the Variable Manager lists `count` and none of `region`, `result`, `loc_n`.
- Drilled into `Scoped_Fn` it lists `region`, `result` and `loc_n` and no longer lists `count`.
- Back at the root `count` is listed again.
