# V-PLUGIN-NETCAT-TUNNEL-FUNCTIONAL: Netcat through SSH tunnels

End-to-end proof that Netcat on the WAVE server tests the far port of an open SSH
tunnel instead of the tunnel's own local listener, talks through the tunnel, reports
a refused far port with the SSH server's words, and refuses UDP to a tunnel's Local
Port (REQ-3.3.4.3, REQ-3.4.1.9; NETCAT-9, NETCAT-18).

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`):
  - `sshd` (:9445) - the SSH session behind both tunnels.
  - `netcat-target` - internal-only, no published port, so it is reachable only
    through a tunnel: TCP echo on 9470, nothing listening on 9479.
- `fixture.json` is imported via `POST /tests` with `injectSsh` and validated via
  `POST /tests/{id}/validate?context=run` (zero errors) before the run. The SSH
  session carries the `127.0.0.1` sentinel the import rewrites per mode; every
  Netcat Block dials Host `localhost`, which is never rewritten. The SSH password
  comes from the secret test variable `ssh_pwd`.
- Both tunnels take an auto-assigned Local Port, so parallel shards never collide.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/netcat-tunnel/v-plugin-netcat-tunnel-functional.spec.ts`.
2. The spec checks the fixture's SSH, tunnel and Netcat targets against the
   `helpers/config.ts` constants, clears the workbench draft, imports and
   validates the fixture, and opens it in the workbench.
3. It selects the shared E2E environment, presses Run and waits for the bookend
   `netcat-tunnel-e2e-done`.
4. It reads the console and the session variables the run left behind, then
   deletes the imported Test.

## Validation

- **Session outcome:** passed. Every Block succeeds except the four Record and
  continue Netcat Blocks (the refused far port, the two UDP checks and the check
  after the tunnel closed), which end amber (`warning`).
- **Tunnels:** `nct-session connected=True`; the two tunnels bind distinct Local
  Ports greater than 0 (`nct-tunnels echo={p} far={q}`) and distinct handles.
- **TCP Check through the tunnel:** Success `true`; Results columns `port`,
  `protocol`, `state`, `reason`, `time_ms` and one row `{p}`, `tcp`, `open`, empty
  reason, integer `time_ms`. Between `Checking localhost port {p} over TCP` and
  `Port {p}/tcp open` the INFO line
  `SSH tunnel detected on local port {p}: testing netcat-target:9470 from {ssh_host}`,
  where `{ssh_host}` is `SSH_TARGET_HOST`.
- **Talk Text through the tunnel:** Reply and the Results `reply` cell equal the
  Text exactly; `Sent {n} bytes, received {n} bytes` follows the tunnel line; with
  Close after sending, `time_ms` stays under the 5 second Timeout.
- **Refused far port (9479):** `Port {q}/tcp closed: Connection refused` after the
  tunnel line `... testing netcat-target:9479 ...`, where `Connection refused` is
  OpenSSH's refusal text. Success `false`, Reason `Closed`, Error
  `Port {q} on localhost is closed: Connection refused`, one WARN line
  `Netcat failed (Closed): Port {q} on localhost is closed: Connection refused`, and
  Results keeps the measured row.
- **UDP to a tunnel Local Port:** after `Checking localhost port {p} over UDP`, one
  WARN line `Netcat failed (Tunnel): SSH tunnel detected on local port {p}: SSH tunnels carry TCP only, so UDP cannot go through one`;
  Reason `Tunnel`, Results empty, no `Port {p}/udp` line.
- **UDP Range `9479, {higher}, {lower}`:** the two tunnel Local Ports are written
  higher first, so the written order is never ascending.
  `Checking 3 ports on localhost over UDP`, then the same refusal naming the higher
  Local Port, the first tunnel port in written order; Results empty and no Range
  summary line. When the echo tunnel holds the higher Local Port, both UDP
  refusals read the same, so that WARN line appears twice in the run.
- **After the tunnel closes:** a Check of `{p}` writes no tunnel line (the tunnel
  line for `{p}` appears exactly twice in the run) and ends `closed` with the
  operating system's reason `Connection refused`; Reason `Closed`.
- **Cleanup:** both tunnel closes return `true`, the session close lists the one
  session, and the run ends on `nct-closes far=True sessions=1 netcat-tunnel-e2e-done`.
