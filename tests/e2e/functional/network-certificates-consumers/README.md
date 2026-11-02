# Certificate trust in the non-HTTP blocks

One spec proves the certificate trust rule (REQ-4.5.16) on every block that
dials TLS without going through the HTTP block: with Verify Server Certificate
on and the block's CA Certificate blank, the block trusts WAVE's trust set
(the built-in list plus the Additional Certificates saved in Settings > Network
> Certificates), never the WAVE host's environment. A PostgreSQL block with TLS
off rides along and proves it stays a plain connection.

| Case id | Spec | Fixture | Proves |
|---------|------|---------|--------|
| V-NET-CERT-FUNCTIONAL (consumers) | `v-network-certificates-consumers-functional.spec.ts` | `fixture.json` | PostgreSQL TLS, SQL Server TLS, OpenSearch HTTPS, K8s Connect to kwok and a Helm Install from the HTTPS chart repository each fail on the built-in list alone and pass once the CA that signs the service is added; each logs the trust line with the right count; PostgreSQL with TLS off reads `ssl` false |

Registered under the `functional-workflow` project of
`playwright.functional.config.ts` (`network-certificates-consumers/**`).

## Prerequisites

- Backend and frontend running, and the shared execution environment
  (`ensureEnvironment` creates it if absent).
- The real-service stack (see `tests/e2e/services/README.md`): `postgres`
  (9473), `mssql` (9476), `opensearch` (9477), `kwok` (9460) and `tls-lab`
  (9464, the HTTPS chart repository behind basic auth). helm must be on the
  PATH of the machine the backend runs on (the E2E runner image carries it).

  ```bash
  ./scripts/e2e-stack.sh up --wait postgres mssql opensearch kwok tls-lab
  ```

- Who signs what: the WAVE Test CA (`CA_CERT_PEM`) signs the PostgreSQL and
  SQL Server leaf, the OpenSearch leaf and the tls-lab leaf behind the chart
  repository; kwok's own CA (`K8S_CA_PEM`, `wave-kwok-ca`) signs the kwok API
  leaf. PostgreSQL's pg_hba accepts non-TLS clients (`host all all all
  scram-sha-256`), so TLS off connects in plain text rather than being refused.
- The fixture stores no secret: the spec fills the SQL, OpenSearch and chart
  repository passwords, the kwok token and the kwok CA (for the Helm session
  only) from `helpers/config.ts`. SQL Host rows carry the `127.0.0.1` sentinel
  that `injectServiceHost(fixture, SQL_TARGET_HOST)` rewrites; the OpenSearch
  and kwok URLs are rewritten by `injectHttp`; the chart repository URL is
  replaced by `CHART_REPO_TLS_URL`, which is mode-correct as built.
- `__TOKEN__` names the run's OpenSearch index (`wave-e2e-<token>-trust`,
  seeded with the ten F-LOGS documents and deleted afterwards) and the Helm
  release (`wave-trust-<token>`); `__NAMESPACE__` is the run's own kwok
  namespace from `seedRun(request, 'minimal')`, torn down afterwards.
- `resetNetworkSettings` runs before and after the test, so the backend is on
  WAVE's built-in list with no Additional Certificates when the test starts and
  when it ends.

## Steps

1. Reset the network settings; seed the namespace and the OpenSearch index.
2. Fill the fixture, import it via `POST /tests` (no repairs), confirm
   `POST /tests/{id}/validate?context=run` reports zero errors, and open it in
   the workbench.
3. Read `GET /network/certificates`: source `builtin`, no Additional
   Certificates; take the built-in list's label.
4. Run 1, built-in list only: set the console to DEBUG (the trust line is a
   DEBUG line), pick the shared environment, press Run and wait for the run to
   pass and the bookend `trust-consumers-done`.
5. `PATCH /network/certificates {add: [WAVE Test CA]}`; clear the console and
   run again (run 2).
6. `PATCH /network/certificates {add: [kwok CA]}`; clear the console and run a
   third time (run 3).
7. After each run read the console (copy text, full source column), the session
   variables and the block states.

## Validation

- **Trust lines:** each run carries exactly five lines starting `Trusting `,
  one DEBUG line per consumer from that consumer's own block:
  `Trusting WAVE's built-in certificate list ({label})` in run 1,
  `... and 1 additional certificate` in run 2, `... and 2 additional
  certificates` in run 3. The TLS-off block, the Helm session Connect (its own
  CA) and the Helm Uninstall write none.
- **Run 1, every consumer refused:**
  - PostgreSQL: Reason `Unreachable`, Error
    `Could not connect to PostgreSQL at {host}:9473: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:{n})`,
    the WARN `Run SQL failed (Unreachable): {error}`, amber.
  - SQL Server: Reason `Unreachable`, Error starting
    `Could not connect to SQL Server at {host}:9476: ` and naming
    `certificate verify failed`, the same WARN, amber.
  - OpenSearch: Reason `Unreachable`, Error starting
    `Could not connect to OpenSearch at {host}:9477: ` with
    `CERTIFICATE_VERIFY_FAILED`, Total results 0, the WARN
    `Search failed (Unreachable): {error}`, amber.
  - K8s Connect: raises inside its Try/Catch; the caught message is
    `Could not verify the TLS certificate of https://{host}:9460: Certificate verification failed: no trusted issuer found for certificate "O=system:masters, CN=kwok-admin"`;
    no cluster version; the block fails and the Try/Catch passes.
  - Helm Install: Success false, Reason `Unreachable`, Error naming
    `x509: certificate signed by unknown authority`, an empty Status and the
    release table with no row, amber.
- **Run 2, the WAVE Test CA added:** PostgreSQL reads its own session from
  `pg_stat_ssl` as encrypted (TLS 1.2 or 1.3) and SQL Server's
  `encrypt_option` is `TRUE`, each with the Connected line and
  `Statement 1: 1 rows, {ms} ms`; OpenSearch finds the 6 ERROR documents;
  Helm deploys `wave-demo-0.1.0` as revision 1 and the release row reads
  deployed; K8s Connect is refused exactly as in run 1.
- **Run 3, kwok's CA added:** all of run 2, and K8s Connect reads a `v1.33`
  cluster version with nothing caught.
- **TLS off, every run:** the plain PostgreSQL block runs
  `SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()` and reads one row
  with `ssl` false; its only lines are the Connected line and the Statement
  line.
- **Bindings and outcome:** the summary Log line carries every bound Success,
  Reason, Total results and Status; the Helm Uninstall (Ignore Not Found) logs
  `Uninstalled release 'wave-trust-<token>'` in every run, so no release
  outlives a run; every run passes.
