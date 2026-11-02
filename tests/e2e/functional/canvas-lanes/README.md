# Canvas lanes: every block and every lane built through the canvas

V-CANVAS-LANES-FUNCTIONAL builds every link the way a user builds it: a block
dropped from the palette below a lane dot, a block Quick Inserted with the
control selected, and a link dragged from the lane dot. No link under test
comes from a fixture. For each link the specs check three things: the line is
drawn from that lane's own dot, the saved Test names that lane
(`sourceHandle`), and a run takes it (REQ-3.1.1.1, REQ-3.1.1.2, REQ-4.2.5;
CANVAS-235).

| Case id | Spec | Proves |
|---------|------|--------|
| V-CANVAS-LANES-FUNCTIONAL (single exit A) | `v-canvas-lanes-single-exit-network-system-functional.spec.ts` | Every Network, Remote (but Remote Execution), Database and System plugin fresh from the palette: a drop below its exit dot links it once, a second drop adds no second link, the saved link has no lane name |
| V-CANVAS-LANES-FUNCTIONAL (single exit B) | `v-canvas-lanes-single-exit-kubernetes-data-functional.spec.ts` | The same for every Kubernetes, Helm and Data plugin |
| V-CANVAS-LANES-FUNCTIONAL (palette controls) | `v-canvas-lanes-palette-controls-functional.spec.ts` | The same for Break, Continue, Variable Setter, Delay and a new local Function; every lane control fresh from the palette draws the lanes of its default settings and takes links on them in drawing order |
| V-CANVAS-LANES-FUNCTIONAL (branching) | `v-canvas-lanes-branching-functional.spec.ts` | If/Else (if; if + else; if + else if + else), Assert (split; single), Switch/Case (two cases + default + then) |
| V-CANVAS-LANES-FUNCTIONAL (loops) | `v-canvas-lanes-loops-functional.spec.ts` | For, For Each, While, Wait Until (Retry; Watch) |
| V-CANVAS-LANES-FUNCTIONAL (scopes) | `v-canvas-lanes-scopes-functional.spec.ts` | Try/Catch/Finally (catch; catch + finally; finally only), Parallel (two and three branches), Remote Execution, Halt (no exit) |
| V-CANVAS-LANES-FUNCTIONAL (lanes taken away) | `v-canvas-lanes-lane-removal-functional.spec.ts` | What the design states when a lane with a link goes: a removed Parallel branch (PARALLEL-3) |

Shared code: `lanes-helpers.ts` (seeding, the three ways to build a link,
the drawn / saved / run checks) and `single-exit-blocks.ts` (the palette
blocks and the default lanes of each lane control).

## Prerequisites

- Backend and frontend running, and the shared execution environment
  (`ensureEnvironment` creates it if absent).
- The scopes spec's Remote Execution case needs the `sshd` service of the
  real-service stack (see `tests/e2e/services/README.md`); the fixture carries
  the `127.0.0.1` sentinel in the SSH Session Open Host row and
  `injectServiceHost` rewrites it per mode. User and password are the
  `helpers/config.ts` constants.

  ```bash
  ./scripts/e2e-stack.sh up --wait sshd
  ```

- The specs run at a 1600 x 1000 viewport and collapse the sidebar and the
  Variable Manager so three control instances fit on the canvas at a usable
  zoom.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/canvas-lanes/<spec>`.
2. Each case seeds a Test through `POST /tests` holding only what is not under
   test: the configured control (three instances, one per way of building a
   link), a For around each instance so the three run in one pass, the Logs a
   drag lands on, and the counter or failing block a lane Log links on to.
3. It clears the workbench session, opens the Test, picks the shared
   environment and fits the canvas.
4. Drop: a Log is dropped from the palette just below a lane dot. Controls with
   two lanes take both drops at the same point under the first dot (the first
   drop takes the first lane, the second the next free one); wider controls
   take one drop under each dot, in drawing order.
5. Quick Insert: with the control selected, Ctrl+Space, `log`, Enter, once per
   lane; each insert takes the next free lane in drawing order.
6. Drag: a link is dragged from each lane dot to a seeded Log.
7. The Logs made by drop and Quick Insert get their text through the config
   sheet. A lane Log that must lead on (the While body and the Wait Until retry
   lane to a counter, a Try/Catch try path to a failing block) gets that link
   dragged from its own exit dot.
8. It presses Save, reads the saved Test (`GET /tests/{id}`), presses Run and
   reads the console, then deletes the Test.
9. Single-exit blocks and the lane controls fresh from the palette are not
   configured, so they are disabled before Save (a disabled block's required
   settings are not checked) and nothing is run; the lane targets there are
   Halt blocks, which need no settings.

## Validation

- **Drawn:** every link is on the canvas as `Edge from <control> to <Log>` and
  its line starts at the bottom center of that lane's dot (within 2 px).
- **Saved:** the saved Test holds exactly one link from the control to each
  lane Log, and its `sourceHandle` is the lane (`branch_0`, `retry`, `then`,
  ...; none for a single exit). The control holds exactly one link per lane.
- **Run:** the run passes and the console holds exactly the lane texts the lane
  logic predicts, each as many times as it runs:
  - If/Else inside a For of 2 or 3 rounds: one branch per round (the if-only
    If/Else takes its branch once and ends the round when nothing matches).
  - Assert split over 2 rounds: pass once, fail once. Assert single: its exit
    once.
  - Switch with two cases whose Break is off: case 1, case 2, the default and
    then, once each.
  - For (count 2), For Each (two items), While (counter below 2): the body Log
    twice and then once.
  - Wait Until Retry (condition: counter at 2, the retry Log leads to the
    counter): the retry Log once per round (twice) and then once. Wait Until
    Watch: its exit once.
  - Try/Catch with catch: the try Log, then the failing block, the catch Log
    and then; with finally also the finally Log; finally only (nothing fails):
    try, finally and then.
  - Parallel: every branch Log and then once.
  - Remote Execution on `sshd`: the body Log and then once.
  - Halt: no exit dot; a drop below it and a Quick Insert after it place a Log
    with no link; nothing is saved from it; the run logs only the block before
    it.
- **Single exit:** a drop below the exit links the block; a second drop beside
  it adds no second link; the saved Test keeps the one link with no lane name.
- **Palette defaults:** If/Else `branch_0`, `branch_1`; Switch `branch_0`,
  `then`; Assert `pass`, `fail`; For, For Each, While and Remote Execution
  `body`, `then`; Parallel `branch_1`, `branch_2`, `then`; Try/Catch `try`,
  `catch`, `then`; Wait Until `retry`, `then`; Halt none. The first lane takes
  a drop, the rest take Quick Inserts in that order.
- **Lanes taken away:** removing a Parallel branch removes its lane and its
  link while the other lanes keep theirs.
