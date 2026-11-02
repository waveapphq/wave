/**
 * V-K8S-TOP-OPTIONS (R4): the K8s Top option sweep against the real kwok
 * cluster.
 *
 * Covers option rows T-01 to T-06, T-08 to T-17 and T-22 to
 * T-25. T-07 belongs to R8 (the pre-run gate), T-18 to T-21 are impossible on
 * a shared single-node cluster and are covered by backend unit tests, and
 * T-26 belongs to R6 (the k8s-stub).
 *
 * The file runs alone because the metrics API only starts serving a pod
 * 35-90 s after the pod is created. `seedRun(request, 'top')` creates the
 * pods and then polls `metrics.k8s.io` for all four of them with no
 * hard-coded floor, both namespaces concurrently, so the wait overlaps the
 * seeding instead of following it. `waitForPodMetrics` allows 150 s.
 *
 * Node metrics are shared mutable state: `kwok-node-0` is one node across
 * every parallel shard and its usage sums every pod on it. Node usage is
 * asserted for presence, shape and units only, never for a value. Node
 * capacity and allocatable come from the checked-in manifest and ARE exact.
 *
 * K8SREAD-17: `usage` is a table, so a row is positional cells under the
 * heading its mode prints. Every read below proves the heading first, then
 * addresses cells through that mode's index map.
 *
 * Design Decisions: K8SREAD-8, K8SREAD-9, K8SREAD-10, K8SREAD-17
 * REQ: REQ-5.1.1, REQ-3.4.1.5
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogEntries, type LogEntry } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, SEEDED, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM, K8S_LIMITED_TOKEN } from '../../helpers/config'
import {
  ANNOTATED_CPU_CORES,
  ANNOTATED_MEMORY_BYTES,
  buildTopSweepFixture,
  CONTAINER_CELL,
  CONTAINER_COLUMN_TYPES,
  CONTAINER_COLUMNS,
  countVar,
  DEFAULT_CPU_CORES,
  DEFAULT_MEMORY_BYTES,
  errorVar,
  legMarker,
  MEBIBYTE,
  MISSING_NAME,
  NODE_CAPACITY,
  NODE_CELL,
  NODE_COLUMN_TYPES,
  NODE_COLUMNS,
  okVar,
  POD_CELL,
  POD_COLUMN_TYPES,
  POD_COLUMNS,
  reasonVar,
  TOP_DONE_MARKER,
  TOP_LEGS,
  usageVar,
  type ContainerUsageRow,
  type NodeUsageRow,
  type PodUsageRow,
  type TopLeg,
  type UsageTable,
} from './cases-top'

/** A junk bearer token: no cluster identity maps to it, so /version 401s and
 *  K8s Connect cannot build this session. The sweep hand-writes it instead. */
const JUNK_TOKEN = 'wave-not-a-real-token'

const GOLDEN_MARKER = 'k8s-top-golden-done'

type SessionVariables = Record<string, { value: unknown; type: string }>

let run: SeededRun

function leg(key: string): TopLeg {
  const found = TOP_LEGS.find((candidate) => candidate.key === key)
  expect(found, `no leg "${key}" in the case table`).toBeTruthy()
  return found as TopLeg
}

/** Load the checked-in golden fixture and write the run's material into it. */
function loadGolden(seeded: SeededRun): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-top-golden.json'), 'utf-8'),
  ) as Record<string, any>
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  fixture.variables.k8s_ca.value = K8S_CA_PEM
  const nodes = fixture.workflow.nodes as Array<Record<string, any>>
  const connect = nodes.find((node) => node.id === 'connect-golden')
  expect(connect, 'the golden fixture must hold connect-golden').toBeTruthy()
  connect!.data.config.values.namespace = seeded.namespace
  const top = nodes.find((node) => node.id === 'top-golden')
  expect(
    top!.data.config.values.name,
    'the golden fixture must read the pod the seeder creates',
  ).toBe(SEEDED.podLabeled)
  return fixture as Record<string, unknown>
}

/** Every console message at one level, for the recorded-failure assertions. */
function messagesAt(entries: readonly LogEntry[], level: string): string[] {
  return entries.filter((entry) => entry.level === level).map((entry) => entry.message)
}

/** The usage table a leg bound, with its heading proved before any cell is
 *  read: a renamed, reordered or inserted column fails here, not silently. */
function readUsage(
  vars: SessionVariables,
  name: string,
  columns: readonly string[],
  types: readonly string[],
): UsageTable {
  const bound = vars[name]
  expect(bound, `variable "${name}" was never bound`).toBeTruthy()
  expect(bound.type, `"${name}" must be a table`).toBe('table')
  const table = bound.value as UsageTable
  expect(
    table.columns.map((column) => column.name),
    `"${name}" heading`,
  ).toEqual([...columns])
  expect(
    table.columns.map((column) => column.type),
    `"${name}" column types`,
  ).toEqual([...types])
  for (const cells of table.rows) {
    expect(cells, `every "${name}" row is one cell per column`).toHaveLength(columns.length)
  }
  return table
}

const podUsage = (vars: SessionVariables, name: string): UsageTable =>
  readUsage(vars, name, POD_COLUMNS, POD_COLUMN_TYPES)
const containerUsage = (vars: SessionVariables, name: string): UsageTable =>
  readUsage(vars, name, CONTAINER_COLUMNS, CONTAINER_COLUMN_TYPES)
const nodeUsage = (vars: SessionVariables, name: string): UsageTable =>
  readUsage(vars, name, NODE_COLUMNS, NODE_COLUMN_TYPES)

/** A cell carries whatever the wire carried; the shape steps assert its type. */
const numberCell = (cells: unknown[], index: number): number => cells[index] as number

/** A float column carries exact decimals as plain-decimal strings; read one as a number. */
const decimalCell = (cells: unknown[], index: number): number => Number(cells[index])

const isPlainDecimal = (cell: unknown): boolean =>
  typeof cell === 'string' && /^\d+(\.\d+)?$/.test(cell)

const podRows = (table: UsageTable): PodUsageRow[] =>
  table.rows.map((cells) => ({
    name: String(cells[POD_CELL.name]),
    cpu: decimalCell(cells, POD_CELL.cpu),
    memory: numberCell(cells, POD_CELL.memory),
  }))

const containerRows = (table: UsageTable): ContainerUsageRow[] =>
  table.rows.map((cells) => ({
    name: String(cells[CONTAINER_CELL.name]),
    container: String(cells[CONTAINER_CELL.container]),
    cpu: decimalCell(cells, CONTAINER_CELL.cpu),
    memory: numberCell(cells, CONTAINER_CELL.memory),
  }))

const nodeRows = (table: UsageTable): NodeUsageRow[] =>
  table.rows.map((cells) => ({
    name: String(cells[NODE_CELL.name]),
    cpu: decimalCell(cells, NODE_CELL.cpu),
    memory: numberCell(cells, NODE_CELL.memory),
    capacity: {
      cpu: decimalCell(cells, NODE_CELL.capacityCpu),
      memory: numberCell(cells, NODE_CELL.capacityMemory),
    },
    allocatable: {
      cpu: decimalCell(cells, NODE_CELL.allocatableCpu),
      memory: numberCell(cells, NODE_CELL.allocatableMemory),
    },
  }))

function readNumber(vars: SessionVariables, name: string): number {
  const cell = vars[name]
  expect(cell, `variable "${name}" was never bound`).toBeTruthy()
  return Number(cell.value)
}

function readString(vars: SessionVariables, name: string): string {
  const cell = vars[name]
  expect(cell, `variable "${name}" was never bound`).toBeTruthy()
  return String(cell.value)
}

function readBoolean(vars: SessionVariables, name: string): unknown {
  const cell = vars[name]
  expect(cell, `variable "${name}" was never bound`).toBeTruthy()
  return cell.value
}

const sortedNames = (rows: readonly { name: string }[]): string[] =>
  rows.map((row) => row.name).sort()

test.describe('K8s Top options (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000)
    run = await seedRun(request, 'top')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('golden fixture: a named pod read returns exactly that pod (T-04, T-06)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    await importValidateAndNavigate(page, loadGolden(run), { injectHttp: true })

    const status = await startRun(page)
    const logs = await finishRun(page, status, GOLDEN_MARKER)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('T-04, T-06: select_by = name returns one row, the named pod', async () => {
      const table = podUsage(vars, 'golden_usage')
      const rows = podRows(table)
      expect(readNumber(vars, 'golden_count'), `count must be 1.\n${all}`).toBe(1)
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe(SEEDED.podLabeled)
      // Without the breakdown a pod row is one total, never a container row.
      expect(table.columns.map((column) => column.name)).not.toContain('CONTAINER')
      expect(
        logs.some((text) => text.includes('[T-04|T-06] rows=1')),
        `the leg marker is missing.\n${all}`,
      ).toBeTruthy()
      await expectNodeStatus(page, 'top-golden', 'success')
    })
  })

  test('option sweep: every reachable K8s Top option in one run', async ({ page }) => {
    test.setTimeout(240_000)
    const fixture = buildTopSweepFixture({
      adminToken: K8S_ADMIN_TOKEN,
      limitedToken: K8S_LIMITED_TOKEN,
      junkToken: JUNK_TOKEN,
      caCert: K8S_CA_PEM,
      namespace: run.namespace,
    })
    await importValidateAndNavigate(page, fixture, { injectHttp: true })

    const status = await startRun(page)
    const logs = await finishRun(page, status, TOP_DONE_MARKER, 180_000)
    const all = logs.join('\n')
    const entries = await getLogEntries(page)
    const warnings = messagesAt(entries, 'WARN')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    const podRowsOf = (key: string): PodUsageRow[] => podRows(podUsage(vars, usageVar(leg(key))))
    const nodeTableOf = (key: string): UsageTable => nodeUsage(vars, usageVar(leg(key)))
    const countOf = (key: string): number => readNumber(vars, countVar(leg(key)))

    const podScopeTable = podUsage(vars, usageVar(leg('t01')))
    const podScope = podRows(podScopeTable)
    const perContainer = containerRows(containerUsage(vars, usageVar(leg('t11'))))
    const nodeScope = nodeRows(nodeTableOf('t02'))

    await test.step('every leg reported its option ids on the console', () => {
      for (const candidate of TOP_LEGS) {
        expect(
          logs.some((text) => text.includes(legMarker(candidate))),
          `${candidate.key} (${candidate.ids.join(', ')}) never reached its marker.\n${all}`,
        ).toBeTruthy()
      }
    })

    await test.step('T-01, T-03, T-10: pod scope lists the run namespace, one row per pod', () => {
      expect(sortedNames(podScope)).toEqual(
        [SEEDED.podLabeled, SEEDED.podMulti, SEEDED.podPlain].sort(),
      )
      expect(countOf('t01')).toBe(3)
      // The second namespace's pod is out of reach without the all-namespaces tick.
      expect(sortedNames(podScope)).not.toContain(SEEDED.podOther)
      // No CONTAINER column, and none of the node capacity columns.
      expect(podScopeTable.columns.map((column) => column.name)).toEqual([...POD_COLUMNS])
      // CPU is a float column: an exact decimal, carried as a plain-decimal string.
      expect(
        podScopeTable.rows.every((cells) => isPlainDecimal(cells[POD_CELL.cpu])),
      ).toBeTruthy()
      expect(podScope.every((row) => Number.isInteger(row.memory))).toBeTruthy()
      expect(
        logs.some((text) => text.includes('Read pod usage: 3 rows')),
        `the plugin's own INFO line is missing.\n${all}`,
      ).toBeTruthy()
    })

    await test.step('T-15, T-16: the breakdown is one row per container, with kwok\'s numbers', () => {
      expect(countOf('t11')).toBe(4)
      expect(
        perContainer.map((row) => `${row.name}/${row.container}`).sort(),
      ).toEqual(
        [
          `${SEEDED.podLabeled}/${SEEDED.containerApp}`,
          `${SEEDED.podMulti}/${SEEDED.containerApp}`,
          `${SEEDED.podMulti}/${SEEDED.containerSidecar}`,
          `${SEEDED.podPlain}/${SEEDED.containerApp}`,
        ].sort(),
      )
      for (const row of perContainer.filter((candidate) => candidate.name !== SEEDED.podPlain)) {
        expect(row.memory, `${row.name}/${row.container} memory is exact`).toBe(
          ANNOTATED_MEMORY_BYTES,
        )
        // kwok reports cpu in nanocores and it jitters in the last digits.
        expect(row.cpu).toBeCloseTo(ANNOTATED_CPU_CORES, 2)
      }
      const plain = perContainer.find((row) => row.name === SEEDED.podPlain)
      expect(plain, 'the unannotated pod must have a row').toBeTruthy()
      expect(plain!.memory).toBe(DEFAULT_MEMORY_BYTES)
      expect(plain!.cpu).toBeCloseTo(DEFAULT_CPU_CORES, 4)
    })

    await test.step('T-11: with the breakdown off a pod row is the SUM of its containers', () => {
      const podRow = podScope.find((row) => row.name === SEEDED.podMulti)
      const containers = perContainer.filter((row) => row.name === SEEDED.podMulti)
      expect(podRow, 'the two-container pod must have a pod row').toBeTruthy()
      expect(containers).toHaveLength(2)
      expect(podRow!.memory).toBe(containers.reduce((total, row) => total + row.memory, 0))
      expect(podRow!.memory).toBe(2 * ANNOTATED_MEMORY_BYTES)
      expect(podRow!.cpu).toBeCloseTo(
        containers.reduce((total, row) => total + row.cpu, 0),
        3,
      )
    })

    await test.step('T-05, T-08: the label selector keeps the labeled pod and drops the rest', () => {
      const rows = podRowsOf('t05')
      expect(countOf('t05')).toBe(1)
      expect(sortedNames(rows)).toEqual([SEEDED.podLabeled])
      expect(sortedNames(rows)).not.toContain(SEEDED.podPlain)
      expect(sortedNames(rows)).not.toContain(SEEDED.podMulti)
    })

    await test.step('TOP-DEFAULT-ALL: a Top block that never wrote Select by measures every pod', () => {
      // Select by opens on All, so an untouched selector is not a hole and the
      // read covers the whole namespace.
      expect(sortedNames(podRowsOf('t03d'))).toEqual(sortedNames(podScope))
      expect(countOf('t03d')).toBe(countOf('t01'))
    })

    await test.step('T-09: selector mode with no selector equals All (known degenerate)', () => {
      expect(sortedNames(podRowsOf('t09'))).toEqual(sortedNames(podScope))
      expect(countOf('t09')).toBe(countOf('t01'))
    })

    await test.step('T-13: All namespaces reaches the second namespace', () => {
      const names = sortedNames(podRowsOf('t13'))
      // Membership only: every shard seeds its own namespaces on this cluster.
      expect(names).toContain(SEEDED.podOther)
      expect(names).toContain(SEEDED.podLabeled)
      expect(countOf('t13')).toBeGreaterThanOrEqual(4)
    })

    await test.step('T-14: All namespaces on a NAME read is ignored (fixture-injected, not sheet-reachable)', () => {
      const rows = podRowsOf('t14')
      expect(countOf('t14')).toBe(1)
      expect(sortedNames(rows)).toEqual([SEEDED.podLabeled])
    })

    await test.step('T-02, T-17: node scope carries capacity and allocatable, exact', () => {
      const nodeRow = nodeScope.find((row) => row.name === SEEDED.node)
      expect(nodeRow, `${SEEDED.node} must have a node row.\n${all}`).toBeTruthy()
      expect(nodeRow!.capacity).toEqual(NODE_CAPACITY)
      expect(nodeRow!.allocatable).toEqual(NODE_CAPACITY)
      // Usage: presence, shape and units only. One node is shared by every
      // shard and its usage sums every pod on it, so no value is assertable.
      const nodeCells = nodeTableOf('t02').rows.find(
        (cells) => String(cells[NODE_CELL.name]) === SEEDED.node,
      )
      expect(isPlainDecimal(nodeCells![NODE_CELL.cpu])).toBeTruthy()
      expect(nodeRow!.cpu).toBeGreaterThan(0)
      // Cores, not nanocores: a nanocore figure would be nine orders larger.
      expect(nodeRow!.cpu).toBeLessThan(1_000)
      expect(Number.isInteger(nodeRow!.memory)).toBeTruthy()
      // Bytes, not mebibytes: a Mi figure would be under a thousand.
      expect(nodeRow!.memory).toBeGreaterThan(MEBIBYTE)
    })

    await test.step('T-12: the container breakdown does nothing to a node read (fixture-injected)', () => {
      const table = nodeTableOf('t12')
      const rows = nodeRows(table)
      expect(countOf('t12')).toBe(countOf('t02'))
      expect(sortedNames(rows)).toEqual(sortedNames(nodeScope))
      // The tick adds no CONTAINER column: the heading is the node heading.
      expect(table.columns.map((column) => column.name)).toEqual([...NODE_COLUMNS])
      const withBreakdown = rows.find((row) => row.name === SEEDED.node)
      const without = nodeScope.find((row) => row.name === SEEDED.node)
      expect(withBreakdown!.capacity).toEqual(without!.capacity)
      expect(withBreakdown!.allocatable).toEqual(without!.allocatable)
    })

    await test.step('T-23: a missing pod names the namespace it looked in', async () => {
      const expected = `K8s Pod '${MISSING_NAME}' not found in namespace '${run.namespace}'`
      expect(readString(vars, errorVar(leg('t23')))).toBe(expected)
      expect(readString(vars, reasonVar(leg('t23')))).toBe('NotFound')
      expect(readBoolean(vars, okVar(leg('t23')))).toBe(false)
      expect(podRowsOf('t23')).toEqual([])
      expect(countOf('t23')).toBe(0)
      expect(warnings, `the recorded failure must write a WARN line.\n${all}`).toContain(
        `Read failed (NotFound): ${expected}`,
      )
      await expectNodeStatus(page, 'top-t23', 'warning')
    })

    await test.step('T-24: a missing NODE carries no namespace clause', async () => {
      const expected = `K8s Node '${MISSING_NAME}' not found`
      const message = readString(vars, errorVar(leg('t24')))
      expect(message).toBe(expected)
      expect(message).not.toContain(' in namespace')
      expect(readString(vars, reasonVar(leg('t24')))).toBe('NotFound')
      expect(readBoolean(vars, okVar(leg('t24')))).toBe(false)
      // A recorded node read still keeps the node heading, with no rows under it.
      expect(nodeRows(nodeTableOf('t24'))).toEqual([])
      expect(countOf('t24')).toBe(0)
      expect(warnings).toContain(`Read failed (NotFound): ${expected}`)
      await expectNodeStatus(page, 'top-t24', 'warning')
    })

    await test.step('T-22: the limited token is refused BY THE METRICS GROUP', async () => {
      const expected =
        'Kubernetes API permission denied: pods.metrics.k8s.io is forbidden: ' +
        'User "wave-limited" cannot list resource "pods" in API group ' +
        `"metrics.k8s.io" in the namespace "${run.namespace}"`
      const message = readString(vars, errorVar(leg('t22')))
      expect(message).toBe(expected)
      expect(message).toContain('metrics.k8s.io')
      expect(readString(vars, reasonVar(leg('t22')))).toBe('Forbidden')
      expect(readBoolean(vars, okVar(leg('t22')))).toBe(false)
      expect(podRowsOf('t22')).toEqual([])
      expect(warnings).toContain(`Read failed (Forbidden): ${expected}`)
      await expectNodeStatus(page, 'top-t22', 'warning')
    })

    await test.step('T-25: a junk bearer token fails authentication', async () => {
      const expected = 'Kubernetes API authentication failed: Unauthorized'
      expect(readString(vars, errorVar(leg('t25')))).toBe(expected)
      expect(readString(vars, reasonVar(leg('t25')))).toBe('Unauthorized')
      expect(readBoolean(vars, okVar(leg('t25')))).toBe(false)
      expect(podRowsOf('t25')).toEqual([])
      expect(countOf('t25')).toBe(0)
      expect(warnings).toContain(`Read failed (Unauthorized): ${expected}`)
      await expectNodeStatus(page, 'top-t25', 'warning')
    })

    await test.step('every reading leg painted the status its option row expects', async () => {
      for (const candidate of TOP_LEGS) {
        await expectNodeStatus(
          page,
          `top-${candidate.key}`,
          candidate.records ? 'warning' : 'success',
        )
      }
    })
  })
})
