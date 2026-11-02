# SSH secret masking + declared-credential sealing - functional E2E

The full leak sweep for the SSH Session plugins. A declared credential LITERAL
(password) seals at rest and still authenticates; a passphrase LITERAL seals at
rest; secret-variable carriers for password / private_key / passphrase mask
everywhere. Nothing leaks on any surface.

## Pre-requisites
- Real-service stack up (real OpenSSH `sshd` on :9445, see
  `tests/e2e/services/README.md`); shared env `E2E Execution Env`. The run
  fixture's SSH host is rewritten per mode via `injectSsh` at import.

## Execution
- `fixture.json` (run): SSH Session Open with a declared credential LITERAL password
  (`wave-secret`) + a passphrase LITERAL, plus three secret variables a Log tries to
  print. A leading Delay holds the run so the WS collector subscribes first.
- `fixture-seal.json` (import-only, not run): an SSH Session Open with password,
  private_key and passphrase LITERALS - proves all three declared credential fields
  seal at rest without ever connecting (the canary private_key never reaches asyncssh).

## Validation
- The password literal seals to a `wave:enc:v1:` envelope at rest, is absent in
  cleartext, and still authenticates (no `Permission denied`) - it unseals at run.
- The audit line masks every secret category (`pass=******** key=******** phrase=********`);
  the non-secret sibling stays cleartext.
- The declared credential masks in the DEBUG harness Inputs echo.
- No secret (password / passphrase literals, secret variables) appears in cleartext in
  the console, WS stream, session variables, report, mask/encrypted exports or on disk.
- The seal fixture proves all three declared credential fields (password, private_key,
  passphrase) seal to envelopes at rest.

Secrets crossing into a REMOTE request are covered by `remote-exec/` (api_token).
