# Remote Execution container - functional E2E

Proves the Remote Execution container's mixed-locus body against the real-service stack
(`tests/e2e/services/`): the pushed pure-Python bundle really runs under the sshd host's python3.

## Pre-requisites
- Backend + frontend E2E stacks up; real-service stack up (`scripts/e2e-stack.sh up --wait`):
  `sshd` (:9445) and the internal `http-target` service.
- Shared env `E2E Execution Env`.

## Execution
Imports `fixture.json` via `POST /tests` (SSH host injected per mode), validates (zero errors),
opens it in the workbench, runs it.

## Validation
- Workflow passes.
- The execution host is real: `hostname` over the session returns `wave-e2e-host`.
- The remotable HTTP body block ran ON THE HOST: its URL names `http-target`, resolvable only
  inside the stack network - the real 200 + real `"status":"healthy"` body prove the bundle's
  urllib executed on the host; the worker's captured log (`HTTP 200 http://http-target:9444/api`)
  is replayed into the run.
- The non-remotable JSON/Log body blocks ran LOCALLY on WAVE (bound result present).
- A registered secret used in the flow is masked (`secretcheck=********`), never cleartext.
- The container binds a Remote Session ID (32-hex) and runs its `then` branch.
- An HTTP block OUTSIDE the container runs locally (real httpx GET of the backend health,
  unreachable from the sshd host).

## TLS parity - `v-plugin-remote-exec-tls-functional.spec.ts`

Proves a remote HTTP body block verifies and negotiates TLS like a local one (PERM-5, PERM-10,
PERM-18 and a remote version pin) and trusts what Settings > Network > Certificates trusts (REQ-4.5.16). Needs
`sshd`, the internal `http-target` service and `tls-lab`. `resetNetworkSettings` runs before and
after each test, so a blank CA starts from the built-in list and no Additional Certificates.

- `fixture-tls.json` (CA from `CA_CERT_PEM`, client identity from `TLS_LAB_CLIENT_*`): verify-on
  with the CA reaches `http-target:9443` (200); mutual TLS at TLS 1.3 to `tls-lab:9451` binds the
  client DN; redirects off surfaces 302; a 1.2 pin negotiates against the tls12 listener; a
  GET-with-body + Basic auth reaches the server; the response cookie, auth password and client
  key never appear in cleartext.
- `fixture-tls-noca.json`, nothing saved in Settings: verify-on with a blank CA fails with
  `Certificate verification failed: no trusted issuer found for certificate ...` in the replayed
  console; the run fails and the remote block is painted failed.
- `fixture-tls-noca.json` after `PATCH /network/certificates` adds the WAVE Test CA
  (`CA_CERT_PEM`) to Additional Certificates: the same blank-CA block reaches
  `http-target:9443` (bound status 200), the run passes, and the replayed console, set to DEBUG
  before the run, holds exactly one trust line, at DEBUG: `Trusting WAVE's built-in certificate
  list ({label}) and 1 additional certificate` - the certificates traveled with the run to the
  remote host.

## Containers inside sub-flows - `v-plugin-remote-exec-nested-functional.spec.ts`

Proves a Remote Execution container runs on the host wherever a container can sit (REMEX-1,
REMEX-4). Imports `fixture-nested.json` (token in the Test name, SSH host injected, zero run
validation errors) and runs one Test on the `sshd` host, reading only `/etc/hostname`:
a top-level Shell Script binds WAVE's `hostname`, SSH Session Exec binds the host's, then
containers sit in a Try/Catch try path, a Parallel lane, a Switch/Case branch and a For Loop body
(count 2), each body reading `/etc/hostname` with File I/O into its own variable. The loop
container's `then` Log prints a per-iteration marker. `afterAll` deletes the Test.

Validation:
- No console entry contains `Plugin remote-execution`; the run passes.
- Every body's host name (trimmed) equals the one SSH Session Exec read and differs from WAVE's.
- The loop marker's INFO line appears exactly twice (`iter=0`, then `iter=1`), read in the
  console's own row order.

## Secrets canary - `v-plugin-remote-exec-secrets-functional.spec.ts`

Proves each remote body block routes through the same secret protection as a local block.
Imports `fixture-secrets.json` (+ `profile-secrets.json`) and runs a container whose body HTTP
blocks hit the internal `http-target` service's canary endpoints: `/secret-payload` plants a
secret in the response body; `/cookie` issues a Set-Cookie credential header. Both canary
values are the service's server-side defaults so they never ride a request URL.

Validation:
- A marked-secret remote OUTPUT (`output_secret_fields: ["body"]`) masks in the block's DEBUG
  Outputs echo, the console (`bodycheck=********`) and the session variables (`rx_body`).
- The remote HTTP response Set-Cookie header masks (WAVE-side response-cred registration, B4c).
- A profile credential used over the remote path masks in the request URL, including in the
  worker's own replayed log line (`secret-payload?tok=********`).
- None of the three canaries appears in cleartext in the console, WS stream, report or on disk.

## SQL block on the remote host - `v-plugin-sql-remote-functional.spec.ts`

V-PLUGIN-SQL-REMOTE-FUNCTIONAL. Proves the SQL block runs inside a Remote Execution body on
the `sshd` host with nothing installed there (REQ-3.4.1.6, REQ-5.1.4; SQL-8, SQL-15). Needs
`sshd`, `postgres`, `mariadb`, `oracle` and `mssql`. Imports `fixture-sql.json` (the spec
replaces `__TOKEN__` with a per-run token for the table `sqlrem_<token>`, the `:tag` value, the
SQLite artifact file `sqlrem-<token>.db` and the remote folder `sqlrem-<token>`, fills `ca_pem`
from `CA_CERT_PEM` and every SQL block's blank Password from `SQL_STACK_PASSWORD`, and rewrites
the SSH and direct-leg hosts per mode), validates it (zero errors), opens it and runs it.

Before the body, on WAVE: an SSH Session Exec makes this run's folder under the remote
account's home, a SQLite block (`SQLite on WAVE`) runs on an artifact file, and a SQL block
saved with no Database type (`No Database type on WAVE`) dials PostgreSQL over the direct leg.
The body reaches the databases by compose names only `sshd` resolves, in this order:
PostgreSQL, MariaDB, a block with no Database type (`No Database type remote`) and SQL Server
with TLS off (`SQL Server TLS off`), all four with drivers carried as source; a Python block
that lists the wheels unpacked so far; a SQLite block (`SQLite remote`) on a file in the run's
remote folder and a second Python block; then Oracle and SQL Server (verified TLS) with their
wheels and a third Python block. The five named SQL blocks are told apart by their console
Source (`SQL : {Name}`, EXEC-25); the others keep the Source `SQL`. After the body the Test
removes its remote folder; `afterEach` deletes the Test. A run that fails before that step
leaves `sqlrem-<token>` in the remote home until the stack is recreated.

No case here for an Execution Host outside the carried Python / CPU / libc set, nor for one
that cannot load the bundled SQLite (glibc older than 2.28): the stack holds no such host, and
the backend unit tests prove both Unsupported messages.

Validation:
- The run passes, every block succeeds, and every body block carries the R locus badge.
- Over SSH the host lists none of `pg8000`, `pymysql`, `pytds`, `oracledb`, `OpenSSL`,
  `cryptography`, `apsw` as installed, and its own Python reports another SQLite version than
  the one the SQLite blocks connect with.
- SQLite: both blocks log one `Connected to SQLite {version} at {file}` line with the same
  version (on WAVE the run's artifact file, in the body `{remote folder}/remote.db`), and
  `SELECT sqlite_version()` returns that version beside the bound `:tag` (Rows changed 1).
- No Database type: the saved Test holds no `database_type` key on either block; on WAVE the
  block logs `Connected to PostgreSQL {version} at {host}:{port}` on the direct leg, in the
  body `... at postgres:5432` with the remote host as the client.
- Each body SQL block logs one `Connected to {database} {version} at {service}:{port}` line and
  its row reports the remote host's own address (`hostname -I`) as the client. PostgreSQL
  returns the bound `:tag` and the literal row (Row count 2, Rows changed 2); Oracle returns
  service `freepdb1` and the bound `:tag`; SQL Server reports `encrypt_option` `FALSE` with TLS
  off and `TRUE` over TLS.
- After PostgreSQL, MariaDB, the block with no Database type and SQL Server with TLS off the
  worker's scratch dir holds no wheel; right after the SQLite block it holds `apsw` alone, and
  every apsw build tag matches the host's Python tag and CPU on manylinux (glibc); after Oracle
  and SQL Server the same dir holds `apsw`, `cffi`, `cryptography`, `oracledb`, `pyopenssl` and
  `typing_extensions`, and every oracledb build tag matches too, as read over SSH.
- On WAVE a Log reads the outputs (`sqlrem-outputs pg=2/2 ...`) and a direct-leg SQL block reads
  the two rows written on the remote host back, then drops the table.
- After the body the scratch dir leaves the host (`worker_gone` is `gone`) and nothing is left
  where its wheels stood (`builds_left` is `0`); the SQLite file the body wrote is on the remote
  host until the run removes its folder (`lite_folder` is `present removed`); the run ends on
  `sqlrem-worker=gone sessions=1 sql-remote-e2e-done`; the database password never appears on
  the console.

## OpenSearch block on the remote host - `v-plugin-opensearch-remote-functional.spec.ts`

V-PLUGIN-OPENSEARCH-REMOTE-FUNCTIONAL. Proves the OpenSearch block runs inside a Remote Execution
body on the `sshd` host with nothing installed there (REQ-5.1.2, REQ-3.4.1.15, REQ-3.4.1.3; OS-14,
OS-11, OS-8, OS-10). Needs `sshd` and `opensearch`.
`beforeAll` seeds F-LOGS (`wave-e2e-<token>-app-logs`) and S-SLOW (`wave-e2e-<token>-slow`) and
calibrates the slow query to 3 to 5 s; `afterAll` deletes `wave-e2e-<token>-*` and the Test.
The spec imports `fixture-opensearch.json` (it replaces `__TOKEN__`, fills every body block's
blank Password and CA Certificate from `OPENSEARCH_PASSWORD` and `CA_CERT_PEM` and the slow
block's Query with the calibrated query; the SSH host is rewritten per mode), validates it (no
repairs, zero errors and warnings), sets the console to DEBUG and runs it. The body dials
`https://opensearch:9200`, a name only `sshd` resolves.

Validation:
- The run passes; every body OpenSearch block carries the R locus badge and nothing else does;
  every block succeeds except the timed-out Search, which ends amber.
- Over SSH, `python3 -c "import opensearchpy"` exits 1 with
  `ModuleNotFoundError: No module named 'opensearchpy'`.
- REMOTE-SEARCH: one INFO line `Search ... 6 results, 6 kept, {s} s`, the `_field_caps` and
  `_search` DEBUG requests replayed from the host, Total results 6 and the six ERROR documents
  newest first; a Log on WAVE after the body reads them (`os-remote-search total=6 first=...`).
- REMOTE-AGG: errors per minute (Group by time 1 minute, Count, DQL `log.level: "ERROR"`) give
  Results `@timestamp, count` with the rows 2, 0, 4, 0, 0 for 10:00 to 10:04 and Total results 6.
- REMOTE-TIMEOUT: the slow search with Timeout 2 and Record and continue gives Reason `Timeout`,
  Error `Timed out after 2 seconds; the connection was shut down, so OpenSearch ends the search`
  and one WARN line; the cluster's search task is canceled or gone within 5 s of running and is
  listed as canceled (a search that finishes on its own is never marked so).
- NO-LEAK: each body block echoes its inputs with the password masked, and neither `os-secret`
  nor the Basic credential appears on the console, DEBUG included.
- The session close lists the one session and the run ends on
  `os-remote-closes sessions=1 os-remote-done`.
