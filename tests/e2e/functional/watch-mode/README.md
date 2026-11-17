# Watch-Mode Functional Tests

Functional E2E coverage for watch-mode authoring (REQ-5.2.7.17), the watched
change of a saved test (REQ-5.2.7.18) and the Focus Current cross-level
navigation (FOCUS-1/2). These specs cover the current
design: Focus Current is the run-controls button only, watchers get a Follow
Changes toggle and a per-change violet pulse, and the variable cue is
per-changed-row (no all-rows bar).

## Prerequisites

- Backend + frontend running on the worker's ports.
- Shared E2E environment present (handled by `ensureEnvironment` at test start).
- MCP specs only: `poetry` + the backend virtualenv available at
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
- `fixture-change.json` - a Log Alpha, a Log Bravo with its own recipe key and a
  Delay, stored the way a recipe compiles them, so a watched change gives a turn
  only to the Blocks it adds or changes. The spec's change recipe keeps Alpha,
  adds a Log after it, renames Bravo with a new message and removes the Delay;
  it goes through `callToolAsync` (`../../helpers/mcp.ts`), which runs
  `../recipe-authoring/mcp_tool_client.py` without blocking the spec.
  The secrets and interrupt specs reuse it: the interrupt changes add 12 Logs
  (30 for the browsing case), so the change plays long enough to act on.
- `fixture-canvas-settings.json` - a Log Alpha and a Log Bravo with its own
  recipe key, stored as a recipe compiles them, each with an open description
  and its secrets set to always mask, as a person sets them on the canvas.
- The canvas spec builds its test in the UI instead: an HTTP Request dropped
  under Start and three Logs under it with `../null-checks/check-chain.ts`,
  its URL and each message typed in its Block window, saved from the New Test
  window. The canvas saves the HTTP Request without choices a compile writes.

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
  test, a mid-build take-over that inherits a dirty draft, and the watched
  build view for a short and a tall build.
- **`v-watch-mcp-amend-functional`**: import `fixture-change` through the API,
  then call `amend_test_live_from_recipe` with the change recipe while (1) a tab
  holding the test and a watching tab, both panned away, record every frame;
  (2) the tab that gives way has `fixture-follow` open instead; (3) the holder
  has dropped a Block and told the server it has unsaved work. A fast amend of
  an open tab is covered by `../run-mirror/v-runm-mcp-functional.spec.ts`.
- **`v-watch-mcp-canvas-functional`**: (1) build a test on the canvas, save it,
  read it back with `get_test_recipe`, change one Log's message in the readback
  and run `amend_test_live_from_recipe` with it while the tab records every
  frame; (2) import `fixture-canvas-settings` and run `amend_test_from_recipe`;
  (3) the same through `amend_test_live_from_recipe` in a recording holder tab.
- **`v-watch-mcp-secrets-functional`**: (1) a holder on an empty workbench and a
  watcher, both watched for the secret from before they load (socket frames
  received, page text and field values); `build_test_from_recipe` with a secret
  variable; the holder takes over at Block 3, saves from the New Test window,
  and `reveal_secret` reads the stored value; (2) `build_test_from_recipe` and
  `amend_test_live_from_recipe` with an SSH Session Open whose password is the
  mask, each in a recording holder tab.
- **`v-watch-mcp-interrupt-functional`**: import `fixture-change`, start a long
  `amend_test_live_from_recipe` without waiting for it, wait in the tab for a
  given frame (step one, or a turn's steady border), then act: (1) a tab that had
  `fixture-follow` open and a redo step of its own presses the undo and redo
  shortcuts, then takes the change over at a turn, moves a Block and undoes it;
  (2) the test is renamed through `PATCH /tests/{id}/metadata`; (3) the tab opens
  the test from the Tests page; (4) the call is canceled and its session ended
  (`startCancelableCall`, `../../helpers/mcp.ts`), then the tab presses Take
  Session.
- A watching tab whose watched test is deleted is covered by
  `../variable-isolation/v-deleted-test-detection.spec.ts` ("in a watching tab").
- The glide of a watched change (the Blocks that make room move first, then
  the new Blocks appear) and the flow order it ends on are covered by
  `../recipe-authoring/v-mcp-recipe-flow-order-functional.spec.ts`.

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
- **Watched build view (WATCH-8):** in both a holder that gives way and a
  watching tab, Block 1 appears on its own under the assistant's banner; both
  tabs, panned away first, frame a short build's finished test with it and do
  not move again; a build too tall for the tab starts at
  the smallest zoom (0.5) on its top, never moves up or sideways, and moves
  down only to bring a new Block into view. A per-frame recorder in the page
  samples the viewport and what is fully in view.
- **Watched change (WATCH-9, RUNM-2, RUNM-6):** the per-frame recorder also
  keeps each Block's name and place, the lines, the steady border, each new
  ring, the banner and the canvas's glide mark. Both tabs show, under
  "read-only, changing live": step
  one (Alpha and Bravo at their final places, Bravo moved down, the Delay gone,
  only the Start to Alpha line, no border or ring), then the new Log with its
  line from Alpha, then the renamed Bravo with its line from the new Log, each
  turn carrying the border and the one ring, then the saved test. Step one
  frames the finished test and the view does not move again. The answer equals
  the fast amend's (version 1.1.0) and the stored test: Alpha and Bravo keep
  their ids, the new Log takes an id no stored Block had. The tab that gave way
  holds the session again on the saved test, clean, with no dialog; the watcher
  watches it. A tab that had another test open switches to the changed test and
  ends on it, saved, with the other test untouched. A holder with unsaved work
  gets `SESSION_HELD` with its exact text, sees no assistant banner, keeps its
  Block and its session, and the stored test stays at 1.0.0.
- **What the canvas set:** a test built on the canvas and changed from its own
  readback with one message changed gives a turn (the steady border and the
  ring) only to that Block, keeps its four Block ids, and hands the saved test
  back clean. A fast amend and a watched change keep each recognized Block's
  "always mask" choice (`secret_masking: mask`, no unmasked fields) and its open
  description, also on the Block whose message changes; every frame of the
  watched change shows both descriptions open (the recorder keeps the open
  ones per frame), and only the changed Block takes a turn.
- **Secrets:** a watched build taken over at Block 3 answers
  `{built: false, released: taken_over}` and saves nothing; the tab is told it
  now holds the session, holds the draft as unsaved work and saves it; the
  stored secret is the recipe's value, and neither that tab nor the watcher ever
  received it in a socket frame or showed it. A watched build or change whose
  SSH password is the mask is refused with the one `MASKED_SECRET_VALUE` error
  for it, the tab never shows the assistant's banner and keeps the session, and
  nothing is written.
- **Interrupted change:** a watching tab has Undo and Redo disabled and its
  shortcuts change nothing; once it takes the change over (`released:
  taken_over`, nothing saved, told it now holds the session), an edit plus undo
  returns to the half-done change, still unsaved, with nothing left to undo, and
  from step one on it never shows the other test's Blocks or the removed Delay.
  A rename while the change plays answers `STALE_RECIPE_VERSION` with its exact
  text, the stored test keeps the rename and its old Blocks, and the tab holds
  the streamed change as unsaved work. A tab that opens the test from the Tests
  page while the change plays browses on its own (banner with Watch Session) and
  gets the session back on the saved test from storage, clean. A dropped
  assistant frees the slot with nobody named and saves nothing; the tab that
  takes it with Take Session is told it now holds the session, holds the
  half-done change as unsaved and reports it to the server. Only the dialog's
  title is asserted, never its body.
