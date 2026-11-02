/**
 * V-K8S-REMOTE-WRITE: the K8s write Blocks inside a Remote Execution container.
 *
 * One workflow opens an SSH session to the stack's sshd host and runs a Remote
 * Execution whose body holds every K8s write Block: a Connect, a ConfigMap
 * applied from the form and read back, a manifest whose unquoted date must
 * reach the cluster as text and whose trailing separator must open no second
 * document, a delete, the recorded miss the delete leaves behind, a Scale and a
 * Rollout Status. The cluster is named by its compose DNS name (`kwok`), which
 * resolves only inside the stack network, so a Block that reached it can only
 * have run on the SSH host. Every claim is asserted on what the cluster holds,
 * read back through a bound output, never on Block status alone. Were the
 * wire-format resolver to stop stripping YAML's timestamp rule, the date would
 * reach the JSON encoder as a date and the Apply would fail loudly rather than
 * write a wrong value.
 *
 * REQ: REQ-3.4.1.3, REQ-5.1.1, REQ-3.4.1.5
 *
 * Design Decisions: K8SWRITE-1, K8SWRITE-2, K8SWRITE-5, K8SWRITE-6, K8SWRITE-7,
 * K8SWRITE-8
 *
 * Pass Criteria:
 *   KR-8   every write Block runs on the SSH host and the roundtrip lands on
 *          the cluster: the form Apply's ConfigMap reads back with its data,
 *          the manifest writes exactly one object whose date is text, the
 *          delete removes the ConfigMap, the read that follows records a
 *          NotFound once and leaves the run passed, the Scale reports the
 *          previous and the new count, and the Rollout reports the cluster's
 *          verdict in both its Status output and its Summary row
 *   KR-gw  the write node factories emit the checked-in workflow shape
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
import { SEEDED, seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  appliedLine,
  corePath,
  deletedLine,
  deleteQuery,
  expectLine,
  expectSummary,
  notFound,
  readLine,
  rolloutLine,
  ROLLOUT_SUMMARY_COLUMNS,
  ROLLOUT_SUMMARY_TYPES,
  scaledLine,
  SCALE_SUMMARY_COLUMNS,
  SCALE_SUMMARY_TYPES,
  SUMMARY_COLUMNS,
  SUMMARY_TYPES,
  typeName,
} from '../k8s-write/cases-write'
import {
  BLOCK_FAILED_MARKER,
  buildWriteFixture,
  cell,
  connectedLine,
  expectLocusBadges,
  expectRecordedRead,
  expectStatuses,
  K8S_DIRECT_URL,
  K8S_VERSION,
  numberOf,
  objectOf,
  tableOf,
  textOf,
  WRITE_DONE_MARKER,
  WRITE_GOLDEN_NAMESPACE,
  WRITE_GOLDEN_SUFFIX,
  WRITE_IDS,
  WRITE_MARKER,
  WRITE_VARS,
  WRITTEN_REMOTE,
  type SessionVariables,
} from './cases-remote'

const GOLDEN_FILE = 'fixture-remote-write-golden.json'

/** The core plural the two written ConfigMaps live under. */
const CONFIGMAPS = 'configmaps'

/** The verdicts kwok's simulated rollout progress can report. */
const ROLLOUT_VERDICTS = ['complete', 'progressing']

/** The checked-in golden with the TEST-ONLY material filled in; PEM and token
 *  bytes are never committed inside fixture JSON. */
function loadWriteGolden(): Record<string, unknown> {
  const golden = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, GOLDEN_FILE), 'utf-8'),
  ) as Record<string, any>
  golden.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  golden.variables.k8s_ca.value = K8S_CA_PEM
  return golden as Record<string, unknown>
}

test('KR-gw: the write node factories emit the checked-in workflow shape', () => {
  const built = buildWriteFixture({
    suffix: WRITE_GOLDEN_SUFFIX,
    namespace: WRITE_GOLDEN_NAMESPACE,
    caCert: K8S_CA_PEM,
    adminToken: K8S_ADMIN_TOKEN,
  })
  expect(built).toEqual(loadWriteGolden())
})

test.describe('K8s writes inside a Remote Execution container', () => {
  let run: SeededRun

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    // 'get' is the one fast profile that seeds a Deployment for Scale and Rollout.
    run = await seedRun(request, 'get')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('KR-8: every write Block runs on the host and the roundtrip lands on the cluster', async ({
    page,
  }) => {
    test.setTimeout(300_000)

    const v = WRITE_VARS
    const ns = run.namespace
    const cmPath = `${corePath(ns, CONFIGMAPS)}/${WRITTEN_REMOTE.configMap}`
    const resource = typeName('Deployment', 'apps', SEEDED.deployment)

    const fixture = buildWriteFixture({
      suffix: run.suffix,
      namespace: ns,
      caCert: K8S_CA_PEM,
      adminToken: K8S_ADMIN_TOKEN,
    })
    await importValidateAndNavigate(page, fixture, { injectSsh: true })

    await test.step('every body Block carries the R badge and nothing else does', async () => {
      await expectLocusBadges(page, fixture)
    })

    const status = await startRun(page)
    const logs = await finishRun(page, status, WRITE_DONE_MARKER, 240_000)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('the Connect reads the cluster by its stack name', () => {
      expect(textOf(vars, v.version), `the cluster version.\n${all}`).toBe(K8S_VERSION)
      expect(
        logs.filter((text) => text === connectedLine(K8S_DIRECT_URL)).length,
        `the Connect must report the cluster by its stack name once.\n${all}`,
      ).toBe(1)
    })

    await test.step('the form Apply lands and the Get reads the same data back', () => {
      expectSummary(vars, 'cm', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[typeName('ConfigMap', '', WRITTEN_REMOTE.configMap), 'created']],
      })
      expect(cell(vars, v.cmNames).value, 'the applied names').toEqual([WRITTEN_REMOTE.configMap])
      expect(numberOf(vars, v.cmCount), `the applied count.\n${all}`).toBe(1)
      expect(cell(vars, v.cmOk).value, 'the Apply reports success').toBe(true)
      expect(objectOf(vars, v.cmResult).data, 'the applied data').toEqual({
        [WRITTEN_REMOTE.configMapKey]: WRITTEN_REMOTE.configMapValue,
      })

      expect(numberOf(vars, v.readCount), `the read-back count.\n${all}`).toBe(1)
      const read = objectOf(vars, v.readResult)
      expect(read.data, 'the cluster holds what the form typed').toEqual({
        [WRITTEN_REMOTE.configMapKey]: WRITTEN_REMOTE.configMapValue,
      })
      expect(read.metadata?.namespace, 'the object landed in the run namespace').toBe(ns)
      expectLine(logs, readLine('ConfigMap', 1, cmPath))
    })

    await test.step('the manifest writes one object and its unquoted date stays text', () => {
      expect(numberOf(vars, v.dtCount), `the manifest Apply count.\n${all}`).toBe(1)
      expect(cell(vars, v.dtNames).value, 'the manifest names').toEqual([
        WRITTEN_REMOTE.datedConfigMap,
      ])
      expectSummary(vars, 'dt', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[typeName('ConfigMap', '', WRITTEN_REMOTE.datedConfigMap), 'created']],
      })
      const applied = cell(vars, v.dtResult)
      expect(applied.type, 'a Manifest-mode Result is one entry per document').toBe('array')
      expect(
        (applied.value as unknown[]).length,
        `the trailing separator must open no second document.\n${all}`,
      ).toBe(1)
      expect(
        logs.filter((text) => text === appliedLine(1)).length,
        `both Applies must write exactly one object.\n${all}`,
      ).toBe(2)

      const dated = objectOf(vars, v.dtRead)
      expect(dated.data, 'the cluster holds the dated key').toEqual({
        [WRITTEN_REMOTE.datedKey]: WRITTEN_REMOTE.datedValue,
      })
      const values = (dated.data ?? {}) as Record<string, unknown>
      expect(
        typeof values[WRITTEN_REMOTE.datedKey],
        'the cluster holds the unquoted date as text',
      ).toBe('string')
      expect(
        logs.filter((text) => text.startsWith("Block '") && text.includes(BLOCK_FAILED_MARKER)),
        `no Block may fail in this run.\n${all}`,
      ).toEqual([])
    })

    await test.step('the Delete removes the ConfigMap the form applied', () => {
      expectSummary(vars, 'drop', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[typeName('ConfigMap', '', WRITTEN_REMOTE.configMap), 'deleted']],
      })
      expect(cell(vars, v.dropNames).value, 'the deleted names').toEqual([
        WRITTEN_REMOTE.configMap,
      ])
      expect(numberOf(vars, v.dropCount), `the deleted count.\n${all}`).toBe(1)
      expect(cell(vars, v.dropOk).value, 'the Delete reports success').toBe(true)
      expectLine(logs, deletedLine(1, 'ConfigMap', `${cmPath}${deleteQuery()}`))
    })

    await test.step('the read that follows records the miss and leaves the run passed', async () => {
      expect(numberOf(vars, v.missCount), `the missing read's count.\n${all}`).toBe(0)
      expect(cell(vars, v.missNames).value, 'the missing read binds no names').toEqual([])
      await expectRecordedRead(
        page,
        vars,
        { ok: v.missOk, reason: v.missReason, error: v.missError },
        WRITE_IDS.missing,
        {
          reason: 'NotFound',
          message: notFound('ConfigMap', WRITTEN_REMOTE.configMap, ns),
        },
      )
    })

    await test.step('the Scale reports the previous and the new count', () => {
      expectSummary(vars, 'scale', {
        columns: SCALE_SUMMARY_COLUMNS,
        types: SCALE_SUMMARY_TYPES,
        rows: [[resource, 'scaled', 1, 3]],
      })
      expect(cell(vars, v.scaleOk).value, 'the Scale reports success').toBe(true)
      expectLine(logs, scaledLine(resource, 1, 3))
    })

    await test.step('the Rollout reports the cluster verdict, and Summary repeats it', () => {
      const verdict = textOf(vars, v.rollStatus)
      expect(ROLLOUT_VERDICTS, `unexpected rollout verdict.\n${all}`).toContain(verdict)
      expect(cell(vars, v.rollOk).value, 'the Rollout reports success').toBe(true)

      const table = tableOf(vars, v.rollSummary, ROLLOUT_SUMMARY_COLUMNS)
      expect(
        table.columns.map((column) => column.type),
        'the Rollout Summary column types',
      ).toEqual([...ROLLOUT_SUMMARY_TYPES])
      expect(table.rows.length, 'Rollout reports one row').toBe(1)
      const [named, outcome, message] = table.rows[0] as [string, string, string]
      expect(named, 'the RESOURCE cell').toBe(resource)
      expect(outcome, 'the OUTCOME cell is the Status output').toBe(verdict)
      if (verdict === 'complete') {
        expect(message, 'the completed wording').toBe(
          `deployment "${SEEDED.deployment}" successfully rolled out`,
        )
      } else {
        expect(message.startsWith('Waiting for deployment'), message).toBeTruthy()
        expect(message.endsWith('...'), message).toBeTruthy()
      }
      expectLine(logs, rolloutLine('status', resource))
    })

    await test.step('the summary marker and the Block statuses', async () => {
      const marker = logs.find((text) => text.startsWith(WRITE_MARKER)) ?? ''
      expect(marker, `the summary marker is missing.\n${all}`).toBe(
        `${WRITE_MARKER} cm=1 dated=1 drop=1 miss=NotFound roll=${textOf(vars, v.rollStatus)}`,
      )
      await expectStatuses(page, fixture, { [WRITE_IDS.missing]: 'warning' })
    })
  })
})
