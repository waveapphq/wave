/**
 * V-BLOCK-TIMEOUT-K8S: the Timeout row is the K8s Block's real wall-clock bound.
 *
 * Phase: functional-workflow (parallel) - one Test, one run namespace of its
 * own, torn down at the end.
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 *
 * Every K8s Block that offers a Timeout row is here, and every one of them is
 * given a Timeout of one second against a cluster that holds its answer for
 * three. A Block that honors the row dies at one second and says so; a Block
 * that does not would sit on the stall and then run to the family default. The
 * message names the deadline in seconds, so the message IS the proof.
 *
 * K8s Connect is the one Block that has to be timed out on its own: the stub
 * keeps discovery fast under `delay` so that a session can be opened at all, so
 * Connect rides the `vdelay` prefix, which stalls discovery too. The other
 * eleven ride one session opened with a generous Timeout through `delay`.
 *
 * Pass Criteria:
 *   TO-01  K8s Connect times out reading /version and names the api_url.
 *   TO-02  K8s Get times out on the Pod list read.
 *   TO-03  K8s Events times out on the event list read.
 *   TO-04  K8s Logs times out on the log subresource read.
 *   TO-05  K8s Top times out on the pod metrics read.
 *   TO-06  K8s Apply times out on the server-side apply.
 *   TO-07  K8s Delete times out on the delete request.
 *   TO-08  K8s Scale times out reading the scale subresource.
 *   TO-09  K8s Rollout times out reading the workload.
 *   TO-10  K8s Exec times out on the exec channel.
 *   TO-11  K8s Script times out on the exec channel.
 *   TO-12  K8s Copy times out on the exec channel.
 *   TO-02 (record) A request timeout is a dependency failure, so Record and
 *          continue does not soften it: the same sentence is raised.
 *   The whole run stays inside a wall-clock ceiling the family defaults could
 *   not have met.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import {
  k8sApplyNode,
  k8sCopyNode,
  k8sDeleteNode,
  k8sExecNode,
  k8sReadNode,
  k8sRolloutNode,
  k8sScaleNode,
  k8sScriptNode,
} from '../../helpers/k8s-nodes'
import {
  buildTimeoutFixture,
  connectTimeoutMessage,
  DELAY_PREFIX,
  expectMarkers,
  expectTimedOut,
  reachedStubUrl,
  restTimeoutMessage,
  runTimeoutFixture,
  secondsText,
  SESSION_VARIABLE,
  SHORT_TIMEOUT,
  stubConnectNode,
  VDELAY_PREFIX,
  type TimeoutLeg,
} from './cases-timeout'

/** The bookend the console harvest gates on. */
const K8S_MARKER = 'block-timeout-k8s-done'

/**
 * The ceiling the whole run must stay under. Thirteen legs bounded at one
 * second cost about 13 s; on the family defaults (30 s a request, 60 s the
 * exec channel) the same thirteen would have cost 10 x 30 + 3 x 60 = 480 s.
 * The ceiling is a band with room for a loaded shard, not a stopwatch.
 */
const WALL_CLOCK_CEILING_SECONDS = 90

/** Names the stub answers for without any of them existing. */
const POD = 'stub-one'
const CONTAINER = 'app'
const CONFIG_MAP = 'wave-timeout-cm'
const DEPLOYMENT = 'wave-timeout-deploy'

let run: SeededRun

const restBase = (kind: string): string => `/api/v1/namespaces/${run.namespace}/${kind}`
const appsBase = (kind: string): string => `/apis/apps/v1/namespaces/${run.namespace}/${kind}`

/** Every K8s Block that carries a Timeout row, each bounded at one second. */
function timeoutLegs(): TimeoutLeg[] {
  const bounded = { session: SESSION_VARIABLE, timeout: SHORT_TIMEOUT, on_error: 'fail' } as const
  return [
    {
      key: 'connect',
      ids: ['TO-01'],
      what: 'Connect against stalled discovery',
      message: connectTimeoutMessage(reachedStubUrl(VDELAY_PREFIX), SHORT_TIMEOUT),
      node: (slot) =>
        stubConnectNode({
          id: slot.id,
          description: slot.description,
          prefix: VDELAY_PREFIX,
          namespace: run.namespace,
          timeout: SHORT_TIMEOUT,
          outputBindings: {},
        }),
    },
    {
      key: 'get',
      ids: ['TO-02'],
      what: 'Get lists Pods',
      message: restTimeoutMessage('GET', restBase('pods'), SHORT_TIMEOUT),
      node: (slot) =>
        k8sReadNode({
          ...slot,
          elementType: 'k8s-get',
          values: {
            ...bounded,
            resource_type: 'default',
            kind: 'Pod',
            search_by: 'list',
            output_format: 'map',
          },
        }),
    },
    {
      key: 'getrec',
      ids: ['TO-02'],
      what: 'the same Get, Record and continue',
      message: restTimeoutMessage('GET', restBase('pods'), SHORT_TIMEOUT),
      node: (slot) =>
        k8sReadNode({
          ...slot,
          elementType: 'k8s-get',
          values: {
            session: SESSION_VARIABLE,
            timeout: SHORT_TIMEOUT,
            on_error: 'record',
            resource_type: 'default',
            kind: 'Pod',
            search_by: 'list',
            output_format: 'map',
          },
        }),
    },
    {
      key: 'events',
      ids: ['TO-03'],
      what: 'Events lists the namespace',
      message: restTimeoutMessage('GET', restBase('events'), SHORT_TIMEOUT),
      node: (slot) =>
        k8sReadNode({
          ...slot,
          elementType: 'k8s-events',
          values: { ...bounded, output_format: 'map' },
        }),
    },
    {
      key: 'logs',
      ids: ['TO-04'],
      what: 'Logs reads the log subresource',
      message: restTimeoutMessage(
        'GET',
        `${restBase('pods')}/${POD}/log?container=${CONTAINER}`,
        SHORT_TIMEOUT,
      ),
      node: (slot) =>
        k8sReadNode({
          ...slot,
          elementType: 'k8s-logs',
          values: { ...bounded, pod: POD, container: CONTAINER },
        }),
    },
    {
      key: 'top',
      ids: ['TO-05'],
      what: 'Top reads pod metrics',
      message: restTimeoutMessage(
        'GET',
        `/apis/metrics.k8s.io/v1beta1/namespaces/${run.namespace}/pods`,
        SHORT_TIMEOUT,
      ),
      node: (slot) =>
        k8sReadNode({
          ...slot,
          elementType: 'k8s-top',
          values: { ...bounded, scope: 'pod', select_by: 'all' },
        }),
    },
    {
      key: 'apply',
      ids: ['TO-06'],
      what: 'Apply writes a ConfigMap',
      message: restTimeoutMessage(
        'PATCH',
        `${restBase('configmaps')}/${CONFIG_MAP}?fieldManager=wave&force=true`,
        SHORT_TIMEOUT,
      ),
      node: (slot) =>
        k8sApplyNode({
          ...slot,
          values: {
            ...bounded,
            define_with: 'form',
            kind: 'ConfigMap',
            name: CONFIG_MAP,
            data: { round: 'one' },
            if_exists: 'update',
            output_format: 'map',
          },
        }),
    },
    {
      key: 'delete',
      ids: ['TO-07'],
      what: 'Delete removes a ConfigMap',
      message: restTimeoutMessage(
        'DELETE',
        `${restBase('configmaps')}/${CONFIG_MAP}?propagationPolicy=Background`,
        SHORT_TIMEOUT,
      ),
      node: (slot) =>
        k8sDeleteNode({
          ...slot,
          values: {
            ...bounded,
            resource_type: 'default',
            kind: 'ConfigMap',
            delete_by: 'name',
            name: CONFIG_MAP,
            cascade: 'background',
            wait_until_gone: false,
          },
        }),
    },
    {
      key: 'scale',
      ids: ['TO-08'],
      what: 'Scale reads the scale subresource',
      message: restTimeoutMessage(
        'GET',
        `${appsBase('deployments')}/${DEPLOYMENT}/scale`,
        SHORT_TIMEOUT,
      ),
      node: (slot) =>
        k8sScaleNode({
          ...slot,
          values: {
            ...bounded,
            resource_type: 'default',
            kind: 'Deployment',
            name: DEPLOYMENT,
            replicas: 2,
          },
        }),
    },
    {
      key: 'rollout',
      ids: ['TO-09'],
      what: 'Rollout restarts a Deployment',
      message: restTimeoutMessage('GET', `${appsBase('deployments')}/${DEPLOYMENT}`, SHORT_TIMEOUT),
      node: (slot) =>
        k8sRolloutNode({
          ...slot,
          values: { ...bounded, operation: 'restart', kind: 'Deployment', name: DEPLOYMENT },
        }),
    },
    {
      key: 'exec',
      ids: ['TO-10'],
      what: 'Exec runs a command in a pod',
      message: `Command execution timed out after ${secondsText(SHORT_TIMEOUT)}`,
      node: (slot) =>
        k8sExecNode({
          ...slot,
          values: { ...bounded, pod: POD, container: CONTAINER, command: 'echo hello' },
        }),
    },
    {
      key: 'script',
      ids: ['TO-11'],
      what: 'Script feeds an interpreter',
      message: `Script execution timed out after ${secondsText(SHORT_TIMEOUT)}`,
      node: (slot) =>
        k8sScriptNode({
          ...slot,
          values: {
            ...bounded,
            pod: POD,
            container: CONTAINER,
            interpreter: 'sh',
            script: 'echo hello\n',
          },
        }),
    },
    {
      key: 'copy',
      ids: ['TO-12'],
      what: 'Copy pulls a file out of a pod',
      message: `File copy timed out after ${secondsText(SHORT_TIMEOUT)}`,
      node: (slot) =>
        k8sCopyNode({
          ...slot,
          values: {
            ...bounded,
            direction: 'from_pod',
            pod: POD,
            container: CONTAINER,
            source_path: '/etc/hostname',
            target_path: '/tmp/wave-timeout-pull',
          },
        }),
    },
  ]
}

test.describe('The Timeout row bounds every K8s Block', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('every K8s Block dies at its typed Timeout (TO-01 to TO-12)', async ({ page }) => {
    test.setTimeout(300_000)
    const legs = timeoutLegs()
    const fixture = buildTimeoutFixture(legs, {
      name: 'K8s Block Timeout E2E Test',
      bookend: K8S_MARKER,
      namespace: run.namespace,
      prefix: DELAY_PREFIX,
    })
    const { logs, all, elapsedSeconds } = await runTimeoutFixture(page, fixture, K8S_MARKER)

    await test.step('every leg reported its ids', () => {
      expectMarkers(logs, legs)
    })

    for (const leg of legs) {
      await test.step(`${leg.ids.join('|')}: ${leg.what}`, () => {
        expectTimedOut(logs, leg)
      })
    }

    await test.step('the whole run stayed inside its wall-clock ceiling', () => {
      expect(
        elapsedSeconds,
        `the run took ${elapsedSeconds}s, over the ${WALL_CLOCK_CEILING_SECONDS}s ceiling.\n${all}`,
      ).toBeLessThan(WALL_CLOCK_CEILING_SECONDS)
    })
  })
})
