/**
 * V-FN-COMPOSITION-GUARDS (functional): the two composition guards hold, and do NOT
 * over-reach.
 *
 * REQ: REQ-3.1.2.4 (Function validation before save).
 *
 *   EDIT_MODE_DRAFT_IN_BODY - a Function body holding a nested Shared
 *        instance still in edit mode is blocked on persisting contexts
 *        (save/import/publish); a TOP-LEVEL edit-mode instance (the normal
 *        edit flow) and a clean nested instance are NOT. The RUN context is
 *        exempt: the run gate executes nested drafts (REQ-5.2.1.24).
 *   Circular Function reference - publishing a version whose body calls
 *        its own Function, directly or through another Function, is refused
 *        with 422 and `Circular Function reference: <name> -> ... -> <name>`
 *        (the Function names, the text the Function import gives a circle),
 *        and the version is not stored; an acyclic chain publishes, and a Test
 *        that uses it validates without SELF_REFERENTIAL_FUNCTION. Through the
 *        UI, publishing an edit-mode draft that closes a circle shows the same
 *        text on the publish dialog.
 *
 * Nested-edit-mode shapes bypass save-validation by raw-persisting the Test
 * through the admin bulk endpoint (the import / hand-edited-file path), then
 * asserting via POST /tests/{id}/validate. POST /functions/{id}/versions runs
 * the circular check on the body and answers 422, so a self-referential body
 * is refused at publish and never stored.
 *
 * Phase: functional-workflow. Self-seeds via POST /functions, the add-version
 * route, POST /tests and the admin bulk test endpoint.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import {
  createValidTest,
  publishLibraryFunction,
  rawPersistTest,
  validateTest,
  codesOf,
  localFunctionNode,
  logNode,
  openTest,
  sharedNode,
  startEdge,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import { digIn, dropLibraryFunctionBelow, editModeOverlay } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

/** A nested Shared instance carrying edit-mode markers (the EDIT_MODE_DRAFT_IN_BODY trigger). */
function editModeSharedNode(
  id: string,
  functionId: string,
  label: string,
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label,
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId,
      functionVersion: '1.0.0',
      editMode: true,
      upstreamLink: { functionId, sourceVersion: '1.0.0' },
      draft: {
        name: label,
        description: '',
        tags: [],
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
      },
      config: { values: {}, outputBindings: {}, profileBindings: [] },
    },
  }
}

const RUN = randomUUID().slice(0, 8)
const FN_NODE_ID = 'fn-circle-instance'
const REFERENCING_VERSION = '1.1.0'

interface PublishAnswer {
  status: number
  errorMessage: string | undefined
  text: string
}

/** Publish version 1.1.0 of `fn` with a body that calls `bodyFunctionId`; the answer is not asserted. */
async function publishReferencingVersion(
  request: APIRequestContext,
  fn: SeededLibraryFunction,
  bodyFunctionId: string,
  bodyLabel: string,
): Promise<PublishAnswer> {
  const resp = await request.post(`${BACKEND_URL}/functions/${fn.functionId}/versions`, {
    data: {
      source_version: fn.version,
      target_version: REFERENCING_VERSION,
      draft_definition: {
        name: fn.name,
        description: '',
        tags: [],
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: {
          nodes: [sharedNode('cycle-inner', { functionId: bodyFunctionId, functionVersion: '1.0.0', label: bodyLabel })],
          edges: [startEdge('cycle-inner')],
        },
      },
      changelog: 'compose cycle (test seed)',
      description: '',
      tags: [],
      details: '',
    },
  })
  const text = await resp.text()
  const body = (await resp.json().catch(() => null)) as { error?: { message?: string } } | null
  return { status: resp.status(), errorMessage: body?.error?.message, text }
}

/** Publish that version and assert it was accepted; returns the new version string. */
async function addReferencingVersion(
  request: APIRequestContext,
  fn: SeededLibraryFunction,
  bodyFunctionId: string,
  bodyLabel: string,
): Promise<string> {
  const answer = await publishReferencingVersion(request, fn, bodyFunctionId, bodyLabel)
  expect(answer.status, `add-version: ${answer.status} ${answer.text}`).toBe(201)
  return REFERENCING_VERSION
}

/** The versions the library holds of `fn`, and which one is the latest. */
async function storedVersions(
  request: APIRequestContext,
  fn: SeededLibraryFunction,
): Promise<{ latest: string; versions: string[] }> {
  const resp = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)
  expect(resp.ok(), `GET versions of ${fn.name}: ${resp.status()}`).toBeTruthy()
  const data = (await resp.json()).data as { latest: string; versions: Array<{ version: string }> }
  return { latest: data.latest, versions: data.versions.map((entry) => entry.version) }
}

/** What the Function import's validate step answers for one Function document. */
async function importFindings(
  request: APIRequestContext,
  doc: Record<string, unknown>,
): Promise<{ status: string; messages: string[] }> {
  const resp = await request.post(`${BACKEND_URL}/functions/import/validate`, {
    multipart: {
      file: { name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) },
    },
  })
  expect(resp.ok(), `import validate: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  const item = (await resp.json()).data.items[0] as {
    status: string
    fatal_errors: Array<{ message: string }>
  }
  return { status: item.status, messages: item.fatal_errors.map((entry) => entry.message) }
}

/** Delete every library Function this run published and check that none is left. */
async function deleteRunFunctions(request: APIRequestContext): Promise<void> {
  const listed = await request.get(`${BACKEND_URL}/functions?search=${RUN}&per_page=100`)
  expect(listed.ok(), `cleanup list failed: ${listed.status()}`).toBeTruthy()
  const left = (await listed.json()).data as Array<{ id: string; name: string }>
  for (const fn of left) {
    const deleted = await request.delete(`${BACKEND_URL}/functions/${fn.id}?cascade=true`)
    expect(deleted.ok(), `cleanup delete of ${fn.name} failed: ${deleted.status()}`).toBeTruthy()
  }
  const after = await request.get(`${BACKEND_URL}/functions?search=${RUN}&per_page=100`)
  expect((await after.json()).pagination.total, 'Functions left behind').toBe(0)
}

test.describe('V-FN-COMPOSITION-GUARDS (functional): EDIT_MODE_DRAFT_IN_BODY', () => {
  // The e2e reset never empties the Function library; a Function with a caller needs cascade.
  test.afterAll(async ({ request }) => {
    await deleteRunFunctions(request)
  })

  test('a nested edit-mode draft blocks the enclosing Function; top-level + clean do NOT', async ({
    request,
  }) => {
    // Freezing a body whose nested Shared is still an
    // edit-mode draft would capture work-in-progress in an immutable version.
    const lib = await publishLibraryFunction(request, { name: `inner ${RUN} ${randomUUID().slice(0, 4)}` })

    // (a) nested edit-mode draft -> EDIT_MODE_DRAFT_IN_BODY on a persisting
    // context (import stands in for the save/publish class here).
    const outer = localFunctionNode('outer-1', 'Outer_Fn', {
      nodes: [editModeSharedNode('inner-1', lib.functionId, 'Inner')],
      edges: [{ id: 'e-start-inner', source: 'start-node', target: 'inner-1' }],
    })
    const nestedId = await rawPersistTest(request, { nodes: [outer], edges: [startEdge('outer-1')] })
    const nested = await validateTest(request, nestedId, 'import')
    expect(codesOf(nested.errors), codesOf(nested.errors).join(',')).toContain(
      'EDIT_MODE_DRAFT_IN_BODY',
    )
    const flagged = nested.errors.find((e) => e.code === 'EDIT_MODE_DRAFT_IN_BODY')
    expect(Array.isArray(flagged?.function_path)).toBe(true)
    expect(flagged?.node_id === 'inner-1' || flagged?.node_label === 'Inner').toBe(true)

    // REQ-5.2.1.24: the
    // SAME nested draft is admitted by the run context - the guard fires only
    // on persisting paths.
    const nestedRun = await validateTest(request, nestedId, 'run')
    expect(codesOf(nestedRun.errors)).not.toContain('EDIT_MODE_DRAFT_IN_BODY')

    // (b) a TOP-LEVEL edit-mode instance is the normal edit flow -> NOT flagged.
    const topId = await rawPersistTest(request, {
      nodes: [editModeSharedNode('top-1', lib.functionId, 'TopLevel')],
      edges: [startEdge('top-1')],
    })
    const top = await validateTest(request, topId, 'import')
    expect(codesOf(top.errors)).not.toContain('EDIT_MODE_DRAFT_IN_BODY')

    // (c) a clean nested instance (no edit mode) -> NOT flagged.
    const cleanOuter = localFunctionNode('outer-2', 'Clean_Outer', {
      nodes: [sharedNode('clean-inner', { functionId: lib.functionId, functionVersion: '1.0.0', label: 'Inner' })],
      edges: [{ id: 'e-start-clean', source: 'start-node', target: 'clean-inner' }],
    })
    const cleanId = await rawPersistTest(request, { nodes: [cleanOuter], edges: [startEdge('outer-2')] })
    const clean = await validateTest(request, cleanId, 'import')
    expect(codesOf(clean.errors)).not.toContain('EDIT_MODE_DRAFT_IN_BODY')
  })
})

test.describe('V-FN-COMPOSITION-GUARDS (functional): a circular Function reference is refused at publish (REQ-3.1.2.4)', () => {
  // The e2e reset never empties the Function library; a Function with a caller needs cascade.
  test.afterAll(async ({ request }) => {
    await deleteRunFunctions(request)
  })

  test('a direct self-reference is refused at publish; acyclic is NOT', async ({ request }) => {
    const f = await publishLibraryFunction(request, { name: `selfie ${RUN} ${randomUUID().slice(0, 4)}` })

    const refused = await publishReferencingVersion(request, f, f.functionId, f.name)
    expect(refused.status, refused.text).toBe(422)
    expect(refused.errorMessage).toBe(
      `Circular Function reference: ${f.name} -> ${f.name}`,
    )
    expect(await storedVersions(request, f), 'the refused version is not stored').toEqual({
      latest: '1.0.0',
      versions: ['1.0.0'],
    })

    // Acyclic parent -> leaf chain publishes and is NOT flagged.
    const leaf = await publishLibraryFunction(request, { name: `leaf ${RUN} ${randomUUID().slice(0, 4)}` })
    const parent = await publishLibraryFunction(request, { name: `parent ${RUN} ${randomUUID().slice(0, 4)}` })
    const parentLatest = await addReferencingVersion(request, parent, leaf.functionId, leaf.name)
    expect((await storedVersions(request, parent)).latest).toBe(parentLatest)
    const acyclicId = await rawPersistTest(request, {
      nodes: [sharedNode('top-1', { functionId: parent.functionId, functionVersion: parentLatest, label: parent.name })],
      edges: [startEdge('top-1')],
    })
    const acyclic = await validateTest(request, acyclicId, 'run')
    expect(codesOf(acyclic.errors)).not.toContain('SELF_REFERENTIAL_FUNCTION')
  })

  test('a transitive cycle F -> G -> F is refused at publish', async ({ request }) => {
    const f = await publishLibraryFunction(request, { name: `fn_f ${RUN} ${randomUUID().slice(0, 4)}` })
    const g = await publishLibraryFunction(request, { name: `fn_g ${RUN} ${randomUUID().slice(0, 4)}` })
    const fLatest = await addReferencingVersion(request, f, g.functionId, g.name)
    expect((await storedVersions(request, f)).latest).toBe(fLatest)

    // The path starts and ends at the Function being published.
    const refused = await publishReferencingVersion(request, g, f.functionId, f.name)
    expect(refused.status, refused.text).toBe(422)
    expect(refused.errorMessage).toBe(
      `Circular Function reference: ${g.name} -> ${f.name} -> ${g.name}`,
    )
    expect(await storedVersions(request, g), 'the refused version is not stored').toEqual({
      latest: '1.0.0',
      versions: ['1.0.0'],
    })
  })

  test('publishing an edit-mode draft that closes a circle is refused with the Function names, the text import gives', async ({
    page,
    request,
  }) => {
    // F's body is a Log; G's body calls F; the draft of F then calls G.
    const f = await publishLibraryFunction(request, {
      name: `circ_f ${RUN} ${randomUUID().slice(0, 4)}`,
      workflow: { nodes: [logNode('f-log', 'Log', "'f'")], edges: [startEdge('f-log')] },
    })
    const g = await publishLibraryFunction(request, {
      name: `circ_g ${RUN} ${randomUUID().slice(0, 4)}`,
      workflow: {
        nodes: [sharedNode('g-calls-f', { functionId: f.functionId, functionVersion: '1.0.0', label: f.name })],
        edges: [startEdge('g-calls-f')],
      },
    })
    const circle = `Circular Function reference: ${f.name} -> ${g.name} -> ${f.name}`
    const testId = await createValidTest(request, {
      name: `zz-fn-circle-publish-${randomUUID().slice(0, 8)}`,
      nodes: [sharedNode(FN_NODE_ID, { functionId: f.functionId, functionVersion: '1.0.0', label: f.name })],
      edges: [startEdge(FN_NODE_ID)],
    })
    const validation = await validateTest(request, testId, 'run')
    expect(validation.errors, JSON.stringify(validation.errors)).toHaveLength(0)

    await test.step('the edit-mode draft of F gets a Block that calls G', async () => {
      await openTest(page, testId)
      await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
      await expect(editModeOverlay(page, FN_NODE_ID)).toBeVisible({ timeout: 10_000 })
      await digIn(page, FN_NODE_ID)
      await expect(page.getByTestId('workflow-node-f-log')).toBeVisible()
      const callG = await dropLibraryFunctionBelow(
        page,
        g.name,
        page.locator('[data-testid="workflow-node-f-log"] [data-testid="handle-output"]'),
      )
      await expect(page.getByTestId(`rf__edge-edge-f-log-${callG}`), 'the G Block follows the Log').toHaveCount(1)
      await page.getByTestId('breadcrumb-back-arrow').click()
      await expect(page.getByTestId(`workflow-node-${FN_NODE_ID}`)).toBeVisible()
    })

    await test.step('Publish is refused on the publish dialog with the circle named by name', async () => {
      await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
      const editDialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
      await expect(editDialog).toBeVisible({ timeout: 10_000 })
      await editDialog.getByTestId('publish-edit-mode-details-input').fill('Calls G')
      await editDialog.getByTestId('publish-edit-mode-changelog-input').fill('Calls G')
      const publish = editDialog.getByRole('button', { name: 'Publish', exact: true })
      await expect(publish).not.toHaveAttribute('aria-disabled', 'true')
      await publish.click()
      const outcome = page.getByRole('alertdialog').filter({ hasText: 'Publish a new version?' })
      await expect(outcome).toBeVisible({ timeout: 10_000 })
      const refused = page.waitForResponse(
        (resp) => resp.request().method() === 'POST' && resp.url().endsWith(`/functions/${f.functionId}/versions`),
      )
      await outcome.getByRole('button', { name: 'Publish and set New', exact: true }).click()
      expect((await refused).status()).toBe(422)
      await expect(outcome.getByTestId('publish-outcome-error')).toHaveText(circle)
      expect(await storedVersions(request, f), 'the refused version is not stored').toEqual({
        latest: '1.0.0',
        versions: ['1.0.0'],
      })
    })

    await test.step('the Function import names the same circle with the same text', async () => {
      const findings = await importFindings(request, {
        id: f.functionId,
        name: f.name,
        description: '',
        tags: [],
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: {
          nodes: [sharedNode('f-calls-g', { functionId: g.functionId, functionVersion: '1.0.0', label: g.name })],
          edges: [startEdge('f-calls-g')],
        },
        version: REFERENCING_VERSION,
      })
      expect(findings).toEqual({ status: 'fatal', messages: [circle] })
    })
    await request.delete(`${BACKEND_URL}/tests/${testId}`)
  })
})
