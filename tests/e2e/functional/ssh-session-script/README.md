# V-PLUGIN-SSH-SESSION-SCRIPT-FUNCTIONAL: SSH Session Script real execution

End-to-end proof that the SSH Session Script plugin pipes a script to a chosen
interpreter's stdin over a live SSH session and that REAL interpreters execute
it (real-service harness, REQ-3.4.1.3 / REQ-5.1.5).

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`).
  The sshd image carries the five interpreters: `/bin/sh`, `bash`, `python3`,
  `perl`, `node` (22). The second test targets the SFTP-disabled host (:9447).
- `fixture.json` is imported via `POST /tests` and validated via
  `POST /tests/{id}/validate?context=run` (zero errors) before each run. SSH
  hosts carry the `127.0.0.1` sentinel, rewritten by `injectServiceHost` per mode.
  Each run replaces `__TOKEN__` with a fresh token.

## Execution

The SAME fixture runs twice: against the main host (:9445) and against
`sshd-no-sftp` (:9447). Both passing proves stdin delivery needs no SFTP
subsystem. Each script node rides the same session and computes a value only
its real interpreter produces.

## Validation (both runs)

- **Session outcome:** passed (the only failure is the guarded timeout).
- **Per interpreter** (real computation, not an echo):
  - `RESULT sh out=42 code=0` (`echo $((6*7))`)
  - `RESULT bash out=42-bash code=0` (arithmetic guarded by `$BASH_VERSION`)
  - `RESULT py out=42 code=0` (`print(6*7)`)
  - `RESULT perl out=42 code=0` (`print 6*7`)
  - `RESULT node out=42 code=0` (`console.log(6*7)`)
- **Missing interpreter:** the real shell 127 - `RESULT missing code=127`.
- **Non-zero exit:** returned, not raised - `RESULT exit code=9`.
- **working_dir:** `script-wd-make` makes `wave-e2e-sss-<token>` under the remote
  account's home and prints its path into `wd_made`; `script-wd` runs `pwd` with
  `working_dir` set to `wd_made` and logs `RESULT wd out=<pwd> made=<wd_made>`;
  the two paths are equal and end with `/wave-e2e-sss-<token>`.
  `script-wd-clean` removes the folder afterwards.
- **Timeout:** `sleep 30` with `timeout=2` raises the plugin's exact
  `Command execution timed out after 2 seconds` (caught; asserted from the
  bound error output).
- **Bookend:** `ssh-script-e2e-done`; every node succeeds except the guarded
  `script-timeout`.
