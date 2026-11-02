# Quick Insert (functional)

| Spec | Covers |
|------|--------|
| `v-qadd-02-functional.spec.ts` | Insert modes, substring search, keyboard, caret |
| `v-qadd-03-functional.spec.ts` | Server paging of the published-Function half |

## V-QADD-02: Quick Insert insert modes

A workflow built entirely through the Ctrl+Space Quick Insert window executes
end-to-end, proving the inserted blocks carry real ids, configs, and wiring
(CANVAS-231..237, REQ-4.2.5, REQ-5.2.1.47).

### Prerequisites

- A running stack (the functional config seeds its own data via REST).
- No fixture for the two canvas tests: they start from a clean workbench
  canvas (backend session deleted, localStorage cleared).
- The self-nest test publishes a library Function and seeds a Shared instance
  via `POST /functions` + `POST /tests`.

### Steps

1. Clean canvas. Ctrl+Space, search "log", Enter - anchors on the Start block.
2. Select that block. Ctrl+Space, Enter - anchors on the selection.
3. Click empty canvas to clear the selection. Ctrl+Space, then CLICK the row -
   anchors on the last interacted block.
4. Ctrl+Space, Ctrl+Enter - places at the viewport center with no link.
5. Ctrl+Space, Alt+Enter - nothing happens.
6. Drag the "Log" row onto empty canvas (palette drop path).
7. Set each inserted Log's message via its config sheet; Run (unsaved
   in-memory state, no save prompt).
8. Separate test: search "del", Tab, PageDown, click a heading, click the
   canvas and back.
9. Separate test: publish a Function, seed a Shared instance, enter edit mode,
   drill in, quick-add the same Function.

### Validation

- Each insert selects the placed block (replacing any selection).
- Edge count: +1 after each anchored insert (Enter and a row click alike);
  unchanged after Ctrl+Enter and after the far-drop drag.
- Alt+Enter leaves the block count unchanged and the window open.
- Run passes; the console shows "from start", "after selection" and
  "after last interacted" - and does NOT show the messages of the two
  unlinked blocks; block statuses match (chain = success, unlinked = not
  executed).
- Search: typing "del" leaves exactly K8s Delete then Delay. Enter inserts K8s Delete;
  Tab then Enter inserts Delay, and focus never leaves the search box.
  PageDown moves the highlight to the eleventh catalog row.
- The caret is back in the search box after clicking a group heading, and
  after clicking away to the canvas and back into the window.
- Self-nest quick-add is refused with the "cannot be nested inside itself"
  toast and adds no block (drop-path parity).

## V-QADD-03: the published-Function half is server-paged

The window used to request one page of the library and filter it in the
browser, so anything past that page was silently unreachable. This spec proves
the whole library is reachable (CANVAS-241, CANVAS-244..247, PICKER-1,
REQ-4.2.5).

### Prerequisites

- No shell fixture. `beforeAll` publishes 110 Functions through
  `POST /functions/batch`, ten per request; `afterAll` removes them through
  `DELETE /functions/batch`, ten per request.
- Names are `QADDP<run> Fn 001`..`Fn 110`, zero-padded so alphabetical order is
  numeric order, and namespaced per run because the functional database is
  shared with every sibling spec that publishes Functions. Every assertion is
  scoped to that prefix through the search box.
- **Why ten per request.** Publishing validates the incoming Function against
  the whole library, so each entry costs time proportional to what is already
  held and the fixture as a whole is quadratic. Measured against a dev backend:
  110 in one request took 16.6s, which is past the default request timeout;
  split into tens the same work is 11 requests whose slowest is 2.8s. Every
  request also carries an explicit 60s timeout.
- **Cleanup does not trust the seeding.** It lists Functions by the run's name
  prefix and deletes what it finds, repeating until nothing is left, so a
  create that timed out but still landed cannot leak. A failed delete chunk
  does not strand the others; the next round retries it. The hook ends by
  asserting the prefix matches nothing, because a leaked fixture would break
  the "del" assertions in the two sibling specs on every later run.

### Steps

1. Clean canvas, Ctrl+Space, type the prefix, wait for the Function half to
   answer it.
2. Scroll the list to its bottom four times.
3. PgDn to the end of the list, then Enter.
4. Second test: type the prefix, then hold ArrowDown to the last loaded row.
5. Second test: type a narrower prefix.

### Validation

- Page 1 holds 25 rows and the status line reads
  "110 Functions - refine your search to narrow down"; the query also removes
  every plugin, control and the New Function creator row.
- Each scroll appends exactly 25 (50, 75, 100, 110); the line then reads
  "110 Functions". Rows 1, 26, 51 and 110 are the alphabetically expected
  entries, so the order holds across page boundaries.
- No row that fails the applied search ever appears on a later page.
- The 110th Function - past the single page the window used to request - is
  highlightable with PgDn and Enter places it on the canvas.
- Arrowing onto the last loaded row loads the next page, so the keyboard
  reaches the whole library without the mouse.
- A changed search restarts at the first page: ten rows and "10 Functions".
