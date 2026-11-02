# SSH Session "Via parent session" + jump isolation - functional E2E

Proves that chaining a child SSH session through a parent is OPT-IN via the `use_parent` checkbox,
so a stale/unresolved parent can never silently connect direct (a routing/security bug) - and that
a via-parent chain REALLY routes through the jump host.

## Pre-requisites
- Real-service stack up (see `tests/e2e/services/README.md`): main `sshd` (:9445) and the
  `nested-sshd` host, which has NO published port - reachable only through the jump.
- Shared env `E2E Execution Env`. SSH hosts carry the `127.0.0.1` sentinel, rewritten by
  `injectServiceHost` per mode; the `nested-sshd` service name is left as-is (in-stack DNS).

## Execution
Imports `fixture.json`, validates, runs it (try/catch guards the two intentional failures).

## Validation
- `open-a` connects direct (hop 1).
- `use_parent` ON with an unresolved parent FAILS `Parent SSH session is not open or not connected`
  and never connects direct (`bad_conn=False`); the error is caught.
- `use_parent` OFF with a stale parent value present connects DIRECT (hop 1, not 2) - the checkbox,
  not the field, decides.
- `use_parent` ON + parent A reaches the nested host: `via-parent-nested connected=True hop=2
  host=nested-host` (`hostname` ran on the far end).
- The SAME host WITHOUT the parent fails (caught): `direct-nested-caught conn=False` with the
  plugin's real `SSH connection to nested-sshd:22 failed` error - proving the via-parent traffic
  went through the jump, not direct.
- Session outcome passes (only the guarded failures occur).
