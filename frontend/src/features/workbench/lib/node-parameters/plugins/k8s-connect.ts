/**
 * K8s Connect Plugin Parameters
 *
 * Credentials are modeless: optional bearer token and/or optional client
 * cert pair, any combination including none. The TLS / Certificates group
 * mirrors the HTTP plugin's section plus tls_server_name, with a PEM-only CA (K8SCON-3).
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import { k8sTimeoutInput } from './_k8s-shared'
import { tlsTrustInputs } from './_tls-shared'

const TLS_VERSION_VALUES = ['1.0', '1.1', '1.2', '1.3']
const TLS_VERSION_LABELS: Record<string, string> = {
  '1.0': 'TLS 1.0',
  '1.1': 'TLS 1.1',
  '1.2': 'TLS 1.2',
  '1.3': 'TLS 1.3',
}

const [VERIFY_SSL, SHARED_CA_CERT, CLIENT_CERT, CLIENT_KEY] = tlsTrustInputs('TLS / Certificates')

// The K8s path takes the CA as PEM text only; it never reads a file.
const CA_CERT: InputParam = {
  ...SHARED_CA_CERT,
  description: 'CA certificate (variable reference or PEM string); when set, it is the only certificate this block trusts',
}

const RUN_TOKEN_ON = { field: 'acquire_run_token', values: ['true'] }

export const groups: Record<string, GroupMeta> = {
  'Connection': group('Connection', {
    description: 'API server URL, default namespace, and request timeout',
    defaultExpanded: true,
  }),
  'Authentication': group('Authentication', {
    description:
      'How WAVE identifies itself to the cluster: an optional bearer token, a TLS client certificate, or neither (anonymous or proxied access)',
    defaultExpanded: true,
  }),
  'TLS / Certificates': group('TLS / Certificates', {
    description:
      "Server trust and TLS behavior. A client certificate the cluster's client CA recognizes is also the identity WAVE presents",
    defaultExpanded: true,
  }),
}

export const inputs: InputParam[] = [
  // --- Connection ---
  param('api_url', 'API URL', 'string', true, 'Full base URL of the Kubernetes API server: http or https, any port, optional path prefix for gateway-mounted clusters (e.g. http://srv:12345/k8s/clusters/c-1); every API call is joined under it', {
    group: 'Connection',
    allowedFormats: ['plain'],
  }),
  param('namespace', 'Namespace', 'string', false, 'Default namespace carried in the session; blocks that specify their own namespace override it', {
    defaultValue: 'default', group: 'Connection',
  }),
  { ...k8sTimeoutInput(30), group: 'Connection' },
  // --- Authentication ---
  param('token', 'Bearer Token', 'string', false, 'Bearer token sent in the Authorization header; optional - a client certificate, both, or neither also works', {
    group: 'Authentication', secret: true, allowedFormats: ['plain'],
  }),
  param('acquire_run_token', 'Get SA Token', 'boolean', false, 'Mint a service account token for the requested duration (the same mechanism as kubectl create token) and put it in the K8s Session instead of the Bearer Token above; the cluster reports back when the token expires', {
    defaultValue: false, group: 'Authentication',
  }),
  param('run_token_service_account', 'Service Account', 'string', false, 'Service account the run token is minted for', {
    group: 'Authentication', showWhen: RUN_TOKEN_ON, requiredWhen: RUN_TOKEN_ON, retainOnHide: true,
  }),
  param('run_token_namespace', 'SA Namespace', 'string', false, 'Namespace of the service account', {
    defaultValue: 'default', group: 'Authentication', showWhen: RUN_TOKEN_ON, retainOnHide: true,
  }),
  param('run_token_duration', 'Duration (s)', 'integer', false, 'Requested token lifetime in seconds (minimum 600); the cluster may cap it and the granted expiry is logged', {
    defaultValue: 14400, group: 'Authentication', showWhen: RUN_TOKEN_ON, retainOnHide: true,
  }),
  // --- TLS / Certificates (mirrors the HTTP plugin's section + tls_server_name) ---
  VERIFY_SSL,
  CA_CERT,
  param('tls_server_name', 'TLS Server Name', 'string', false, 'Hostname used for SNI and certificate verification when the cluster is reached through a tunnel or by IP address', {
    group: 'TLS / Certificates',
  }),
  CLIENT_CERT,
  CLIENT_KEY,
  param('tls_min_version', 'Min TLS Version', 'string', false, 'Lowest TLS protocol version offered to the server', {
    enumValues: TLS_VERSION_VALUES, defaultValue: '1.2', noExpression: true, group: 'TLS / Certificates',
    enumLabels: TLS_VERSION_LABELS,
    notAbove: { field: 'tls_max_version', message: 'Min TLS Version cannot exceed Max TLS Version' },
    clampsSibling: { field: 'tls_max_version', keep: 'atLeast' },
  }),
  param('tls_max_version', 'Max TLS Version', 'string', false, 'Highest TLS protocol version offered to the server', {
    enumValues: TLS_VERSION_VALUES, defaultValue: '1.3', noExpression: true, group: 'TLS / Certificates',
    enumLabels: TLS_VERSION_LABELS,
    clampsSibling: { field: 'tls_min_version', keep: 'atMost' },
  }),
  param('cipher_suites', 'Cipher Suites', 'array', false, 'Cipher suites offered to the server, in client preference order per protocol family. Unset offers every suite WAVE supports for the selected TLS version range; an empty selection offers no ciphers. The K8s Session always carries the exact suites offered. OpenSSL and IANA names accepted', {
    group: 'TLS / Certificates', cipherPicker: true, cipherDefaultsBlock: 'k8s-connect',
  }),
]

export const outputs: OutputParam[] = [
  output('session', 'K8s Session', 'string', 'Kubectl-compatible session carrying the server URL, trust settings, credentials, and default namespace', {
    secret: true,
  }),
  output('cluster_version', 'Cluster Version', 'string', 'Version reported by the API server (raw gitVersion, e.g. v1.33.0)'),
]
