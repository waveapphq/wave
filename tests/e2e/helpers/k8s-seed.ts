/**
 * Kubernetes object seeding for the kwok-backed read suites.
 *
 * One profile per fixture run, never one shared object set: a Deployment, a
 * Job or a PVC in the namespace adds control-plane events of its own (the
 * PVC's keeps refreshing) which breaks every event count, and a
 * terminal-phase pod never gets a metrics row.
 */

import { request as apiRequest } from '@playwright/test'
import { expect, type APIRequestContext } from './playwright-fixtures'
import { K8S_ADMIN_TOKEN, K8S_API_HOST, K8S_API_PORT } from './config'
import { randomUUID } from 'node:crypto'

/** kwok apiserver root. The functional project already sets ignoreHTTPSErrors. */
const K8S_API_URL = `https://${K8S_API_HOST}:${K8S_API_PORT}`

const K8S_HEADERS = {
  Authorization: `Bearer ${K8S_ADMIN_TOKEN}`,
  'Content-Type': 'application/json',
}

const POD_IMAGE = 'busybox:1.36'

/** Names of every seeded object. The run namespace isolates the namespaced
 *  ones, so only the two cluster-scoped names carry the run suffix. */
export const SEEDED = {
  label: 'wave-e2e',
  labelValue: 'read',
  labelSelector: 'wave-e2e=read',
  podLabeled: 'wave-pod-labeled',
  podPlain: 'wave-pod-plain',
  podMulti: 'wave-pod-multi',
  podSolo: 'wave-pod-solo',
  podKubelet: 'wave-pod-kubelet',
  podCrash: 'wave-pod-crash',
  podOther: 'wave-pod-other',
  podB: 'wave-pod-b',
  /** The two names the checked-in ClusterExec doc grants exec to. */
  podExec: 'wave-pod-exec',
  podExecB: 'wave-pod-exec-b',
  /** Any other name: the cluster serves no exec for it. */
  podNoExec: 'wave-pod-noexec',
  containerApp: 'app',
  containerSidecar: 'sidecar',
  containerMain: 'main',
  configMap: 'wave-cm',
  // Never spell this "wave-secret": that is the sshd account password, and the SSH
  // secret canary sweeps the whole shared store for it.
  secret: 'wave-sec',
  secretKey: 'canary',
  secretValue: 'wave-sec-canary-value',
  service: 'wave-svc',
  /** Not created here: the apiserver adds the ServiceAccount, the endpoint
   *  controller adds the Endpoints (a direct POST answers 409). */
  serviceAccount: 'default',
  endpoints: 'wave-svc',
  ingress: 'wave-ing',
  networkPolicy: 'wave-netpol',
  pvc: 'wave-pvc',
  role: 'wave-role',
  roleBinding: 'wave-rb',
  deployment: 'wave-deploy',
  replicaSet: 'wave-rs',
  statefulSet: 'wave-sts',
  daemonSet: 'wave-ds',
  job: 'wave-job',
  cronJob: 'wave-cj',
  eventEventTime: 'wave-evt-eventtime',
  eventFirstTimestamp: 'wave-evt-firsttimestamp',
  eventCreationOnly: 'wave-evt-creationonly',
  eventWarning: 'wave-evt-warning',
  eventOtherNs: 'wave-evt-other-ns',
  warningReason: 'WaveProbeWarning',
  eventTimeReason: 'WaveEventTimeOnly',
  firstTimestampReason: 'WaveFirstTimestampOnly',
  creationOnlyReason: 'WaveCreationTimestampOnly',
  /** Stock, never created and never deleted by this helper. */
  node: 'kwok-node-0',
  clusterRole: 'view',
  clusterRoleBinding: 'wave-admin',
} as const

/** Which object set a run gets. R1 get, R2 events, R3 logs, R4 top,
 *  R5 impersonation, R7 minimal, exec for the pod exec channel. */
export type K8sSeedProfile =
  | 'get'
  | 'events'
  | 'logs'
  | 'top'
  | 'impersonation'
  | 'minimal'
  | 'exec'

export type SeededRun = {
  /** Run-unique 8-char suffix carried by the cluster-scoped names. */
  suffix: string
  namespace: string
  namespaceB: string
  /** '' unless the profile creates it. */
  storageClass: string
  /** '' unless the profile creates it. */
  persistentVolume: string
  /** Sends every delete and returns without polling for 404; a refused delete throws. */
  teardown: () => Promise<void>
}

type K8sBody = Record<string, unknown>

const corePath = (ns: string, plural: string): string => `/api/v1/namespaces/${ns}/${plural}`
const storageClassName = (suffix: string): string => `wave-sc-${suffix}`
const persistentVolumeName = (suffix: string): string => `wave-pv-${suffix}`
const groupPath = (group: string, ns: string, plural: string): string =>
  `/apis/${group}/namespaces/${ns}/${plural}`

async function apiCreate(
  request: APIRequestContext,
  path: string,
  body: K8sBody,
): Promise<void> {
  const resp = await request.post(`${K8S_API_URL}${path}`, { headers: K8S_HEADERS, data: body })
  const detail = resp.ok() ? '' : await resp.text()
  expect(resp.ok(), `POST ${path} failed: ${resp.status()} ${detail}`).toBeTruthy()
}

/** Delete one object; one that is already gone (404) counts as deleted. */
async function apiDelete(request: APIRequestContext, path: string): Promise<void> {
  const resp = await request.delete(`${K8S_API_URL}${path}`, { headers: K8S_HEADERS })
  const gone = resp.ok() || resp.status() === 404
  const detail = gone ? '' : await resp.text()
  expect(gone, `DELETE ${path} failed: ${resp.status()} ${detail}`).toBeTruthy()
}

type ListedItem = { metadata?: { name?: string } }

async function apiListItems(request: APIRequestContext, path: string): Promise<ListedItem[]> {
  const resp = await request.get(`${K8S_API_URL}${path}`, { headers: K8S_HEADERS })
  if (!resp.ok()) return []
  const body = (await resp.json().catch(() => null)) as { items?: ListedItem[] } | null
  return body?.items ?? []
}

/** RFC3339 at second granularity (metav1.Time fields). */
function secondsAgo(offset: number): string {
  return new Date(Date.now() - offset * 1_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** RFC3339 for metav1.MicroTime, which parses exactly six fractional digits. */
function microTimeAgo(offset: number): string {
  return new Date(Date.now() - offset * 1_000).toISOString().replace('Z', '000Z')
}

type PodOptions = {
  name: string
  namespace: string
  labels?: Record<string, string>
  containers?: string[]
  /** Adds the kwok per-container usage annotations that give Top a real row. */
  usage?: boolean
}

function podBody(opts: PodOptions): K8sBody {
  const metadata: K8sBody = { name: opts.name, namespace: opts.namespace }
  if (opts.labels) metadata.labels = opts.labels
  if (opts.usage) {
    metadata.annotations = {
      'kwok.x-k8s.io/usage-cpu': '250m',
      'kwok.x-k8s.io/usage-memory': '512Mi',
    }
  }
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata,
    spec: {
      nodeName: SEEDED.node,
      containers: (opts.containers ?? [SEEDED.containerApp]).map((name) => ({
        name,
        image: POD_IMAGE,
      })),
    },
  }
}

const readLabels = { [SEEDED.label]: SEEDED.labelValue }

function labeledMeta(name: string, namespace: string): K8sBody {
  return { name, namespace, labels: { ...readLabels } }
}

function workloadTemplate(app: string): K8sBody {
  return {
    metadata: { labels: { app } },
    spec: { containers: [{ name: SEEDED.containerApp, image: POD_IMAGE }] },
  }
}

type EventOptions = {
  name: string
  namespace: string
  involvedPod: string
  reason: string
  message: string
  type: 'Normal' | 'Warning'
  eventTime?: string
  firstTimestamp?: string
  lastTimestamp?: string
  count?: number
}

function eventBody(opts: EventOptions): K8sBody {
  const body: K8sBody = {
    apiVersion: 'v1',
    kind: 'Event',
    metadata: { name: opts.name, namespace: opts.namespace },
    involvedObject: {
      kind: 'Pod',
      namespace: opts.namespace,
      name: opts.involvedPod,
      apiVersion: 'v1',
    },
    reason: opts.reason,
    message: opts.message,
    type: opts.type,
  }
  if (opts.eventTime) {
    body.eventTime = opts.eventTime
    body.reportingComponent = 'wave-e2e'
    body.reportingInstance = 'wave-e2e-0'
    body.action = 'Seed'
  }
  if (opts.firstTimestamp) body.firstTimestamp = opts.firstTimestamp
  if (opts.lastTimestamp) body.lastTimestamp = opts.lastTimestamp
  if (opts.count !== undefined) body.count = opts.count
  return body
}

async function seedGetSet(
  request: APIRequestContext,
  ns: string,
  nsB: string,
  suffix: string,
): Promise<void> {
  const storageClass = storageClassName(suffix)
  await apiCreate(request, '/apis/storage.k8s.io/v1/storageclasses', {
    apiVersion: 'storage.k8s.io/v1',
    kind: 'StorageClass',
    metadata: { name: storageClass, labels: { ...readLabels } },
    provisioner: 'kubernetes.io/no-provisioner',
    volumeBindingMode: 'WaitForFirstConsumer',
  })
  await apiCreate(request, '/api/v1/persistentvolumes', {
    apiVersion: 'v1',
    kind: 'PersistentVolume',
    metadata: { name: persistentVolumeName(suffix), labels: { ...readLabels } },
    spec: {
      capacity: { storage: '1Gi' },
      accessModes: ['ReadWriteOnce'],
      persistentVolumeReclaimPolicy: 'Delete',
      storageClassName: storageClass,
      hostPath: { path: `/srv/${persistentVolumeName(suffix)}` },
    },
  })

  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podLabeled,
      namespace: ns,
      labels: { ...readLabels, app: 'wave-target' },
      usage: true,
    }),
  )
  await apiCreate(request, corePath(ns, 'pods'), podBody({ name: SEEDED.podPlain, namespace: ns }))
  await apiCreate(request, corePath(ns, 'configmaps'), {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: labeledMeta(SEEDED.configMap, ns),
    data: { key: 'value' },
  })
  await apiCreate(request, corePath(ns, 'secrets'), {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: labeledMeta(SEEDED.secret, ns),
    type: 'Opaque',
    stringData: { [SEEDED.secretKey]: SEEDED.secretValue },
  })
  await apiCreate(request, corePath(ns, 'services'), {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: labeledMeta(SEEDED.service, ns),
    spec: {
      selector: { app: 'wave-target' },
      ports: [{ name: 'http', port: 80, targetPort: 80, protocol: 'TCP' }],
    },
  })
  await apiCreate(request, groupPath('networking.k8s.io/v1', ns, 'ingresses'), {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: labeledMeta(SEEDED.ingress, ns),
    spec: {
      rules: [
        {
          host: 'wave.example.test',
          http: {
            paths: [
              {
                path: '/',
                pathType: 'Prefix',
                backend: { service: { name: SEEDED.service, port: { number: 80 } } },
              },
            ],
          },
        },
      ],
    },
  })
  await apiCreate(request, groupPath('networking.k8s.io/v1', ns, 'networkpolicies'), {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: labeledMeta(SEEDED.networkPolicy, ns),
    spec: { podSelector: { matchLabels: { app: 'wave-target' } }, policyTypes: ['Ingress'] },
  })
  await apiCreate(request, corePath(ns, 'persistentvolumeclaims'), {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: labeledMeta(SEEDED.pvc, ns),
    spec: {
      accessModes: ['ReadWriteOnce'],
      resources: { requests: { storage: '1Gi' } },
      storageClassName: storageClass,
    },
  })
  await apiCreate(request, groupPath('rbac.authorization.k8s.io/v1', ns, 'roles'), {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'Role',
    metadata: labeledMeta(SEEDED.role, ns),
    rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['get', 'list'] }],
  })
  await apiCreate(request, groupPath('rbac.authorization.k8s.io/v1', ns, 'rolebindings'), {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'RoleBinding',
    metadata: labeledMeta(SEEDED.roleBinding, ns),
    roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: SEEDED.role },
    subjects: [{ apiGroup: 'rbac.authorization.k8s.io', kind: 'User', name: 'wave-reader' }],
  })
  await apiCreate(request, groupPath('apps/v1', ns, 'deployments'), {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: labeledMeta(SEEDED.deployment, ns),
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: SEEDED.deployment } },
      template: workloadTemplate(SEEDED.deployment),
    },
  })
  await apiCreate(request, groupPath('apps/v1', ns, 'replicasets'), {
    apiVersion: 'apps/v1',
    kind: 'ReplicaSet',
    metadata: labeledMeta(SEEDED.replicaSet, ns),
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: SEEDED.replicaSet } },
      template: workloadTemplate(SEEDED.replicaSet),
    },
  })
  await apiCreate(request, groupPath('apps/v1', ns, 'statefulsets'), {
    apiVersion: 'apps/v1',
    kind: 'StatefulSet',
    metadata: labeledMeta(SEEDED.statefulSet, ns),
    spec: {
      serviceName: SEEDED.service,
      replicas: 1,
      selector: { matchLabels: { app: SEEDED.statefulSet } },
      template: workloadTemplate(SEEDED.statefulSet),
    },
  })
  await apiCreate(request, groupPath('apps/v1', ns, 'daemonsets'), {
    apiVersion: 'apps/v1',
    kind: 'DaemonSet',
    metadata: labeledMeta(SEEDED.daemonSet, ns),
    spec: {
      selector: { matchLabels: { app: SEEDED.daemonSet } },
      template: workloadTemplate(SEEDED.daemonSet),
    },
  })
  await apiCreate(request, groupPath('batch/v1', ns, 'jobs'), {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: labeledMeta(SEEDED.job, ns),
    spec: {
      template: {
        metadata: { labels: { app: SEEDED.job } },
        spec: {
          restartPolicy: 'Never',
          containers: [{ name: SEEDED.containerApp, image: POD_IMAGE }],
        },
      },
    },
  })
  await apiCreate(request, groupPath('batch/v1', ns, 'cronjobs'), {
    apiVersion: 'batch/v1',
    kind: 'CronJob',
    metadata: labeledMeta(SEEDED.cronJob, ns),
    spec: {
      schedule: '0 0 * * *',
      jobTemplate: {
        spec: {
          template: {
            spec: {
              restartPolicy: 'Never',
              containers: [{ name: SEEDED.containerApp, image: POD_IMAGE }],
            },
          },
        },
      },
    },
  })

  await apiCreate(
    request,
    corePath(nsB, 'pods'),
    podBody({ name: SEEDED.podOther, namespace: nsB, labels: { ...readLabels }, usage: true }),
  )
}

async function seedEventsSet(
  request: APIRequestContext,
  ns: string,
  nsB: string,
): Promise<void> {
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podKubelet,
      namespace: ns,
      labels: { ...readLabels, 'wave.e2e/kubelet-events': 'true' },
    }),
  )
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podCrash,
      namespace: ns,
      labels: { ...readLabels, 'wave.e2e/crash-loop': 'true' },
    }),
  )
  await apiCreate(request, groupPath('apps/v1', ns, 'deployments'), {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: labeledMeta(SEEDED.deployment, ns),
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: SEEDED.deployment } },
      template: workloadTemplate(SEEDED.deployment),
    },
  })
  await apiCreate(request, groupPath('apps/v1', ns, 'replicasets'), {
    apiVersion: 'apps/v1',
    kind: 'ReplicaSet',
    metadata: labeledMeta(SEEDED.replicaSet, ns),
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: SEEDED.replicaSet } },
      template: workloadTemplate(SEEDED.replicaSet),
    },
  })

  // The POSTed events name the same pod, so the Stage chain must be waited for first.
  await waitForPodEvents(request, ns, SEEDED.podKubelet, 4)
  await waitForPodEvents(request, ns, SEEDED.podCrash, 1)
  // metav1.Time is second-granularity: land the POSTs in a later second than the last Stage event.
  await new Promise((resolve) => setTimeout(resolve, 1_500))

  // E-35 falls back to creationTimestamp (now), so the other two are dated
  // behind it to fix the sort order.
  await apiCreate(
    request,
    corePath(ns, 'events'),
    eventBody({
      name: SEEDED.eventEventTime,
      namespace: ns,
      involvedPod: SEEDED.podKubelet,
      reason: SEEDED.eventTimeReason,
      message: 'eventTime only',
      type: 'Normal',
      eventTime: microTimeAgo(30),
    }),
  )
  await apiCreate(
    request,
    corePath(ns, 'events'),
    eventBody({
      name: SEEDED.eventFirstTimestamp,
      namespace: ns,
      involvedPod: SEEDED.podKubelet,
      reason: SEEDED.firstTimestampReason,
      message: 'firstTimestamp only',
      type: 'Normal',
      firstTimestamp: secondsAgo(60),
    }),
  )
  await apiCreate(
    request,
    corePath(ns, 'events'),
    eventBody({
      name: SEEDED.eventCreationOnly,
      namespace: ns,
      involvedPod: SEEDED.podKubelet,
      reason: SEEDED.creationOnlyReason,
      message: 'creationTimestamp only',
      type: 'Normal',
    }),
  )
  await apiCreate(
    request,
    corePath(ns, 'events'),
    eventBody({
      name: SEEDED.eventWarning,
      namespace: ns,
      involvedPod: SEEDED.podKubelet,
      reason: SEEDED.warningReason,
      message: 'distinctive warning',
      type: 'Warning',
      firstTimestamp: secondsAgo(10),
      lastTimestamp: secondsAgo(10),
      count: 1,
    }),
  )

  await apiCreate(
    request,
    corePath(nsB, 'pods'),
    podBody({ name: SEEDED.podOther, namespace: nsB, labels: { ...readLabels } }),
  )
  // A directly-created pod schedules nothing, so namespace B has no events of
  // its own until one is POSTed.
  await apiCreate(
    request,
    corePath(nsB, 'events'),
    eventBody({
      name: SEEDED.eventOtherNs,
      namespace: nsB,
      involvedPod: SEEDED.podOther,
      reason: SEEDED.warningReason,
      message: 'second namespace',
      type: 'Warning',
      firstTimestamp: secondsAgo(10),
      lastTimestamp: secondsAgo(10),
      count: 1,
    }),
  )
}

async function seedLogsSet(
  request: APIRequestContext,
  ns: string,
  nsB: string,
): Promise<void> {
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podMulti,
      namespace: ns,
      labels: { ...readLabels },
      containers: [SEEDED.containerApp, SEEDED.containerSidecar],
      usage: true,
    }),
  )
  // A container named neither app nor sidecar falls through to pod.log.
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podSolo,
      namespace: ns,
      labels: { ...readLabels },
      containers: [SEEDED.containerMain],
    }),
  )
  await apiCreate(
    request,
    corePath(nsB, 'pods'),
    podBody({ name: SEEDED.podB, namespace: nsB, labels: { ...readLabels } }),
  )
}

async function seedTopSet(
  request: APIRequestContext,
  ns: string,
  nsB: string,
): Promise<void> {
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podLabeled,
      namespace: ns,
      labels: { ...readLabels, app: 'wave-target' },
      usage: true,
    }),
  )
  await apiCreate(request, corePath(ns, 'pods'), podBody({ name: SEEDED.podPlain, namespace: ns }))
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podMulti,
      namespace: ns,
      labels: { ...readLabels },
      containers: [SEEDED.containerApp, SEEDED.containerSidecar],
      usage: true,
    }),
  )
  await apiCreate(
    request,
    corePath(nsB, 'pods'),
    podBody({ name: SEEDED.podOther, namespace: nsB, labels: { ...readLabels }, usage: true }),
  )

  await Promise.all([
    waitForPodMetrics(request, ns, [SEEDED.podLabeled, SEEDED.podPlain, SEEDED.podMulti]),
    waitForPodMetrics(request, nsB, [SEEDED.podOther]),
  ])
}

async function seedImpersonationSet(request: APIRequestContext, ns: string): Promise<void> {
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podLabeled,
      namespace: ns,
      labels: { ...readLabels, app: 'wave-target' },
      usage: true,
    }),
  )
  await apiCreate(request, corePath(ns, 'secrets'), {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: labeledMeta(SEEDED.secret, ns),
    type: 'Opaque',
    stringData: { [SEEDED.secretKey]: SEEDED.secretValue },
  })
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podKubelet,
      namespace: ns,
      labels: { ...readLabels, 'wave.e2e/kubelet-events': 'true' },
    }),
  )
  await waitForPodEvents(request, ns, SEEDED.podKubelet, 4)
}

async function seedMinimalSet(request: APIRequestContext, ns: string): Promise<void> {
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podLabeled,
      namespace: ns,
      labels: { ...readLabels, app: 'wave-target' },
      usage: true,
    }),
  )
}

/** The exec-fixture pods. `wave-pod-exec` and `wave-pod-exec-b` are the only
 *  two names the checked-in ClusterExec doc grants exec to, keyed by container
 *  name; `wave-pod-noexec` carries the same container and is refused, which is
 *  what makes it the refusal fixture. */
async function seedExecSet(request: APIRequestContext, ns: string): Promise<void> {
  for (const name of [SEEDED.podExec, SEEDED.podExecB]) {
    await apiCreate(
      request,
      corePath(ns, 'pods'),
      podBody({
        name,
        namespace: ns,
        labels: { ...readLabels },
        containers: [SEEDED.containerApp, SEEDED.containerSidecar],
      }),
    )
  }
  await apiCreate(
    request,
    corePath(ns, 'pods'),
    podBody({
      name: SEEDED.podNoExec,
      namespace: ns,
      labels: { ...readLabels },
      containers: [SEEDED.containerApp],
    }),
  )
}

/** Poll until the pod carries at least `minCount` events. kwok Stage events
 *  land about a second apart, so a fresh pod needs a few seconds. */
export async function waitForPodEvents(
  request: APIRequestContext,
  namespace: string,
  podName: string,
  minCount: number,
  timeoutMs = 30_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const items = await apiListItems(
          request,
          `${corePath(namespace, 'events')}?fieldSelector=involvedObject.name=${podName}`,
        )
        return items.length
      },
      {
        timeout: timeoutMs,
        intervals: [250],
        message: `expected ${minCount} events on ${namespace}/${podName}`,
      },
    )
    .toBeGreaterThanOrEqual(minCount)
}

/** Poll until metrics.k8s.io reports a row for every named pod. The first
 *  sample lands 35-90 s after the pods are created, so there is no floor and
 *  the 150 s budget below is the one every caller gets. */
export async function waitForPodMetrics(
  request: APIRequestContext,
  namespace: string,
  podNames: readonly string[],
  timeoutMs = 150_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const items = await apiListItems(
          request,
          `/apis/metrics.k8s.io/v1beta1/namespaces/${namespace}/pods`,
        )
        const seen = new Set(items.map((item) => item.metadata?.name))
        return podNames.every((name) => seen.has(name))
      },
      {
        timeout: timeoutMs,
        intervals: [1_000],
        message: `expected metrics rows for ${podNames.join(', ')} in ${namespace}`,
      },
    )
    .toBeTruthy()
}

/**
 * Create the run's namespaces, apply the profile's object set, and return the
 * names plus a teardown. Cluster-scoped names carry a run suffix because
 * parallel shards share one cluster; the namespace delete cascades everything
 * inside it.
 */
export async function seedRun(
  request: APIRequestContext,
  profile: K8sSeedProfile,
): Promise<SeededRun> {
  const suffix = randomUUID().slice(0, 8)
  const namespace = `wave-e2e-${suffix}`
  const namespaceB = `${namespace}-b`
  const clusterScoped: string[] = []

  const run: SeededRun = {
    suffix,
    namespace,
    namespaceB,
    storageClass: '',
    persistentVolume: '',
    teardown: async () => {
      // Own context: the request of a beforeAll hook is disposed when that hook ends.
      const api = await apiRequest.newContext({ ignoreHTTPSErrors: true })
      try {
        const paths = [
          `/api/v1/namespaces/${namespace}`,
          `/api/v1/namespaces/${namespaceB}`,
          ...clusterScoped,
        ]
        let refused: unknown
        for (const path of paths) {
          await apiDelete(api, path).catch((error: unknown) => {
            refused ??= error
          })
        }
        if (refused) throw refused
      } finally {
        await api.dispose()
      }
    },
  }

  try {
    for (const name of [namespace, namespaceB]) {
      await apiCreate(request, '/api/v1/namespaces', {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name, labels: { ...readLabels } },
      })
    }

    if (profile === 'get') {
      run.storageClass = storageClassName(suffix)
      run.persistentVolume = persistentVolumeName(suffix)
      clusterScoped.push(`/api/v1/persistentvolumes/${run.persistentVolume}`)
      clusterScoped.push(`/apis/storage.k8s.io/v1/storageclasses/${run.storageClass}`)
      await seedGetSet(request, namespace, namespaceB, suffix)
    } else if (profile === 'events') {
      await seedEventsSet(request, namespace, namespaceB)
    } else if (profile === 'logs') {
      await seedLogsSet(request, namespace, namespaceB)
    } else if (profile === 'top') {
      await seedTopSet(request, namespace, namespaceB)
    } else if (profile === 'impersonation') {
      await seedImpersonationSet(request, namespace)
    } else if (profile === 'exec') {
      await seedExecSet(request, namespace)
    } else {
      await seedMinimalSet(request, namespace)
    }
  } catch (error) {
    // The seeding error is the one to report; a cleanup error must not replace it.
    await run.teardown().catch(() => undefined)
    throw error
  }

  return run
}
