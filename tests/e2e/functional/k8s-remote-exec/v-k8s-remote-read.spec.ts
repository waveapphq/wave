/**
 * V-K8S-REMOTE-READ: the K8s read Blocks inside a Remote Execution container.
 *
 * One workflow opens an SSH session to the stack's sshd host and runs a Remote
 * Execution whose body holds every K8s read Block: two Connects, four Gets,
 * Events, two Logs reads and Top. The cluster is named by its compose DNS name
 * (`kwok`), which resolves only inside the stack network, so a Connect that
 * reads the cluster version can only have run on the SSH host. Every Block's
 * result comes back through its bound variables, materialized from the remote
 * worker: the map, the YAML text, the event list, the log text, the log table
 * and the usage table are each asserted on their values, not on status alone.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1, REQ-5.1.5
 *
 * Pass Criteria:
 *   KR-1  every read Block runs on the SSH host and its bound result carries
 *         the seeded values: the ConfigMap map and its YAML envelope, the
 *         seeded events, the canned log as text and as a TIME and MESSAGE
 *         table, the pod usage table with fixed-point CPU cells, a recorded
 *         miss that leaves the run passed, and a second session minted from a
 *         run token that reads the same ConfigMap
 *   KR-g  the node factories emit the checked-in workflow shape
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { SEEDED, seedRun, type K8sSeedProfile, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  APP_LOG,
  APP_LOG_LINES,
  buildReadFixture,
  cell,
  CONFIG_MAP_DATA,
  connectedLine,
  expectLocusBadges,
  expectRecordedMiss,
  expectStatuses,
  GOLDEN_NAMESPACES,
  GOLDEN_SUFFIX,
  K8S_DIRECT_URL,
  K8S_VERSION,
  LOG_STAMP_RE,
  LOG_TABLE_COLUMNS,
  numberOf,
  objectOf,
  PLAIN_DECIMAL_RE,
  READ_DONE_MARKER,
  READ_IDS,
  READ_MARKER,
  READ_VARS,
  RUN_TOKEN_SERVICE_ACCOUNT,
  runTokenLinePrefix,
  SEEDED_EVENT_NAMES,
  tableOf,
  textOf,
  TOP_POD_CELL,
  TOP_POD_COLUMNS,
  YAML_HEAD_RE,
  type ReadNamespaces,
  type SessionVariables,
} from './cases-remote'

const GOLDEN_FILE = 'fixture-remote-golden.json'

/** One event as the map-mode `result` carries it. */
type EventItem = {
  metadata?: { name?: string; namespace?: string }
  involvedObject?: { name?: string }
}

/** The four seed profiles the read leg reads, one namespace each. */
const PROFILES = ['get', 'events', 'logs', 'top'] as const satisfies readonly K8sSeedProfile[]
type ReadProfile = (typeof PROFILES)[number]

/** The checked-in golden with the TEST-ONLY material filled in; PEM and token
 *  bytes are never committed inside fixture JSON. */
function loadGolden(): Record<string, unknown> {
  const golden = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, GOLDEN_FILE), 'utf-8'),
  ) as Record<string, any>
  golden.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  golden.variables.k8s_ca.value = K8S_CA_PEM
  return golden as Record<string, unknown>
}

/** Seed every profile at once; if one fails, the others are torn down first. */
async function seedProfiles(
  request: Parameters<typeof seedRun>[0],
): Promise<Record<ReadProfile, SeededRun>> {
  const settled = await Promise.allSettled(PROFILES.map((profile) => seedRun(request, profile)))
  const seeded = settled.filter(
    (entry): entry is PromiseFulfilledResult<SeededRun> => entry.status === 'fulfilled',
  )
  const failed = settled.find(
    (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
  )
  if (failed) {
    await Promise.all(seeded.map((entry) => entry.value.teardown()))
    throw failed.reason
  }
  return Object.fromEntries(
    PROFILES.map((profile, index) => [profile, seeded[index].value]),
  ) as Record<ReadProfile, SeededRun>
}

test('KR-g: the node factories emit the checked-in workflow shape', () => {
  const built = buildReadFixture({
    suffix: GOLDEN_SUFFIX,
    namespaces: GOLDEN_NAMESPACES,
    caCert: K8S_CA_PEM,
    adminToken: K8S_ADMIN_TOKEN,
  })
  expect(built).toEqual(loadGolden())
})

test.describe('K8s reads inside a Remote Execution container', () => {
  let runs: Record<ReadProfile, SeededRun>

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000)
    runs = await seedProfiles(request)
  })

  test.afterAll(async () => {
    if (!runs) return
    await Promise.all(PROFILES.map((profile) => runs[profile].teardown()))
  })

  test('KR-1: every read Block runs on the host and binds the seeded values', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    const suffix = runs.get.suffix
    const namespaces: ReadNamespaces = {
      get: runs.get.namespace,
      events: runs.events.namespace,
      logs: runs.logs.namespace,
      top: runs.top.namespace,
    }
    const v = READ_VARS

    const fixture = buildReadFixture({
      suffix,
      namespaces,
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })

    await test.step('every body Block carries the R badge and nothing else does', async () => {
      await expectLocusBadges(page, fixture)
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, READ_DONE_MARKER, 240_000)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('Connect A reads the cluster by its stack name', () => {
      expect(textOf(vars, v.versionA), `the cluster version.\n${all}`).toBe(K8S_VERSION)
      expect(
        logs.filter((text) => text === connectedLine(K8S_DIRECT_URL)).length,
        `both Connects must report the cluster by its stack name.\n${all}`,
      ).toBe(2)
    })

    await test.step('the ConfigMap comes back as a map with the seeded data', () => {
      expect(numberOf(vars, v.cmCount), `the ConfigMap count.\n${all}`).toBe(1)
      expect(cell(vars, v.cmNames).value, 'the ConfigMap names').toEqual([SEEDED.configMap])
      const read = objectOf(vars, v.cmResult)
      expect(read.data, 'the seeded data keys and values').toEqual(CONFIG_MAP_DATA)
      expect(read.metadata?.name).toBe(SEEDED.configMap)
      expect(read.metadata?.namespace).toBe(namespaces.get)
    })

    await test.step('the same ConfigMap comes back as YAML text', () => {
      const found = cell(vars, v.cmYaml)
      expect(found.type, 'the YAML result declares text').toBe('string')
      const yaml = String(found.value)
      expect(YAML_HEAD_RE.test(yaml), `the YAML envelope.\n${yaml}`).toBeTruthy()
      expect(yaml).toContain('kind: ConfigMap')
      expect(yaml).toContain(`name: ${SEEDED.configMap}`)
      for (const [key, value] of Object.entries(CONFIG_MAP_DATA)) {
        expect(yaml, `the seeded value under ${key}`).toContain(`${key}: ${value}`)
      }
    })

    await test.step('the events of the last hour name the seeded objects', () => {
      const count = numberOf(vars, v.evCount)
      expect(count, `the event count.\n${all}`).toBeGreaterThan(0)
      const found = cell(vars, v.evResult)
      expect(found.type, 'the map-mode result declares an array').toBe('array')
      const events = found.value as EventItem[]
      expect(events.length, 'count matches the rows').toBe(count)
      for (const event of events) {
        expect(event.metadata?.namespace, 'every event is from the events namespace').toBe(
          namespaces.events,
        )
      }
      expect(
        events.some((event) => SEEDED_EVENT_NAMES.includes(event.metadata?.name ?? '')),
        `a seeded event must be listed.\n${JSON.stringify(events, null, 2)}`,
      ).toBeTruthy()
      expect(
        events.some((event) => event.involvedObject?.name === SEEDED.podKubelet),
        'an event about the seeded pod must be listed',
      ).toBeTruthy()
    })

    await test.step('the log comes back as the canned text', () => {
      const found = cell(vars, v.logText)
      expect(found.type, 'the string format declares text').toBe('string')
      expect(found.value, `the canned app log.\n${all}`).toBe(APP_LOG)
    })

    await test.step('the same log comes back as a TIME and MESSAGE table', () => {
      const table = tableOf(vars, v.logTable, LOG_TABLE_COLUMNS)
      expect(table.columns.map((column) => column.type)).toEqual(['string', 'string'])
      expect(table.rows.length, 'one row per line of the log').toBe(APP_LOG_LINES.length)
      table.rows.forEach((cells, index) => {
        const [time, message] = cells.map(String)
        expect(time, 'TIME carries the stamp alone').toMatch(LOG_STAMP_RE)
        expect(message, 'MESSAGE carries the line the container wrote').toBe(
          APP_LOG_LINES[index],
        )
      })
    })

    await test.step('the pod usage table names the seeded pods with fixed-point CPU', () => {
      const count = numberOf(vars, v.topCount)
      expect(count, `the usage row count.\n${all}`).toBeGreaterThanOrEqual(1)
      const table = tableOf(vars, v.topUsage, TOP_POD_COLUMNS)
      expect(table.rows.length, 'count matches the rows').toBe(count)
      expect(
        table.rows.map((cells) => String(cells[TOP_POD_CELL.name])).sort(),
        'every seeded pod reports usage',
      ).toEqual([SEEDED.podLabeled, SEEDED.podMulti, SEEDED.podPlain].sort())
      const labeled = table.rows.find(
        (cells) => cells[TOP_POD_CELL.name] === SEEDED.podLabeled,
      ) as unknown[]
      const cpu = labeled[TOP_POD_CELL.cpu]
      expect(typeof cpu, 'CPU crosses the remote path as text').toBe('string')
      expect(cpu, 'CPU reads as fixed-point text').toMatch(PLAIN_DECIMAL_RE)
      expect(Number.isInteger(labeled[TOP_POD_CELL.memory]), 'MEMORY is whole bytes').toBeTruthy()
    })

    await test.step('a missing namespace is recorded, and the run stays passed', async () => {
      expect(numberOf(vars, v.missCount)).toBe(0)
      expect(cell(vars, v.missNames).value).toEqual([])
      await expectRecordedMiss(
        page,
        vars,
        { ok: v.missOk, reason: v.missReason, error: v.missError },
        READ_IDS.missing,
        suffix,
      )
    })

    await test.step('Connect B mints a run token and its session reads the ConfigMap', () => {
      const prefix = runTokenLinePrefix(RUN_TOKEN_SERVICE_ACCOUNT)
      expect(
        logs.some((text) => text.startsWith(prefix)),
        `the run token line is missing.\n${all}`,
      ).toBeTruthy()
      expect(numberOf(vars, v.bCount), `the run-token session's read.\n${all}`).toBe(1)
      expect(cell(vars, v.bNames).value).toEqual([SEEDED.configMap])
    })

    await test.step('the summary marker and the Block statuses', async () => {
      const marker = logs.find((text) => text.startsWith(READ_MARKER)) ?? ''
      expect(marker, `the summary marker is missing.\n${all}`).toBe(
        `${READ_MARKER} ver=${K8S_VERSION} cm=1 ev=${numberOf(vars, v.evCount)}` +
          ` logs=${APP_LOG.length} top=${numberOf(vars, v.topCount)} miss=NotFound b=1`,
      )
      await expectStatuses(page, fixture, { [READ_IDS.missing]: 'warning' })
    })
  })
})
