# E2E Real-Service Stack

Real backing services the functional E2E suite runs against, so plugin tests
exercise real protocols instead of in-process fakes. Managed by
`scripts/e2e-stack.sh` (a docker-compose v2 wrapper over the rootless podman
socket).

## Licenses

The `mssql` and `oracle` services use vendor images under the vendors' own terms. Building or running the stack means you accept them: the SQL Server Developer Edition license (`mssql/Containerfile` sets `ACCEPT_EULA=Y` and `MSSQL_PID=Developer`; Developer Edition is for development and test, not production) and the Oracle Free Use Terms and Conditions (the Oracle Database Free in `gvenzl/oracle-free`). `scripts/e2e-stack.sh up` and `run` build missing images by themselves, so the first run of any E2E script also does this.

## Test certificates

Every key here is public and for tests only. Never add these CAs to a system or browser trust store. Most of their keys are in this repo, so anyone can sign a certificate with them. `../simulators/https/certs/ca.pem` (WAVE Test CA), `kwok/pki/ca.crt`, `k8s-stub/certs/ca.crt`, `tls-lab/certs/chain-root.crt`.

## Services

| Service | Host port | Internal DNS | Role |
|---------|-----------|--------------|------|
| `sshd` | 127.0.0.1:9445 | `sshd:22` | Main OpenSSH host: password + key auth, forwarding on, SFTP on, five interpreters (sh/bash/python3/perl/node). Fixed committed host key. `wave` also accepts the passphrase-protected key `sshd/keys/wave_ed25519_passphrase` (passphrase `wave-key-passphrase`). SFTP-only account `dropzone` / `dropzone-secret`: `ForceCommand internal-sftp`, chrooted to a root-owned `/srv/sftp/dropzone` that holds only the writable `/inbound` and `/outbound`, no shell and no forwarding. Carries a pinned Helm 3.21.4 at `/usr/local/bin/helm` (a different major from the E2E runner's) for the Remote Execution Helm leg. Runs with `net.ipv4.ping_group_range=1000 1000` so a pushed Remote Execution worker can send unprivileged ICMP. |
| `sshd-no-sftp` | 127.0.0.1:9447 | `sshd-no-sftp:22` | SFTP subsystem removed (proves SSH Session Script's stdin delivery needs no SFTP). |
| `sshd-no-fwd` | 127.0.0.1:9448 | `sshd-no-fwd:22` | `AllowTcpForwarding no` (tunnel / multi-hop negative cases). |
| `sshd-banner` | 127.0.0.1:9446 | `sshd-banner:22` | `ForceCommand` prints one fixed line on stdout, then runs the requested command: every exec channel carries noise ahead of the command's own output. |
| `sshd-badpy` | 127.0.0.1:9462 | `sshd-badpy:22` | `ForceCommand` runs the interpreter probe for real and fails every other command on stderr with nothing on stdout. |
| `nested-sshd` | none (internal) | `nested-sshd:22` | Jump-host target: reachable ONLY through `sshd`, never from host or shard. |
| `http-target` | none (internal) | `http-target:9443` (HTTPS), `:9444` (HTTP health) | Tunnel-only destination + Remote-Exec HTTP target + cookie/secret canary source. Wraps `../simulators/https/server.ts`. |
| `http-echo` | 127.0.0.1:9449 (HTTPS), :9450 (HTTP health) | `http-echo:9443` / `:9444` | Published sibling of `http-target` - SAME image, no rebuild. The HTTP plugin's direct target (echo/delay/status/retry/redirect/cookie/secret endpoints). |
| `tls-lab` | 127.0.0.1:9451-9457, :9463, :9464, :9480, :9481 | `tls-lab:9451-9457`, `:9463`, `:9464`, `:9480`, `:9481` | nginx TLS matrix; every 9451-9457 listener returns JSON `{"ssl_protocol","ssl_cipher","client_dn","listener"}`. The same nginx also serves the checked-in Helm chart repository as static files on 9463 (plain HTTP, no auth) and 9464 (HTTPS + basic auth), and the chain PKI on 9480 (leaf + intermediate) and 9481 (leaf only). See listener map below. |
| `http-proxy` | 127.0.0.1:9458 | `http-proxy:8888` | tinyproxy OPEN forward proxy: plain proxying + CONNECT to any port; resolves compose DNS names server-side. |
| `http-proxy-auth` | 127.0.0.1:9459 | `http-proxy-auth:8888` | tinyproxy BasicAuth forward proxy (user `wave`, password `proxy-secret`); 407 without credentials. Same image as `http-proxy`, config swapped by command override. Exported as `PROXY_PORT`, `PROXY_AUTH_PORT`, `PROXY_AUTH_USER` and `PROXY_AUTH_SECRET`. |
| `kwok` | 127.0.0.1:9460 | `kwok:6443` | Real Kubernetes API: kwok all-in-one cluster (etcd + kube-apiserver + kwok controller + metrics-server). Secure serving ONLY (insecure proxy disabled), RBAC on, static-token + client-cert auth, TokenRequest enabled. Node/pod lifecycle simulated by the checked-in Stages (opt-in kubelet-event, crash-loop, container-creating and job-fail Stages, see below); pod logs served per container from checked-in files plus one generated at container start, with previous-instance files (see below); one custom resource definition baked in (see below); `metrics.k8s.io` served by metrics-server over kwok's simulated kubelet resource metrics (see below). `kubectl exec` runs real commands, for the exec-fixture pod names only, on a kwok controller rebuilt from patched source (see below). Kubernetes 1.33 (specs assert `ver=v1.33`). |
| `kwok-internal` | none (internal) | `kwok-internal:6443` | Identical second kwok cluster (same image), reachable ONLY on the compose network: in-network / tunnel-target Kubernetes cases. |
| `k8s-gateway` | none (internal) | `k8s-gateway:8080` | nginx path-prefix front for the published `kwok`: plain HTTP, `http://k8s-gateway:8080/k8s/clusters/wave/<api path>` proxies to `https://kwok:6443/<api path>` (upstream TLS unverified, `Authorization` passed through, paths outside the prefix 404 at nginx). Proves a Connect base URL with scheme + non-standard port + path prefix. Resolves `kwok` per request, so it may start before kwok; healthy only once the authenticated `readyz` answers through the prefix. |
| `k8s-stub` | 127.0.0.1:9461 | `k8s-stub:9461` | Kubernetes API fault injector, not a cluster: canned discovery over TLS plus a configurable status / body / delay on the resource read. It answers discovery successfully and fails ONLY the read, which is what a real cluster cannot be made to do on demand. See the fixture contract below. |
| `netcat-target` | none (internal) | `netcat-target:9470` (TCP echo), `:9471` (UDP echo), `:9472` (UDP silent sink) | Raw TCP/UDP target (alpine + socat, no keys or credentials): the Netcat tunnel far end and the Remote-Exec Netcat target. TCP echo returns every byte and closes its side once the client closes its sending side; UDP echo answers each datagram with the same bytes (up to 65507), and an empty datagram gets no reply; the silent sink receives and never replies. Nothing listens on 9479 (the `closed` proofs dial their own loopback, because ICMP refusals do not cross the published-port forwarder). |
| `netcat-echo` | 127.0.0.1:9470 (TCP), :9471 (UDP), :9472 (UDP) | `netcat-echo:9470` / `:9471` / `:9472` | Published sibling of `netcat-target` - SAME image, no rebuild. The Netcat block's direct target: TCP `open` and Talk echo on 9470, UDP `open` on 9471 (the `X` probe is echoed), UDP `open or filtered` on 9472. |
| `postgres` | 127.0.0.1:9473 | `postgres:5432` | PostgreSQL (`postgres:alpine`). Login `wave` / `sql-secret` owns database `wave` (tables go in `public`). TLS offered on the database leaf, plain still accepted; a client certificate, when sent, is verified against the WAVE Test CA. Seed procedure `wave_add`. The SQL block's direct target, the tunnel far host and the remote-host target. |
| `mariadb` | 127.0.0.1:9474 | `mariadb:3306` | MariaDB 11. User `wave` / `sql-secret` holds every right on database `wave`. TLS offered on the database leaf, plain still accepted; a client certificate, when sent, is verified against the WAVE Test CA. Seed procedure `wave.wave_add`. The service records connection attributes (performance schema on, `mariadb/attrs.cnf`), and `wave` may read them from `performance_schema.session_connect_attrs`: a client's program name is the `program_name` attribute. |
| `oracle` | 127.0.0.1:9475 | `oracle:1521` | Oracle Database Free (`gvenzl/oracle-free:slim-faststart`). User `wave` / `sql-secret` (schema `WAVE`) in the default pluggable database, service name `FREEPDB1` - the block's Database row. Plain TCP only, no TLS. Seed procedure `WAVE.WAVE_ADD`. |
| `mssql` | 127.0.0.1:9476 | `mssql:1433` | SQL Server 2022 Developer (`mcr.microsoft.com/mssql/server:2022-latest`). Login `wave` / `sql-secret` is `db_owner` of database `wave` (default schema `dbo`) and may read its own row of `sys.dm_exec_connections` (`encrypt_option`). TLS offered on the database leaf, encryption not forced, so plain is still accepted. Seed procedure `dbo.wave_add`. |
| `opensearch` | 127.0.0.1:9477 | `opensearch:9200` | OpenSearch 3.8.0, one node, only the security, SQL and job-scheduler plugins. HTTPS only, on the OpenSearch leaf signed by the WAVE Test CA; logins by Basic (`wave` / `os-secret`), the tls-lab client certificate, the checked-in JWT and minted API tokens. The OpenSearch block's direct target, the tunnel far host and the remote-host target. See below. |
| `opensearch-gateway` | 127.0.0.1:9478 | `opensearch-gateway:9478` | nginx path-prefix front for `opensearch`: plain HTTP, `http://127.0.0.1:9478/os/<api path>` proxies to `https://opensearch:9200/<api path>` over verified TLS (lab CA, server name `opensearch`). The raw request path after `/os` is passed on unchanged, so an encoded index pattern (`%2A`, `%2C`, `%2F`) arrives as sent; `Authorization` is passed through; paths outside the prefix 404 at nginx. Resolves `opensearch` per request. |
| `oci-registry` | 127.0.0.1:9482 | `oci-registry:5000` | OCI registry (the distribution registry, `registry:3.1.2`). HTTPS only, on the registry leaf signed by the WAVE Test CA (`tls-lab/certs/registry.crt`, SAN `DNS:localhost, IP:127.0.0.1, IP:10.0.2.2, DNS:oci-registry`, generator `tls-lab/certs/generate-registry-cert.sh`). Basic login `wave` / `oci-secret` from `oci-registry/htpasswd` (bcrypt, the one scheme this registry accepts); 401 without it. Holds one chart, `oci://<host>:9482/charts/wave-demo` version 0.1.0, the same archive as `tls-lab/charts/wave-demo-0.1.0.tgz`. The chart is pushed into the image at BUILD time (pinned Helm 4.2.4 in a build stage) and the storage folder is not a volume, so every start holds exactly that chart and nothing is pushed at run time; healthy also proves the chart is there. Address the chart by its version, not by digest: the digest follows the archive's file time on the build machine. The Helm blocks' OCI chart source: direct on the published port, and by its network name through `http-proxy` / `http-proxy-auth`. Exported from `helpers/config.ts` as `OCI_REGISTRY_PORT`, `OCI_REGISTRY_SERVICE`, `OCI_REGISTRY_INTERNAL_PORT`, `OCI_REGISTRY_USER`, `OCI_REGISTRY_PASSWORD` and `OCI_CHART_REF`. |

SSH credentials: user `wave`, password `wave-secret`, plus the committed client key
in `sshd/keys/client_ed25519` and the passphrase-protected key
`sshd/keys/wave_ed25519_passphrase` (passphrase `wave-key-passphrase`), both
authorized for `wave`. On `sshd` only, the SFTP-only account `dropzone` /
`dropzone-secret` sees just `/inbound` and `/outbound`. The fixed host public key
is `sshd/keys/ssh_host_ed25519_key.pub` (pin it for strict host-key tests). All
key material is TEST-ONLY.

Host keys: WAVE checks SSH host keys against its own trusted hosts list in the
data folder, never the account's `~/.ssh/known_hosts`. `setup/global-setup.ts`
calls `resetNetworkSettings` (`helpers/network-settings.ts`) on every backend,
which clears the list and the host key policy and trusts `STACK_TRUSTED_HOSTS`:
the host key for `SSH_TARGET_HOST` port 9445, the WRONG key (`client_ed25519.pub`)
for port 9448 (strict-mismatch proof) and the host key for `sshd` port 22 (the
tunnel far host). Port 9447 is never trusted, so `accept-new` makes first contact
there. Specs that change network settings call the same helper before and after
each test.

## Databases (TEST-ONLY, `postgres/`, `mariadb/`, `oracle/`, `mssql/`)

All four take the same login: user `wave`, password `sql-secret`, database
`wave` (Oracle: service name `FREEPDB1`, schema `WAVE`), exported from
`helpers/config.ts` as `SQL_STACK_USER`, `SQL_STACK_PASSWORD`,
`SQL_STACK_DATABASE` and `ORACLE_SERVICE_NAME`. The admin accounts (`postgres`,
MariaDB `root`, Oracle `SYS` / `SYSTEM`, SQL Server `sa`) share the password
`Wave-Admin-Secret-1` and only the provisioning scripts use them. `wave` is not
an admin anywhere: it owns its own database or schema and nothing else.

| Constant | Value |
|----------|-------|
| `SQL_TARGET_HOST` | `127.0.0.1` in host mode, `10.0.2.2` in container shards (same rule as `HTTP_TARGET_HOST`) |
| `POSTGRES_PORT`, `MARIADB_PORT`, `ORACLE_PORT`, `MSSQL_PORT` | `9473`, `9474`, `9475`, `9476` (published) |
| `POSTGRES_SERVICE` / `POSTGRES_INTERNAL_PORT` (and the `MARIADB_`, `ORACLE_`, `MSSQL_` siblings) | the compose DNS name and native port, for the tunnel far host and the remote-host leg |
| `SQL_SEED_PROCEDURE` | `wave_add` |

The seed procedure is the same on every database: in arguments `a` and `b`, out
arguments `total` (integer, `a + b`) and `label` (text, always `sum`).
Provisioning runs once, at the container's first start (each image's own
init-script hook), so `down` + `up` always starts clean. Each healthcheck logs in
as `wave` over TCP and calls `wave_add(2, 3)`, so healthy also means provisioned
(MariaDB's check logs in over verified TLS, because MariaDB starts without TLS
when it cannot load its files).

TLS on postgres, mariadb and mssql uses one database leaf,
`tls-lab/certs/database.crt` + `database.key`, signed by the WAVE Test CA (the
`CA_CERT_PEM` trust anchor) and baked into each image where the server takes
files by config. Its SAN covers `localhost`, `127.0.0.1`, `10.0.2.2`, `postgres`,
`mariadb` and `mssql`, so verification passes on the direct leg in both modes and
on the tunnel and remote-host legs, where the server name is the compose DNS
name. `tls-lab/certs/generate-database-cert.sh` reissues it without touching the
tls-lab leaf. The tls-lab client pair (`TLS_LAB_CLIENT_CERT_PEM`,
`TLS_LAB_CLIENT_KEY_PEM`) is accepted by postgres and mariadb; no login requires
it.

Every provisioned object is shared by all shards: specs create their own tables
with the test id in the name and never alter `wave_add`.

## OpenSearch (TEST-ONLY, `opensearch/`, `opensearch-gateway/`)

The node reads its security configuration from `opensearch/security/*.yml` at
its first start (`allow_default_init_securityindex`), so no admin certificate is
needed to bring it up and `down` + `up` always starts clean. The admin DN
`CN=wave-e2e-admin,O=WAVE Test` is configured but no certificate for it is
checked in: nothing in the suite changes the security configuration.

| Login | Secret | Rights |
|-------|--------|--------|
| `admin` | `Wave-Admin-Secret-1` | `all_access` and the security REST API. Seeding, cleanup and API token minting only. |
| `wave` | `os-secret` | Role `wave_e2e_read`: `cluster_composite_ops_ro`, `read` on `wave-e2e-*`. |
| `wave-limited` | `Limited-Secret-7x!` | Role `wave_e2e_limited`: `read` on `wave-e2e-other-*` only, so a search on `wave-e2e-demo-*` answers 403 `security_exception`. |
| tls-lab client certificate | `tls-lab/certs/client.crt` + `client.key` | Authenticates as its CN, `wave-e2e-client`, mapped to `wave_e2e_read`. |
| JWT | `opensearch/jwt/wave-e2e.jwt` | HS256, subject `wave-jwt`, roles `["wave_e2e_read"]`, no expiry, sent as `Authorization: Bearer <token>`. The signing key is `opensearch/jwt/wave-e2e.key` (base64 of 32 bytes; `security/config.yml` carries the same text). `opensearch/jwt/generate-jwt.sh` rewrites the token from the key byte for byte. |
| API token | minted per spec file | Sent as `Authorization: ApiKey os_...`; rights are the ones named at minting. |

Authentication runs client certificate, then JWT, then Basic. Basic is last
because it answers a request with no Basic header with an immediate 401 and a
`WWW-Authenticate: Basic` challenge, and no later domain would run. A request
with no credentials gets that 401.

API tokens are minted and revoked as `admin`:

- `POST /_plugins/_security/api/apitokens` with
  `{"name": "wave-e2e-<run token>-<purpose>", "cluster_permissions": ["cluster_composite_ops_ro"], "index_permissions": [{"index_pattern": ["wave-e2e-*"], "allowed_actions": ["read"]}], "duration_seconds": 86400}`
  answers 200 with `{"id": "...", "token": "os_..."}`. The token is shown only
  in that answer. `duration_seconds` is required: without it the cluster answers
  400 `Non-expiring tokens are not allowed. Maximum duration is 7776000 seconds.`
- `DELETE /_plugins/_security/api/apitokens/<id>` revokes it (200,
  `{"message": "Token <id> revoked successfully."}`); the token then gets 401.
- A revoked token stays listed with `revoked_at` and still counts toward the
  cap (`max_tokens: 1000`, the highest the node accepts). There is no delete, so
  a long-lived local stack that has minted 1000 tokens needs `down` + `up`.
  Token names must be unique for the life of the node.

TLS uses its own leaf, `tls-lab/certs/opensearch.crt` + `opensearch.key`
(subject `CN=wave-e2e-opensearch,O=WAVE Test`, the transport `nodes_dn`), signed
by the WAVE Test CA (`CA_CERT_PEM`), for HTTP and transport both, so its EKU is
`serverAuth, clientAuth`. Its SAN covers `localhost`, `127.0.0.1`, `10.0.2.2` and
`opensearch`. The container name `wave-e2e-opensearch` resolves on the compose
network to the same node but is left out of the SAN on purpose: dialing it with
verification on fails, which is the far-name negative.
`tls-lab/certs/generate-opensearch-cert.sh` reissues the leaf.

Per-test isolation: the block cannot write, so specs seed as `admin`. Index
names are `wave-e2e-<run token>-<purpose>`; an idempotent
`PUT _index_template/wave-e2e` with
`{"index_patterns": ["wave-e2e-*"], "template": {"settings": {"number_of_replicas": 0}}}`
runs before the first seed (a replica-1 index turns the single-node cluster
yellow); each index is created with an explicit mapping, filled with
`POST /_bulk?refresh=true` (the answer must read `"errors":false`) and deleted in
teardown with `DELETE /wave-e2e-<run token>-*`. Never `DELETE /*`, never a
cluster-wide setting, never an index outside the run's own prefix.

The heap is fixed at 512 MB and the container is capped at 1536 MB; after start
and a small seed it holds about 1.0 GB.

## sshd ForceCommand variants (TEST-ONLY, `sshd/`)

`sshd-banner` and `sshd-badpy` run the same image and the same credentials as
`sshd`; each selects a config variant whose only extra line is a `ForceCommand`
pointing at a shim baked into the image at `/usr/local/bin`.

| Service | Config | Shim | Behavior |
|---------|--------|------|----------|
| `sshd-banner` | `sshd_config.banner` | `wave-banner-shim` | Echoes one line on stdout, then `exec`s `$SSH_ORIGINAL_COMMAND`. Exit status and stderr are the command's own. |
| `sshd-badpy` | `sshd_config.badpy` | `wave-badpy-shim` | `$SSH_ORIGINAL_COMMAND` containing `sys.version_info` (the interpreter probe) is `exec`ed, so the image's own Python 3.10 answers it; anything else prints one line on stderr, nothing on stdout, and exits 1. |

The exact strings, exported from `helpers/config.ts` so specs never retype them:

- `SSH_BANNER_LINE`: `NOTICE: Authorized use only. All activity on this system is monitored and recorded.`
- `SSH_BADPY_STDERR_LINE`: `ModuleNotFoundError: No module named 'encodings'`

A banner is on EVERY exec channel, not just the first, so the noise reaches a
persistent remote worker's own stream too, not only a one-shot probe.
`sshd-badpy` runs no command for real but the probe: it is a host that passes
the interpreter check and then cannot start anything.

Both are published like their siblings, so `SSH_TARGET_HOST` plus
`SSH_BANNER_PORT` / `SSH_BADPY_PORT` reach them in host mode and in
container-shard mode alike. Neither is in the trusted SSH hosts list
`setup/global-setup.ts` seeds, so they behave like `sshd-no-sftp` on first contact.

## kwok credentials & bootstrap (TEST-ONLY, `kwok/`)

- **Tokens** (`kwok/tokens.csv`, static-token auth): `wave-admin-token` (user
  `wave-admin`, ClusterRoleBinding to `cluster-admin`) and `wave-limited-token`
  (user `wave-limited`, bound to `view` - reads pass, writes 403).
- **Client cert**: `kwok/pki/client.crt` + `client.key`
  (`CN=wave-cert-user,O=system:masters` - RBAC bypass), signed by the dedicated
  `kwok/pki/ca.crt` (`wave-kwok-ca`), which is also the serving-cert trust
  anchor. Serving SANs: `localhost,127.0.0.1,10.0.2.2,kwok,kwok-internal`.
- **Bootstrap objects** (applied by the image entrypoint before it reports
  healthy): SA `wave-tests` in `default` (TokenRequest subject, bound to `view`
  cluster-wide so a minted run token reads any resource and gets 403 on every
  write), namespace `restricted` (read-only - no test writes to it), standing
  fake node `kwok-node-0` (so pods schedule without any test creating
  cluster-scoped objects; carries the `metrics.k8s.io/resource-metrics-path`
  annotation metrics-server scrapes), plus the impersonation subjects below.
- **Changing any of it needs a rebuild**: `kwok/manifests/` is copied into the
  image at build time (`Containerfile`) and applied from inside the container at
  startup (`entrypoint.sh`). Editing a manifest and running `up` leaves the
  cluster exactly as it was, and the stale permissions look like a plugin bug.
  The sequence is `scripts/e2e-stack.sh build`, then `down`, then
  `up --wait kwok`. A rebuild recreates the cluster from scratch, so every
  runtime object any suite or person created is wiped; only the baked bootstrap
  comes back.
- **Healthcheck**: authenticated `/readyz`, an authenticated read of the
  `restricted` namespace, and `GET /apis/metrics.k8s.io/v1beta1`, so healthy
  also proves token auth, RBAC bindings, bootstrap completion and the
  aggregated metrics API.
- **Isolation**: the cluster is shared across parallel shards, so any suite
  that writes must scope its objects to its own uniquely-named namespace
  (`wave-e2e-{runId8}`) and delete it in teardown. The K8s Connect suite only
  reads (`/version`) and mints run tokens for the `wave-tests` service
  account; the static tokens and the client cert are read-only shared state.

### kwok impersonation subjects (`kwok/manifests/rbac-impersonation.yaml`, `rbac-deleter.yaml`)

Subjects that exist only to be impersonated, so the Blocks' Impersonate-User /
Impersonate-Group options can be proven rather than assumed. No token in
`tokens.csv` maps to any of them: an impersonation header is the only way to act
as them.

| Subject | Kind | Can read | Cannot read |
|---------|------|----------|-------------|
| `wave-reader` | User | pods, `pods/log`, core `v1` events - cluster-wide, read-only | Secrets, `apps/v1` Deployments, `metrics.k8s.io`, everything else |
| `wave-readers` | Group | pods only - cluster-wide, read-only | pod logs, events, Secrets, Deployments, `metrics.k8s.io` |
| `wave-nobody` | User | nothing. Deliberately NOT seeded - it is the no-rights control | everything |
| `wave-deleter` | User | nothing at all. It holds `delete` and `deletecollection` on core `configmaps` and no `get`, `list` or `watch` anywhere, so it can destroy a ConfigMap collection and can never see one | everything, the `configmaps` it may delete included |

The grants are narrower than the `wave-admin` caller's on purpose. A read the
caller's own token satisfies comes back 403 while impersonating, and the
apiserver's message names the impersonated subject verbatim, which the caller's
token can never produce:
`secrets is forbidden: User "wave-reader" cannot list resource "secrets" in API
group "" in the namespace "..."`. Pair that with the same read succeeding
unimpersonated and with a different Kind succeeding under the same header, and
impersonation is proven to have taken effect.

The group grant is strictly narrower than the user grant (pods, but not pod logs
and not events), so the two headers are told apart by outcome, not only by which
field was filled. The group proof is `wave-nobody` alone (403 on pods) against
`wave-nobody` plus group `wave-readers` (200), identical in every other field.

`wave-deleter` is the write-side counterpart, and the only subject whose grant is
not read-only. A collection DELETE under that header returns 200 with the list of
the objects it removed, and every GET that follows returns 403, so a delete that
waits for its objects to be gone can be held to observing their absence instead of
reading a refusal as absence. Impersonate it with `wave-admin-token` as the
caller; nothing else may impersonate.

Three rules worth knowing before writing a spec:

- **A group header with no user header never leaves WAVE.** The pairing is
  refused during validation with `Parameter 'impersonate_groups' cannot be used
  on its own: set 'impersonate_user' to the user to run the request as, or clear
  the groups`, so no request is sent and there is no cluster answer to assert.
  The apiserver's own answer to that shape - HTTP 500 with the plain-text body
  `requested [{Group  wave-readers    }] without impersonating a user` - is
  still what this cluster does, but a spec that wants it has to send the headers
  itself, outside the plugins.
- **Discovery still works under impersonation**: the default `system:discovery`
  ClusterRole is bound to `system:authenticated`, which the apiserver adds to
  every impersonated user, so a 403 a spec sees is about the resource, not about
  discovery.
- **Nobody but `wave-admin` can impersonate.** `wave-limited` gets
  `users "wave-reader" is forbidden: User "wave-limited" cannot impersonate
  resource "users" in API group "" at the cluster scope` - a free negative case.

### kwok metrics (`metrics.k8s.io`)

- **How it is served**: `kwokctl create cluster --enable metrics-server` runs
  the metrics-server binary baked into the image at build time
  (`COPY --from=registry.k8s.io/metrics-server/metrics-server:v0.7.2`; the
  cluster never downloads at runtime) and registers the
  `v1beta1.metrics.k8s.io` APIService. The kwok controller serves the kubelet
  resource-metrics endpoint from `kwok/metrics/metrics-usage.yaml`, the kwok
  v0.7.0 release asset vendored verbatim (a `Metric` + a
  `ClusterResourceUsage` document). Never pass `--enable-crds Metric` (it
  silently stops the config-file `Metric` from being served) and never tune
  `metric-resolution`; both break the cluster on this pin.
- **Usage annotations**: every pod reports what its annotations say, per
  CONTAINER: `kwok.x-k8s.io/usage-cpu` (e.g. `250m`) and
  `kwok.x-k8s.io/usage-memory` (e.g. `512Mi`); unannotated pods report
  `1m` / `1Mi` per container. A two-container pod annotated 250m/512Mi
  therefore reports 250m/512Mi for EACH container (pod total 500m/1Gi).
  Memory comes back exactly; CPU is a rate off a cumulative counter
  (`250009220n` for `250m`), so assert memory exactly and CPU with a tolerance.
- **Node-sum caveat**: `kwok-node-0` is one node shared by every parallel
  shard and its usage is the sum over every pod on it, so node metrics are
  NOT isolated by namespace. Assert node metrics for shape only (name, fields
  present, non-negative); assert values only on pod metrics inside the test's
  own `wave-e2e-{runId8}` namespace.
- **Readiness delay**: the first pod metrics land 35-90 s after pod creation
  (measured 35, 36, 41, 51 and 52 s). That is a measurement, not a floor - it is
  not a promise about the next run. Use `waitForPodMetrics` in
  `tests/e2e/helpers/k8s-seed.ts`, which polls
  `GET /apis/metrics.k8s.io/v1beta1/namespaces/{ns}/pods` for up to 150 s with
  NO lower bound hard-coded. Do not hand-roll a shorter poll; the discovery
  endpoint itself answers 200 within seconds of container start, which is a
  different thing from a pod having a row.
- **RBAC**: the built-in `view` role carries no `metrics.k8s.io` rules, so
  `wave-limited-token` and run tokens minted for `wave-tests` get 403 on
  metrics (a ready-made negative case); `wave-admin-token` reads them. The
  impersonation roles carry no `metrics.k8s.io` rules either, so Top is a
  denial for every impersonated subject and its pass/fail pair is
  "admin, no header" against "any impersonated subject".
- **Footprint**: +65 MB image (593 MB), about +69 MB RSS per kwok container.

### kwok pod logs (`kwok/logs/`, CRI format)

The `ClusterLogs` doc in `kwok/kwok.yaml` serves these files to every pod in
every namespace, keyed by container name:

| Container name | Current instance | `previous=true` |
|----------------|------------------|-----------------|
| `app` | `app.log` - 6 lines, `app: starting payments-api v2.4.0` ... `app: GET /healthz 200 1ms` | `app-previous.log` - 4 lines ending `app: FATAL exiting with code 1` |
| `sidecar` | `sidecar.log` - 4 lines, `sidecar: envoy proxy ready, upstream app:8080` ... | `sidecar-previous.log` - 2 lines ending `sidecar: ERROR config reload failed, exiting` |
| `recent` | `recent.log` - 10 lines, 228 body bytes, timestamps GENERATED at container start (see below) | none - `previous=true` on this container is out of contract |
| `unicode` | `unicode.log` - 4 lines, 256 body bytes, multi-byte characters at fixed offsets (see below) | none - out of contract |
| any other | `pod.log` - `kwok-log-line-1..3` | `pod-previous.log` - `kwok-previous-log-line-1..3` |

`tailLines`, `timestamps`, `limitBytes`, `sinceSeconds` and `sinceTime` are all
honored for real by the cluster, against each line's own CRI timestamp
(`timestamps=true` prefixes each line with that stamp, e.g.
`2026-01-01T00:00:05.000000001Z`, which is 31 bytes per line). All seven
checked-in files are stamped 2026-01-01 (current: `app`, `sidecar`, `unicode`,
`pod`) or 2025-12-31 (previous: `app`, `sidecar`, `pod`), so any
realistic `sinceSeconds` empties them - against those, assert `since` as
"filters everything out". Use container `recent` when `since` has to be a
genuine subset filter.

**The `recent` log is generated at container start** by `kwok/generate-logs.sh`,
because a checked-in file cannot stay recent. It is 10 lines:
`recent: archived line 1..6` stamped 365 days before container start, then
`recent: fresh line 1..4` stamped 180 s, 120 s, 60 s and 0 s before it. Read it
with no options for **10 lines / 228 bytes**; read it with
`since_seconds = 2592000` (30 days) for **4 lines / 84 bytes** - the four
`fresh` lines. The archived lines are a year older than the cutoff, so they
never come back; the 4-line result holds while the kwok container has been up
for less than 30 days, after which the fresh lines age past the cutoff too and
the read returns nothing. A `down` / `up` resets the file.

**The `unicode` log carries multi-byte characters at fixed byte offsets**, so a
byte cut can be aimed inside a character. The served body is 256 bytes with
`timestamps` off; each line is padded with `-` to 63 bytes plus a newline, so
line k starts at byte 64 * (k - 1).

| Character | Codepoint | Width | First byte at offset |
|-----------|-----------|-------|----------------------|
| € | U+20AC | 3 bytes | 32 |
| £ | U+00A3 | 2 bytes | 96 |
| 😀 | U+1F600 | 4 bytes | 160 |

`max_bytes` of 33, 34, 97, 161, 162 or 163 cuts inside a character and the text
comes back ending in the replacement character with the Block still succeeding;
32, 35, 96, 98, 160 and 164 cut cleanly. Keep `timestamps` off on these legs - a
timestamp prefix adds 31 bytes per line and moves every offset.

`recent` and `unicode` are keyed by CONTAINER NAME, not by pod label: kwok's
`ClusterLogs` selector matches only namespaces and names, never labels. Nothing
else in the tree uses a container called `recent` or `unicode`, so no other
suite's log read changes.

Fidelity gaps versus a real kubelet, and what the cluster CAN fail with:

- `previous=true` is served even when the container never restarted (a real
  kubelet answers 400).
- **A container that has not started is served its log body with HTTP 200.**
  kwok never looks at container status, so `is waiting to start` cannot be
  produced here at all - it is a kubelet message and this cluster has no
  kubelet. A spec that needs a rejected log read uses the `k8s-stub` service.

| Log read | Status | Body |
|----------|--------|------|
| container name not in the pod | 400 | `container <name> is not valid for pod <pod>` |
| multi-container pod, no container named | 400 | `a container name must be specified for pod <pod>, choose one of: [...]` - real, and from the API server |
| pod does not exist | 404 | `pods "<name>" not found` |
| pod never scheduled (no node assigned) | 204 | empty. WAVE reads a 204 as a SUCCESSFUL empty log read, so an unscheduled pod is not a failure case and cannot be used as one |

### kwok pod exec (`ClusterExec` in `kwok/kwok.yaml`)

The `ClusterExec` doc turns on `kubectl exec` for the cluster. Without it every
exec call fails with `no exec found for container "<name>" in pod "<ns>/<pod>"`,
which is what the checked-in stack used to do.

kwok's only exec target type is `local`, so **the command runs as a real process
on the kwok container itself**, not in a pod. Real busybox, real exit codes, real
`tar`, real files - but every pod that the doc matches shares the kwok
container's one filesystem. Per-container isolation comes from the working
directories below; there is no per-pod isolation.

The doc is applied as a `--config` file at `kwokctl create cluster` time, exactly
like `ClusterLogs` and the Stages. It cannot be applied afterwards with
`kubectl`: the kwok CRDs are not registered in this cluster.

**Which pods get exec.** The selector lists pod NAMES and no namespaces, so exec
works in every namespace, including each run's own `wave-e2e-{runId8}`. kwok
matches selector entries literally (`slices.Contains`), so no pattern or prefix
form exists - a namespace list would have to name every per-run namespace, which
is why there is none.

| Pod name | Exec |
|----------|------|
| `wave-pod-exec` | yes - the main exec fixture, give it containers `app` and `sidecar` |
| `wave-pod-exec-b` | yes - second pod, for Cp legs that need two |
| any other name | refused with `no exec found for container "<name>" in pod "<ns>/<pod>"` |

A test that needs a refusal (Cp's negative leg) creates a pod under any other
name; `wave-pod-noexec` is the conventional one.

**Which container it lands in.** Entries are matched in order by container name;
the entry with no `containers` key is the catch-all. Each carries its own working
directory and environment, so a spec can prove which container it reached:

| Container | Working directory | `WAVE_EXEC_TARGET` |
|-----------|-------------------|--------------------|
| `app` | `/wave/exec/app` | `app-container` |
| `sidecar` | `/wave/exec/sidecar` | `sidecar-container` |
| any other | `/wave/exec` | `default-fallback` |

Those directories are created in the `Containerfile`. kwok chdir's into the
configured `workDir` and a missing one fails the exec.

`sh`, `ash`, `tar`, `gzip`, `busybox` and `python3` are present; `bash`, `perl`
and `node` are not. python3 is installed by this image's `apk` line purely so
Script legs have a second interpreter.

`kwokctl kubectl exec -c app` does NOT work - `-c` is kwokctl's own `--config`
flag. Call the kubectl already cached in the image directly:

```sh
podman exec wave-e2e-kwok \
  /root/.kwok/cache/https/dl.k8s.io/release/v1.33.0/bin/linux/amd64/kubectl \
  --kubeconfig=/root/.kwok/clusters/kwok/kubeconfig.yaml \
  -n <ns> exec wave-pod-exec -c app -- sh -c 'pwd'
```

### kwok exec-fidelity patch (`kwok/kwok-exec-fidelity.patch`)

Stock kwok v0.7.0 gets two things wrong in its process runner, and both of them
sit under the exec tests. The patch fixes both in `pkg/utils/exec/exec.go`
(+28 / -2), and the `Containerfile` builder stage rebuilds `./cmd/kwok` from
pinned source with it applied, replacing `/usr/local/bin/kwok` in the image.

| Gap | Stock behavior | Patched behavior |
|-----|----------------|------------------|
| stdin is never closed | kwok copies the client's stdin into the process but never closes the pipe, so a command that reads to EOF (`cat`, or an interpreter reading a script body) never returns and the exec hangs until the client gives up | the pipe is closed when the client's stream ends, so EOF arrives and the command exits |
| non-zero exit is an internal error | the status frame comes back `reason: InternalError`, code 500, with the exit code only as free text inside the message, and kubectl exits 1 | the canonical frame: `reason: NonZeroExitCode` with `details.causes[0]` = `{reason: ExitCode, message: "7"}`, and kubectl exits 7 |

Both hold on the v5 websocket transport and on v4 over SPDY. The status
`message` string is NOT canonical and differs between the two transports, so
assert on `reason` and `causes[].reason` only, never on message text. A
zero-exit command returns `{"metadata":{},"status":"Success"}` and stdout and
stderr stay on channels 1 and 2.

Cost of the patch: the fixture image build goes from a few seconds to about 40 s
and from 593 MB to 659 MB, because it now compiles kwok. That is paid once per
machine and again after any `Containerfile` change. **GitHub CI never builds or
runs this image** - the stack is brought up only by
`scripts/ci-playwright-local.sh` and `scripts/e2e-targeted-local.sh` on a
developer machine - so CI is unaffected.

The source is fetched at build time from the Go module proxy
(`https://proxy.golang.org/sigs.k8s.io/kwok/@v/${KWOK_VERSION}.zip`), which is
immutable and checksummed. `KWOK_VERSION` is a build ARG and has to track the
kwok half of the cluster image tag: `v0.7.0-k8s.v1.33.0` means `v0.7.0`. On a
kwok bump, `patch` fails the build loudly if the hunks stop applying; the quieter
risk is upstream fixing these its own way and the patch silently becoming a
no-op, which the exec specs would then catch.

### kwok Stages (`kwok/stages/`)

Two node Stages run before any pod can be scheduled: `node-initialize` brings
`kwok-node-0` Ready and fills its addresses, capacity and allocatable from the
checked-in node manifest, and `node-heartbeat-with-lease` keeps it Ready. Break
or remove either and every pod in every namespace stays Pending.

Stock path for every pod: `pod-ready` (Running, all containers ready) and
`pod-complete` (Job-owned pods succeed); `pod-delete` honors deletion. Six
opt-in Stages are selected by a pod LABEL, so unlabeled pods keep the stock
path and ordinary Deployments keep producing only their control-plane events
(`ScalingReplicaSet`, `SuccessfulCreate`, `Scheduled`):

| Pod label | Stage file | What the pod gets |
|-----------|------------|-------------------|
| `wave.e2e/kubelet-events: "true"` | `pod-kubelet-events.yaml` | Four kubelet lifecycle Events in order, one second apart - `Pulling`, `Pulled`, `Created`, `Started` (Normal, source `kwok_controller`) - then the stock `pod-ready` path; Ready about 3 s after creation. |
| `wave.e2e/crash-loop: "true"` | `pod-crash-loop.yaml` | A stable CrashLoopBackOff pod: phase `Running`, every container `restartCount: 3`, `ready: false`, `state.waiting.reason: CrashLoopBackOff`, `lastState.terminated` (`exitCode: 1`, `reason: Error`), `Ready`/`ContainersReady` False with reason `ContainersNotReady`, plus one `Warning BackOff` Event. Never reaches Ready. |
| `wave.e2e/container-creating: "true"` | `pod-container-creating.yaml` | A pod stuck before start, forever: phase `Pending`, every container `state.waiting.reason: ContainerCreating`, `ready: false`, `started: false`, `restartCount: 0`, conditions `PodReadyToStartContainers` True, `Initialized` True, `Ready`/`ContainersReady` False with reason `ContainersNotReady`. It does get a `podIP` - that is what stops the stock `pod-ready` Stage from taking it to Running, the same trick `pod-crash-loop` uses. Get and Events can assert the state. A log read against it is NOT a failure: kwok serves the container's log file with HTTP 200 and never says `is waiting to start`. |
| `wave.e2e/job-fail: "true"` | `pod-job-fail.yaml` | A Job-owned pod that terminates with a real failure: phase `Failed`, every container `state.terminated` with `exitCode: 1` and `reason: Error`, `ready: false`, `started: false`. The real Job controller then marks the Job `Failed` with `reason: BackoffLimitExceeded` on both `FailureTarget` and `Failed` (use `backoffLimit: 0` so the failure is one attempt). Unlabeled Job pods keep the stock `pod-complete` path (`Succeeded`, exit 0). The label goes on the Job's POD TEMPLATE, and a bare Pod cannot use it: `pod-complete` and `pod-job-fail` both require a `Job` owner reference. |
| `wave.e2e/helm-test: "true"` | `pod-helm-test-complete.yaml` | A BARE pod that terminates successfully: phase `Succeeded`, every container `state.terminated` with `exitCode: 0` and `reason: Completed`, once the stock `pod-ready` Stage has taken it to Running. This is the Stage that lets `helm test` finish: helm test hooks are bare Pods, and `pod-complete` cannot serve them because it requires a `Job` owner reference and kwok ANDs selector expressions. The Stage selects on this LABEL rather than on the `helm.sh/hook: test` annotation, so the fixture charts (`tls-lab/charts-src/`) put both on their test Pods. |
| `wave.e2e/helm-test-fail: "true"` (always together with `wave.e2e/helm-test`) | `pod-helm-test-fail.yaml` | The same hook pod terminates FAILED instead: phase `Failed`, `exitCode: 1`, `reason: Error`. Weight 1 beats `pod-helm-test-complete`'s 0 while both match, and phase `Failed` ends the other Stage's match. Only the `wave-demo-badtest` fixture chart carries it, which is what makes `helm test` report a failing hook. |

Use one opt-in label per pod. The helm-test pair is the one designed
combination (`wave.e2e/helm-test-fail` only ever appears next to
`wave.e2e/helm-test`); any other two of these Stages on the same pod both match
at weight 1 and which one wins is not defined.

Container names matter for logs: a helm test hook whose container is named
`test` (as the fixture charts name it) falls to the default `pod.log` file, so
`helm test --logs` reads back `kwok-log-line-1..3`.

Any pod can also be made to reach Ready SLOWLY, by annotation rather than by
label: `pod-ready.stage.kwok.x-k8s.io/delay` on the pod, a Go duration string
such as `"3s"`, delays the stock `pod-ready` Stage by that much. Unannotated
pods are untouched and still go Ready in about 250 ms. Put the annotation in a
Deployment's pod template with `maxSurge: 1` and `maxUnavailable: 0` and the
rolling update goes serial, so the window is replicas x delay and a rollout
status read has something to observe: 3 replicas at `"3s"` gives a 9 s
`rollout restart`. There is no jitter on purpose - the number a test writes is
the number it gets. `spec.minReadySeconds` on the workload is the other lever
and needs no annotation; it delays availability after readiness rather than
readiness itself.

Event messages are static (kwok renders no template into `next.event`), so
assert on `reason` and `type`, not on the image name inside the message.

### kwok custom resource (`kwok/manifests/crd-wavegadget.yaml`)

The cluster serves exactly one CRD, so `resource_type` = custom can be proven
against a real custom resource instead of a built-in.

| | |
|---|---|
| CRD | `wavegadgets.wave.e2e` |
| group | `wave.e2e` |
| scope | Namespaced |
| kind / listKind | `WaveGadget` / `WaveGadgetList` |
| plural / singular | `wavegadgets` / `wavegadget` |
| short names | `wgad`, `wg` |
| served versions | `v1` (stored and preferred) and `v1alpha1` (served only) |
| conversion | none - the default `None` strategy, so both versions answer with the same body under a different `apiVersion` |
| schema | `spec.size` and `status.phase`, both strings, identical in both versions |

Name forms, all five driven through the real resolver against the running
cluster: `WaveGadget`, `wavegadget`, `wavegadgets`, `wgad` and `wg` each
resolve, and the match is case-insensitive (`WAVEGADGET` resolves too). An
unpinned read goes through the group's preferred version, `wave.e2e/v1`. Pinning
needs the FULL group-version string: `wave.e2e/v1alpha1` resolves to the
served-but-not-stored version, and a bare `v1alpha1` resolves to nothing.

The CRD itself is baked into the image; nothing in a test should create or
delete it. `wave-gadget-0` is a standing instance in the read-only `restricted`
namespace (`spec.size: large`, label `wave-e2e: read`), so a custom-kind read
finds an object with no seeding at all. `helpers/k8s-seed.ts` does not create a
WaveGadget, so a spec that wants one inside its own run namespace creates it
there and lets the namespace delete clean it up.

Read access is aggregated into the built-in `view` role
(`kwok/manifests/rbac-wavegadget-view.yaml`), so `wave-limited-token`, minted run
tokens and the client cert can all read a WaveGadget. The impersonation subjects
are bound to their own narrow ClusterRoles rather than to `view`, so they still
cannot - the impersonation negatives are unchanged.

## k8s-stub fault injection (TEST-ONLY, `k8s-stub/`)

A TLS server that answers Kubernetes discovery successfully and fails only the
resource read, the way a spec asks. It exists because a real cluster cannot be
made to return 503, a gateway HTML page or a three-second stall on demand.

**Discovery must succeed.** `discover()` treats a discovery document answering
400 or more (other than 401 / 403) as empty and skips the group, so a stub that
failed everything would render `This cluster has no resource kind 'Pod'` instead
of the error under test. `/version`, `/api`, `/api/v1`, `/apis` and
`/apis/<group>/<version>` always answer 200, and `delay` never touches them;
everything else is a resource read and carries the fault. That split is why
`delay` does not slow K8s Connect - only the read times out. `vdelay` is the
deliberate exception: it stalls every request including discovery, which is the
only way to make Connect itself pass its own Timeout.

Configuration rides in the K8s Connect `api_url` path prefix, so a spec sets it
once and every read in that session inherits it:

```
https://127.0.0.1:9461/cfg/status=503/msg=the%20cluster%20is%20draining
https://127.0.0.1:9461/cfg/delay=3
https://127.0.0.1:9461                    <- no prefix: a healthy cluster
```

Directives, one per path segment, all optional, values percent-decoded. Parsing
stops at the first segment that is not `key=value`, and the rest is the API path.

| Directive | Effect | Default |
|-----------|--------|---------|
| `status=<code>` | HTTP status of the resource read | 200 |
| `body=<shape>` | `object`, `status` or `html` | implied by status: `object` under 400, `status` at 400+ |
| `msg=<text>` | message inside a Status body | `the server is currently unable to handle the request` |
| `delay=<seconds>` | wait before answering a read; decimals accepted | 0 |
| `vdelay=<seconds>` | wait before answering DISCOVERY as well, so K8s Connect itself can be made to time out; decimals accepted | 0 |
| `metrics=<code>` | status of `GET /apis/metrics.k8s.io/v1beta1` | 200 |
| `stamp=<form>` | timestamp form the Event objects carry: `zulu` (`...Z`), `colonless` (`...+0000`) or `hour` (`...+00`) | `zulu` |

An unknown directive makes every request answer 500 naming it, so a typo fails
at K8s Connect instead of passing a spec for the wrong reason. An unknown
`stamp` form does the same, naming the form.

`colonless` and `hour` are the two offset shapes `datetime.fromisoformat`
rejects on Python 3.10 and accepts on 3.12, so an Events read that passes on
WAVE can still raise inside a remote bundle. `zulu` is the default and the only
form a spec never needs to ask for.

Recipes, every one driven against the real plugins:

| Want | Prefix | Block |
|------|--------|-------|
| request timeout | `/cfg/delay=3` | any read with timeout below 3 |
| a Connect that times out | `/cfg/vdelay=3` | K8s Connect with timeout below 3; every later read stalls too |
| the same leg succeeding | `/cfg/delay=3` | the same read with timeout above 3 |
| table refusal | none | Get or Events with Output Format Table |
| the cluster's own error text | `/cfg/status=503` or `/cfg/status=503/msg=...` | any read |
| a gateway page behind an error | `/cfg/status=503/body=html` (also 401, 400) | any read; the message ends `(HTTP 503)` |
| a gateway page behind a 200 | `/cfg/body=html` | Get with Output Format JSON or YAML |
| a rejected log read | `/cfg/status=400/msg=<percent-encoded text>` | Logs; renders `Kubernetes rejected the log request: <text>` |
| no metrics API | `/cfg/metrics=404` | Top, hard-fails under both On Error settings |
| 406 on the Events path | `/cfg/status=406` | Events with Output Format Table |
| a 404 by name | `/cfg/status=404` | Get with `search_by = name` |
| an event stamp the remote floor cannot parse | `/cfg/stamp=colonless` (or `/cfg/stamp=hour`) | Events, run remotely on an SSH host |

Use a namespaced list or a named read for the error-text row: a 404 by name is
matched first and never shows the cluster message, so 503 is the safe status
there. Get's `search_by` defaults to `name`, so a list read must set
`search_by = list` (or `selector`) explicitly; Top's equivalent field is called
`select_by`.

TLS: the stub has its own CA (`k8s-stub/certs/ca.crt`, exported as
`K8S_STUB_CA_PEM`), not the WAVE Test CA. The SAN covers `localhost`,
`127.0.0.1`, the slirp gateway `10.0.2.2` and the compose name `k8s-stub`, so
`verify_ssl` stays on in host mode, container-shard mode and in-network mode
alike. There is no authentication: any token, or none, is accepted.

Happy path: the stub serves core `v1`, `apps/v1`, `batch/v1`,
`events.k8s.io/v1` and `metrics.k8s.io/v1beta1`. A list returns two objects named
`stub-one` and `stub-two`. It NEVER returns a Table, which is what makes the
table-refusal recipe work.

`helpers/config.ts` exports `K8S_STUB_HOST` (mode-aware, like `K8S_API_HOST`),
`K8S_STUB_PORT`, `K8S_STUB_CONFIG_PREFIX`, `K8S_STUB_DEFAULT_MESSAGE`,
`K8S_STUB_CA_PEM` and the three `K8S_STUB_STAMP_*` forms.

Regenerate the PKI with `k8s-stub/certs/generate-certs.sh`; it recreates the CA
only when absent, so a leaf regen does not rotate the anchor.

## tls-lab listener map

| Port | Listener | TLS behavior |
|------|----------|--------------|
| 9451 | `mtls` | `ssl_verify_client on` (client cert REQUIRED), TLS 1.0-1.3 |
| 9452 | `tls10` | TLSv1 only |
| 9453 | `tls11` | TLSv1.1 only |
| 9454 | `tls12` | TLSv1.2 only (healthcheck endpoint, with 9480 and 9481) |
| 9455 | `tls13` | TLSv1.3 only |
| 9456 | `cipher-pin` | TLSv1.2, single cipher ECDHE-RSA-AES256-GCM-SHA384 |
| 9457 | `cipher-reorder` | TLSv1.2, ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384, `ssl_prefer_server_ciphers off` (client preference wins) |
| 9463 | `chart-repo` | No TLS: plain HTTP static files, no auth. Helm chart repository (see below) |
| 9464 | `chart-repo-tls` | TLSv1.2/1.3 on the same lab-CA server cert, `auth_basic` (user `wave`, password `chart-secret`). Same chart repository |
| 9480 | `chain-full` | TLSv1.2/1.3 on the chain leaf, sent with the chain intermediate; `GET /` answers 200 `{"listener":"chain-full"}`. Verifies against the chain root alone |
| 9481 | `chain-leaf-only` | TLSv1.2/1.3 on the same chain leaf, sent alone; `GET /` answers 200 `{"listener":"chain-leaf-only"}`. Fails against the chain root alone, verifies when the chain intermediate is trusted |

TLSv1/1.1 negotiate for real on the stock nginx image via the service's own
`openssl.cnf` (MinProtocol=TLSv1, SECLEVEL=0) - no sidecar needed.

tls-lab PKI (TEST-ONLY, `tls-lab/certs/generate-certs.sh`): the server leaf and
the client identity are BOTH signed by the one WAVE Test CA
(`../simulators/https/certs/ca.pem`), which nginx also trusts for client
verification - CA_CERT_PEM stays the single trust anchor for every verify-on
assertion. Client material: `client.crt` + `client.key` (plain). The
`database.crt` + `database.key` pair in the same directory is the database
services' leaf, from its own script (see Databases above).

Chain PKI (TEST-ONLY, `tls-lab/certs/generate-chain-certs.sh`), separate from the
WAVE Test CA: root `WAVE E2E Chain Root CA` (`chain-root.crt`), intermediate
`WAVE E2E Chain Intermediate CA` (`chain-intermediate.crt`, CA with pathlen 0,
signed by the root) and the leaf `chain-leaf.crt` + `chain-leaf.key` (signed by
the intermediate, SAN `DNS:localhost, IP:127.0.0.1, IP:10.0.2.2, DNS:tls-lab`).
`chain-leaf-fullchain.crt` is the leaf followed by the intermediate, which 9480
sends. The CA keys are not kept: a rerun reissues all five files.
`helpers/config.ts` exports `TLS_LAB_CHAIN_FULL_PORT`, `TLS_LAB_CHAIN_LEAF_PORT`,
`TLS_LAB_CHAIN_ROOT_PEM` and `TLS_LAB_CHAIN_INTERMEDIATE_PEM`.

### Helm chart repository (`tls-lab/charts/`)

Listeners 9463 and 9464 serve one static directory - packaged charts plus
`index.yaml` - which is all a classic Helm chart repository is. Nothing runs
there; `helm ... --repo http://<host>:9463` reads `index.yaml` and then the
`.tgz` next to it. 9464 is the same directory behind TLS and basic auth, so the
repository credential and CA legs are real. The `http` block defaults every
response to `application/json`, so both chart listeners set their own types
(`.tgz` -> `application/gzip`, `.yaml` -> `application/yaml`).

| Chart | Versions | Content |
|-------|----------|---------|
| `wave-demo` | 0.1.0, 0.2.0 | Deployment + Service + a test hook that passes. `values.yaml` carries `marker`, which install sets and Reuse Values / Reset Values can be told apart by (it lands in the release's `config`). |
| `wave-demo-badtest` | 0.1.0 | Same workload, and a test hook that FAILS (its Pod carries `wave.e2e/helm-test-fail`). |
| `wave-demo-stuck` | 0.1.0 | A Deployment whose pod template carries `wave.e2e/container-creating`, so the release never becomes ready - what an atomic install times out on. |

Every test hook Pod carries both the `helm.sh/hook: test` annotation helm needs
and the `wave.e2e/helm-test` label the kwok Stage selects on, and names its
container `test` so `helm test --logs` reads back the default `pod.log`.

Sources live unpacked in `tls-lab/charts-src/<name>-<version>/`, one directory
per published version; `charts-src/package-charts.py` packages them into
`tls-lab/charts/` and rewrites `index.yaml`. Both the archives and the index are
CHECKED IN, and the index carries a sha256 digest per archive, so never edit a
chart source without re-running the script. The script needs no helm and its
output is byte-reproducible (fixed mtimes, owners and entry order), so a re-run
with no source change leaves the checked-in files untouched. `index.yaml` urls are
relative filenames, which is what lets the same directory answer on both
listeners and at every host address.

Basic auth for 9464 is `tls-lab/htpasswd` (apr1, the one scheme every nginx
build implements natively); the header of that file carries the openssl command
that regenerates it. Credentials and endpoints are exported from
`helpers/config.ts` as `CHART_REPO_HOST`, `CHART_REPO_PORT`,
`CHART_REPO_TLS_PORT`, `CHART_REPO_INTERNAL_SERVICE`, `CHART_REPO_USER` and
`CHART_REPO_PASSWORD`. Specs build repository URLs from those constants: 9463
and 9464 are outside the `injectHttp` fixture-rewrite range (9449-9461), so a
chart URL hardcoded in a fixture would not be rewritten for container shards.

The two helm binaries the suite runs against are pinned in their images: Helm
4.2.4 in the E2E runner (`scripts/Containerfile.e2e`, the image
`scripts/run-e2e-shard.sh` starts the backend in) and Helm 3.21.4 in `sshd`
(`services/sshd/Containerfile`), so the remote-execution leg proves the other
major. Both land at `/usr/local/bin/helm`.

## HTTPS leaf SAN

The `http-target`/`http-echo` leaf (`../simulators/https/certs/`) carries SAN
`DNS:localhost, IP:127.0.0.1, IP:10.0.2.2, DNS:http-target, DNS:http-echo`:
`10.0.2.2` because container shards reach the published ports at the slirp
gateway, and the compose DNS names because Remote-Exec bundles on `sshd` hit
the services by name with verification ON. Regenerating the leaf never touches
the CA (`generate-certs.sh` creates the CA only when absent).

## Reachability

- **Host mode** (the configs run straight on the host, which CONTRIBUTING forbids
  because it resets your dev backend's data): services publish on
  `127.0.0.1`; fixtures use those directly.
- **Container-shard mode** (CI): shards run with
  `--network slirp4netns:allow_host_loopback=true` and reach the host-published
  ports at the slirp gateway `10.0.2.2`. `helpers/config.ts` `SSH_TARGET_HOST`
  resolves per mode and the `injectSsh` import option rewrites SSH fixture
  `host` params (`127.0.0.1` -> `10.0.2.2`). `HTTP_TARGET_HOST` + the
  `injectHttp` option do the same for URLs on the published HTTP-side ports
  (9449-9461 allowlist only - backend URLs are never rewritten). The stub's
  `/cfg/...` prefix survives that rewrite: only host and port are replaced. The
  SSH ports (9445-9448 and 9462) are rewritten by host, not by port, so they
  need no place in that allowlist.
- Netcat fixtures reach `netcat-echo` and `sshd` through the same `injectSsh`
  host rewrite: their nodes carry Host `127.0.0.1`, and `NETCAT_ECHO_HOST`
  equals `SSH_TARGET_HOST`. Nodes that must stay on the dialing side's own
  loopback (the closed port 9479, every tunnel Local Port) carry Host
  `localhost`, which the rewrite never touches.
- Ping fixtures stand up no service: ICMP echo has no server. They target the
  dialing side's own loopback, the host as WAVE reaches it (`PING_GATEWAY_HOST`,
  which resolves per mode exactly as `SSH_TARGET_HOST` does), and `192.0.2.1`,
  a TEST-NET-1 address routed nowhere. The remote leg pings `netcat-target` by
  name, which only `sshd` resolves. Unprivileged ICMP needs
  `net.ipv4.ping_group_range=1000 1000` on every container WAVE runs in: the two
  podman run sites (`scripts/ci-playwright-local.sh`,
  `scripts/e2e-targeted-local.sh`) and the `sshd` service in `compose.yaml`.
- Database fixtures carry Host `127.0.0.1` on the direct leg and are imported
  through `injectServiceHost(fixture, SQL_TARGET_HOST)`, which rewrites every
  `host` key equal to the sentinel. The tunnel leg names the compose DNS service
  (`POSTGRES_SERVICE` and siblings) as the SSH Tunnel's far host; its Local Port
  lives on WAVE's own loopback, so the block's Host there must be one the
  rewrite leaves alone (`localhost`, as the Netcat tunnel nodes carry). The
  remote-host leg names the compose DNS service as the block's Host.
- OpenSearch fixtures reach the published ports (9477 direct, 9478 gateway)
  at `OPENSEARCH_TARGET_HOST`, which resolves per mode exactly as
  `SQL_TARGET_HOST` does. The tunnel leg names `opensearch:9200`
  (`OPENSEARCH_SERVICE`, `OPENSEARCH_INTERNAL_PORT`) as the SSH Tunnel's far
  host and verifies the server name `opensearch`; the remote-host leg calls
  `https://opensearch:9200` from `sshd`. `OPENSEARCH_CONTAINER`
  (`wave-e2e-opensearch`) reaches the same node from `sshd` and always fails
  verification. Port 9479 still has nothing listening.
- Internal services (`nested-sshd`, `http-target`, `kwok-internal`,
  `k8s-gateway`, `netcat-target`) are reachable only on the compose network,
  by service name, resolved server-side by `sshd`. That is what makes the
  jump-host, tunnel-only and remote-execution proofs real.

## Lifecycle

```bash
scripts/e2e-stack.sh build          # build the service images (podman build)
scripts/e2e-stack.sh up --wait      # start all services, wait until healthy
scripts/e2e-stack.sh up --wait sshd # start (and wait for) a subset
scripts/e2e-stack.sh status         # compose ps
scripts/e2e-stack.sh down           # stop + remove containers and volumes (keeps the network)
scripts/e2e-stack.sh run            # foreground: up + block + teardown on signal (Playwright webServer)
```

- CI (`ci-playwright-local.sh`) brings the stack up before shards and tears it
  down on exit.
- Local targeted runs (`e2e-targeted-local.sh`) bring the stack up and down
  around the run (`WAVE_E2E_KEEP_STACK=1` to persist it between iterations).
- In host mode, which CONTRIBUTING forbids, the webServer block keeps the stack
  up; an already-running stack is reused.

The wrapper owns two rootless-podman 3.4.x quirks: it pre-creates the external
network (`wave-e2e-net`) and patches its CNI conflist `cniVersion` 1.0.0 -> 0.4.0,
and it builds images with `podman build` (compose only references them by tag).

## Adding a service (future protocols: LDAP, ...)

1. Add `services/<name>/` with a Containerfile (+ any provisioning/config/keys).
   Check in deterministic test material (keys, certs) next to it.
2. Add the service to `compose.yaml`: `image: localhost/wave-e2e-<name>:latest`,
   a `healthcheck`, a `container_name: wave-e2e-<name>`, and either a
   `127.0.0.1:<port>:<port>` publish (if WAVE connects to it directly) or NO
   `ports:` (if it should only be reachable inside the network).
3. Add its build to `scripts/e2e-stack.sh` (`build_images`, `ensure_images`) and
   its name to `ALL_SERVICES`.
4. Add endpoint constants to `helpers/config.ts` (host + port, mode-aware like
   `SSH_TARGET_HOST`).
5. If shards mutate the service, isolate per-test state (unique names/paths,
   per-shard namespaces) - the stack is shared across parallel shards.
6. Document it in the table above.

Never add a new in-process fake/simulator for a protocol the stack can serve for
real.
