# V-PLUGIN-NETCAT-LOCAL-FUNCTIONAL: Netcat on the WAVE server

End-to-end proof that the Netcat block checks and talks to real TCP and UDP
ports from the WAVE server: TCP and UDP Check, a Range under both pass rules
and with no port succeeding, Talk with Text, File and Nothing, Talk over UDP, a
capped reply, a Range Talk, a missing payload file, Record and continue, and
Fail the block (REQ-3.3.4.3, REQ-3.4.1.9).

## Prerequisites

- The real-service stack is running (see `tests/e2e/services/README.md`):
  `netcat-echo` (TCP echo 9470, UDP echo 9471, UDP silent sink 9472) and
  `sshd` (9445, sends an `SSH-2.0-` banner on connect).
- Nothing listens on port 9479. The blocks that dial it use Host `localhost`,
  so they stay on the WAVE server's own loopback in every mode, where the
  operating system refuses them with `Connection refused`.
- Blocks aimed at `netcat-echo` or `sshd` carry the `127.0.0.1` sentinel; the
  import helper (`injectSsh`) rewrites it to the SSH gateway per mode.
- `netcat-payload.txt` is uploaded into the test's own Test Data by the spec;
  nothing is seeded beforehand, so `netcat-no-such-payload.txt` does not exist.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/netcat/v-plugin-netcat-local-functional.spec.ts`.
2. The spec clears the workbench draft, imports `fixture.json` via `POST /tests`
   with `injectSsh` and opens it in the workbench.
3. It uploads `netcat-payload.txt` to the root of the test's Test Data, then
   validates with `POST /tests/{id}/validate?context=run` (zero errors).
4. It selects the shared E2E environment, presses Run and waits for the
   bookend `netcat-local-done`, then reads the console and the session
   variables and deletes the imported test.

## Validation

- **Session outcome:** passed; the bookend line `netcat-local-done` is logged.
- **TCP Check open (9470):** Success true; one Results row `9470, tcp, open`,
  empty reason, whole-number `time_ms`; console `Checking {host} port 9470 over TCP`
  and `Port 9470/tcp open`.
- **TCP Check closed (9479, Record and continue):** Success false, Reason
  `Closed`, Results reason `Connection refused`, Error
  `Port 9479 on localhost is closed: Connection refused`; WARN
  `Netcat failed (Closed): {message}`; Results holds the closed row.
- **Range `9479, 9470`:** One succeeds passes on 9470, the port written
  second; All succeed (Record and continue) fails with Reason
  `NotAllSucceeded` and `1 of 2 ports on {host} did not succeed: 9479 {state}`;
  both Results hold 9479 then 9470, the written order and not ascending, and
  9470 is `open`. The state of 9479 is not asserted: it is dialed through the
  gateway.
- **Timeout floors:** a `time_ms` that must reach a Timeout may fall short of
  it by at most 1 ms, because the server's event loop keeps time in whole
  milliseconds.
- **UDP Check:** 9471 `open`; 9472 `open or filtered` with
  `No reply within 2 seconds` and `time_ms` reaching the 2-second Timeout,
  Success true and Error and Reason empty; 9479 on
  `localhost` `closed` with `Connection refused`, recorded with Reason `Closed`.
- **Talk Text, CRLF line endings on:** the reply is exactly
  `alpha\r\nbeta\r\ngamma\r\n`, `Sent 20 bytes, received 20 bytes`, the
  downstream Assert `CRLF reply exact` passes, Results carries the `reply`
  column, and `time_ms` is at least the 2-second Timeout (the reply ends on
  silence).
- **Talk File, Close after sending on:** the reply equals `netcat-payload.txt`
  byte for byte and ends before the 5-second Timeout (the echo closes).
- **Talk Nothing to sshd 9445:** the reply starts `SSH-2.0-`;
  `Sent 0 bytes, received {n} bytes`.
- **Talk Text over UDP (9471):** Reply and the Results `reply` cell are the
  Text `nc-udp-talk-ping`; `Sent 16 bytes, received 16 bytes`; `time_ms` is at
  least the 2-second Timeout (the reply ends on silence).
- **Max reply size 5 (9470):** the Text `alpha beta gamma delta` goes out and
  Reply and the `reply` cell are `alpha`; `Sent 22 bytes, received 5 bytes`,
  WARN `Reply from port 9470 stopped at 5 bytes`, `time_ms` under the 5-second
  Timeout, and the block passes.
- **Range Talk `9470`:** the Results `reply` cell is the Text
  `nc-range-talk-ping`; `Talking to 1 ports on {host} over TCP` and
  `1 open of 1`.
- **Range `9479` on `localhost`, One succeeds (Record and continue):** Reason
  `NoneSucceeded`, Error `No port on localhost succeeded (1 checked)`, Results
  holds the `closed` row with `Connection refused`.
- **Talk File `testdata://netcat-no-such-payload.txt` (Record and continue):**
  Reason `StartFailed`, Error
  `Payload file not found: testdata://netcat-no-such-payload.txt`, Results and
  Reply empty, and only the start line and the Record WARN line are written.
- **Fail the block inside Try/Catch:** the Netcat block paints failed;
  ERROR `Block 'TCP check closed fail' failed: Port 9479 on localhost is closed: Connection refused`;
  the caught error carries the same message, no Record WARN line is written,
  and the catch path logs `nc-fail-caught {message}`.
- **Block states:** the five recorded blocks (TCP closed, Range All succeed,
  UDP closed, Range with none succeeding, missing payload file) paint the
  warning state, `TCP check closed fail` paints failed, and every other block
  succeeds, the capped Talk included.
- **Bindings:** every bound value is echoed by a downstream Log block, and no
  Netcat console line carries payload or reply bytes.
