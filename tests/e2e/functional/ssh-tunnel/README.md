# V-PLUGIN-SSH-TUNNEL-FUNCTIONAL: SSH Tunnel pair

End-to-end proof that the SSH Tunnel Open / Close plugins forward traffic
through an open SSH session to a REAL remote-only destination, report every
refused forwarded connection, and check the destination at open when Validate
Target is on (REQ-3.4.1.3 / REQ-5.1.5; SSHTUN-6, SSHTUN-7, SSHTUN-8, SSH-10).

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`).
  The tunnel destination is the internal `http-target` service (:9444 in-stack,
  NO published port) - reachable only through the tunnel. The closed-port
  destination is `netcat-target:9479` (nothing listens). The no-fwd cases use
  the `sshd-no-fwd` host (:9448, `AllowTcpForwarding no`).
- The late-start and one-shot destinations are `python3` processes the run
  starts on the `sshd` host through SSH Session Exec, on ports picked at run
  time and stopped by `timeout 120`.
- `fixture.json` is imported via `POST /tests` and validated via
  `POST /tests/{id}/validate?context=run` (zero errors) before the run. SSH
  hosts carry the `127.0.0.1` sentinel, rewritten by `injectServiceHost` per mode.
  `{ssh_host}` below is that injected value (`SSH_TARGET_HOST`); `{p}` is a
  tunnel's Local Port output.

## Steps

1. Run `./scripts/e2e-targeted-local.sh functional/ssh-tunnel/v-plugin-ssh-tunnel-functional.spec.ts`.
2. The spec checks the fixture's destinations against the `helpers/config.ts`
   constants, imports `fixture.json` and validates it (zero errors).
3. Secret round-trip guard: `GET` then `PUT` the test so the masked secret
   password is saved once before running.
4. Open in the workbench, select the shared E2E environment, and Run.
5. Read the console and the session variables.

## Validation

- **Session outcome:** passed (the only failures are the seven guarded probes).
- **Secret survives the save:** `session opened connected=True` and no
  `Permission denied` in the logs (proves the save round-trip did not clobber
  the secret-variable password to `********`).
- **Fixed tunnel:** `tunnel-fixed tid=tunnel_... lport=19446` and
  `http-fixed status=200` with a body containing `"status":"healthy"` - the
  response of a service WAVE cannot reach directly (real forwarding proof).
- **Auto-assign tunnel:** `tunnel-auto` reports a resolved `lport` greater
  than 0 and different from 19446, a distinct `tunnel_` handle, and
  `http-auto status=200` with the health body.
- **Close:** `close-fixed closed=True close-again closed=False` (explicit close
  then idempotent re-close).
- **Post-close refusal:** a GET through the closed 19446 is caught -
  `post-close-caught request-refused` with the real `Connection refused` error
  in the bound output.
- **Closed port (default):** the tunnel to `netcat-target:9479` opens; its GET
  is caught with `Server disconnected without sending a response`; one WARN
  `Connection through SSH tunnel 127.0.0.1:{p} to netcat-target:9479 failed: {ssh_host} could not connect (Connection refused)`.
- **Late start (default):** the tunnel to `127.0.0.1:P` opens while nothing
  listens; the first GET is caught with one WARN
  `Connection through SSH tunnel 127.0.0.1:{p} to 127.0.0.1:P failed: {ssh_host} could not connect (Connection refused)`;
  once the HTTP server listens on P (`start=listening`), a GET through the same
  tunnel returns 200.
- **Validate Target, closed port:** Tunnel Open fails with
  `SSH tunnel to netcat-target:9479 failed: {ssh_host} could not connect (Connection refused)`,
  caught, with the console line [WARN] `Try-path error caught: <that message>`;
  no tunnel id is bound.
- **Validate Target, one-shot listener:** the listener accepts one connection
  and stops listening; Tunnel Open with Validate Target opens and the GET
  through it returns 200 `one-shot`, so the GET used the connection the check
  opened.
- **Blank Local Port:** Local Port as a blank expression opens on a port
  greater than 0 and the GET returns 200 with the health body.
- **Local Port None:** Local Port as the expression `None` fails Tunnel Open
  with `'local_port' is null`, caught, with [WARN]
  `Try-path error caught: 'local_port' is null`; no tunnel id is bound.
- **Cascade close:** closing the session flips `conn=False` and reaps the
  still-open auto tunnel, so `close-auto-after-cascade closed=False`.
- **Forwarding disabled (:9448), default:** the listener still opens (no check
  at open) - `tunnel-nofwd tid=tunnel_...` - but traffic through it is caught:
  `nofwd-caught traffic-refused` with the real
  `Server disconnected without sending a response` error, and one WARN
  `Connection through SSH tunnel 127.0.0.1:{p} to http-target:9444 failed: {ssh_host} refused to forward (administratively prohibited)`.
- **Validate Target, forwarding disabled:** Tunnel Open fails with
  `SSH tunnel to http-target:9444 failed: {ssh_host} refused to forward (administratively prohibited)`,
  caught, with [WARN] `Try-path error caught: <that message>`; no tunnel id is bound.
- **Warnings:** the run carries exactly three `Connection through SSH tunnel`
  WARN lines (closed port, late start, no-fwd), each from its Tunnel Open
  block; the failed checks write none.
- **Bookend:** `ssh-tunnel-e2e-done`; every node reports `success` except the
  seven guarded probes (`http-after-close`, `http-nofwd`, `http-closed`,
  `http-late-before`, the two Validate Target blocks `tunnel-vt-closed`,
  `tunnel-vt-nofwd`, and `tunnel-null-port`, which report `failed`).

## V-PLUGIN-SQL-TUNNEL-FUNCTIONAL: the SQL block through SSH tunnels

`v-plugin-sql-tunnel-functional.spec.ts` + `fixture-sql.json`. End-to-end proof that a SQL
block with Host `localhost` on the Local Port of an open SSH tunnel reaches the tunnel's far
database, and that its TLS name check uses the far host (REQ-3.4.1.6, REQ-5.1.4; SQL-15).

### Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`): `sshd`
  (:9445) and the four databases, reached through the tunnels by their compose names
  (`postgres:5432`, `mssql:1433`, `mariadb:3306`, `oracle:1521`) and by two container names
  the database certificate does not list (`wave-e2e-postgres`, `wave-e2e-mssql`).
- The spec replaces `__TOKEN__` in the fixture with a per-run token, so the table it creates
  (`sqltun_<token>`) is its own; the fixture drops it. The CA variable `ca_pem` is filled from
  `CA_CERT_PEM` and every SQL block's blank Password from `SQL_STACK_PASSWORD`. The SSH block and the direct read-back block carry the `127.0.0.1` sentinel
  the import rewrites per mode; every tunneled SQL block dials `localhost`, or the expression
  `'127.0.0.1'`, which the rewrite never touches. Every tunnel takes an auto-assigned Local Port.

### Steps

1. Run `./scripts/e2e-targeted-local.sh functional/ssh-tunnel/v-plugin-sql-tunnel-functional.spec.ts`.
2. The spec checks the fixture's targets against the `helpers/config.ts` constants, clears the
   workbench draft, imports and validates the fixture (zero errors), and opens it.
3. It selects the shared E2E environment, presses Run and waits for `sql-tunnel-e2e-done`.
4. It reads the console and the session variables, then deletes the imported Test.

### Validation

- **Session outcome:** passed. Every block succeeds except the two Record and continue SQL
  blocks behind a container name, which end amber (`warning`).
- **Tunnels:** the session opens with the secret password; six tunnels bind distinct Local
  Ports greater than 0 (`sqltun-tunnels pg=... msx=...`).
- **PostgreSQL (TLS on, Verify Server Certificate on):** one INFO line
  `Connected to PostgreSQL {version} at localhost:{p}`; the row reports the SSH host's own
  address (`hostname -I` over the session) as the client, database `wave`, TLS in use and two
  stored rows; Row count 1, Rows changed 2.
- **Read-back on the direct leg:** the next block, connected at `{SQL_TARGET_HOST}:9473`, reads
  `[1, through-the-tunnel]` and `[2, far-end]` (the bound `:tag` first) and drops the table.
- **SQL Server (TLS on, verified):** connected at `localhost:{p}`, database `wave`, the SSH
  host as the client, `encrypt_option` `TRUE`.
- **MariaDB (TLS on, verified):** connected at `localhost:{p}` as MySQL, database `wave`, the
  SSH host as the client, a `TLSv1.2` or `TLSv1.3` session.
- **Oracle (plain TCP):** connected at `localhost:{p}`, service `freepdb1`, the SSH host as the
  client.
- **Host 127.0.0.1:** a PostgreSQL block whose Host is the expression `'127.0.0.1'` (the
  import rewrite only touches a literal `127.0.0.1`) on the PostgreSQL Local Port connects at
  `127.0.0.1:{p}` through the tunnel with TLS verified, the SSH host as the client.
- **Far name the certificate does not list:** through the tunnel to `wave-e2e-postgres`, Error
  `Could not connect to PostgreSQL at localhost:{p}: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: Hostname mismatch, certificate is not valid for 'wave-e2e-postgres'. ...`,
  Reason `Unreachable`, Success `false`, one WARN line `Run SQL failed (Unreachable): ...`.
  The certificate lists `localhost`, so this fails only because the far host is the name
  checked. Through `wave-e2e-mssql` SQL Server fails the same way with a
  `certificate verify failed` error.
- **Cleanup:** the session close lists the one session, the run ends on
  `sqltun-closes sessions=1 sql-tunnel-e2e-done`, and the database password never appears
  on the console.

## V-PLUGIN-OPENSEARCH-TUNNEL-FUNCTIONAL: the OpenSearch block through SSH tunnels

`v-plugin-opensearch-tunnel-functional.spec.ts` + `fixture-opensearch.json`. End-to-end proof
that an OpenSearch block whose Cluster URL is `localhost` or `127.0.0.1` on the Local Port of an
open SSH tunnel reaches the tunnel's far cluster, and that its certificate check uses the far
host (REQ-5.1.2, REQ-3.4.1.15, REQ-5.1.5; OS-14, OS-11, OS-10).

### Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`): `sshd` (:9445)
  and `opensearch`, reached through the tunnels by its compose name (`opensearch:9200`) and by
  its container name (`wave-e2e-opensearch:9200`), which the cluster certificate does not list.
- `beforeAll` seeds F-LOGS into `wave-e2e-<token>-app-logs` on the direct leg; `afterAll`
  deletes `wave-e2e-<token>-*` and the imported Test. The spec replaces `__TOKEN__` and fills
  every Search's blank Password and CA Certificate from `OPENSEARCH_PASSWORD` and `CA_CERT_PEM`.
  The SSH block carries the `127.0.0.1` sentinel the import rewrites per mode; each Cluster URL is
  an expression on the Local Port (`url` in `expressionFields`), which the rewrite never touches.

### Steps

1. Run `./scripts/e2e-targeted-local.sh functional/ssh-tunnel/v-plugin-opensearch-tunnel-functional.spec.ts`.
2. The spec checks the fixture against the `helpers/config.ts` constants, imports and validates
   it (no repairs, zero errors and warnings), opens it and sets the console to DEBUG.
3. It selects the shared E2E environment, presses Run and waits for `os-tunnel-done`.

### Validation

- **Session outcome:** passed. Every block succeeds except the Record and continue far-name
  Search, which ends amber (`warning`).
- **Tunnels:** the session opens with the secret password; both tunnels bind distinct Local
  Ports greater than 0 (`os-tunnel-ports near=... far=...`).
- **TUNNEL (`'https://localhost:' + str(lport_os)`, Basic, CA, Verify on):** one INFO line
  `Search wave-e2e-<token>-app-logs from 2026-09-25T10:00:00.000Z to 2026-09-25T10:04:59.000Z: 6 results, 6 kept, {s} s`,
  the `_field_caps` and `_search` DEBUG requests, Success true, Total results 6, and the six
  ERROR documents newest first in Results.
- **LOOPBACK (`'https://127.0.0.1:' + str(lport_os)`):** the same, Total 6.
- **FAR-NAME:** through the tunnel to `wave-e2e-opensearch`, Error
  `Could not connect to OpenSearch at localhost:{p}: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: Hostname mismatch, certificate is not valid for 'wave-e2e-opensearch'. ...`,
  Reason `Unreachable`, Success false, one WARN line `Search failed (Unreachable): ...` and no
  search sent. The certificate lists `localhost`, so this fails only because the far host is the
  name checked.
- **Cleanup and secrets:** the session close lists the one session, the run ends on
  `os-tunnel-closes sessions=1 os-tunnel-done`, each Search echoes its inputs with the password
  masked, and neither `os-secret` nor the Basic credential appears on the console.
