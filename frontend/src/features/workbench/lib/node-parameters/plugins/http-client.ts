/**
 * HTTP Client Plugin Parameters
 */

import { group, output, param, type GroupMeta, type InputParam, type OutputParam, type SecretMaskField } from '../types'
import { tlsTrustInputs } from './_tls-shared'

const AUTH_MODE_LABELS: Record<string, string> = {
  basic: 'Basic',
  bearer: 'Bearer token',
  api_key: 'API key',
}

const BODY_MODE_LABELS: Record<string, string> = {
  text: 'Text',
  form: 'Form (URL-encoded)',
  multipart: 'Multipart (form-data)',
  file: 'File',
}

const RESPONSE_MODE_LABELS: Record<string, string> = { body: 'Body', file: 'File' }

const PROXY_MODE_LABELS: Record<string, string> = {
  'wave-setting': 'WAVE setting',
  off: 'Off',
}

export const groups: Record<string, GroupMeta> = {
  'Auth': group('Auth'),
  'Body': group('Body'),
  'Timeouts & Retries': group('Timeouts & Retries'),
  'Response': group('Response'),
  'TLS / Certificates': group('TLS / Certificates'),
  'Connection': group('Connection'),
}

const BLOCKED_HEADER_MESSAGES: Record<string, string> = {
  'content-length': 'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides',
}

const CONTENT_TYPE_ITEMS = [
  'application/json',
  'application/xml',
  'text/plain',
  'text/html',
  'application/yaml',
  'application/octet-stream',
].map((mediaType) => ({ label: mediaType, key: 'Content-Type', value: mediaType }))

const FILE_SOURCE_PLACEHOLDER = 'artifact://…, testdata://…, or /abs/path on host'

const TLS_VERSION_VALUES = ['1.0', '1.1', '1.2', '1.3']
const TLS_VERSION_LABELS: Record<string, string> = {
  '1.0': 'TLS 1.0',
  '1.1': 'TLS 1.1',
  '1.2': 'TLS 1.2',
  '1.3': 'TLS 1.3',
}
const TLS_DEFAULT_MIN = '1.2'
const TLS_DEFAULT_MAX = '1.3'

const AUTH_ON = { field: 'auth_enabled', values: ['true'] }
const AUTH_BASIC = [AUTH_ON, { field: 'auth_mode', values: ['basic'] }]
const AUTH_BEARER = [AUTH_ON, { field: 'auth_mode', values: ['bearer'] }]
const AUTH_API_KEY = [AUTH_ON, { field: 'auth_mode', values: ['api_key'] }]

export const inputs: InputParam[] = [
  // --- Ungrouped (always visible) ---
  param('url', 'URL', 'string', true, 'Full URL including scheme (e.g. https://api.example.com/v1/users)', {
    allowedFormats: ['plain'],
  }),
  param('method', 'Method', 'string', true, 'HTTP method for the request', {
    enumValues: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'], defaultValue: 'GET',
  }),
  param('headers', 'Headers', 'map', false, 'Request headers - including auth (Authorization, API keys)', {
    credentialCatalog: true,
    editorNote: 'Standard headers (Host, User-Agent, Accept, ...) are sent automatically - add a row to override.',
    keyPolicy: {
      keyNoun: 'header',
      caseInsensitive: true,
      blockedKeys: BLOCKED_HEADER_MESSAGES,
    },
    quickInserts: [
      {
        label: '+ Content-Type',
        items: [
          ...CONTENT_TYPE_ITEMS,
          { label: 'Custom…', sublabel: 'empty row, key prefilled', key: 'Content-Type', value: '' },
        ],
      },
    ],
  }),
  // --- Auth ---
  param('auth_enabled', 'Enable Auth', 'boolean', false, 'Compose an auth header from the fields below and add it to the request', {
    defaultValue: false, noExpression: true, group: 'Auth',
  }),
  param('auth_mode', 'Mode', 'string', false, 'How the auth header is composed: Basic credentials, a Bearer token, or an API key header', {
    enumValues: ['basic', 'bearer', 'api_key'], defaultValue: 'basic', noExpression: true, group: 'Auth',
    showWhen: AUTH_ON, retainOnHide: true,
    enumLabels: AUTH_MODE_LABELS,
  }),
  param('auth_username', 'Username', 'string', false, 'Username for HTTP Basic auth', {
    group: 'Auth', showWhenAll: AUTH_BASIC, requiredWhenAll: AUTH_BASIC,
    retainOnHide: true, allowedFormats: ['plain'],
  }),
  param('auth_password', 'Password', 'string', false, 'Password for HTTP Basic auth', {
    group: 'Auth', showWhenAll: AUTH_BASIC, requiredWhenAll: AUTH_BASIC,
    retainOnHide: true, secret: true, allowedFormats: ['plain'],
  }),
  param('auth_token', 'Token', 'string', false, 'Token placed in the Authorization: Bearer header', {
    group: 'Auth', showWhenAll: AUTH_BEARER, requiredWhenAll: AUTH_BEARER,
    retainOnHide: true, secret: true, allowedFormats: ['plain'],
  }),
  param('auth_header_name', 'Header Name', 'string', false, 'Header name carrying the API key (e.g. X-API-Key)', {
    group: 'Auth', defaultValue: 'X-API-Key', showWhenAll: AUTH_API_KEY, requiredWhenAll: AUTH_API_KEY,
    retainOnHide: true, allowedFormats: ['plain'],
  }),
  param('auth_key', 'API Key', 'string', false, 'API key sent in the configured header', {
    group: 'Auth', showWhenAll: AUTH_API_KEY, requiredWhenAll: AUTH_API_KEY,
    retainOnHide: true, secret: true, allowedFormats: ['plain'],
  }),
  // --- Body ---
  param('body_mode', 'Body Mode', 'string', false, 'How the request body is authored and encoded', {
    enumValues: ['text', 'form', 'multipart', 'file'], defaultValue: 'text', noExpression: true, group: 'Body',
    enumLabels: BODY_MODE_LABELS,
    enumSublabels: { multipart: 'file upload', file: 'file as body' },
  }),
  param('body', 'Body', 'string', false, 'Request body content (JSON, XML, or plain text); empty sends nothing', {
    showWhen: { field: 'body_mode', values: ['text'] }, retainOnHide: true, group: 'Body',
    contentTypeAdvisory: true,
  }),
  param('form_fields', 'Form Fields', 'map', false, 'URL-encoded form fields sent as the request body', {
    showWhen: { field: 'body_mode', values: ['form'] }, retainOnHide: true, group: 'Body',
    note: 'Content-Type: application/x-www-form-urlencoded - set automatically; with body headers off, the transport default applies',
  }),
  param('parts', 'Parts', 'array', false, 'Multipart form-data parts: text fields and file uploads', {
    showWhen: { field: 'body_mode', values: ['multipart'] }, retainOnHide: true, partsEditor: true, group: 'Body',
    note: 'Content-Type: multipart/form-data; boundary=(generated) - set automatically',
  }),
  param('file_source', 'File Source', 'string', false, 'File sent as the request body: artifact://, testdata://, or an absolute or relative path where the block runs', {
    showWhen: { field: 'body_mode', values: ['file'] },
    requiredWhen: { field: 'body_mode', values: ['file'] },
    retainOnHide: true, allowedFormats: ['plain'], placeholder: FILE_SOURCE_PLACEHOLDER, group: 'Body',
    fileReference: 'file',
  }),
  param('file_content_type', 'Type', 'string', false, 'Content-Type header sent with the file; Auto detects it from the file extension (fallback application/octet-stream)', {
    enumValues: ['auto', 'application/json', 'application/xml', 'text/plain', 'text/html', 'application/yaml', 'application/octet-stream'],
    defaultValue: 'auto', noExpression: true, group: 'Body',
    showWhen: { field: 'body_mode', values: ['file'] }, retainOnHide: true,
    enumLabels: { auto: 'Auto' },
  }),
  param('body_auto_headers', 'Auto Headers', 'boolean', false, 'Add the Content-Type header implied by the body mode automatically', {
    defaultValue: true, noExpression: true, group: 'Body',
    lockedWhen: { field: 'body_mode', values: ['multipart'], value: true },
  }),
  param('query_params', 'Query Params', 'map', false, 'URL query parameters appended as ?key=value&key2=value2'),
  // --- Timeouts & Retries ---
  param('timeout', 'Timeout', 'integer', false, 'Request timeout in seconds', { defaultValue: 30, group: 'Timeouts & Retries' }),
  param('retry_count', 'Retry Count', 'integer', false, 'Number of retry attempts on failure', { defaultValue: 0, group: 'Timeouts & Retries' }),
  param('retry_delay', 'Retry Delay', 'float', false, 'Initial delay between retries in seconds', { defaultValue: 1, group: 'Timeouts & Retries' }),
  param('retry_backoff_factor', 'Backoff Factor', 'float', false, 'Multiplier applied to retry delay after each attempt (e.g. 2 means 1s, 2s, 4s)', { defaultValue: 2, group: 'Timeouts & Retries' }),
  param('retryable_status_codes', 'Retryable Codes', 'array', false, 'HTTP status codes that trigger automatic retry (e.g. 502, 503, 504)', { defaultValue: ['502', '503', '504'], group: 'Timeouts & Retries' }),
  // --- Response ---
  param('response_mode', 'Response', 'string', true, 'Capture the response as text (body) or stream it to a file with a sha256 digest', {
    enumValues: ['body', 'file'], defaultValue: 'body', noExpression: true, group: 'Response',
    enumLabels: RESPONSE_MODE_LABELS,
  }),
  param('file_path', 'File Path', 'string', false, 'Where the download is saved: artifact:// or an absolute or relative path where the block runs; empty keeps the automatic name and location', {
    showWhen: { field: 'response_mode', values: ['file'] }, group: 'Response', allowedFormats: ['plain'],
    fileReference: 'save-as',
  }),
  param('max_size', 'Max Size', 'integer', false, 'Response size cap in bytes; empty = 1 MB in body mode, unlimited in file mode. Exceeding it truncates with a warning', {
    group: 'Response',
  }),
  // --- TLS / Certificates ---
  ...tlsTrustInputs('TLS / Certificates'),
  param('tls_min_version', 'Min TLS Version', 'string', false, 'Lowest TLS protocol version offered to the server', {
    enumValues: TLS_VERSION_VALUES, defaultValue: TLS_DEFAULT_MIN, noExpression: true, group: 'TLS / Certificates',
    enumLabels: TLS_VERSION_LABELS,
    notAbove: { field: 'tls_max_version', message: 'Min TLS Version cannot exceed Max TLS Version' },
    clampsSibling: { field: 'tls_max_version', keep: 'atLeast' },
  }),
  param('tls_max_version', 'Max TLS Version', 'string', false, 'Highest TLS protocol version offered to the server', {
    enumValues: TLS_VERSION_VALUES, defaultValue: TLS_DEFAULT_MAX, noExpression: true, group: 'TLS / Certificates',
    enumLabels: TLS_VERSION_LABELS,
    clampsSibling: { field: 'tls_min_version', keep: 'atMost' },
  }),
  param('cipher_suites', 'Cipher Suites', 'array', false, 'Cipher suites offered to the server, in client preference order per protocol family. Unset offers every suite WAVE supports for the selected TLS version range; an empty selection offers no ciphers. OpenSSL and IANA names accepted', {
    group: 'TLS / Certificates', cipherPicker: true, cipherDefaultsBlock: 'http-client',
  }),
  // --- Connection ---
  param('allow_redirects', 'Allow Redirects', 'boolean', false, 'Automatically follow HTTP 3xx redirect responses', { defaultValue: true, group: 'Connection' }),
  param('max_redirects', 'Max Redirects', 'integer', false, 'Maximum redirect hops before stopping (prevents infinite loops)', { defaultValue: 10, group: 'Connection' }),
  param('proxy_mode', 'Proxy', 'string', false, "Proxy: WAVE setting follows Settings > Network > Proxy; Off connects directly. On a remote host the block uses that host's own proxy settings.", {
    enumValues: ['wave-setting', 'off'], defaultValue: 'wave-setting', noExpression: true, group: 'Connection',
    enumLabels: PROXY_MODE_LABELS,
    lockedOnRemoteHost: { displayText: "Remote host's settings" },
  }),
]

// Credential-bearing headers this plugin knows by protocol - the per-block
// Secret Masking checklist. Keys are the canonical lowercase names and MUST
// equal the backend HTTPClientPlugin._SENSITIVE_HEADERS set (guarded by a
// parity test).
export const secretMaskFields: SecretMaskField[] = [
  { key: 'authorization', label: 'Authorization' },
  { key: 'proxy-authorization', label: 'Proxy-Authorization' },
  { key: 'cookie', label: 'Cookie' },
  { key: 'set-cookie', label: 'Set-Cookie' },
  { key: 'x-api-key', label: 'X-Api-Key' },
  { key: 'x-auth-token', label: 'X-Auth-Token' },
  { key: 'x-csrf-token', label: 'X-CSRF-Token' },
  { key: 'x-xsrf-token', label: 'X-XSRF-Token' },
]

export const outputs: OutputParam[] = [
  output('status_code', 'Status Code', 'integer', 'HTTP response status code (e.g. 200, 404, 500)'),
  output('body', 'Body', 'string', 'Response text in body mode; the downloaded file path in file mode (artifact reference on WAVE, host path under Remote Execution)'),
  output('headers', 'Headers', 'map', 'Response headers as key-value map'),
  output('content_type', 'Content Type', 'string', 'Response Content-Type header (e.g. application/json)'),
  output('response_time', 'Response Time', 'float', 'Request duration in seconds'),
  output('final_url', 'Final URL', 'string', 'Final URL after following redirects (same as request URL if no redirects)'),
  output('size', 'Size', 'integer', 'Bytes received (body mode) or written to disk (file mode)'),
  output('sha256', 'SHA-256', 'string', 'Hex digest of the downloaded file in file mode; empty in body mode'),
  output('trace', 'Trace', 'map', 'Structured wire-level trace: tls, timing, hops, and sizes'),
]
