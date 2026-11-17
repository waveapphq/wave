# V-RUNM-*: Live-Execution Mirroring Functional Suite

Verify that the holder's run is mirrored live to every watcher (banner phrase,
reflected environment, progressive console stream, block paint, live variable
values), that assistant-held runs borrow the session with auto-yield and hand
it back silently, that a browsing watcher is a free read-only surface, and
that mirroring is strictly broadcast-only (a watched run leaves exactly the
same record as an unwatched one).

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared E2E environment present (created by `ensureEnvironment` at test start)
- MCP specs enable the listener until-restart on the per-stack port
  (backend port + 765) and drive it through
  `../recipe-authoring/mcp_tool_client.py` in the backend poetry env

## Fixtures

- `fixture.json` - five Log plugins paced by four 1.5s Delay controls plus a
  mid-run Variable Setter (`runm_progress` = `halfway`), so console lines
  arrive at measurably distinct times and a live value change reaches
  watchers. Imported per test with a uniquified name.

## Specs

| Spec | Covers |
|------|--------|
| `v-runm-person-functional.spec.ts` | Person-held run: running-live banner, run env readout vs differing local selection, Focus-Current-only toolbar, progressive arrivals (>= 3 distinct times), mid-run backlog join, paint + live variables, post-run persistence, take-over mid-run via the approval protocol with the run surviving |
| `v-runm-mcp-functional.spec.ts` | Assistant runs: auto-yield with no dialog, a running-live banner naming the client by its title (`Claude Code (MCP)` for a client named `claude-code`), silent hand-back with clean inherit and the environment picker keeping the run's environment, the picker left as it was when that environment is deleted while the run plays, attribution by the client's name (`mcp:claude-code`), dirty-holder refusal (run starts unmirrored), clean-again yields, suites never borrow, synchronous busy-guard conflict in the tool reply, immediate take-over grant against a run-holder that also ends the mirror of the run in a third watching tab, amend convergence (no stale resurrect), watch build binding the new test, the run fitting the whole test in a tab panned away (RUNM-11) |
| `v-runm-parity-functional.spec.ts` | Broadcast-only proof: watched vs unwatched runs of the same test produce identical report log rows, identical history payloads (apart from ids, timestamps and measured durations), and the mirror's live lines equal the Execution History repaint |
| `v-runm-browse-functional.spec.ts` | Browsing watcher: browsing banner + Watch Session pill, holder edits/runs never move the browsed view, Watch Session mid-run attaches into the live run, closing the mirrored test flips to browsing with no snap-back |
| `v-runm-holder-foreign-run-functional.spec.ts` | Holder tab with test A open follows a tracked run of test B started over REST: shows running while it is in flight, then leaves running with B's verdict and offers Run again once B ends |

## Validation

- **Banner phrases:** `read-only, running live` (both holder kinds while a run
  is in flight); browsing reads `Read-only` + `holds the workbench` /
  `is running a test in the workbench`
- **Watcher toolbar during a run:** disabled `Env: <run env>` readout +
  Focus Current only; no Run/Debug/Stop/step controls anywhere
- **Streaming:** row count grows at >= 3 distinct times spread over >= 2s;
  a joiner mid-run receives the backlog; entries persist after the run
- **Ownership:** auto-yield only for a clean idle person holder; dirty holders
  refuse (run proceeds unmirrored); silent hand-back on terminal; suites never
  claim; the busy guard rejects a second start in the tool reply
- **Environment after an assistant's run:** once the session is handed back,
  the tab's environment picker, empty before the run, shows the run's
  environment, enabled; when that environment was deleted through the API
  while the run played, the picker shows what it showed before the run
- **Take Over during an assistant's run:** a third tab that was watching
  stops mirroring the run at the take-over, while the run is still in flight:
  its banner shows a person holder and reads `read-only, updates as they edit`,
  the `Env:` readout is gone and no Stop is offered; the taker offers Run
  again, not a Stop for the assistant's run
- **Parity:** log rows compared on (level, source, message) one-for-one in
  order; history payloads compared on block states, end-of-run variables and
  sequenced log rows
