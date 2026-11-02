# V-CTRL-TRYCATCH: Try/Catch/Finally Control End-to-End

Verify the Try/Catch container behaves the way the control promises across every
combination of its three paths: the try path runs, a failure inside it is caught
when a catch path exists and suppressed when it does not, a finally path runs
either way, and the flow always leaves through the `then` egress so the chain
behind the block keeps going. Also covers the debug consequence of the scoped
walker - a Step Over inside a try path ends on that path's next block rather
than running away or never ending.

## Prerequisites

- Backend and frontend running (standard functional-stack ports)
- Shared execution environment (`ensureEnvironment` creates it if absent)
- No external service: Try/Catch opens no protocol, so nothing from
  `tests/e2e/services/` is required
- `fixture.json` - eight chained Try/Catch blocks, one per permutation of
  try OK/FAIL x catch on/off x finally on/off, bookended by `before-all` and
  `after-all` so a broken egress breaks the chain instead of passing silently
- `fixture-step-over.json` - one Try/Catch whose try path is two Logs
  (`tso-try-1`, `tso-try-2`), with a catch path and a `then` egress
- `fixture-catch-sees-error.json` - one Try/Catch whose try path raises; the
  catch path snapshots the control's own `error` and `caught` outputs into
  `catch_saw_error` / `catch_saw_caught` before logging, so a post-run variable
  read shows what the handler could see while it was running

## Isolation on the shared stack

Each spec imports its own Test through `POST /tests` and asserts only on that
run's console and node statuses. No server state is reset and no other shard is
affected.

## Steps

1. Import the fixture via `POST /tests` and confirm `POST /tests/{id}/validate`
   reports zero errors
2. Open the test in the workbench, pick the shared environment, press Run
3. Read the console log once the session reaches a terminal state
4. For the step case: import `fixture-step-over.json`, set a breakpoint on
   `log-tso-try-1`, Debug with pause-on-first off, press Step Over, then Continue

## Validation

- **F1 try OK, catch on, finally off:** `f1-try` logs, `f1-catch` does not
- **F2 try OK, catch off, finally off:** `f2-try` logs
- **F3 try OK, catch on, finally on:** `f3-try` and `f3-finally` log,
  `f3-catch` does not
- **F4 try OK, catch off, finally on:** `f4-try` and `f4-finally` log
- **F5 try FAILS, catch on, finally off:** `f5-catch` logs and the engine log
  carries `Try-path error caught`
- **F6 try FAILS, catch off, finally off:** the error is suppressed and the chain
  carries on - proved by the F7 / F8 markers and the `after-all` bookend
- **F7 try FAILS, catch on, finally on:** `f7-catch` and `f7-finally` log
- **F8 try FAILS, catch off, finally on:** `f8-finally` logs, the error stays
  suppressed
- **Session outcome:** `passed`, with `before-all` and `after-all` bookending the
  run
- **Catch reads the error (KNOWN-FAILING, unfixed defect):** per REQ-3.2.2.6 the
  handler runs with the structured error object in scope, so `catch_saw_error`
  must carry the `ZeroDivisionError` and `catch_saw_caught` must be true. Today
  the control binds both outputs only after the catch chain finishes, so the
  handler reads the pre-run values (`None` / `false`) and this case fails.
- **Step Over inside a try path:** the stepped block has run (`tso-try-1` logged)
  and the pause sits on `log-tso-try-2` before it runs; Continue finishes the try
  path and leaves through `tso-then`, with `tso-catch` never running because
  nothing failed
