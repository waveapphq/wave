# Ping functional suite

Two specs prove the Ping block sends real ICMP echo requests and reports what came
back - on the WAVE server, and on a remote host inside a Remote Execution body
(REQ-3.3.4.4, REQ-3.4.1.9; PING-1 to PING-16, apart from the ICMP-error and
path-MTU reply statuses of PING-15, which none of the three targets produces, and
the documentation half of PING-11, which a unit test covers).

| Spec | Fixture | Proves |
|------|---------|--------|
| `v-plugin-ping-local-functional.spec.ts` | `fixture.json` | Every permutation on the WAVE server |
| `v-plugin-ping-remote-functional.spec.ts` | `fixture-remote.json` | The block runs on the remote host |

## Prerequisites

- Backend and frontend running on the worker's stack ports, and the shared
  execution environment (`ensureEnvironment` creates it if absent).
- Unprivileged ICMP open to the container's own user. Every container WAVE runs
  in carries `net.ipv4.ping_group_range=1000 1000`: the two podman run sites
  (`scripts/ci-playwright-local.sh`, `scripts/e2e-targeted-local.sh`) and the
  `sshd` compose service. Without it every ping fails with the privilege message.
- The real-service stack (see `tests/e2e/services/README.md`), for the remote
  spec only:
  - `sshd` - the OpenSSH host (127.0.0.1:9445 -> in-stack 22) the Remote
    Execution pushes its worker to.
  - `netcat-target` - an internal-only service, so only the remote host resolves
    it. The remote spec pings it by name; that is what makes the run a remote
    proof.

  ```bash
  ./scripts/e2e-stack.sh up --wait sshd netcat-target
  ```

- No service stands up for ICMP itself. The three targets are the dialing side's
  own loopback, the host as WAVE reaches it (`PING_GATEWAY_HOST`: 127.0.0.1 on
  the host, the slirp gateway 10.0.2.2 inside a shard container), and
  192.0.2.1, a TEST-NET-1 address routed nowhere. No test needs internet egress.
- Nothing is shared and nothing is cleaned up: ICMP holds no server state, each
  block pings its own target and asserts on its own outputs.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/ping/v-plugin-ping-local-functional.spec.ts functional/ping/v-plugin-ping-remote-functional.spec.ts`.
2. Load the fixture, check it against the harness targets, and point the one
   gateway block at `PING_GATEWAY_HOST`.
3. Clear the workbench draft, import via `POST /tests`, and open the test in the
   workbench.
4. Confirm `POST /tests/{id}/validate?context=run` reports zero errors.
5. Read the locus badges off the canvas (remote spec only).
6. Pick the shared environment, press Run, and wait for the terminal state and
   the `ping-local-done` / `ping-remote-done` line.
7. Read the console and the session variables.
8. Delete the imported test.

## Validation - local

- **Validation:** zero errors; `POST /tests` reports no repairs.
- **Session outcome:** `passed`. Blocks that answer are successful, blocks under
  Record and continue are amber (`warning`), and the block under Fail the block
  inside the Try/Catch is red (`failed`).
- **Loopback:** Success true; Summary is one row with sent 2, received 2, loss
  0 and four round-trip figures that order min <= avg <= max; two Replies rows,
  each answered, from 127.0.0.1, 64 bytes, a hop limit above zero and a
  round-trip time. The console carries ping's own lines: the PING banner, one
  line per reply, `--- 127.0.0.1 ping statistics ---`, the packets-transmitted
  line and the rtt line.
- **Non-loopback host:** the same, and the Replies row names that host as the
  source. With Log Output off only the summary lines are written.
- **Advanced:** IP version IPv4, TTL, Don't fragment and a Source address the
  server holds all apply and the block still passes; Packet size 0 sends
  `0(28)` bytes and the reply is 8 bytes.
- **No reply:** Success false, Reason `NoReply`, Error `No reply from
  192.0.2.1`; every Replies row reads `timed out` with an empty source; Summary
  loss 100 and no round-trip figures; one warning per unanswered request, and
  the statistics are still written.
- **Pass when:** All replies, At least N replies and At least X% replies each
  pass on the loopback; on the silent host each fails with its own message and
  reason word - `NotAllReplied`, `TooFewReplies`, `RateTooLow`.
- **Timeout:** Reason `Timeout`, Error `Ping did not finish within 2 seconds`;
  fewer Replies rows than Count, because a request the bound never let out has
  no row; Summary counts only what went out; the statistics still reach the
  console.
- **Before any request:** an unresolvable host (`Unresolved`), a forced IPv6
  family the host has no address for (`Unresolved`) and a Source address the
  server does not hold (`Source`) each write only their failure line - no
  banner, no statistics - and leave Replies empty.
- **Fail the block:** the caught error and the ERROR line both read `No reply
  from 192.0.2.1`, and no Record warning is written.
- **Bindings:** every bound output reaches its downstream Log.

## Validation - remote

- **Locus:** each of the three Ping blocks in the body carries one `R` badge;
  the SSH block, the container, the WAVE-side Ping block and the Log blocks
  carry none, and no `L` badge is painted.
- **Session outcome:** `passed`; the two recorded blocks are amber.
- **Remote-only target:** Success true; Summary sent 2, received 2, loss 0; two
  answered Replies rows whose source is the address the remote host resolved,
  which is not the loopback. Ping's own lines are written from the remote host.
- **Remote loopback:** answered, source 127.0.0.1 - the block pings with the
  remote host's own network. That block carries Host `localhost` and IP version
  IPv4, because the SSH host rewrite replaces every `127.0.0.1` Host in the
  fixture and `localhost` is the name it never touches.
- **Record and continue:** the silent host records Reason `NoReply` on the
  remote host too.
- **WAVE side:** the same Host pinged from WAVE fails with `Cannot resolve host
  'netcat-target'` and Reason `Unresolved`. That pair is the remote proof.
