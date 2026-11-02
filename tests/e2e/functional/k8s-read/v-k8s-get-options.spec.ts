/**
 * V-K8S-GET-OPTIONS (R1): the K8s Get option sweep against the real kwok
 * cluster.
 *
 * Covers option rows G-01 to G-37 and G-40 to G-48 and G-53 to G-55, plus the shared rows
 * S-01, S-05, S-08, S-10 and S-11 (the id families are defined in the suite
 * README). The eight empty-shape cells (G-56 to G-62), the amber row (S-20)
 * and the empty-session sentence (S-03) live in `v-k8s-get-failures.spec.ts`:
 * one run carrying all of them lands over the 60 s per-file budget. G-38 and
 * G-39 are R8 and R7; G-63 to G-67 are R7 and R6.
 *
 * The leg count is driven by the 23 Kinds, so most Kind legs also carry a
 * rotated option - a format, a namespace state, a selector, a version pin -
 * and the rows for those options ride the same leg. `cases-get.ts` names which
 * ids ride which leg, and every leg stamps those ids on the console.
 *
 * Two assertion surfaces, both exact. The plugin's own INFO line carries the
 * API path it read, which is what proves the namespace options, the selectors
 * and the resolution forms: a tick that was ignored shows up as a path with no
 * namespace segment. The bound outputs are read back in one session-variables
 * call, which is what proves the shapes and the declared Result type.
 *
 * Design Decisions: K8SREAD-1, K8SREAD-5, K8SREAD-6, K8SREAD-8
 * REQ: REQ-5.1.1, REQ-4.5.6, REQ-3.4.1.5
 */

import fs from 'fs'
import path from 'path'
import { test, expect } from '../../helpers/playwright-fixtures'
import { expectNoSecret, SECRET_MASK } from '../../helpers/secret-canary'
import {
  getActiveSessionId,
  getSessionVariables,
  importExpectingErrors,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { codesOf } from '../../helpers/fn-seed'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, SEEDED, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM } from '../../helpers/config'
import {
  buildGetFixture,
  countVar,
  CRD_OBJECT,
  GET_DONE_MARKER,
  GET_GOLDEN_MARKER,
  getLegs,
  GOLDEN_LEG,
  legMarker,
  markerLine,
  namesVar,
  POD_TABLE_COLUMNS,
  readLine,
  resultVar,
  SECRET_TABLE_COLUMNS,
  type GetLeg,
} from './cases-get'

type SessionVariables = Record<string, { value: unknown; type: string }>
type WaveTable = { columns: Array<{ name: string; type: string }>; rows: unknown[][] }

let run: SeededRun
let legs: GetLeg[]

function leg(key: string): GetLeg {
  const found = legs.find((candidate) => candidate.key === key)
  expect(found, `no leg "${key}" in the case table`).toBeTruthy()
  return found as GetLeg
}

function cell(vars: SessionVariables, name: string): { value: unknown; type: string } {
  const found = vars[name]
  expect(found, `variable "${name}" was never bound`).toBeTruthy()
  return found
}

const namesOf = (vars: SessionVariables, key: string): string[] =>
  cell(vars, namesVar(leg(key))).value as string[]
const countOf = (vars: SessionVariables, key: string): number =>
  Number(cell(vars, countVar(leg(key))).value)
const resultOf = (vars: SessionVariables, key: string): { value: unknown; type: string } =>
  cell(vars, resultVar(leg(key)))

/** The plugin's own success line. The path is the proof for every namespace,
 *  selector and resolution row, so it is asserted whole. */
function expectReadLine(logs: readonly string[], candidate: GetLeg, all: string): void {
  const read = candidate.expectRead
  if (!read) return
  if (read.count !== undefined) {
    const expected = readLine(read.kind, read.count, read.path)
    expect(
      logs.includes(expected),
      `${legMarker(candidate)} did not print: ${expected}\n${all}`,
    ).toBeTruthy()
    return
  }
  const tail = ` ${read.kind} object(s) from ${read.path}`
  expect(
    logs.some((text) => text.startsWith('Read ') && text.endsWith(tail)),
    `${legMarker(candidate)} did not print a read line ending: ${tail}\n${all}`,
  ).toBeTruthy()
}

/** Load the checked-in golden fixture and write the run's material into it. */
function loadGolden(seeded: SeededRun): Record<string, unknown> {
  const fixture = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-get-golden.json'), 'utf-8'),
  ) as Record<string, any>
  fixture.variables.k8s_admin_token.value = K8S_ADMIN_TOKEN
  fixture.variables.k8s_ca.value = K8S_CA_PEM
  const nodes = fixture.workflow.nodes as Array<Record<string, any>>
  const connect = nodes.find((node) => node.id === 'connect-admin')
  expect(connect, 'the golden fixture must hold connect-admin').toBeTruthy()
  connect!.data.config.values.namespace = seeded.namespace
  return fixture as Record<string, unknown>
}

/** Which seeded object each Kind leg must find in `names`. */
function kindMembers(seeded: SeededRun): Array<[string, string]> {
  return [
    ['g14', SEEDED.configMap],
    ['g13', SEEDED.service],
    ['g10', SEEDED.endpoints],
    ['g11', SEEDED.ingress],
    ['g12', SEEDED.networkPolicy],
    ['g18', SEEDED.pvc],
    ['g24', SEEDED.role],
    ['g25', SEEDED.roleBinding],
    ['g16', SEEDED.serviceAccount],
    ['g05', SEEDED.deployment],
    ['g08', SEEDED.replicaSet],
    ['g09', SEEDED.statefulSet],
    ['g04', SEEDED.daemonSet],
    ['g06', SEEDED.job],
    ['g03', SEEDED.cronJob],
    ['g23', SEEDED.node],
    ['g20', SEEDED.clusterRole],
    ['g21', SEEDED.clusterRoleBinding],
    ['g19', seeded.storageClass],
    ['g17', seeded.persistentVolume],
  ]
}

test.describe('K8s Get options (real kwok cluster)', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(240_000)
    run = await seedRun(request, 'get')
    legs = getLegs({
      namespace: run.namespace,
      namespaceB: run.namespaceB,
      storageClass: run.storageClass,
      persistentVolume: run.persistentVolume,
    })
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('golden fixture: the generated shape matches the checked-in one, and the named read works (G-01, G-07, G-34, G-37)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const golden = loadGolden(run)

    await test.step('the node factories emit the checked-in shape', () => {
      const built = buildGetFixture([GOLDEN_LEG], {
        adminToken: K8S_ADMIN_TOKEN,
        limitedToken: '',
        junkToken: '',
        caCert: K8S_CA_PEM,
        namespace: run.namespace,
        connects: ['admin'],
        name: 'K8s Get Golden',
        bookend: GET_GOLDEN_MARKER,
      })
      expect(built).toEqual(golden)
    })

    await importValidateAndNavigate(page, golden, { injectHttp: true })
    const status = await startRun(page)
    const logs = await finishRun(page, status, GET_GOLDEN_MARKER)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('the named read returns exactly the seeded pod', async () => {
      expect(cell(vars, 'golden_names').value).toEqual([SEEDED.podLabeled])
      expect(Number(cell(vars, 'golden_count').value)).toBe(1)
      expect(
        logs.includes(
          readLine('Pod', 1, `/api/v1/namespaces/${run.namespace}/pods/${SEEDED.podLabeled}`),
        ),
        `the plugin's own read line is missing.\n${all}`,
      ).toBeTruthy()
      await expectNodeStatus(page, 'get-golden', 'success')
    })
  })

  test('option sweep: every Kind, every resolution form, every format, every namespace option', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const fixture = buildGetFixture(legs, {
      adminToken: K8S_ADMIN_TOKEN,
      limitedToken: '',
      junkToken: '',
      caCert: K8S_CA_PEM,
      namespace: run.namespace,
      connects: ['admin'],
      name: 'K8s Get Option Sweep E2E Test',
      bookend: GET_DONE_MARKER,
    })

    // Every Result binding declares the type its Output Format and Search by
    // pair resolves to, and the pre-run gate refuses a mismatch, so a run that
    // starts at all proves the declared types.
    await importValidateAndNavigate(page, fixture, { injectHttp: true })

    const status = await startRun(page)
    const logs = await finishRun(page, status, GET_DONE_MARKER, 180_000)
    const all = logs.join('\n')
    const sessionId = await getActiveSessionId(page)
    const vars = (await getSessionVariables(page, sessionId)) as SessionVariables

    await test.step('every leg reported its option ids on the console', () => {
      for (const candidate of legs) {
        expect(
          logs.some((text) => text.includes(markerLine(candidate))),
          `${candidate.key} (${candidate.ids.join(', ')}) never reached its marker.\n${all}`,
        ).toBeTruthy()
      }
    })

    await test.step('NO-MANAGED-FIELDS: no read path hands back metadata.managedFields', () => {
      // The cluster writes managedFields onto every object it stores; kubectl
      // strips them before it prints, and so does WAVE, on every format.
      expect(JSON.stringify(resultOf(vars, 'g07').value)).not.toContain('managedFields')
      expect(JSON.stringify(resultOf(vars, 'g36').value)).not.toContain('managedFields')
      expect(String(resultOf(vars, 'g47').value)).not.toContain('managedFields')
      expect(String(resultOf(vars, 'g48').value)).not.toContain('managedFields')
      // The control: the rest of metadata survives, so this cannot pass by
      // handing back nothing.
      expect(JSON.stringify(resultOf(vars, 'g07').value)).toContain('resourceVersion')
    })

    await test.step('every leg read the path its options describe', () => {
      for (const candidate of legs) expectReadLine(logs, candidate, all)
    })

    await test.step('every leg succeeded except the deliberate discovery miss', async () => {
      for (const candidate of legs) {
        await expectNodeStatus(
          page,
          `get-${candidate.key}`,
          candidate.records ? 'warning' : 'success',
        )
      }
    })

    await test.step('G-03 to G-25: every stock Kind resolves and lists its object', () => {
      for (const [key, member] of kindMembers(run)) {
        expect(namesOf(vars, key), `${legMarker(leg(key))} did not return ${member}`).toContain(
          member,
        )
      }
      expect(namesOf(vars, 'g07')).toEqual([SEEDED.podLabeled])
      expect(countOf(vars, 'g07')).toBe(1)
      expect(namesOf(vars, 'g22')).toEqual([run.namespace])
      expect(namesOf(vars, 'g15a')).toEqual([SEEDED.secret])
    })

    await test.step('G-15: the Secret value never surfaces, and Table mode carries only the key count', () => {
      const encoded = Buffer.from(SEEDED.secretValue).toString('base64')
      expectNoSecret(all, 'console log', [SEEDED.secretValue, encoded])

      const mapped = JSON.stringify(resultOf(vars, 'g15a').value)
      expectNoSecret(mapped, 'the Map-mode Secret result', [SEEDED.secretValue, encoded])
      expect(mapped, 'the registered data value must read as the mask').toContain(SECRET_MASK)

      // g15a logs its whole result, so the console really carries the value.
      const printed = logs.find((text) => text.includes('[G-15] g15a count=')) ?? ''
      expect(printed, `the Secret result was never printed.\n${all}`).toContain(SECRET_MASK)

      const table = resultOf(vars, 'g15b')
      expect(table.type).toBe('table')
      const value = table.value as WaveTable
      expect(value.columns.map((column) => column.name)).toEqual([...SECRET_TABLE_COLUMNS])
      const row = value.rows.find((cells) => cells[0] === SEEDED.secret)
      expect(row, 'the seeded Secret must have a table row').toBeTruthy()
      // Table mode asks for metadata only: the Data cell is the key COUNT.
      expect(String(row![2])).toBe('1')
      expectNoSecret(JSON.stringify(value), 'the Table-mode Secret result', [
        SEEDED.secretValue,
        encoded,
        SEEDED.secretKey,
      ])
    })

    await test.step('G-02, G-26 to G-29: kind, plural, singular and short name all resolve to the same object', () => {
      for (const key of ['g02', 'g27', 'g28', 'g29']) {
        expect(namesOf(vars, key), `${legMarker(leg(key))} did not resolve`).toEqual([
          SEEDED.podLabeled,
        ])
        expect(countOf(vars, key)).toBe(1)
      }
    })

    await test.step('G-30, G-31: the core fast path and the group walk are different paths', () => {
      expect(namesOf(vars, 'g36')).toContain(SEEDED.podLabeled)
      expect(namesOf(vars, 'g31')).toContain(SEEDED.deployment)
    })

    await test.step('G-33: a real custom resource resolves and its object lists', () => {
      expect(namesOf(vars, 'g33')).toEqual([CRD_OBJECT])
      expect(countOf(vars, 'g33')).toBe(1)
    })

    await test.step('G-35, G-40: the label selector keeps the labeled pod and drops the unlabeled one', () => {
      const selected = namesOf(vars, 'g35')
      expect(selected).toContain(SEEDED.podLabeled)
      expect(selected).not.toContain(SEEDED.podPlain)
      expect(countOf(vars, 'g35')).toBeGreaterThan(0)
    })

    await test.step('G-42, G-44: the field selector narrows, and both selectors intersect', () => {
      expect(namesOf(vars, 'g42')).toEqual([SEEDED.podPlain])
      // Either clause alone returns something; together they cannot, because
      // the pod the field selector names is the one with no labels.
      expect(countOf(vars, 'g42')).toBe(1)
      expect(countOf(vars, 'g35')).toBeGreaterThan(0)
      expect(countOf(vars, 'g44')).toBe(0)
      expect(namesOf(vars, 'g44')).toEqual([])
    })

    await test.step('G-41, G-43: selector mode with no selector is the list read (known degenerate)', () => {
      expect([...namesOf(vars, 'g41')].sort()).toEqual([...namesOf(vars, 'g36')].sort())
    })

    await test.step('S-11, G-53: all namespaces reaches the second namespace, off does not', () => {
      expect(namesOf(vars, 'g36')).not.toContain(SEEDED.podOther)
      const everywhere = namesOf(vars, 'g53')
      // Other shards seed their own labeled pods, so membership only.
      expect(everywhere).toContain(SEEDED.podLabeled)
      expect(everywhere).toContain(SEEDED.podOther)
    })

    await test.step('G-54: the tick is ignored on a name read, which still finds the object', () => {
      expect(namesOf(vars, 'g54')).toEqual([SEEDED.podLabeled])
      expect(countOf(vars, 'g54')).toBe(1)
    })

    await test.step('S-08, S-10: a blank namespace override falls back to the session default', () => {
      expect(namesOf(vars, 's10')).toEqual(namesOf(vars, 'g07'))
      expect(countOf(vars, 's10')).toBe(1)
    })

    await test.step('G-45 to G-48, RESULT-TYPE: the Result type follows Output Format and Search by', () => {
      const named = resultOf(vars, 'g07')
      expect(named.type).toBe('map')
      expect((named.value as { metadata: { name: string } }).metadata.name).toBe(
        SEEDED.podLabeled,
      )

      const listed = resultOf(vars, 'g36')
      expect(listed.type).toBe('array')
      expect((listed.value as unknown[]).length).toBe(countOf(vars, 'g36'))

      const asJson = resultOf(vars, 'g47')
      expect(asJson.type).toBe('string')
      expect(JSON.parse(String(asJson.value)).kind).toBe('PodList')

      const asYaml = resultOf(vars, 'g48')
      expect(asYaml.type).toBe('string')
      expect(String(asYaml.value).split('\n')[0]).toBe('apiVersion: v1')
    })

    await test.step('G-46: Table mode carries the columns kubectl prints, and still fills names', () => {
      const table = resultOf(vars, 'g46')
      expect(table.type).toBe('table')
      const value = table.value as WaveTable
      expect(value.columns.map((column) => column.name)).toEqual([...POD_TABLE_COLUMNS])
      expect(value.rows.length).toBe(countOf(vars, 'g46'))
      expect(value.rows.map((cells) => cells[0])).toContain(SEEDED.podLabeled)
      expect(namesOf(vars, 'g46')).toContain(SEEDED.podLabeled)
    })

  })

  test('RESULT-TYPE: a Table Result cannot bind to a map variable', async ({ page }) => {
    const fixture = buildGetFixture(
      [
        {
          key: 'gbad',
          ids: ['RESULT-TYPE'],
          what: 'Table result bound to a map variable',
          session: 'admin',
          values: {
            resource_type: 'default',
            kind: 'Pod',
            search_by: 'list',
            output_format: 'table',
          },
          resultType: 'table',
        },
      ],
      {
        adminToken: K8S_ADMIN_TOKEN,
        limitedToken: '',
        junkToken: '',
        caCert: K8S_CA_PEM,
        namespace: run.namespace,
        connects: ['admin'],
        name: 'K8s Get Binding Type E2E Test',
        bookend: 'k8s-get-binding-done',
      },
    )
    const variables = fixture.variables as Record<string, { type: string }>
    variables.gbad_result.type = 'map'

    // The pre-run gate is where a binding type is checked, so this is the same
    // refusal a Run would hit. POST /tests does not carry the check.
    const result = await importExpectingErrors(page, fixture, {
      context: 'run',
      navigate: false,
      injectHttp: true,
    })
    expect(result.status, 'a mismatched Result binding must be refused').toBe(422)
    expect(codesOf(result.errors)).toContain('INVALID_OUTPUT_BINDING_TYPE')
    expect(result.errors.map((entry) => String(entry.message))).toContain(
      "Output 'result' (type table) cannot bind to variable 'gbad_result' (type map)",
    )
    expect(result.errors.map((entry) => String(entry.node_label))).toContain('K8s Get')
  })
})
