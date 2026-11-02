/**
 * Kubernetes API stub for E2E fault injection (test-only).
 *
 * Serves a canned discovery surface (/version, /api, /api/v1, /apis,
 * /apis/<group>/<version>) that always succeeds, and injects the configured
 * fault only into the RESOURCE read. Discovery must succeed: a discovery
 * document answering >= 400 with anything but 401/403 is treated as empty and
 * the kind is skipped, which hides the HTTP error under test.
 *
 * Configuration rides in the api_url path prefix K8s Connect already supports
 * for gateway-mounted clusters, so a spec sets it once on Connect and every
 * read in that session inherits it:
 *
 *   https://127.0.0.1:9461/cfg/status=503/msg=the%20server%20is%20busy
 *
 * Directives, each its own path segment, all optional:
 *   status=<code>    status of the resource read                 (default 200)
 *   body=<shape>     object | status | html          (default: implied by status)
 *   msg=<text>       message inside a Status body, percent-encoded
 *   delay=<seconds>  wait this long before answering a read      (default 0)
 *   vdelay=<seconds> wait this long before answering DISCOVERY too, so K8s
 *                    Connect itself can be made to time out          (default 0)
 *   metrics=<code>   status of GET /apis/metrics.k8s.io/v1beta1  (default 200)
 *   stamp=<form>     event timestamp form: zulu | colonless | hour (default zulu)
 *
 * An unknown directive makes every request answer 500 naming it, so a typo
 * fails at K8s Connect instead of passing a spec for the wrong reason.
 */

import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const PORT = parseInt(process.env.K8S_STUB_PORT || '9461', 10)

const certsDir = path.join(__dirname, 'certs')
const tlsOptions = {
  key: fs.readFileSync(path.join(certsDir, 'server.key')),
  cert: fs.readFileSync(path.join(certsDir, 'server.crt')),
}

const GIT_VERSION = 'v1.33.0'
const METRICS_GROUP_VERSION = 'metrics.k8s.io/v1beta1'
const DEFAULT_STATUS_MESSAGE = 'the server is currently unable to handle the request'
const NOT_FOUND_MESSAGE = 'the server could not find the requested resource'

interface ResourceEntry {
  name: string
  singularName: string
  kind: string
  namespaced: boolean
}

function entry(name: string, singularName: string, kind: string, namespaced: boolean): ResourceEntry {
  return { name, singularName, kind, namespaced }
}

/** Every group/version the stub discovers; a read of a plural outside it is a 404. */
const RESOURCES: Record<string, ResourceEntry[]> = {
  v1: [
    entry('pods', 'pod', 'Pod', true),
    entry('pods/log', 'pod', 'Pod', true),
    entry('services', 'service', 'Service', true),
    entry('secrets', 'secret', 'Secret', true),
    entry('configmaps', 'configmap', 'ConfigMap', true),
    entry('events', 'event', 'Event', true),
    entry('serviceaccounts', 'serviceaccount', 'ServiceAccount', true),
    entry('namespaces', 'namespace', 'Namespace', false),
    entry('nodes', 'node', 'Node', false),
  ],
  'apps/v1': [
    entry('deployments', 'deployment', 'Deployment', true),
    entry('replicasets', 'replicaset', 'ReplicaSet', true),
    entry('statefulsets', 'statefulset', 'StatefulSet', true),
    entry('daemonsets', 'daemonset', 'DaemonSet', true),
  ],
  'batch/v1': [
    entry('jobs', 'job', 'Job', true),
    entry('cronjobs', 'cronjob', 'CronJob', true),
  ],
  'events.k8s.io/v1': [entry('events', 'event', 'Event', true)],
  [METRICS_GROUP_VERSION]: [
    entry('pods', 'pod', 'PodMetrics', true),
    entry('nodes', 'node', 'NodeMetrics', false),
  ],
}

const GROUP_VERSIONS = Object.keys(RESOURCES).filter((gv) => gv !== 'v1')

interface StubConfig {
  status: number
  body: string
  message: string
  delaySeconds: number
  discoveryDelaySeconds: number
  metricsStatus: number
  stamp: string
  error: string | null
}

/** Timestamp offset an Event carries per stamp form; the key set is the accepted vocabulary. */
const STAMP_OFFSETS: Record<string, string> = {
  zulu: 'Z',
  colonless: '+0000',
  hour: '+00',
}

const DIRECTIVE = /^([a-z]+)=(.*)$/

function defaultConfig(): StubConfig {
  return {
    status: 200,
    body: '',
    message: DEFAULT_STATUS_MESSAGE,
    delaySeconds: 0,
    discoveryDelaySeconds: 0,
    metricsStatus: 200,
    stamp: 'zulu',
    error: null,
  }
}

function applyStamp(config: StubConfig, value: string): void {
  if (STAMP_OFFSETS[value] === undefined) {
    config.error = `unknown k8s-stub stamp form '${value}'`
    return
  }
  config.stamp = value
}

function applyDirective(config: StubConfig, key: string, value: string): void {
  if (key === 'status') config.status = parseInt(value, 10)
  else if (key === 'body') config.body = value
  else if (key === 'msg') config.message = value
  else if (key === 'delay') config.delaySeconds = parseFloat(value)
  else if (key === 'vdelay') config.discoveryDelaySeconds = parseFloat(value)
  else if (key === 'metrics') config.metricsStatus = parseInt(value, 10)
  else if (key === 'stamp') applyStamp(config, value)
  else config.error = `unknown k8s-stub directive '${key}'`
}

function readConfig(pathname: string): { config: StubConfig; segments: string[] } {
  const parts = pathname.split('/').filter((part) => part !== '')
  const config = defaultConfig()
  let index = 0
  if (parts[0] === 'cfg') {
    index = 1
    while (index < parts.length) {
      const match = DIRECTIVE.exec(parts[index])
      if (!match) break
      applyDirective(config, match[1], decodeURIComponent(match[2]))
      index += 1
    }
  }
  return { config, segments: parts.slice(index) }
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json).toString(),
  })
  res.end(json)
}

function statusObject(status: number, message: string, reason: string): Record<string, unknown> {
  return {
    kind: 'Status',
    apiVersion: 'v1',
    metadata: {},
    status: 'Failure',
    message,
    reason,
    code: status,
  }
}

function statusResponse(res: ServerResponse, status: number, message: string, reason: string): void {
  jsonResponse(res, status, statusObject(status, message, reason))
}

/** No colon anywhere: a YAML load of this page must stay a scalar, never a mapping. */
const GATEWAY_PAGE = [
  '<html>',
  '<head><title>Gateway</title></head>',
  '<body>',
  '<center><h1>The gateway answered instead of the cluster</h1></center>',
  '<hr><center>wave-e2e-gateway</center>',
  '</body>',
  '</html>',
  '',
].join('\n')

function htmlResponse(res: ServerResponse, status: number): void {
  if (res.writableEnded) return
  res.writeHead(status, {
    'Content-Type': 'text/html',
    'Content-Length': Buffer.byteLength(GATEWAY_PAGE).toString(),
  })
  res.end(GATEWAY_PAGE)
}

function textResponse(res: ServerResponse, status: number, text: string): void {
  if (res.writableEnded) return
  res.writeHead(status, {
    'Content-Type': 'text/plain',
    'Content-Length': Buffer.byteLength(text).toString(),
  })
  res.end(text)
}

function reasonFor(status: number): string {
  if (status === 400) return 'BadRequest'
  if (status === 401) return 'Unauthorized'
  if (status === 403) return 'Forbidden'
  if (status === 404) return 'NotFound'
  if (status === 406) return 'NotAcceptable'
  if (status === 409) return 'Conflict'
  if (status === 503) return 'ServiceUnavailable'
  return 'InternalError'
}

function resourceList(groupVersion: string): Record<string, unknown> {
  return {
    kind: 'APIResourceList',
    apiVersion: 'v1',
    groupVersion,
    resources: RESOURCES[groupVersion].map((item) => ({
      name: item.name,
      singularName: item.singularName,
      namespaced: item.namespaced,
      kind: item.kind,
      verbs: ['get', 'list', 'watch'],
    })),
  }
}

function apiGroupList(): Record<string, unknown> {
  return {
    kind: 'APIGroupList',
    apiVersion: 'v1',
    groups: GROUP_VERSIONS.map((groupVersion) => {
      const group = groupVersion.split('/')[0]
      const version = { groupVersion, version: groupVersion.split('/')[1] }
      return { name: group, versions: [version], preferredVersion: version }
    }),
  }
}

function lookup(groupVersion: string, plural: string): ResourceEntry | null {
  const entries = RESOURCES[groupVersion] || []
  return entries.find((item) => item.name === plural) || null
}

function metadata(name: string, namespace: string | null): Record<string, unknown> {
  return {
    name,
    ...(namespace ? { namespace } : {}),
    uid: '00000000-0000-4000-8000-000000000000',
    resourceVersion: '1',
    creationTimestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  }
}

function podMetrics(name: string, namespace: string | null): Record<string, unknown> {
  return {
    kind: 'PodMetrics',
    apiVersion: METRICS_GROUP_VERSION,
    metadata: metadata(name, namespace),
    timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    window: '30s',
    containers: [
      { name: 'app', usage: { cpu: '250m', memory: '512Mi' } },
      { name: 'sidecar', usage: { cpu: '50m', memory: '64Mi' } },
    ],
  }
}

function nodeMetrics(name: string): Record<string, unknown> {
  return {
    kind: 'NodeMetrics',
    apiVersion: METRICS_GROUP_VERSION,
    metadata: metadata(name, null),
    timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    window: '30s',
    usage: { cpu: '1200m', memory: '2Gi' },
  }
}

function nodeObject(name: string): Record<string, unknown> {
  return {
    kind: 'Node',
    apiVersion: 'v1',
    metadata: metadata(name, null),
    status: {
      capacity: { cpu: '4', memory: '8Gi', pods: '110' },
      allocatable: { cpu: '3800m', memory: '7Gi', pods: '110' },
    },
  }
}

function eventObject(name: string, namespace: string | null, form: string): Record<string, unknown> {
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, STAMP_OFFSETS[form])
  return {
    kind: 'Event',
    apiVersion: 'v1',
    metadata: metadata(name, namespace),
    involvedObject: { kind: 'Pod', name: 'stub-pod', namespace: namespace || 'default' },
    reason: 'Scheduled',
    message: 'the stub scheduled a pod',
    type: 'Normal',
    count: 1,
    firstTimestamp: stamp,
    lastTimestamp: stamp,
    eventTime: stamp,
  }
}

function podObject(name: string, namespace: string | null): Record<string, unknown> {
  return {
    kind: 'Pod',
    apiVersion: 'v1',
    metadata: metadata(name, namespace),
    spec: { containers: [{ name: 'app', image: 'stub:1.0' }] },
    status: { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0 }] },
  }
}

function genericObject(
  kind: string,
  groupVersion: string,
  name: string,
  namespace: string | null
): Record<string, unknown> {
  return {
    kind,
    apiVersion: groupVersion,
    metadata: metadata(name, namespace),
    spec: {},
    status: {},
  }
}

function objectFor(
  resource: ResourceEntry,
  groupVersion: string,
  name: string,
  namespace: string | null,
  form: string
): Record<string, unknown> {
  if (groupVersion === METRICS_GROUP_VERSION) {
    return resource.kind === 'PodMetrics' ? podMetrics(name, namespace) : nodeMetrics(name)
  }
  if (resource.kind === 'Node') return nodeObject(name)
  if (resource.kind === 'Event') return eventObject(name, namespace, form)
  if (resource.kind === 'Pod') return podObject(name, namespace)
  return genericObject(resource.kind, groupVersion, name, namespace)
}

const STUB_NAMES = ['stub-one', 'stub-two']

function listFor(
  resource: ResourceEntry,
  groupVersion: string,
  namespace: string | null,
  form: string
): Record<string, unknown> {
  return {
    kind: `${resource.kind}List`,
    apiVersion: groupVersion,
    metadata: { resourceVersion: '1' },
    items: STUB_NAMES.map((name) => objectFor(resource, groupVersion, name, namespace, form)),
  }
}

const LOG_TEXT = [
  '2026-01-01T00:00:00.000000000Z stdout F stub log line one',
  '2026-01-01T00:00:01.000000000Z stdout F stub log line two',
  '',
].join('\n')

interface ReadTarget {
  groupVersion: string
  namespace: string | null
  plural: string
  name: string | null
  subresource: string | null
}

function readTarget(segments: string[]): ReadTarget | null {
  let groupVersion: string
  let rest: string[]
  if (segments[0] === 'api') {
    groupVersion = segments[1]
    rest = segments.slice(2)
  } else {
    groupVersion = `${segments[1]}/${segments[2]}`
    rest = segments.slice(3)
  }
  let namespace: string | null = null
  if (rest[0] === 'namespaces' && rest.length >= 3) {
    namespace = decodeURIComponent(rest[1])
    rest = rest.slice(2)
  }
  if (rest.length === 0) return null
  return {
    groupVersion,
    namespace,
    plural: rest[0],
    name: rest[1] ? decodeURIComponent(rest[1]) : null,
    subresource: rest[2] || null,
  }
}

function resourceRead(res: ServerResponse, config: StubConfig, segments: string[]): void {
  const shape = config.body || (config.status >= 400 ? 'status' : 'object')
  if (shape === 'html') return htmlResponse(res, config.status)
  if (shape === 'status') {
    return statusResponse(res, config.status, config.message, reasonFor(config.status))
  }
  const target = readTarget(segments)
  if (target === null) return statusResponse(res, 404, NOT_FOUND_MESSAGE, 'NotFound')
  const resource = lookup(target.groupVersion, target.plural)
  if (resource === null) return statusResponse(res, 404, NOT_FOUND_MESSAGE, 'NotFound')
  if (target.subresource === 'log') return textResponse(res, config.status, LOG_TEXT)
  if (target.name !== null) {
    return jsonResponse(
      res,
      config.status,
      objectFor(resource, target.groupVersion, target.name, target.namespace, config.stamp)
    )
  }
  return jsonResponse(
    res,
    config.status,
    listFor(resource, target.groupVersion, target.namespace, config.stamp)
  )
}

function ignoreSocketError(): void {
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', `https://localhost:${PORT}`)
  const { config, segments } = readConfig(url.pathname)

  if (config.error !== null) {
    return statusResponse(res, 500, config.error, 'InternalError')
  }

  if (config.discoveryDelaySeconds > 0) await sleep(config.discoveryDelaySeconds * 1000)

  const apiPath = `/${segments.join('/')}`

  if (apiPath === '/version') {
    return jsonResponse(res, 200, {
      major: '1',
      minor: '33',
      gitVersion: GIT_VERSION,
      platform: 'linux/amd64',
    })
  }
  if (apiPath === '/api') {
    return jsonResponse(res, 200, { kind: 'APIVersions', versions: ['v1'] })
  }
  if (segments[0] === 'api' && segments.length === 2) {
    if (segments[1] !== 'v1') return statusResponse(res, 404, NOT_FOUND_MESSAGE, 'NotFound')
    return jsonResponse(res, 200, resourceList('v1'))
  }
  if (apiPath === '/apis') {
    return jsonResponse(res, 200, apiGroupList())
  }
  if (segments[0] === 'apis' && segments.length === 3) {
    const groupVersion = `${segments[1]}/${segments[2]}`
    if (groupVersion === METRICS_GROUP_VERSION && config.metricsStatus !== 200) {
      const status = config.metricsStatus
      return statusResponse(res, status, NOT_FOUND_MESSAGE, reasonFor(status))
    }
    if (!RESOURCES[groupVersion]) return statusResponse(res, 404, NOT_FOUND_MESSAGE, 'NotFound')
    return jsonResponse(res, 200, resourceList(groupVersion))
  }
  if (segments[0] !== 'api' && segments[0] !== 'apis') {
    return statusResponse(res, 404, NOT_FOUND_MESSAGE, 'NotFound')
  }

  if (config.delaySeconds > 0) await sleep(config.delaySeconds * 1000)
  return resourceRead(res, config, segments)
}

const server = https.createServer(tlsOptions, (req, res) => {
  // The delay cases hang up mid-response on purpose; a reset must not kill the process.
  res.on('error', ignoreSocketError)
  handleRequest(req, res).catch((err) => {
    console.error('[k8s-stub] Error:', err)
    statusResponse(res, 500, String(err), 'InternalError')
  })
})

server.on('clientError', (_err, socket) => socket.destroy())
server.on('tlsClientError', ignoreSocketError)

server.listen(PORT, () => {
  console.log(`[k8s-stub] Listening on https://0.0.0.0:${PORT}`)
})

function shutdown(): void {
  console.log('[k8s-stub] Shutting down...')
  server.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
