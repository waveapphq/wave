/**
 * Shared configuration for E2E tests
 *
 * Centralizes environment variable handling to avoid hardcoding ports
 * and other configuration values across test files.
 */

import fs from 'fs'
import path from 'path'

// Per-worker port routing for the N-stack CI layout. We use
// TEST_PARALLEL_INDEX (bounded 0..workers-1) rather than TEST_WORKER_INDEX
// (monotonically increasing - would index past N_STACKS after project
// dependencies swap workers). The modulo is a belt-and-suspenders guard.
const N_STACKS = Number(process.env.WAVE_E2E_N_STACKS || '4')
const RAW_PARALLEL_INDEX = Number(process.env.TEST_PARALLEL_INDEX ?? '0')
const STACK_INDEX = RAW_PARALLEL_INDEX % N_STACKS
const BACKEND_BASE_PORT = Number(process.env.WAVE_E2E_BACKEND_PORT || '8000')
const FRONTEND_BASE_PORT = Number(process.env.WAVE_E2E_FRONTEND_PORT || '3000')

/** Backend API port for the current worker */
export const BACKEND_PORT = String(BACKEND_BASE_PORT + STACK_INDEX)

/** Frontend port for the current worker */
export const FRONTEND_PORT = String(FRONTEND_BASE_PORT + STACK_INDEX)

/** Full backend URL for the current worker */
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`

/** Full frontend URL for the current worker */
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`

/**
 * Backend storage root for the current worker, for raw at-rest inspection
 * (encrypt-at-rest assertions read store files directly). Mirrors the data
 * dirs the backends are started with: run-e2e-shard.sh (container mode) and
 * the playwright config webServer blocks (host mode).
 */
export const STORAGE_BASE_PATH =
  process.env.WAVE_E2E_EXTERNAL_SERVICES === '1'
    ? '/tmp/wave-shard-data'
    : `/tmp/wave-e2e-stack-${STACK_INDEX}`

/**
 * Host of the published HTTP-side compose services (http-echo, tls-lab, the
 * proxies) as WAVE reaches them. Mirrors SSH_TARGET_HOST: host mode publishes
 * on 127.0.0.1; container shards reach the host-published ports through the
 * slirp gateway. HTTP fixtures carry the sentinel and the import helper
 * rewrites it (see injectHttpHost in fixture-import).
 */
export const HTTP_TARGET_HOST =
  process.env.HTTP_TARGET_HOST ||
  (process.env.WAVE_E2E_EXTERNAL_SERVICES === '1' ? '10.0.2.2' : '127.0.0.1')

/** The host value HTTP fixtures carry by default, rewritten to HTTP_TARGET_HOST at import. */
export const HTTP_FIXTURE_HOST_SENTINEL = '127.0.0.1'

/** http-echo published HTTPS port (same image + endpoints as http-target) */
export const HTTP_MAIN_PORT = '9449'

/** http-echo published HTTP health port */
export const HTTP_HEALTH_PORT = '9450'

/** tls-lab listeners (see tests/e2e/services/README.md for the matrix) */
export const TLS_LAB_MTLS_PORT = '9451'
export const TLS_LAB_TLS10_PORT = '9452'
export const TLS_LAB_TLS11_PORT = '9453'
export const TLS_LAB_TLS12_PORT = '9454'
export const TLS_LAB_TLS13_PORT = '9455'
export const TLS_LAB_CIPHER_PORT = '9456'
export const TLS_LAB_REORDER_PORT = '9457'

/** tls-lab chain listeners: 9480 sends the chain leaf with its intermediate, 9481 the leaf alone */
export const TLS_LAB_CHAIN_FULL_PORT = '9480'
export const TLS_LAB_CHAIN_LEAF_PORT = '9481'

/**
 * Helm chart repository, served as static files by the same tls-lab nginx:
 * 9463 plain HTTP with no auth, 9464 HTTPS (lab CA cert) with basic auth.
 * Fixture charts and their index live in tests/e2e/services/tls-lab/charts/.
 */
export const CHART_REPO_HOST = HTTP_TARGET_HOST
export const CHART_REPO_PORT = '9463'
export const CHART_REPO_TLS_PORT = '9464'

/** Compose DNS name of the chart repository as in-network hosts reach it */
export const CHART_REPO_INTERNAL_SERVICE = 'tls-lab'

/** Basic-auth credentials of the 9464 chart repository listener */
export const CHART_REPO_USER = 'wave'
export const CHART_REPO_PASSWORD = 'chart-secret'

/** OCI registry (HTTPS on the lab CA, basic auth) holding the chart `charts/wave-demo` 0.1.0 */
export const OCI_REGISTRY_PORT = '9482'
export const OCI_REGISTRY_SERVICE = 'oci-registry'
export const OCI_REGISTRY_INTERNAL_PORT = '5000'
export const OCI_REGISTRY_USER = 'wave'
export const OCI_REGISTRY_PASSWORD = 'oci-secret'
export const OCI_CHART_REF = `oci://${CHART_REPO_HOST}:${OCI_REGISTRY_PORT}/charts/wave-demo`

/** Forward proxies (tinyproxy): open and BasicAuth (wave / proxy-secret) */
export const PROXY_PORT = '9458'
export const PROXY_AUTH_PORT = '9459'
export const PROXY_AUTH_USER = 'wave'
export const PROXY_AUTH_SECRET = 'proxy-secret'

/**
 * Host of the published kwok Kubernetes API (service `kwok`) as WAVE reaches
 * it. Mirrors SSH_TARGET_HOST/HTTP_TARGET_HOST: host mode publishes on
 * 127.0.0.1; container shards reach the host-published port through the slirp
 * gateway. K8s fixtures carry https://127.0.0.1:9460 URLs and the injectHttp
 * import option rewrites them (9460 is in the allowlist).
 */
export const K8S_API_HOST =
  process.env.K8S_API_HOST ||
  (process.env.WAVE_E2E_EXTERNAL_SERVICES === '1' ? '10.0.2.2' : '127.0.0.1')

/** kwok published secure API port */
export const K8S_API_PORT = '9460'

/** Compose DNS name + in-network port of the internal-only kwok cluster */
export const K8S_INTERNAL_SERVICE = 'kwok-internal'
export const K8S_INTERNAL_PORT = '6443'

/** Compose DNS name of the published kwok cluster as in-network hosts reach it (port 6443) */
export const K8S_SERVICE = 'kwok'

/**
 * Compose-only nginx front for the published kwok cluster: plain HTTP on a
 * non-standard port plus a path prefix every API path joins under, so a
 * Connect base URL of http://k8s-gateway:8080/k8s/clusters/wave is real.
 */
export const K8S_GATEWAY_SERVICE = 'k8s-gateway'
export const K8S_GATEWAY_PORT = '8080'
export const K8S_GATEWAY_PREFIX = '/k8s/clusters/wave'

/** kwok static tokens (tests/e2e/services/kwok/tokens.csv): cluster-admin / view-only */
export const K8S_ADMIN_TOKEN = 'wave-admin-token'
export const K8S_LIMITED_TOKEN = 'wave-limited-token'

/**
 * kwok impersonation subjects (kwok/manifests/rbac-impersonation.yaml). No token maps
 * to any of them, so an impersonation header is the only way to act as one: the user
 * reads pods, pod logs and core events, the group reads pods only, and nobody is
 * deliberately unseeded and reads nothing.
 */
export const K8S_IMPERSONATE_USER = 'wave-reader'
export const K8S_IMPERSONATE_GROUP = 'wave-readers'
export const K8S_IMPERSONATE_NOBODY = 'wave-nobody'

/**
 * Host of the published K8s fault-injection stub (service `k8s-stub`) as WAVE
 * reaches it. Same rule as K8S_API_HOST: host mode publishes on 127.0.0.1,
 * container shards reach the host-published port through the slirp gateway.
 */
export const K8S_STUB_HOST =
  process.env.K8S_STUB_HOST ||
  (process.env.WAVE_E2E_EXTERNAL_SERVICES === '1' ? '10.0.2.2' : '127.0.0.1')

/** k8s-stub published TLS port */
export const K8S_STUB_PORT = '9461'

/**
 * Fault configuration for the stub, as an api_url path prefix on the K8s Connect
 * block. Directives: status, body (object|status|html), msg, delay, metrics, stamp.
 * See tests/e2e/services/README.md for the per-case recipes.
 */
export const K8S_STUB_CONFIG_PREFIX = '/cfg'

/**
 * Timestamp form the stub's Events carry, as a `stamp=<form>` directive value.
 * `colonless` and `hour` are offsets Python 3.10's isoformat reader rejects.
 */
export const K8S_STUB_STAMP_ZULU = 'zulu'
export const K8S_STUB_STAMP_COLONLESS = 'colonless'
export const K8S_STUB_STAMP_HOUR = 'hour'

/** The Status-body message the stub sends when no msg directive overrides it */
export const K8S_STUB_DEFAULT_MESSAGE = 'the server is currently unable to handle the request'

/** k8s-stub PKI (tests/e2e/services/k8s-stub/certs, TEST-ONLY): its own trust anchor */
export const K8S_STUB_CA_PEM = fs.readFileSync(
  path.resolve(__dirname, '../services/k8s-stub/certs/ca.crt'),
  'utf-8'
)

/** kwok PKI (tests/e2e/services/kwok/pki, TEST-ONLY): trust anchor + cert-auth client */
const K8S_PKI_DIR = path.resolve(__dirname, '../services/kwok/pki')
export const K8S_CA_PEM = fs.readFileSync(path.join(K8S_PKI_DIR, 'ca.crt'), 'utf-8')
export const K8S_CLIENT_CERT_PEM = fs.readFileSync(
  path.join(K8S_PKI_DIR, 'client.crt'),
  'utf-8'
)
export const K8S_CLIENT_KEY_PEM = fs.readFileSync(
  path.join(K8S_PKI_DIR, 'client.key'),
  'utf-8'
)

/**
 * Host of the shared compose SSH stack as WAVE reaches it. Host mode: the
 * services publish on 127.0.0.1. Container-shard mode: shards reach the
 * host-published ports through the slirp gateway (run-e2e-shard.sh exports
 * SSH_TARGET_HOST=10.0.2.2). SSH fixtures carry the 127.0.0.1 default and the
 * import helper rewrites it to this value (see injectServiceHost in fixture-import).
 */
export const SSH_TARGET_HOST =
  process.env.SSH_TARGET_HOST ||
  (process.env.WAVE_E2E_EXTERNAL_SERVICES === '1' ? '10.0.2.2' : '127.0.0.1')

/** The host value SSH fixtures carry by default, rewritten to SSH_TARGET_HOST at import. */
export const SSH_FIXTURE_HOST_SENTINEL = '127.0.0.1'

/** Main real-OpenSSH host (password + key auth, forwarding on, SFTP on) */
export const SSH_MAIN_PORT = process.env.SSH_MAIN_PORT || '9445'

/** Real-OpenSSH host with the SFTP subsystem removed */
export const SSH_NO_SFTP_PORT = process.env.SSH_NO_SFTP_PORT || '9447'

/** Real-OpenSSH host with AllowTcpForwarding disabled */
export const SSH_NO_FWD_PORT = process.env.SSH_NO_FWD_PORT || '9448'

/**
 * Real-OpenSSH host whose ForceCommand prints one line on stdout before every
 * command, so a probe's own output is never the first thing on the stream.
 */
export const SSH_BANNER_PORT = process.env.SSH_BANNER_PORT || '9446'

/** The exact line the banner host prints ahead of every command's output */
export const SSH_BANNER_LINE =
  'NOTICE: Authorized use only. All activity on this system is monitored and recorded.'

/** Real-OpenSSH host that runs the interpreter probe for real and fails every other command on stderr. */
export const SSH_BADPY_PORT = process.env.SSH_BADPY_PORT || '9462'

/** The exact stderr line the broken-interpreter host fails every non-probe command with */
export const SSH_BADPY_STDERR_LINE = "ModuleNotFoundError: No module named 'encodings'"

/** Compose service DNS names, resolved server-side by sshd for jump / tunnel targets */
export const SSH_NESTED_SERVICE = 'nested-sshd'
export const HTTP_TARGET_SERVICE = 'http-target'
export const SSH_MAIN_SERVICE = 'sshd'
export const SSH_NO_SFTP_SERVICE = 'sshd-no-sftp'
export const SSH_NO_FWD_SERVICE = 'sshd-no-fwd'

/** SSH stack credentials (matches tests/e2e/services/sshd/) */
export const SSH_STACK_USER = 'wave'
export const SSH_STACK_PASSWORD = 'wave-secret'

/** SFTP-only account on `sshd`, chrooted to a root holding only `/inbound` and `/outbound` */
export const SSH_DROPZONE_USER = 'dropzone'
export const SSH_DROPZONE_PASSWORD = 'dropzone-secret'

/** Passphrase of the committed key services/sshd/keys/wave_ed25519_passphrase (authorized for `wave`) */
export const SSH_KEY_PASSPHRASE = 'wave-key-passphrase'

/**
 * Host of the published Netcat echo (service `netcat-echo`) as WAVE reaches it.
 * Netcat fixtures carry the SSH sentinel and are imported with injectSsh, so
 * this is the SSH gateway value itself.
 */
export const NETCAT_ECHO_HOST = SSH_TARGET_HOST

/** Compose DNS name of the internal-only Netcat target (same listeners as netcat-echo) */
export const NETCAT_TARGET_SERVICE = 'netcat-target'

/** netcat-target / netcat-echo listeners: TCP echo, UDP echo, UDP sink that never replies */
export const NETCAT_TCP_ECHO_PORT = '9470'
export const NETCAT_UDP_ECHO_PORT = '9471'
export const NETCAT_UDP_SILENT_PORT = '9472'

/** Nothing listens here; `closed` proofs dial it on the dialing side's own loopback (Host `localhost`) */
export const NETCAT_CLOSED_PORT = '9479'

/**
 * Ping targets. ICMP has no service to stand up, so the three targets are the
 * dialing side's own loopback, the host as WAVE reaches it, and an address that
 * answers nowhere. Unprivileged ICMP needs
 * `net.ipv4.ping_group_range=1000 1000` on the container WAVE runs in; the two
 * podman run sites and the `sshd` compose service all carry it.
 */

/** The WAVE server's own loopback; answers echo in host mode and in a shard container. */
export const PING_LOOPBACK_HOST = '127.0.0.1'

/**
 * A non-loopback target WAVE can reach. Same rule as SSH_TARGET_HOST: host mode
 * pings 127.0.0.1, container shards ping the slirp host gateway. Fixtures carry
 * the sentinel and the spec rewrites the one block that uses it.
 */
export const PING_GATEWAY_HOST = SSH_TARGET_HOST

/** The host value the gateway Ping block carries, rewritten to PING_GATEWAY_HOST at import. */
export const PING_GATEWAY_SENTINEL = '127.0.0.1'

/** TEST-NET-1 (RFC 5737): routed nowhere, so every request to it goes unanswered. */
export const PING_SILENT_HOST = '192.0.2.1'

/** A name no resolver answers (RFC 6761 reserves `.invalid`). */
export const PING_UNRESOLVABLE_HOST = 'ping-no-such-host.invalid'

/** A local address the WAVE server does not hold, so binding to it is refused. */
export const PING_FOREIGN_SOURCE = '192.0.2.9'

/**
 * Host of the published database services (postgres, mariadb, oracle, mssql) as
 * WAVE reaches them. Mirrors HTTP_TARGET_HOST: host mode publishes on 127.0.0.1;
 * container shards reach the host-published ports through the slirp gateway.
 * SQL fixtures carry the 127.0.0.1 sentinel in their Host row and
 * injectServiceHost rewrites it to this value.
 */
export const SQL_TARGET_HOST =
  process.env.SQL_TARGET_HOST ||
  (process.env.WAVE_E2E_EXTERNAL_SERVICES === '1' ? '10.0.2.2' : '127.0.0.1')

/** Published database ports (each container keeps its native port inside the network) */
export const POSTGRES_PORT = '9473'
export const MARIADB_PORT = '9474'
export const ORACLE_PORT = '9475'
export const MSSQL_PORT = '9476'

/** Compose DNS names + in-network ports, for the tunnel far host and the remote-host leg */
export const POSTGRES_SERVICE = 'postgres'
export const POSTGRES_INTERNAL_PORT = '5432'
export const MARIADB_SERVICE = 'mariadb'
export const MARIADB_INTERNAL_PORT = '3306'
export const ORACLE_SERVICE = 'oracle'
export const ORACLE_INTERNAL_PORT = '1521'
export const MSSQL_SERVICE = 'mssql'
export const MSSQL_INTERNAL_PORT = '1433'

/** The compose container names: a second in-network name for the same server that the database leaf's SAN does not list */
export const POSTGRES_CONTAINER = 'wave-e2e-postgres'
export const MSSQL_CONTAINER = 'wave-e2e-mssql'

/** Database stack credentials, the same on all four (matches tests/e2e/services/<database>/) */
export const SQL_STACK_USER = 'wave'
export const SQL_STACK_PASSWORD = 'sql-secret'
export const SQL_STACK_DATABASE = 'wave'

/** Oracle's Database row: the service name of the default pluggable database, where schema WAVE lives */
export const ORACLE_SERVICE_NAME = 'FREEPDB1'

/**
 * Seed procedure on every database (Oracle: in schema WAVE), for the Call procedure
 * leg: in arguments a and b, out arguments total = a + b (integer) and label = 'sum'
 * (text).
 */
export const SQL_SEED_PROCEDURE = 'wave_add'

/** Host of the published OpenSearch ports as WAVE reaches them, resolved per mode like SQL_TARGET_HOST. */
export const OPENSEARCH_TARGET_HOST =
  process.env.OPENSEARCH_TARGET_HOST ||
  (process.env.WAVE_E2E_EXTERNAL_SERVICES === '1' ? '10.0.2.2' : '127.0.0.1')

/** Published OpenSearch ports: the node over HTTPS, the plain-HTTP gateway with its path prefix */
export const OPENSEARCH_PORT = '9477'
export const OPENSEARCH_GATEWAY_PORT = '9478'
export const OPENSEARCH_GATEWAY_PREFIX = '/os'

/** Compose DNS name + in-network port, for the tunnel far host and the remote-host leg */
export const OPENSEARCH_SERVICE = 'opensearch'
export const OPENSEARCH_INTERNAL_PORT = '9200'

/** The compose container name: a second in-network name for the node that its leaf's SAN does not list */
export const OPENSEARCH_CONTAINER = 'wave-e2e-opensearch'

/** OpenSearch logins (matches tests/e2e/services/opensearch/security/): the read user, the seeding admin, the 403 user */
export const OPENSEARCH_USER = 'wave'
export const OPENSEARCH_PASSWORD = 'os-secret'
export const OPENSEARCH_ADMIN_USER = 'admin'
export const OPENSEARCH_ADMIN_PASSWORD = 'Wave-Admin-Secret-1'
export const OPENSEARCH_LIMITED_USER = 'wave-limited'
export const OPENSEARCH_LIMITED_PASSWORD = 'Limited-Secret-7x!'

/** The checked-in HS256 JWT (subject wave-jwt, role wave_e2e_read, no expiry) */
export const OPENSEARCH_JWT = fs
  .readFileSync(path.resolve(__dirname, '../services/opensearch/jwt/wave-e2e.jwt'), 'utf-8')
  .trim()

/** WAVE Test CA PEM - the pinned trust anchor for every stack HTTPS service */
export const CA_CERT_PEM = fs.readFileSync(
  path.resolve(__dirname, '../simulators/https/certs/ca.pem'),
  'utf-8'
)

/** tls-lab client identity, signed by the same WAVE Test CA (mTLS listener) */
const TLS_LAB_CERTS_DIR = path.resolve(__dirname, '../services/tls-lab/certs')
export const TLS_LAB_CLIENT_CERT_PEM = fs.readFileSync(
  path.join(TLS_LAB_CERTS_DIR, 'client.crt'),
  'utf-8'
)
export const TLS_LAB_CLIENT_KEY_PEM = fs.readFileSync(
  path.join(TLS_LAB_CERTS_DIR, 'client.key'),
  'utf-8'
)

/** tls-lab chain PKI (generate-chain-certs.sh), apart from the WAVE Test CA: its root and the intermediate that signed the leaf */
export const TLS_LAB_CHAIN_ROOT_PEM = fs.readFileSync(
  path.join(TLS_LAB_CERTS_DIR, 'chain-root.crt'),
  'utf-8'
)
export const TLS_LAB_CHAIN_INTERMEDIATE_PEM = fs.readFileSync(
  path.join(TLS_LAB_CERTS_DIR, 'chain-intermediate.crt'),
  'utf-8'
)

/** Shared environment name for all functional E2E tests */
export const E2E_ENV_NAME = 'E2E Execution Env'

/**
 * Ensure the shared E2E environment exists. Creates it only if not found.
 * Call this from any functional test before running workflows.
 */
export async function ensureEnvironment(request: {
  get: (url: string) => Promise<any>
  post: (url: string, options: any) => Promise<any>
}): Promise<void> {
  const listResp = await request.get(`${BACKEND_URL}/environments/`)
  const body = await listResp.json()
  const envs = Array.isArray(body) ? body : (body.data ?? [])
  const exists = envs.some((e: any) => e.name === E2E_ENV_NAME)
  if (!exists) {
    await request.post(`${BACKEND_URL}/environments/`, {
      data: { name: E2E_ENV_NAME, description: 'Shared env for functional E2E tests' },
    })
  }
}
