/** Shared E2E configuration, so no test file hard-codes a port or host. */

import fs from 'fs'
import os from 'os'
import path from 'path'

/** Backend API port of the shard's own backend */
export const BACKEND_PORT = process.env.WAVE_E2E_BACKEND_PORT || '8000'

/** Frontend port of the shard's own frontend */
export const FRONTEND_PORT = process.env.WAVE_E2E_FRONTEND_PORT || '3000'

/** Full backend URL of the shard */
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`

/** Full frontend URL of the shard */
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`

/** The shard backend's storage root, the data dir run-e2e-shard.sh starts it with, for at-rest reads. */
export const STORAGE_BASE_PATH = path.join(os.tmpdir(), 'wave-shard-data')

/** The slirp gateway, where a shard container reaches the host-published compose service ports. */
const SHARD_GATEWAY_HOST = '10.0.2.2'

/** Host of the HTTP-side compose services: the slirp gateway; injectHttpHost rewrites the fixture sentinel to it. */
export const HTTP_TARGET_HOST = process.env.HTTP_TARGET_HOST || SHARD_GATEWAY_HOST

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

/** Helm chart repository on the tls-lab nginx: 9463 plain HTTP, 9464 HTTPS with basic auth. */
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

/** Host of the kwok Kubernetes API: the slirp gateway; the injectHttp import option rewrites the fixture URLs to it. */
export const K8S_API_HOST = process.env.K8S_API_HOST || SHARD_GATEWAY_HOST

/** kwok published secure API port */
export const K8S_API_PORT = '9460'

/** Compose DNS name + in-network port of the internal-only kwok cluster */
export const K8S_INTERNAL_SERVICE = 'kwok-internal'
export const K8S_INTERNAL_PORT = '6443'

/** Compose DNS name of the published kwok cluster as in-network hosts reach it (port 6443) */
export const K8S_SERVICE = 'kwok'

/** Compose-only nginx front for kwok: plain HTTP on a non-standard port under a path prefix. */
export const K8S_GATEWAY_SERVICE = 'k8s-gateway'
export const K8S_GATEWAY_PORT = '8080'
export const K8S_GATEWAY_PREFIX = '/k8s/clusters/wave'

/** kwok static tokens (tests/e2e/services/kwok/tokens.csv): cluster-admin / view-only */
export const K8S_ADMIN_TOKEN = 'wave-admin-token'
export const K8S_LIMITED_TOKEN = 'wave-limited-token'

/** kwok impersonation subjects; no token maps to any of them (kwok/manifests/rbac-impersonation.yaml). */
export const K8S_IMPERSONATE_USER = 'wave-reader'
export const K8S_IMPERSONATE_GROUP = 'wave-readers'
export const K8S_IMPERSONATE_NOBODY = 'wave-nobody'

/** Host of the published K8s fault-injection stub (service `k8s-stub`) as WAVE reaches it: the slirp gateway. */
export const K8S_STUB_HOST = process.env.K8S_STUB_HOST || SHARD_GATEWAY_HOST

/** k8s-stub published TLS port */
export const K8S_STUB_PORT = '9461'

/** Stub fault configuration as an api_url path prefix; recipes in tests/e2e/services/README.md. */
export const K8S_STUB_CONFIG_PREFIX = '/cfg'

/** Stub Events timestamp form; `colonless` and `hour` are offsets Python 3.10's isoformat rejects. */
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

/** Host of the compose SSH stack: the slirp gateway; injectServiceHost rewrites the fixture sentinel to it. */
export const SSH_TARGET_HOST = process.env.SSH_TARGET_HOST || SHARD_GATEWAY_HOST

/** The host value SSH fixtures carry by default, rewritten to SSH_TARGET_HOST at import. */
export const SSH_FIXTURE_HOST_SENTINEL = '127.0.0.1'

/** Main real-OpenSSH host (password + key auth, forwarding on, SFTP on) */
export const SSH_MAIN_PORT = process.env.SSH_MAIN_PORT || '9445'

/** Real-OpenSSH host with the SFTP subsystem removed */
export const SSH_NO_SFTP_PORT = process.env.SSH_NO_SFTP_PORT || '9447'

/** Real-OpenSSH host with AllowTcpForwarding disabled */
export const SSH_NO_FWD_PORT = process.env.SSH_NO_FWD_PORT || '9448'

/** OpenSSH host that prints a banner line before every command. */
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

/** Host of the Netcat echo; its fixtures use the SSH sentinel and injectSsh. */
export const NETCAT_ECHO_HOST = SSH_TARGET_HOST

/** Compose DNS name of the internal-only Netcat target (same listeners as netcat-echo) */
export const NETCAT_TARGET_SERVICE = 'netcat-target'

/** netcat-target / netcat-echo listeners: TCP echo, UDP echo, UDP sink that never replies */
export const NETCAT_TCP_ECHO_PORT = '9470'
export const NETCAT_UDP_ECHO_PORT = '9471'
export const NETCAT_UDP_SILENT_PORT = '9472'

/** Nothing listens here; `closed` proofs dial it on the dialing side's own loopback (Host `localhost`) */
export const NETCAT_CLOSED_PORT = '9479'

// Ping targets; unprivileged ICMP needs net.ipv4.ping_group_range=1000 1000 on WAVE's container.

/** The WAVE server's own loopback in its shard container. */
export const PING_LOOPBACK_HOST = '127.0.0.1'

/** A non-loopback target WAVE can reach: the slirp host gateway. */
export const PING_GATEWAY_HOST = SSH_TARGET_HOST

/** The host value the gateway Ping block carries, rewritten to PING_GATEWAY_HOST at import. */
export const PING_GATEWAY_SENTINEL = '127.0.0.1'

/** TEST-NET-1 (RFC 5737): routed nowhere, so every request to it goes unanswered. */
export const PING_SILENT_HOST = '192.0.2.1'

/** A name no resolver answers (RFC 6761 reserves `.invalid`). */
export const PING_UNRESOLVABLE_HOST = 'ping-no-such-host.invalid'

/** A local address the WAVE server does not hold, so binding to it is refused. */
export const PING_FOREIGN_SOURCE = '192.0.2.9'

/** Host of the database services: the slirp gateway; injectServiceHost rewrites the fixture sentinel to it. */
export const SQL_TARGET_HOST = process.env.SQL_TARGET_HOST || SHARD_GATEWAY_HOST

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

/** Seed procedure on every database (Oracle: schema WAVE): total = a + b, label = 'sum'. */
export const SQL_SEED_PROCEDURE = 'wave_add'

/** Host of the published OpenSearch ports as WAVE reaches them: the slirp gateway, like SQL_TARGET_HOST. */
export const OPENSEARCH_TARGET_HOST = process.env.OPENSEARCH_TARGET_HOST || SHARD_GATEWAY_HOST

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

/** Create the shared E2E environment if it does not exist. */
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
