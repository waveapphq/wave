/**
 * V-K8S-WRITE-MANIFEST: what K8s Apply refuses before it writes, and which API
 * version a manifest's own `apiVersion` routes the write to.
 *
 * Phase: functional-workflow (parallel) - each test imports its own Test,
 * writes only inside the run's own namespace, and tears the namespace down.
 * REQ: REQ-5.1.1, REQ-3.4.1.5, REQ-3.5.2.1, REQ-3.5.2.2, REQ-4.5.5, REQ-4.5.6
 * Design Decisions: K8SWRITE-1, K8SWRITE-2, K8SWRITE-6, K8SWRITE-8
 *
 * Three runs. The first holds every refusal the Block makes before it opens a
 * connection, so its legs share a run without sharing an object: none of them
 * reaches the cluster, and the two read-back legs at the end prove it. The
 * second routes one write through a CRD the cluster serves at two versions.
 * The third hands the cluster a field it does not know, on the create path and
 * on the update path.
 *
 * A refusal raised before the write is a hard failure whatever On error says,
 * so each one is wrapped in a Try/Catch and read back off the caught message.
 * A refusal the cluster makes is recordable, so those legs run under Record and
 * continue and are read back off the bound Error and Reason.
 *
 * Pass Criteria:
 *   KW-21  a mode row whose expression gives an empty string fails the Block
 *          with that row's own allowed-values sentence, and no Job reaches the
 *          cluster
 *   KW-22  a manifest whose apiVersion or kind is written but empty, or
 *          written as null, is refused with the manifest's own message, and
 *          none of those objects is created
 *   KW-23  a manifest whose metadata is a string, a list or a number gets the
 *          Block's own missing-name message every time, and no internal Python
 *          error text ever reaches the console
 *   KW-24  a manifest naming a served but non-preferred API version writes at
 *          the version it names, and a K8s Get finds the object at the version
 *          the cluster prefers
 *   KW-25  a manifest naming a version the cluster does not serve fails,
 *          naming both the kind and the version, and writes nothing
 *   KW-26  an unknown manifest field is refused on the create path
 *          (If exists = Fail) rather than dropped
 *   KW-27  the same field is refused on the update path, and neither object
 *          is left on the cluster
 *   KW-35  a manifest that is only a document separator declares no object,
 *          so the Block refuses it before it writes with the manifest's own
 *          apiVersion/kind message, and nothing reaches the cluster
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogEntries, type LogEntry } from '../../helpers/log-reader'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { finishRun, startRun } from '../../helpers/k8s-run'
import { seedRun, type SeededRun } from '../../helpers/k8s-seed'
import { K8S_ADMIN_TOKEN, K8S_CA_PEM, K8S_LIMITED_TOKEN } from '../../helpers/config'
import {
  appliedLine,
  buildWriteFixture,
  corePath,
  countOf,
  errorOf,
  expectCaught,
  expectEmptyWrite,
  expectLegStatuses,
  expectLine,
  expectMarkers,
  expectRecorded,
  expectSummary,
  namesOf,
  readLine,
  reasonOf,
  recordedLine,
  resultOf,
  SUMMARY_COLUMNS,
  SUMMARY_TYPES,
  typeName,
  type SessionVariables,
  type WriteLeg,
  type WriteMaterial,
} from './cases-write'

/** The bookend each run harvests its console against. */
const REFUSED_MARKER = 'k8s-write-refused-done'
const ROUTED_MARKER = 'k8s-write-routed-done'
const STRICT_MARKER = 'k8s-write-strict-done'

/** Every object name this file names on the wire. Only the two routing names
 *  are ever meant to exist; the rest prove a refusal by staying absent. */
const NAMED = {
  job: 'wave-blank-mode-job',
  blankVersion: 'wave-blank-version-cm',
  nullVersion: 'wave-null-version-cm',
  blankKind: 'wave-blank-kind-cm',
  nullKind: 'wave-null-kind-cm',
  gadget: 'wave-pinned-gadget',
  unserved: 'wave-unserved-gadget',
  strictCreate: 'wave-strict-create-cm',
  strictUpdate: 'wave-strict-update-cm',
} as const

/** The cluster's own custom resource, served at two versions with the default
 *  conversion: v1 is stored and preferred, v1alpha1 is served only. */
const CRD_KIND = 'WaveGadget'
const CRD_GROUP = 'wave.e2e'
const CRD_PLURAL = 'wavegadgets'
const CRD_PINNED_VERSION = `${CRD_GROUP}/v1alpha1`
const CRD_PREFERRED_VERSION = `${CRD_GROUP}/v1`
const CRD_UNSERVED_VERSION = `${CRD_GROUP}/v9`

const CONFIGMAPS = 'configmaps'
const JOBS = 'jobs'

/** Published into every namespace by the cluster, never by a test. */
const CLUSTER_OWNED_CONFIGMAP = 'kube-root-ca.crt'

/** The field no built-in type declares, so a strict cluster must refuse it. */
const UNKNOWN_FIELD = 'bogusTopLevel'

/** The Block's own manifest wordings (`_k8s_common`). */
const MANIFEST_KIND_MESSAGE = "Parameter 'manifest' must include 'apiVersion' and 'kind'"
const MANIFEST_NAME_MESSAGE = "Parameter 'manifest' must include 'metadata.name'"

/** A stream that declares no document at all: the engine renders it as the
 *  empty JSON array, and parse_manifest refuses that as declaring no kind. */
const SEPARATOR_ONLY_MANIFEST = '---\n'

/** The enum sentence `validate()` writes for a row holding an empty string. */
const BLANK_JOB_FROM =
  "Parameter 'job_from' must be one of: image, cronjob; Actual value was ''."

/** A blank choice saved as text is refused at save, so the leg reaches the run through an expression. */
const BLANK_ENUM = "''" as unknown as never

const groupPath = (group: string, namespace: string, plural: string): string =>
  `/apis/${group}/namespaces/${namespace}/${plural}`

const yaml = (lines: readonly string[]): string => [...lines, ''].join('\n')

/** A ConfigMap document whose two header lines are written verbatim, so one of
 *  them can be given no text at all. */
const headerManifest = (apiVersionLine: string, kindLine: string, name: string): string =>
  yaml([apiVersionLine, kindLine, 'metadata:', `  name: ${name}`])

/** A ConfigMap document whose `metadata` is not a mapping. */
const badMetadataManifest = (metadata: readonly string[]): string =>
  yaml(['apiVersion: v1', 'kind: ConfigMap', ...metadata])

const gadgetManifest = (apiVersion: string, name: string): string =>
  yaml([
    `apiVersion: ${apiVersion}`,
    `kind: ${CRD_KIND}`,
    'metadata:',
    `  name: ${name}`,
    'spec:',
    '  size: small',
  ])

/** A ConfigMap carrying a top-level field no cluster declares. */
const unknownFieldManifest = (name: string): string =>
  yaml([
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    `  name: ${name}`,
    'data:',
    '  role: "target"',
    `${UNKNOWN_FIELD}: nope`,
  ])

let run: SeededRun

function material(
  overrides: Partial<WriteMaterial> & Pick<WriteMaterial, 'name' | 'bookend'>,
): WriteMaterial {
  return {
    adminToken: K8S_ADMIN_TOKEN,
    limitedToken: K8S_LIMITED_TOKEN,
    caCert: K8S_CA_PEM,
    namespace: run.namespace,
    connects: ['admin'],
    ...overrides,
  }
}

function messagesAt(entries: readonly LogEntry[], level: string): string[] {
  return entries.filter((entry) => entry.level === level).map((entry) => entry.message)
}

async function runFixture(
  page: Page,
  fixture: Record<string, unknown>,
  marker: string,
): Promise<{ logs: string[]; all: string; vars: SessionVariables }> {
  await importValidateAndNavigate(page, fixture, { injectHttp: true })
  const status = await startRun(page)
  const logs = await finishRun(page, status, marker, 180_000)
  const sessionId = await getActiveSessionId(page)
  const vars = (await getSessionVariables(page, sessionId)) as SessionVariables
  return { logs, all: logs.join('\n'), vars }
}

/** KW-21, KW-22, KW-23, KW-35: every refusal the Block makes before it writes. */
function refusedLegs(): WriteLeg[] {
  return [
    {
      key: 'blankmode',
      ids: ['KW-21'],
      what: 'a Job whose Job from holds no text',
      block: 'apply',
      guarded: true,
      expressions: ['job_from'],
      values: {
        define_with: 'form',
        kind: 'Job',
        name: NAMED.job,
        job_from: BLANK_ENUM,
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'blankver',
      ids: ['KW-22'],
      what: 'a blank apiVersion',
      block: 'apply',
      guarded: true,
      values: {
        define_with: 'manifest',
        manifest: headerManifest('apiVersion: ""', 'kind: ConfigMap', NAMED.blankVersion),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'nullver',
      ids: ['KW-22'],
      what: 'a null apiVersion',
      block: 'apply',
      guarded: true,
      values: {
        define_with: 'manifest',
        manifest: headerManifest('apiVersion:', 'kind: ConfigMap', NAMED.nullVersion),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'blankkind',
      ids: ['KW-22'],
      what: 'a blank kind',
      block: 'apply',
      guarded: true,
      values: {
        define_with: 'manifest',
        manifest: headerManifest('apiVersion: v1', 'kind: ""', NAMED.blankKind),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'nullkind',
      ids: ['KW-22'],
      what: 'a null kind',
      block: 'apply',
      guarded: true,
      values: {
        define_with: 'manifest',
        manifest: headerManifest('apiVersion: v1', 'kind:', NAMED.nullKind),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'sepdoc',
      ids: ['KW-35'],
      what: 'a manifest that is only a document separator',
      block: 'apply',
      guarded: true,
      values: {
        define_with: 'manifest',
        manifest: SEPARATOR_ONLY_MANIFEST,
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'metastr',
      ids: ['KW-23'],
      what: 'metadata written as a string',
      block: 'apply',
      guarded: true,
      values: {
        define_with: 'manifest',
        manifest: badMetadataManifest(['metadata: wave-not-a-mapping']),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'metalist',
      ids: ['KW-23'],
      what: 'metadata written as a list',
      block: 'apply',
      guarded: true,
      values: {
        define_with: 'manifest',
        manifest: badMetadataManifest(['metadata:', '  - 1', '  - 2']),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'metanum',
      ids: ['KW-23'],
      what: 'metadata written as a number',
      block: 'apply',
      guarded: true,
      values: {
        define_with: 'manifest',
        manifest: badMetadataManifest(['metadata: 7']),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'nojob',
      ids: ['KW-21'],
      what: 'every Job in the namespace',
      block: 'get',
      resultType: 'array',
      values: {
        resource_type: 'default',
        kind: 'Job',
        search_by: 'list',
        output_format: 'map',
      },
    },
    {
      key: 'nocm',
      ids: ['KW-22'],
      what: 'every ConfigMap in the namespace',
      block: 'get',
      resultType: 'array',
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        search_by: 'list',
        output_format: 'map',
      },
    },
  ]
}

/** KW-24, KW-25: the manifest's own apiVersion decides where the write goes. */
function routedLegs(): WriteLeg[] {
  return [
    {
      key: 'pinned',
      ids: ['KW-24'],
      what: 'a custom resource at a served, non-preferred version',
      block: 'apply',
      values: {
        define_with: 'manifest',
        manifest: gadgetManifest(CRD_PINNED_VERSION, NAMED.gadget),
        if_exists: 'update',
        output_format: 'map',
      },
    },
    {
      key: 'preferred',
      ids: ['KW-24'],
      what: 'read it back at the preferred version',
      block: 'get',
      resultType: 'map',
      values: {
        resource_type: 'custom',
        kind_custom: CRD_KIND,
        search_by: 'name',
        name: NAMED.gadget,
        output_format: 'map',
      },
    },
    {
      key: 'unserved',
      ids: ['KW-25'],
      what: 'a version the cluster does not serve',
      block: 'apply',
      records: true,
      values: {
        define_with: 'manifest',
        manifest: gadgetManifest(CRD_UNSERVED_VERSION, NAMED.unserved),
        if_exists: 'update',
        output_format: 'map',
        on_error: 'record',
      },
    },
    {
      key: 'onegadget',
      ids: ['KW-25'],
      what: 'every custom resource in the namespace',
      block: 'get',
      resultType: 'array',
      values: {
        resource_type: 'custom',
        kind_custom: CRD_KIND,
        search_by: 'list',
        output_format: 'map',
      },
    },
  ]
}

/** KW-26, KW-27: an unknown field, on the create path and on the update path. */
function strictLegs(): WriteLeg[] {
  return [
    {
      key: 'create',
      ids: ['KW-26'],
      what: 'an unknown field with If exists Fail',
      block: 'apply',
      records: true,
      values: {
        define_with: 'manifest',
        manifest: unknownFieldManifest(NAMED.strictCreate),
        if_exists: 'fail',
        output_format: 'map',
        on_error: 'record',
      },
    },
    {
      key: 'update',
      ids: ['KW-27'],
      what: 'the same field with If exists Update',
      block: 'apply',
      records: true,
      values: {
        define_with: 'manifest',
        manifest: unknownFieldManifest(NAMED.strictUpdate),
        if_exists: 'update',
        output_format: 'map',
        on_error: 'record',
      },
    },
    {
      key: 'neither',
      ids: ['KW-26', 'KW-27'],
      what: 'every ConfigMap in the namespace',
      block: 'get',
      resultType: 'array',
      values: {
        resource_type: 'default',
        kind: 'ConfigMap',
        search_by: 'list',
        output_format: 'map',
      },
    },
  ]
}

test.describe('K8s Apply: what it refuses, and where a manifest routes', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000)
    run = await seedRun(request, 'minimal')
  })

  test.afterAll(async () => {
    await run?.teardown()
  })

  test('every refusal the Block makes before it writes, and nothing on the cluster after them (KW-21, KW-22, KW-23, KW-35)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = refusedLegs()
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Apply Refusals E2E Test', bookend: REFUSED_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, REFUSED_MARKER)
    const leg = (key: string): WriteLeg => legs.find((entry) => entry.key === key) as WriteLeg

    await test.step('every leg reported its ids and the read-backs went green', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-21: a blank mode row names the row and its allowed values', () => {
      expectCaught(logs, leg('blankmode'), BLANK_JOB_FROM)
    })

    await test.step('KW-21: no Job reached the cluster', () => {
      expect(countOf(vars, 'nojob'), `a Job was created.\n${all}`).toBe(0)
      expect(namesOf(vars, 'nojob')).toEqual([])
      expectLine(logs, readLine('Job', 0, groupPath('batch/v1', run.namespace, JOBS)))
    })

    await test.step('KW-22: a blank or null apiVersion or kind gets the manifest message', () => {
      for (const key of ['blankver', 'nullver', 'blankkind', 'nullkind']) {
        expectCaught(logs, leg(key), MANIFEST_KIND_MESSAGE)
      }
    })

    await test.step('KW-35: a manifest that is only a separator is refused with the manifest message', () => {
      expectCaught(logs, leg('sepdoc'), MANIFEST_KIND_MESSAGE)
    })

    await test.step('KW-23: a non-mapping metadata gets the missing-name message, never a Python error', () => {
      for (const key of ['metastr', 'metalist', 'metanum']) {
        expectCaught(logs, leg(key), MANIFEST_NAME_MESSAGE)
      }
      expect(all, 'an internal Python error reached the console').not.toContain('AttributeError')
      expect(all, 'an internal Python error reached the console').not.toContain(
        'object has no attribute',
      )
    })

    await test.step('KW-22, KW-35: none of the refused objects was created', () => {
      const written = namesOf(vars, 'nocm')
      for (const name of [
        NAMED.blankVersion,
        NAMED.nullVersion,
        NAMED.blankKind,
        NAMED.nullKind,
      ]) {
        expect(written, `${name} was written despite the refusal.\n${all}`).not.toContain(name)
      }
      // The cluster's own root-CA publisher owns kube-root-ca.crt in every namespace.
      expect(
        written.filter((name) => name !== CLUSTER_OWNED_CONFIGMAP),
        `KW-35 names no object, so no refusal may write a ConfigMap.\n${all}`,
      ).toEqual([])
      expectLine(logs, readLine('ConfigMap', written.length, corePath(run.namespace, CONFIGMAPS)))
    })

    await test.step('KW-21, KW-22, KW-23: a refusal before the write records nothing', async () => {
      const warnings = messagesAt(await getLogEntries(page), 'WARN')
      expect(
        warnings.filter((entry) => entry.startsWith('Apply failed')),
        `a refusal raised before the write must not write a recorded WARN line.\n${all}`,
      ).toEqual([])
    })
  })

  test("the manifest's own apiVersion routes the write (KW-24, KW-25)", async ({ page }) => {
    test.setTimeout(180_000)
    const legs = routedLegs()
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Apply Version Routing E2E Test', bookend: ROUTED_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, ROUTED_MARKER)

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-24: the object is written at the version the manifest names', () => {
      expectSummary(vars, 'pinned', {
        columns: SUMMARY_COLUMNS,
        types: SUMMARY_TYPES,
        rows: [[typeName(CRD_KIND, CRD_GROUP, NAMED.gadget), 'created']],
      })
      expect(namesOf(vars, 'pinned')).toEqual([NAMED.gadget])
      expect(countOf(vars, 'pinned')).toBe(1)
      expectLine(logs, appliedLine(1))

      const applied = resultOf(vars, 'pinned')
      expect(applied.type, 'a Manifest-mode Result is one entry per document').toBe('array')
      const written = (applied.value as Array<Record<string, any>>)[0]
      expect(
        written.apiVersion,
        `the write went to the version the cluster prefers, not the one the manifest names.\n${all}`,
      ).toBe(CRD_PINNED_VERSION)
      expect(written.spec.size, 'the document reached the cluster whole').toBe('small')
    })

    await test.step('KW-24: a K8s Get finds the same object at the preferred version', () => {
      expect(countOf(vars, 'preferred'), `the object must exist.\n${all}`).toBe(1)
      const readBack = resultOf(vars, 'preferred').value as Record<string, any>
      expect(readBack.apiVersion, 'a Get with no version row resolves the preferred one').toBe(
        CRD_PREFERRED_VERSION,
      )
      expect(readBack.metadata.name).toBe(NAMED.gadget)
      expectLine(
        logs,
        readLine(
          CRD_KIND,
          1,
          `${groupPath(CRD_PREFERRED_VERSION, run.namespace, CRD_PLURAL)}/${NAMED.gadget}`,
        ),
      )
    })

    await test.step('KW-25: a version the cluster does not serve names the kind and the version', async () => {
      const message =
        `This cluster has no resource kind '${CRD_KIND}' in API version` +
        ` '${CRD_UNSERVED_VERSION}' - check the spelling, or whether the CRD is installed`
      expectRecorded(vars, 'unserved', { message, reason: 'NotFound' })
      expectEmptyWrite(vars, 'unserved', SUMMARY_COLUMNS)
      const empty = resultOf(vars, 'unserved')
      expect(empty.type, 'a Manifest-mode Result stays an array').toBe('array')
      expect(empty.value).toEqual([])

      const line = recordedLine('Apply', 'NotFound', message)
      const warnings = messagesAt(await getLogEntries(page), 'WARN')
      expect(
        warnings.filter((entry) => entry === line).length,
        `expected exactly one WARN line for the unserved version.\n${all}`,
      ).toBe(1)
    })

    await test.step('KW-25: nothing was written for the unserved document', () => {
      expect(namesOf(vars, 'onegadget'), `the refused document was written.\n${all}`).toEqual([
        NAMED.gadget,
      ])
    })
  })

  test('an unknown manifest field is refused on the create path and on the update path (KW-26, KW-27)', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const legs = strictLegs()
    const fixture = buildWriteFixture(
      legs,
      material({ name: 'K8s Apply Strict Fields E2E Test', bookend: STRICT_MARKER }),
    )
    const { logs, all, vars } = await runFixture(page, fixture, STRICT_MARKER)

    await test.step('every leg reported its ids and carried the status its case declares', async () => {
      expectMarkers(logs, legs)
      await expectLegStatuses(page, legs)
    })

    await test.step('KW-26: the create path asks the cluster to be strict, and the cluster refuses', () => {
      const head =
        `Kubernetes could not apply ConfigMap '${NAMED.strictCreate}'` +
        ` in namespace '${run.namespace}': `
      const message = errorOf(vars, 'create')
      expect(
        message.startsWith(head),
        `the create refusal must be the cluster's own row.\n${message}\n${all}`,
      ).toBeTruthy()
      expect(message, 'the cluster must name the field it refused').toContain(
        `strict decoding error: unknown field "${UNKNOWN_FIELD}"`,
      )
      expect(reasonOf(vars, 'create')).toBe('BadRequest')
      expectEmptyWrite(vars, 'create', SUMMARY_COLUMNS)
    })

    await test.step('KW-27: the update path refuses the same manifest', () => {
      const message = errorOf(vars, 'update')
      expect(
        message.startsWith('Kubernetes rejected the manifest: '),
        `the update refusal must be the typed-patch row.\n${message}\n${all}`,
      ).toBeTruthy()
      expect(message, 'the cluster must name the field it refused').toContain(UNKNOWN_FIELD)
      expectEmptyWrite(vars, 'update', SUMMARY_COLUMNS)
    })

    await test.step('KW-26, KW-27: neither object was left on the cluster', () => {
      const written = namesOf(vars, 'neither')
      for (const name of [NAMED.strictCreate, NAMED.strictUpdate]) {
        expect(written, `${name} was written despite the refusal.\n${all}`).not.toContain(name)
      }
    })
  })
})
