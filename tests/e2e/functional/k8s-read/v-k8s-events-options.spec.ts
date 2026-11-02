/**
 * V-K8S-EVENTS-OPTIONS: the K8s Events option sweep against the real kwok
 * cluster.
 *
 * Covers option rows E-01 to E-05, E-08 to E-29, E-32 to E-35 and E-37 to
 * E-39, plus the shared S-03 row on a second Block.
 * E-06, E-07, E-30 and E-31 belong to the pre-run gate specs, E-36 (an
 * event with no timestamp at all) cannot exist on any real cluster and is
 * covered by a backend unit test, and E-40 has no route because a list in a
 * missing namespace answers 200 with an empty list.
 *
 * Event counts are fragile on a shared cluster, so the sweep scopes its
 * counting legs to `wave-pod-kubelet`, whose event set the seeder gates on and
 * whose eight events never change during a run. Every cross-leg comparison is
 * relative to the anchor leg's own result; only that one exact set is pinned.
 *
 * The two Table-refusal shapes are NOT here: kwok prints a real Table for
 * events, so neither the 406 nor the plain-EventList arm can be produced
 * against it. The k8s-stub specs own both. What this file owns is the
 * case that a real Table response still renders normally.
 *
 * Design Decisions: K8SREAD-1, K8SREAD-5, K8SREAD-6
 * REQ: REQ-5.1.1, REQ-3.3.5.4, REQ-3.4.1.5
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries, type LogEntry } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, SEEDED, type SeededRun } from '../../helpers/k8s-seed'
import { configSheet, openBlockSheet } from '../../helpers/workbench'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  buildEventsSweepFixture,
  countVar,
  errorVar,
  EVENTS_DONE_MARKER,
  EVENTS_GOLDEN_MARKER,
  EVENTS_LEGS,
  KUBELET_ORDER,
  KUBELET_REASONS,
  legMarker,
  MALFORMED_SELECTOR_TOKEN,
  okVar,
  reasonVar,
  resultVar,
  SESSION_EMPTY_CAUGHT,
  SESSION_EMPTY_ERROR_MARKER,
  STAGE_REASONS,
  type EventItem,
  type EventsLeg,
  type SerializedTable,
} from './cases-events'

/** A junk bearer token: no cluster identity maps to it, so /version 401s and
 *  K8s Connect cannot build this session. The sweep hand-writes it instead. */
const JUNK_TOKEN = 'wave-not-a-real-token'

/** The exact sentence a read Block gives when its session variable is empty. */
const EMPTY_SESSION_MESSAGE =
  "Parameter 'session' is set but what it points at is empty: check it names the " +
  "variable a K8s Connect block assigns its 'session' output to, and that Connect " +
  'ran before this block'

const KIND_TRIGGER = '[data-testid="enum-picker-trigger-object_kind"]'
const KIND_CONTENT = '[data-testid="enum-picker-content-object_kind"]'
const KIND_SEARCH = '[data-testid="enum-picker-search-object_kind"]'

type SessionVariables = Record<string, { value: unknown; type: string }>

let run: SeededRun

function leg(key: string): EventsLeg {
  const found = EVENTS_LEGS.find((candidate) => candidate.key === key)
  expect(found, `no leg "${key}" in the case table`).toBeTruthy()
  return found as EventsLeg
}

/** Load the checked-in golden fixture and write the run's material into it. */
function loadGolden(seeded: SeededRun): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-events-golden.json'), 'utf-8'),
  ) as Record<string, any>
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  fixture.variables.k8s_ca.value = K8S_CA_PEM
  const nodes = fixture.workflow.nodes as Array<Record<string, any>>
  const connect = nodes.find((node) => node.id === 'connect-golden')
  expect(connect, 'the golden fixture must hold connect-golden').toBeTruthy()
  connect!.data.config.values.namespace = seeded.namespace
  const events = nodes.find((node) => node.id === 'evt-golden')
  expect(
    events!.data.config.values.object_name,
    'the golden fixture must scope to the pod the seeder creates',
  ).toBe(SEEDED.podKubelet)
  expect(
    events!.data.config.values.object_kind,
    'the golden fixture must start on the WRONG kind, so the picker has work to do',
  ).toBe('Service')
  return fixture as Record<string, unknown>
}

/** Every console message at one level, for the recorded-failure assertions. */
function messagesAt(entries: readonly LogEntry[], level: string): string[] {
  return entries.filter((entry) => entry.level === level).map((entry) => entry.message)
}

function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  const found = vars[name]
  expect(found, `variable "${name}" was never bound`).toBeTruthy()
  return found
}

function readItems(vars: SessionVariables, name: string): EventItem[] {
  return cell(vars, name).value as EventItem[]
}

function readNumber(vars: SessionVariables, name: string): number {
  return Number(cell(vars, name).value)
}

function readString(vars: SessionVariables, name: string): string {
  return String(cell(vars, name).value)
}

const reasonsOf = (items: readonly EventItem[]): string[] =>
  items.map((item) => String(item.reason))

const objectNamesOf = (items: readonly EventItem[]): string[] =>
  items.map((item) => String(item.involvedObject?.name))

const namespacesOf = (items: readonly EventItem[]): string[] =>
  items.map((item) => String(item.metadata?.namespace))

/** Select a Block on the canvas and open its config sheet. */
async function openBlockConfig(page: Page, nodeId: string): Promise<Locator> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await openBlockSheet(page, nodeId)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

test.describe('K8s Events options (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'events')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('golden fixture: the grouped Kind picker drives a scoped read (KIND-PICKER)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await importValidateAndNavigate(page, loadGolden(run), { injectHttp: true })

    const modal = await openBlockConfig(page, 'evt-golden')

    await test.step('KIND-PICKER: Object Type sits above the same grouped searchable Kind picker Get uses', async () => {
      await expect(modal.locator('[data-testid="param-row-object_type"]')).toBeVisible()
      // The stored kind is the one the read must NOT keep.
      await expect(modal.locator(KIND_TRIGGER)).toHaveText('Service')
      await modal.locator(KIND_TRIGGER).click()
      const content = page.locator(KIND_CONTENT)
      await expect(content).toBeVisible()
      for (const heading of ['Workloads', 'Networking', 'Config', 'Storage', 'Cluster']) {
        await expect(
          content.locator(`[data-testid="enum-picker-group-object_kind-${heading}"]`),
        ).toHaveCount(1)
      }
      // "po" is Pod's kubectl short name, so the search box is doing the work.
      await page.locator(KIND_SEARCH).fill('po')
      await content.locator('[data-testid="enum-picker-item-object_kind-Pod"]').click()
      await expect(page.locator(KIND_CONTENT)).toHaveCount(0)
      await expect(modal.locator(KIND_TRIGGER)).toHaveText('Pod')
      await modal.getByRole('button', { name: 'Save' }).click()
      await expect(modal).not.toBeVisible()
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, EVENTS_GOLDEN_MARKER)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('KIND-PICKER: the read the picker built returns the fixture events', async () => {
      const items = readItems(vars, 'golden_result')
      // Scoped to Service the same read returns nothing, so a picker that did
      // not write its choice through leaves this at zero.
      expect(readNumber(vars, 'golden_count'), `count must be 8.\n${all}`).toBe(
        KUBELET_REASONS.length,
      )
      expect(reasonsOf(items).sort()).toEqual([...KUBELET_REASONS].sort())
      expect(new Set(objectNamesOf(items))).toEqual(new Set([SEEDED.podKubelet]))
      expect(
        logs.some((text) => text.includes(`[KIND-PICKER] n=${KUBELET_REASONS.length}`)),
        `the leg marker is missing.\n${all}`,
      ).toBeTruthy()
      await expectNodeStatus(page, 'evt-golden', 'success')
    })
  })

  test('option sweep: every reachable K8s Events option in one run', async ({ page }) => {
    test.setTimeout(240_000)
    const fixture = buildEventsSweepFixture({
      adminToken: K8S_ADMIN_TOKEN,
      junkToken: JUNK_TOKEN,
      caCert: K8S_CA_PEM,
      namespace: run.namespace,
    })
    await importValidateAndNavigate(page, fixture, { injectHttp: true })

    const status = await startRun(page)
    const logs = await finishRun(page, status, EVENTS_DONE_MARKER, 180_000)
    const all = logs.join('\n')
    const entries = await getLogEntries(page)
    const warnings = messagesAt(entries, 'WARN')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    const itemsOf = (key: string): EventItem[] => readItems(vars, resultVar(leg(key)))
    const countOf = (key: string): number => readNumber(vars, countVar(leg(key)))
    const typeOf = (key: string): string => cell(vars, resultVar(leg(key))).type

    /** The anchor: the kubelet pod's whole event set, newest first. */
    const anchor = itemsOf('e02')
    const anchorReasons = reasonsOf(anchor)

    await test.step('every leg reported its option ids on the console', () => {
      for (const candidate of EVENTS_LEGS) {
        expect(
          logs.some((text) => text.includes(legMarker(candidate))),
          `${candidate.key} (${candidate.ids.join(', ')}) never reached its marker.\n${all}`,
        ).toBeTruthy()
      }
    })

    await test.step('NO-MANAGED-FIELDS: the events come back without metadata.managedFields', () => {
      // kwok is a real apiserver over real etcd, so every stored event carries
      // managedFields. kubectl strips them before it prints, and so does WAVE.
      expect(JSON.stringify(anchor)).not.toContain('managedFields')
      expect(readString(vars, resultVar(leg('e27')))).not.toContain('managedFields')
      expect(readString(vars, resultVar(leg('e28')))).not.toContain('managedFields')
      // The control: the rest of metadata survives.
      expect(JSON.stringify(anchor)).toContain('resourceVersion')
    })

    await test.step('E-02, E-03, E-05, E-08, E-17, E-19, E-22, E-25: the anchor reads one object, whole and unfiltered', () => {
      expect(countOf('e02')).toBe(KUBELET_REASONS.length)
      expect([...anchorReasons].sort()).toEqual([...KUBELET_REASONS].sort())
      // E-05: nothing but the named object comes back.
      expect(new Set(objectNamesOf(anchor))).toEqual(new Set([SEEDED.podKubelet]))
      // E-17: several distinct reasons, so an unset filter is not a one-value read.
      expect(new Set(anchorReasons).size).toBe(KUBELET_REASONS.length)
      // E-08: the four kwok Stage events are all present.
      for (const reason of STAGE_REASONS) expect(anchorReasons).toContain(reason)
      // E-25: Map mode hands back an array of event objects.
      expect(typeOf('e02')).toBe('array')
      expect(Array.isArray(cell(vars, resultVar(leg('e02'))).value)).toBeTruthy()
      expect(anchor.every((item) => typeof item.metadata?.name === 'string')).toBeTruthy()
      expect(
        logs.some((text) => text.includes(`Read ${KUBELET_REASONS.length} event(s) from `)),
        `the plugin's own INFO line is missing.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('E-33, E-34, E-35: each timestamp fallback lands its event in a different place (E-32 exercised only - a kwok Stage event stamps all three fields in the same second)', () => {
      // A fallback that never fired would drag its event to one end or other.
      expect(anchorReasons).toEqual([...KUBELET_ORDER])
      expect(anchorReasons[0]).toBe(SEEDED.creationOnlyReason)
      expect(anchorReasons[anchorReasons.length - 1]).toBe(SEEDED.firstTimestampReason)
    })

    await test.step('E-01: an unscoped read carries more than one object', () => {
      const names = objectNamesOf(itemsOf('e01'))
      expect(names).toContain(SEEDED.podKubelet)
      expect(names).toContain(SEEDED.deployment)
      expect(new Set(names).size).toBeGreaterThan(1)
      // The namespace holds the control plane's own events on top of the pod's.
      expect(countOf('e01')).toBeGreaterThan(countOf('e02'))
    })

    await test.step('E-04, E-12: Custom object type with the exact kind reads the same objects', () => {
      expect(reasonsOf(itemsOf('e04'))).toEqual(anchorReasons)
      expect(countOf('e04')).toBe(countOf('e02'))
    })

    await test.step('E-13, EVENTS-KIND-RESOLVE: the plural and the short name resolve to the same object as the exact kind', () => {
      // kubectl runs the typed kind through the REST mapper, so Pod, pods and
      // po all name the same object. Events resolves it the same way.
      expect(reasonsOf(itemsOf('e13'))).toEqual(anchorReasons)
      expect(countOf('e13')).toBe(countOf('e02'))
      expect(cell(vars, okVar(leg('e13'))).value).toBe(true)
      expect(readString(vars, errorVar(leg('e13')))).toBe('')
      expect(readString(vars, reasonVar(leg('e13')))).toBe('')

      expect(reasonsOf(itemsOf('e13b'))).toEqual(anchorReasons)
      expect(countOf('e13b')).toBe(countOf('e02'))
    })

    await test.step('E-09: scoping to the Deployment returns its own events', () => {
      const items = itemsOf('e09')
      expect(countOf('e09')).toBeGreaterThan(0)
      expect(new Set(objectNamesOf(items))).toEqual(new Set([SEEDED.deployment]))
      expect(new Set(items.map((item) => item.involvedObject?.kind))).toEqual(
        new Set(['Deployment']),
      )
      expect(reasonsOf(items)).toContain('ScalingReplicaSet')
    })

    await test.step('E-10: scoping to the ReplicaSet returns its own events', () => {
      const items = itemsOf('e10')
      expect(countOf('e10')).toBeGreaterThan(0)
      expect(new Set(objectNamesOf(items))).toEqual(new Set([SEEDED.replicaSet]))
      expect(new Set(items.map((item) => item.involvedObject?.kind))).toEqual(
        new Set(['ReplicaSet']),
      )
      expect(reasonsOf(items)).toContain('SuccessfulCreate')
    })

    await test.step('E-11: a kind with no events returns an empty list and the Block PASSES', () => {
      // Same object NAME as the anchor, so the kind clause is the only
      // difference on the wire - which is also E-03's discriminator.
      expect(countOf('e11')).toBe(0)
      expect(itemsOf('e11')).toEqual([])
      expect(countOf('e02')).toBeGreaterThan(0)
      expect(cell(vars, okVar(leg('e11'))).value).toBe(true)
      expect(readString(vars, errorVar(leg('e11')))).toBe('')
    })

    await test.step('E-14, E-15, E-16: the type filter splits the set in two and keeps nothing back', () => {
      const both = itemsOf('e14')
      const warning = itemsOf('e15')
      const normal = itemsOf('e16')
      // E-14: Any keeps both seeded types in one read.
      expect(reasonsOf(both)).toEqual(anchorReasons)
      expect(new Set(both.map((item) => item.type))).toEqual(new Set(['Normal', 'Warning']))

      expect(new Set(warning.map((item) => item.type))).toEqual(new Set(['Warning']))
      expect(reasonsOf(warning)).toContain(SEEDED.warningReason)
      expect(reasonsOf(warning)).not.toContain(SEEDED.eventTimeReason)

      expect(new Set(normal.map((item) => item.type))).toEqual(new Set(['Normal']))
      expect(reasonsOf(normal)).not.toContain(SEEDED.warningReason)
      expect(reasonsOf(normal)).toContain(SEEDED.eventTimeReason)

      // The two halves together are the whole set: nothing was lost or doubled.
      expect(countOf('e15') + countOf('e16')).toBe(countOf('e02'))
    })

    await test.step('E-18: the reason filter keeps one reason and drops the others', () => {
      const items = itemsOf('e18')
      expect(new Set(reasonsOf(items))).toEqual(new Set([SEEDED.warningReason]))
      expect(countOf('e18')).toBe(1)
      expect(countOf('e18')).toBeLessThan(countOf('e02'))
    })

    await test.step('E-20, E-21: the age window is a real filter in both directions', () => {
      // E-20 is exercised only: a day-wide window cannot drop anything here.
      expect(countOf('e20')).toBe(countOf('e02'))
      expect(reasonsOf(itemsOf('e20'))).toEqual(anchorReasons)
      // E-21: every seeded event is older than one second by the time the run
      // reaches this Block, so the narrow window empties the read.
      expect(countOf('e21')).toBe(0)
      expect(itemsOf('e21')).toEqual([])
      expect(countOf('e21')).toBeLessThan(countOf('e02'))
    })

    await test.step('E-23, E-24: max events is a cap, not a fixed size', () => {
      expect(countOf('e23')).toBe(3)
      // The cut keeps the head of the same newest-first order the anchor has.
      expect(reasonsOf(itemsOf('e23'))).toEqual(anchorReasons.slice(0, 3))
      expect(countOf('e24')).toBe(countOf('e02'))
      expect(reasonsOf(itemsOf('e24'))).toEqual(anchorReasons)
    })

    await test.step('E-26, TABLE-KIND: a real Table response still renders normally', () => {
      expect(typeOf('e26')).toBe('table')
      const table = cell(vars, resultVar(leg('e26'))).value as SerializedTable
      const columns = table.columns.map((column) => column.name)
      expect(columns.length).toBeGreaterThan(0)
      expect(columns).toContain('Reason')
      expect(columns).toContain('Type')
      expect(table.rows).toHaveLength(1)
      expect(countOf('e26')).toBe(1)
      // includeObject=Object is what lets the row sort on the event's own
      // last-seen stamp; metadata alone would put a different event first.
      expect(table.rows[0].map((value) => String(value))).toContain(anchorReasons[0])
    })

    await test.step('E-27: the JSON document is re-serialized, so it honors max events', () => {
      expect(typeOf('e27')).toBe('string')
      const text = readString(vars, resultVar(leg('e27')))
      const parsed = JSON.parse(text) as { kind?: string; items?: unknown[] }
      expect(parsed.kind).toBe('EventList')
      // A raw cluster body would carry all eight; only a re-serialized one can
      // carry two.
      expect(parsed.items).toHaveLength(2)
      expect(countOf('e27')).toBe(2)
      expect(countOf('e27')).toBeLessThan(countOf('e02'))
    })

    await test.step('E-28: the YAML document is re-serialized the same way', () => {
      expect(typeOf('e28')).toBe('string')
      const text = readString(vars, resultVar(leg('e28')))
      expect(text).toContain('kind: EventList')
      // The newest event survives and the seeded older ones are gone from the
      // TEXT, which a raw cluster body could not manage.
      expect(text).toContain(SEEDED.creationOnlyReason)
      for (const dropped of [
        SEEDED.warningReason,
        SEEDED.eventTimeReason,
        SEEDED.firstTimestampReason,
      ]) {
        expect(text).not.toContain(dropped)
      }
      expect(countOf('e28')).toBe(2)
      expect(countOf('e28')).toBeLessThan(countOf('e02'))
    })

    await test.step('E-29: All namespaces is honored even on a scoped read', () => {
      // The control: the same scoped read inside the session namespace only.
      expect(countOf('e29a')).toBe(0)
      expect(itemsOf('e29a')).toEqual([])
      expect(cell(vars, okVar(leg('e29a'))).value).toBe(true)

      const wide = itemsOf('e29b')
      expect(countOf('e29b')).toBeGreaterThan(0)
      // Membership only: every shard seeds its own second namespace, so the
      // count is shared mutable state and only this run's namespace is pinned.
      expect(namespacesOf(wide)).toContain(run.namespaceB)
      expect(new Set(objectNamesOf(wide))).toEqual(new Set([SEEDED.podOther]))
      expect(reasonsOf(wide)).toContain(SEEDED.warningReason)
    })

    await test.step('E-37: an unparsable field selector gives the LIST wording, naming the object once', async () => {
      const message = readString(vars, errorVar(leg('e37')))
      const prefix = `Kubernetes could not list Event objects in namespace '${run.namespace}': `
      expect(message.startsWith(prefix), `unexpected message: ${message}`).toBeTruthy()
      expect(message.length).toBeGreaterThan(prefix.length)
      // The read wording, never the update wording, and the object named once.
      expect(message).not.toContain('rejected the update')
      expect(message.split('Event objects').length - 1).toBe(1)
      // The cluster's own text rides through, naming the clause it choked on.
      expect(message).toContain(MALFORMED_SELECTOR_TOKEN)
      expect(readString(vars, reasonVar(leg('e37')))).toBe('BadRequest')
      expect(cell(vars, okVar(leg('e37'))).value).toBe(false)
      expect(itemsOf('e37')).toEqual([])
      expect(countOf('e37')).toBe(0)
      expect(warnings, `the recorded failure must write a WARN line.\n${all}`).toContain(
        `Read failed (BadRequest): ${message}`,
      )
      await expectNodeStatus(page, 'evt-e37', 'warning')
    })

    await test.step('E-38: an anonymous session is refused by permission, not by authentication', async () => {
      const message = readString(vars, errorVar(leg('e38')))
      expect(message.startsWith('Kubernetes API permission denied: ')).toBeTruthy()
      expect(message).toContain('system:anonymous')
      expect(readString(vars, reasonVar(leg('e38')))).toBe('Forbidden')
      expect(cell(vars, okVar(leg('e38'))).value).toBe(false)
      expect(itemsOf('e38')).toEqual([])
      expect(countOf('e38')).toBe(0)
      expect(warnings).toContain(`Read failed (Forbidden): ${message}`)
      await expectNodeStatus(page, 'evt-e38', 'warning')
    })

    await test.step('E-39: a junk bearer token fails authentication', async () => {
      const expected = 'Kubernetes API authentication failed: Unauthorized'
      expect(readString(vars, errorVar(leg('e39')))).toBe(expected)
      expect(readString(vars, reasonVar(leg('e39')))).toBe('Unauthorized')
      expect(cell(vars, okVar(leg('e39'))).value).toBe(false)
      expect(itemsOf('e39')).toEqual([])
      expect(countOf('e39')).toBe(0)
      expect(warnings).toContain(`Read failed (Unauthorized): ${expected}`)
      await expectNodeStatus(page, 'evt-e39', 'warning')
    })

    await test.step('S-03: a session pointing at a declared but empty variable says so, on Events', async () => {
      expect(
        logs.some((text) => text === SESSION_EMPTY_CAUGHT),
        `the empty-session leg was never caught.\n${all}`,
      ).toBeTruthy()
      const caught = logs.find((text) => text.startsWith(SESSION_EMPTY_ERROR_MARKER)) ?? ''
      expect(caught, `the caught error was never bound.\n${all}`).toContain(EMPTY_SESSION_MESSAGE)
      // It is a configuration refusal, so it raises rather than recording.
      expect(caught).not.toContain('is not a kubeconfig WAVE can read')
      await expectNodeStatus(page, 'log-s03', 'success')
      expect(
        await page
          .locator('[data-testid="workflow-node-evt-s03"]')
          .getAttribute('data-execution-status'),
        'the empty-session Block must not succeed',
      ).not.toBe('success')
    })

    await test.step('every reading leg painted the status its option row expects', async () => {
      for (const candidate of EVENTS_LEGS) {
        await expectNodeStatus(
          page,
          `evt-${candidate.key}`,
          candidate.records ? 'warning' : 'success',
        )
      }
    })
  })
})
