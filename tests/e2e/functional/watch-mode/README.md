# Watch-Mode Functional Tests

Functional E2E coverage for watch-mode authoring (REQ-5.2.7.17) and the Focus
Current cross-level navigation (FOCUS-1/2). These specs cover the current
design: Focus Current is the run-controls button only, watchers get a Follow
Changes toggle and a per-change violet pulse, and the variable cue is
per-changed-row (no all-rows bar).

## Prerequisites

- Backend + frontend running on the worker's ports.
- Shared E2E environment present (handled by `ensureEnvironment` at test start).
- MCP build test only: `poetry` + the backend virtualenv available at
  `backend/` (the python MCP client runs there), and the MCP listener enabled
  per-test via `enableMcpUntilRestart`.

## Fixtures / recipe

- `fixture-focus-levels.json` - a local `Function_1` (body `inner-a -> inner-b`)
  placed far from a top-level after-Log, so Focus Current must cross Function
  levels AND move the viewport a visible distance to center its target.
- `fixture-follow.json` - a top-level Log far from a local `Function_1` (body
  `inner-a`), plus two pre-existing variables so a watcher can prove rows are
  clean by default.
- `recipe-watch-build.yaml` - a linear 20-step log recipe revealed block-by-block
  by `build_test_from_recipe`. The python client is reused from
  `../recipe-authoring/mcp_recipe_client.py`.

## Steps

- **`v-watch-focus-current-functional`**: import `fixture-focus-levels`,
  breakpoint the Function node + the top-level block, Debug, Step Into to pause
  INSIDE the Function, then exercise `action-focus-current-button` while viewing
  the wrong scope - asserting the breadcrumb drills in / pops out and the target
  node ends centered.
- **`v-watch-follow-functional`**: two person tabs (tab 1 holds `fixture-follow`,
  tab 2 mirrors). Tab 2 engages Follow Changes; tab 1 edits; tab 2's viewport,
  the `node-change-pulse-<id>` overlay, and the variable rows are asserted.
- **`v-watch-mcp-build-functional`**: enable MCP, spawn `build_test_from_recipe`
  asynchronously, mirror `/workbench`, and assert the live reveal, the saved
  test, and a mid-build take-over that inherits a dirty draft.

## Validation

- **Focus Current (cross-level):** paused inside the Function + viewing root ->
  Focus Current drills in (breadcrumb Function segment count `1`) and centers the
  inner block; paused at the top + viewing inside -> pops out (count `0`) and
  centers; same level -> re-centers with no drill change.
- **Follow Changes:** a following watcher recenters on every holder edit, the
  changed block carries a violet pulse, a repeated change to the SAME block
  re-fires (change tick), a nested change drills the follower into the Function,
  panning does NOT stop following, and Stop Following does. A person watch shows
  the pulse only - no steady `data-mirror-active` border.
- **Variable cue:** rows are clean by default while mirroring; a modified
  variable's row shows a temporary `animate-variable-mirror-pulse` that fades; a
  variable-only change does not move a following watcher.
- **MCP build:** the mirror sees blocks appear one-by-one with the pulse + the
  steady violet active border; on completion the test is saved (v1.0.0, full
  20-node workflow) and `POST /tests/{id}/validate` returns zero errors; a
  mid-build take-over yields `released: "taken_over"`, saves nothing, and leaves
  the taker on a dirty draft with no lingering border.
