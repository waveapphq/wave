# V-PROFILE-*-FUNCTIONAL: a Profile drives a plugin

End-to-end proof that a Profile's OWN fields configure a real plugin: every
plugin parameter the profile schema has a field for is bound to the profile
rather than typed into the Block, the workflow runs against a real service, and
the assertions are on the execution result. This is not a Log Block echoing a
profile value back, and not an autocomplete assertion on a saved canvas
(REQ-4.7.3, REQ-4.7.7).

The design the five suites are proved against is K8SPROF-7 (a profile type's
fields mirror the plugin that type exists for), K8SPROF-9 (every profile type
whose plugin ships is proven by a real execution), SQL-14 (the database
profile's ten fields) and OS-15 (the opensearch profile's nine fields).

## Case ids

Five suites, one per profile type that has a plugin behind it. Each id is the
spec's `test.describe` title, so a failure names the profile type that broke.

| Case id | Spec | Profile | Target service | Proves |
|---|---|---|---|---|
| `V-PROFILE-SSH-FUNCTIONAL` | `v-profile-ssh-functional.spec.ts` | `profile-ssh.json` | `sshd` (:9445) | host, port, username, password and connect_timeout drive `ssh-session-open` |
| `V-PROFILE-HTTP-FUNCTIONAL` | `v-profile-http-functional.spec.ts` | `profile-http.json`, `profile-http-tls.json` | `http-echo` (:9449), `tls-lab` mtls (:9451) | base_url, timeout, verify_ssl, ca_cert, auth_key, auth_header_name, client_cert and client_key drive `http-client` |
| `V-PROFILE-K8S-FUNCTIONAL` | `v-profile-k8s-functional.spec.ts` | `profile-k8s.json` | `kwok` (:9460) | the eight explicit kubernetes fields drive `k8s-connect` |
| `V-PROFILE-DATABASE-FUNCTIONAL` | `v-profile-database-functional.spec.ts` | `profile-database.json` | `postgres` (:9473) | host, port, database, username, password, verify_ssl, ca_cert, client_cert, client_key and driver_options drive `sql-client` |
| `V-PROFILE-OPENSEARCH-FUNCTIONAL` | `v-profile-opensearch-functional.spec.ts` | `profile-opensearch.json`, `profile-opensearch-token.json`, `profile-opensearch-apikey.json`, `profile-opensearch-cert.json`, and one built on the Profiles page | `opensearch` (:9477), `opensearch-gateway` (:9478) | url, username, password, api_key, bearer_token, verify_ssl, ca_cert, client_cert and client_key drive `opensearch` Searches (Total 6; a wrong profile password gives `AuthFailed`), and a url, username and password profile bound in the Aggregate sheet drives errors per minute (2, 0, 4, 0, 0) |
| `V-PROFILE-SSH-PASSPHRASE-FUNCTIONAL` | `v-profile-ssh-passphrase-functional.spec.ts` | `fixture-ssh-passphrase.json`; the good profile built on the Profiles page, the wrong one by `POST /profiles` | `sshd` (:9445) | host, port, username, private_key and passphrase (a passphrase-protected OpenSSH key) drive `ssh-session-open` with Strict host keys, and SFTP runs on that session |

## Prerequisites

- The real-service stack must be running (see `tests/e2e/services/README.md`).
  The five suites use `sshd`, `http-echo`, `tls-lab`, `kwok`, `postgres`,
  `opensearch` and `opensearch-gateway`.
- No credential or endpoint is committed. Each profile JSON carries an EMPTY
  value for every host-specific or secret field and the spec fills it at load
  from `tests/e2e/helpers/config.ts`:

  | Profile field | Filled from |
  |---|---|
  | `profile-ssh.json` `host` | `SSH_TARGET_HOST` |
  | `profile-ssh.json` `port` | `SSH_MAIN_PORT` |
  | `profile-ssh.json` `username` | `SSH_STACK_USER` |
  | `profile-ssh.json` `password` | `SSH_STACK_PASSWORD` |
  | `profile-http.json` `base_url` | `HTTP_TARGET_HOST` + `HTTP_MAIN_PORT` |
  | `profile-http.json` `ca_cert` | `CA_CERT_PEM` |
  | `profile-http.json` `auth_key` | a TEST-ONLY key declared in the spec |
  | `profile-http-tls.json` `base_url` | `HTTP_TARGET_HOST` + `TLS_LAB_MTLS_PORT` |
  | `profile-http-tls.json` `ca_cert` | `CA_CERT_PEM` |
  | `profile-http-tls.json` `client_cert` | `TLS_LAB_CLIENT_CERT_PEM` |
  | `profile-http-tls.json` `client_key` | `TLS_LAB_CLIENT_KEY_PEM` |
  | `profile-k8s.json` `api_url` | `K8S_API_HOST` + `K8S_API_PORT` |
  | `profile-k8s.json` `token` | `K8S_ADMIN_TOKEN` |
  | `profile-k8s.json` `ca_cert` | `K8S_CA_PEM` |
  | `profile-k8s.json` `client_cert` | `K8S_CLIENT_CERT_PEM` |
  | `profile-k8s.json` `client_key` | `K8S_CLIENT_KEY_PEM` |
  | `profile-database.json` `host` | `SQL_TARGET_HOST` |
  | `profile-database.json` `port` | `POSTGRES_PORT` |
  | `profile-database.json` `database` | `SQL_STACK_DATABASE` |
  | `profile-database.json` `username` | `SQL_STACK_USER` |
  | `profile-database.json` `password` | `SQL_STACK_PASSWORD` |
  | `profile-database.json` `ca_cert` | `CA_CERT_PEM` |
  | `profile-database.json` `client_cert` | `TLS_LAB_CLIENT_CERT_PEM` |
  | `profile-database.json` `client_key` | `TLS_LAB_CLIENT_KEY_PEM` |
  | `profile-opensearch.json` `url` | `https://` + `OPENSEARCH_TARGET_HOST` + `OPENSEARCH_PORT` |
  | `profile-opensearch.json` `username` | `OPENSEARCH_USER` |
  | `profile-opensearch.json` `password` | `OPENSEARCH_PASSWORD` (the per-run WRONG copy gets a wrong password) |
  | `profile-opensearch.json` `ca_cert` | `CA_CERT_PEM` |
  | `profile-opensearch-token.json` `url` | `https://` + `OPENSEARCH_TARGET_HOST` + `OPENSEARCH_PORT` |
  | `profile-opensearch-token.json` `ca_cert` | `CA_CERT_PEM` |
  | `profile-opensearch-token.json` `bearer_token` | `OPENSEARCH_JWT` |
  | `profile-opensearch-apikey.json` `url` | `https://` + `OPENSEARCH_TARGET_HOST` + `OPENSEARCH_PORT` |
  | `profile-opensearch-apikey.json` `api_key` | an API token minted in `beforeAll`, revoked in `afterAll` |
  | `profile-opensearch-cert.json` `url` | `https://` + `OPENSEARCH_TARGET_HOST` + `OPENSEARCH_PORT` |
  | `profile-opensearch-cert.json` `ca_cert` | `CA_CERT_PEM` |
  | `profile-opensearch-cert.json` `client_cert` | `TLS_LAB_CLIENT_CERT_PEM` |
  | `profile-opensearch-cert.json` `client_key` | `TLS_LAB_CLIENT_KEY_PEM` |

  The remaining fields (`connect_timeout` 30, `timeout` 30, `verify_ssl` true,
  the custom `auth_header_name`, `tls_server_name`, `namespace`, the
  database `driver_options` `application_name` and the opensearch `verify_ssl`
  (true in `profile-opensearch.json`, false in
  `profile-opensearch-apikey.json`)) are declared in the JSON: they
  are the values under test, not environment material.
- The host constants are already mode-aware (`10.0.2.2` under
  `WAVE_E2E_EXTERNAL_SERVICES=1`, `127.0.0.1` otherwise), so the profile is
  built for the right mode directly. The `injectSsh` / `injectHttp` import
  options rewrite the FIXTURE, and here the endpoint lives in the profile, so
  neither option is used.

## Steps

1. Resolve the shared E2E environment, then create the profile through
   `POST /profiles` under a per-run unique name, with `environment_values` set
   for that environment.
2. Load the fixture and substitute the profile id and name placeholders.
3. Import via `POST /tests` and validate with zero errors.
4. Open in the workbench, select the shared environment, and Run.
5. Assert on the console markers and the Block execution statuses, then delete
   the imported Test and the profile, and assert the profile is gone.
6. Database and OpenSearch: the console is set to DEBUG before Run so the
   masked `Inputs:` echo renders. Database only: after the workbench run the
   same Test runs once more as a tracked execution (`POST /executions`) so its
   record, log, variables, export and report can be searched for the secrets;
   that execution is deleted with the Test.
7. OpenSearch UI-built case: the profile is made on the Profiles page (the
   gateway url, username and password for the E2E environment), a Test holding
   one Aggregate is seeded, the profile is added in the sheet's Profiles panel
   and the Cluster URL, Username and Password rows are switched to `{}`
   expressions on it; the sheet and the Test are saved, then run.

## Validation

- **SSH (`fixture-ssh.json`):** the run passes, the Open and Close Blocks report
  `success`, the console reports `connected=True` and `hop=1`, the
  `server_banner` output is a real `SSH-2.0-OpenSSH_...` banner, the DEBUG
  `Inputs:` echo shows the profile's `connect_timeout` arriving as `30` (the
  seconds spelling, spent by asyncssh over TCP connect, handshake and auth),
  and the profile password never renders in cleartext.
- **HTTP (`fixture-http.json`):** all three HTTP Blocks report `success`. The
  plain leg returns 200 from the profile-composed `/echo` URL with `timeout`
  bound from the profile. The auth leg returns 200 and the echoed request
  headers carry the profile's own non-default header name, with the key's value
  masked and never cleartext. The mTLS leg returns 200 from the tls-lab mtls
  listener, which reports the client DN it verified - the profile's own client
  identity on the wire.
- **Kubernetes (`fixture-k8s.json`):** both Connect Blocks report `success`, the
  token leg and the client-certificate leg each report `ver=v1.33`, the plugin
  logs `Connected to Kubernetes v1.33`, and the profile's bearer token never
  renders in cleartext. K8s Connect hard-fails, so a failed connect would fail
  the run outright.
- **Database (`fixture-database.json`):** the profile SQL Block reports
  `success` and logs `Connected to PostgreSQL {version} at {host}:9473`. Its
  query reads back what the server saw of the session: `who=wave db=wave` (the
  profile's username and database), `tls=True`, a `client_dn` naming
  `CN=wave-e2e-client` (the profile's client certificate, verified by the
  server) and `app=wave-e2e-profile-db` (the profile's `application_name`
  driver option). The DEBUG `Inputs:` echo shows every profile field arriving
  at the Block, with `password` and `client_key` as `********`. The second SQL
  Block binds the same profile without its CA: the certificate check the
  profile's `verify_ssl` keeps on refuses the server, so it records
  `Unreachable` with `CERTIFICATE_VERIFY_FAILED` and paints the warning state -
  which is what makes the first Block's CA the trust anchor. The password and
  the client key never appear in the console, the session variables, the
  workbench session, the session report, the profile and Test API reads, or
  the tracked execution's record, log, variables, export and report.
- **OpenSearch (`fixture-opensearch.json`):** the BASIC, TOKEN, APIKEY and
  CERT Searches end `success` with Total results 6 and the six ERROR
  documents, newest (`Stock check failed`) first, each reading `_field_caps`
  then `_search`; WRONG (the profile's wrong password, Record and continue)
  ends amber with Reason `AuthFailed` and Error `HTTP 401: Unauthorized`;
  together the four profile files carry all nine fields, `verify_ssl` both
  true and false; no password, JWT, minted API token or client key line
  reaches the console, DEBUG included. The UI-built profile lists exactly the
  nine fields, none required (the schema route agrees), and saves with only
  url, username and password; bound in the Aggregate sheet it gives
  `@timestamp, count` rows 2, 0, 4, 0, 0, Total results 6, every request under
  the gateway's `/os` prefix, and the `<= 5` Assert passes; API Key and Bearer
  Token saved empty show empty, not masked.

## Isolation

- Every profile is created under a per-run unique name, and each spec deletes
  the imported Test before the profile (a profile the store still sees a Test
  referencing cannot be deleted) and then asserts the profile is gone. No
  existing profile is reused or mutated.
- `importFixtureTest` uniquifies every test name, and runs execute in the
  per-worker workbench session the worker fixture frees afterwards.
- The suites only READ: `/echo` and the tls-lab listener hold no per-request
  state, the kubernetes suite reads `/version` only, so it creates no
  cluster object and needs no per-test namespace, and the database suite reads
  its own session from `pg_stat_ssl`, so it creates no database object.
  The OpenSearch suite reads through the block only; as `admin` it seeds its
  own `wave-e2e-<token>-app-logs` index and mints one API token, and
  `afterAll` deletes the index and revokes the token.

## V-PROFILE-DATABASE-TYPED-OPTIONS

- Spec: `v-profile-database-typed-options.spec.ts`; fixture: `profile-database-typed.json`, `fixture-database-typed.json`.
- The database profile form keeps each Driver options row type, stores the field with its element types, reads them back, and a SQL block bound to the profile hands the driver those types; retyping `timeout` as the decimal 16.5 stores a float that still reaches the driver as a platform number (REQ-3.1.3.19, SQL-14).

## V-PROFILE-SSH-PASSPHRASE-FUNCTIONAL

- Spec: `v-profile-ssh-passphrase-functional.spec.ts`; fixture: `fixture-ssh-passphrase.json`.
- Key: `tests/e2e/services/sshd/keys/wave_ed25519_passphrase` (OpenSSH format, passphrase
  `SSH_KEY_PASSPHRASE`), authorized for `wave` on `sshd`.
- Built through the UI: the good profile `Profile SSH Passphrase <uuid>` is made on the Profiles
  page for the shared E2E environment: Type `ssh`, Host, Port, Username, the key text pasted into
  the Private Key value sheet, and Passphrase. The wrong-passphrase profile is created with
  `POST /profiles`. Both ids and names replace the fixture placeholders at load.
- Fixture: SSH Session Open with host, port, username, private key and passphrase bound to the good
  profile (its own Password empty, Strict), SFTP Create folder, Stats, Delete and a Stats after the
  Delete on `e2e-profile-ssh-passphrase-<uuid>`, Session Close; then a Try/Catch around a Session
  Open bound to the wrong-passphrase profile.
- Criteria (REQ-4.5.4, REQ-4.7.3; SSH-7, K8SPROF-9):
  - PASS-1: the create dialog's Type selector offers exactly six types and none reads `sftp`; the
    Profiles list's Type filter offers no `sftp` either.
  - PASS-2: the fixture validates with zero errors; every connection value of the first Session
    Open is an expression on the profile, and the DEBUG `Inputs:` echo shows the profile's host,
    port and username with the key and passphrase masked.
  - PASS-3: the session opens: connected true, `hop_count` 1.
  - PASS-4: Create folder, Stats (Exists true, Type `folder`) and Delete pass on that session; the
    Stats after the Delete finds nothing.
  - PASS-5: the wrong-passphrase Session Open is caught with
    `SSH connection to {host}:{port} failed: Incorrect passphrase`.
  - PASS-6: no console line carries either passphrase or any line of the private key in clear.
  - PASS-7: `afterAll` runs the SFTP cleanup run as `wave`, deletes the Test, then both profiles,
    and proves all three are gone.
