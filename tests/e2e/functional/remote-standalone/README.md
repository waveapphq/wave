# Remote standalone block routing - functional E2E

Proves Run Current / Run from Here on a single block routes by the same locus rules as a full
container run, against the real-service stack. Shares its `fixture.json` with `remote-lifecycle/`.

## Pre-requisites
- E2E stacks up; real-service stack up (`sshd` :9445 + internal `http-target`); shared env
  `E2E Execution Env`.

## Execution
Each test imports `fixture.json` (SSH host injected per mode), opens it, and drives ad-hoc Run
Current on a specific node.

## Validation
- T1: Run Current on a remotable body block with NO live session FAILS with the session-named
  message (`its SSH session 'sid' is closed or not connected ... Open it first`) and NEVER runs the
  plugin locally (the stack-only URL never surfaces in any log).
- T2: after Run Current opens the session (ad-hoc keeps it live), Run Current on the body block runs
  ON THE HOST: the real 200 from `http://http-target:9444/api` (a name resolvable only inside the
  stack) is replayed from the worker's log.
- T3: Run Current on a remotable block OUTSIDE any container runs LOCALLY (real httpx 200).
- T4: Run Current on a non-remotable body block on its own runs LOCALLY (no session required).
