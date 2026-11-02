# Remote session lifecycle - functional E2E

Proves WAVE closes SSH sessions on a full run's clean end but keeps them live after ad-hoc runs
and after an Immediate Stop. Reuses `../remote-standalone/fixture.json` against the real-service
stack.

## Pre-requisites
- E2E stacks up; real-service stack up (`sshd` :9445 + internal `http-target`); shared env
  `E2E Execution Env`.

## Execution
Imports the shared fixture (SSH host injected per mode), then drives full runs, a breakpointed
debug run with Immediate Stop, and ad-hoc Run Current.

## Validation
- T5: a full run executes the body on the host (real 200 from the stack-only `http-target`
  replayed from the worker log), then DRAINS the session at clean end - a follow-up Run Current
  on the remotable body block then FAILS (a live session would have passed).
- T6: a breakpoint on the container pauses the debug run after the session opened; Immediate Stop
  ends the run ("stopped") but KEEPS the session - a follow-up Run Current on the remotable body
  block runs ON THE HOST over the surviving session.
