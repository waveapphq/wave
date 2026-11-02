# V-PLUGIN-NETCAT-REMOTE-FUNCTIONAL: Netcat inside a Remote Execution body

Proves the Netcat block runs on the remote host when a Remote Execution body
holds it: it checks and talks to `netcat-target`, a service only the remote host
can reach, and its outputs come back to the run. A `testdata://` payload is read
on WAVE and shipped; a plain path is read on the remote host. The same Host
dialed from WAVE does not resolve (REQ-3.3.4.3, REQ-3.4.1.9; NETCAT-1, NETCAT-3,
NETCAT-5, NETCAT-6, NETCAT-7, NETCAT-8, NETCAT-10, NETCAT-13, NETCAT-15,
NETCAT-16, NETCAT-17).

## Prerequisites

- Backend and frontend running on the worker's stack ports, and the shared
  execution environment (`ensureEnvironment` creates it if absent).
- The real-service stack (see `tests/e2e/services/README.md`), two services:
  - `sshd` - the OpenSSH host (127.0.0.1:9445 -> in-stack 22) the Remote
    Execution pushes its worker to.
  - `netcat-target` - internal-only socat listeners: TCP echo 9470, UDP echo
    9471, UDP silent sink 9472. No published port, so only the remote host
    reaches it.

  ```bash
  ./scripts/e2e-stack.sh up --wait sshd netcat-target
  ```

- `fixture.json` - an SSH Session Open (Host `127.0.0.1`, rewritten per mode
  by `injectSsh`), an SSH Session Exec that writes `remote-payload.txt` under a
  per-run folder on the host, then a Remote Execution body of six Netcat blocks
  with Host `netcat-target`:

  | Block | Port | Setup |
  |-------|------|-------|
  | TCP Check | 9470 | Timeout 5 |
  | Talk Text | 9470 | Text `nc-remote-text-ping`, Close after sending off, Timeout 2 |
  | Talk File (Test Data) | 9470 | File `testdata://payload.txt`, Close after sending on, Timeout 5 |
  | Talk File (plain path) | 9470 | File `<run folder>/remote-payload.txt`, Close after sending on, Timeout 5 |
  | UDP Check | 9471 | Timeout 5 |
  | UDP Check | 9472 | Timeout 2 |

  The `then` branch removes the run folder, runs one Netcat block on WAVE
  (TCP Check of `netcat-target` 9470, On error = Record and continue) and logs
  every bound output with one Log block per leg, ending on
  `netcat-remote-done`.
- `payload.txt` - the Test Data payload (two lines, a tab and a two-byte UTF-8
  character; 109 bytes), uploaded into the test's own Test Data after import.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/netcat-remote/v-plugin-netcat-remote-functional.spec.ts`.
2. Load `fixture.json`, check it against the harness constants, and set the
   run folder to a fresh `/tmp/wave-e2e-ncrem-<8 hex>`.
3. Clear the workbench draft, import via `POST /tests` with `injectSsh`, open
   the test in the workbench, and upload `payload.txt` into its Test Data.
4. Confirm `POST /tests/{id}/validate?context=run` reports zero errors.
5. Read the locus badges off the canvas.
6. Pick the shared environment, press Run, and wait for the terminal state and
   the `netcat-remote-done` line.
7. Read the console and the session variables.
8. Delete the imported test.

## Validation

- **Validation:** zero errors after the payload upload.
- **Locus:** each of the six Netcat blocks in the body carries one `R` badge;
  the SSH blocks, the container, the WAVE-side Netcat block and the Log blocks
  carry none, and no `L` badge is painted.
- **Session outcome:** `passed`; every block is successful except the WAVE-side
  Netcat block, painted amber (`warning`).
- **TCP Check:** Success true; Results is one row `9470 | tcp | open | '' |
  time_ms` with the columns port, protocol, state, reason, time_ms;
  `Port 9470/tcp open` on the console.
- **Talk Text:** Reply and the Results `reply` column are exactly
  `nc-remote-text-ping`; `Sent 19 bytes, received 19 bytes`; time_ms is at
  least 2000, because with Close after sending off only 2 seconds of silence
  end the reply.
- **Talk File (Test Data):** Reply and the `reply` column equal `payload.txt`
  byte for byte; `Sent 109 bytes, received 109 bytes`; time_ms is under 5000,
  because Close after sending makes the echo close its side.
- **Talk File (plain path):** Reply is `nc-remote-plain-payload`, the text the
  SSH session wrote on the remote host; `Sent 23 bytes, received 23 bytes`.
- **UDP echo:** Results row `9471 | udp | open | ''`; `Port 9471/udp open`.
- **UDP silent sink:** Success true; Results row
  `9472 | udp | open or filtered | No reply within 2 seconds` with time_ms at
  least 2000; `Port 9472/udp open or filtered: No reply within 2 seconds`.
- **Reach boundary:** the WAVE-side block reads Success false, Error
  `Could not resolve host: netcat-target`, Reason `Unresolved`, and an empty
  Results table; the console carries the WARN line
  `Netcat failed (Unresolved): Could not resolve host: netcat-target`.
- **Console:** `Checking netcat-target port 9470 over TCP` twice (body and
  WAVE side), `Talking to netcat-target port 9470 over TCP` three times,
  `Port 9470/tcp open` four times, and one start line for each UDP port, every
  one from the source `Netcat`.
- **Downstream:** each Log block after the body prints its leg's bound values,
  for example `nc-remote udp-silent success=True state=open or filtered
  reason=No reply within 2 seconds`; the cleanup probe reads `gone` and the
  bookend is `nc-remote cleanup=gone rsid-len=32 netcat-remote-done`.
