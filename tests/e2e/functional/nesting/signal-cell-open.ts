/** Opens a nesting cell whose graph the design may refuse, or whose built graph needs a rewrite before import. */

import { test, expect, type APIRequestContext, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { BACKEND_URL, ensureEnvironment } from '../../helpers/config'
import { injectServiceHost } from '../../helpers/fixture-import'
import { openTest, validateTest } from '../../helpers/fn-seed'
import type { WorkflowEdge, WorkflowNode } from '../../helpers/k8s-nodes'
import {
  buildNestingGraph,
  TOKEN_PLACEHOLDER,
  type NestingGraph,
  type NestingGraphSpec,
  type PublishedFunctions,
} from '../../helpers/nesting-graph'
import { deleteTest } from '../file-picker/picker'
import { newToken, withToken } from '../shell-blocks/shell-helpers'
import { closeApiSockets } from './api-run'
import { cellSurface, type NestCell } from './nesting-harness'

type Created = { token: string; testId?: string; functionIds: string[] }

// Keyed on Playwright's per-test id, so a worker restart never mixes two tests' entities.
const created = new Map<string, Created>()

type Workflow = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }

export type SignalCellOptions = {
  /** Fail the cell on a refused publish, import or validation; otherwise report the refusal and open nothing. */
  requireValid: boolean
  /** Applied to the built graph before anything is published or imported. */
  rewrite?: (graph: NestingGraph) => NestingGraph
}

export type OpenedSignalCell =
  | { refusal: null; cell: NestCell }
  | { refusal: string; cell: null }

/** Per-test teardown for an afterEach hook, for cells opened here: the Test, then every Function, outermost first. */
export async function deleteSignalCellEntities(request: APIRequestContext, testInfo: TestInfo): Promise<void> {
  closeApiSockets()
  const entry = created.get(testInfo.testId)
  created.delete(testInfo.testId)
  if (!entry) return
  await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
  if (entry.testId) await deleteTest(request, entry.testId)
  for (const functionId of [...entry.functionIds].reverse()) {
    const response = await request.delete(`${BACKEND_URL}/functions/${functionId}?cascade=true`)
    expect(
      response.ok(),
      `teardown (${entry.token}) DELETE /functions/${functionId}?cascade=true answered ${response.status()}`,
    ).toBeTruthy()
  }
}

/** Drop every edge leaving `sources`, then every node that loses its last incoming edge by that. */
export function withoutEdgesFrom(workflow: Workflow, sources: readonly string[]): Workflow {
  const keep = new Set(sources)
  let edges = workflow.edges
  let nodes = workflow.nodes
  let cut = new Set(sources)
  while (cut.size > 0) {
    const removed = edges.filter((e) => cut.has(e.source))
    edges = edges.filter((e) => !cut.has(e.source))
    const orphans = new Set<string>()
    for (const e of removed) {
      if (!keep.has(e.target) && !edges.some((other) => other.target === e.target)) orphans.add(e.target)
    }
    nodes = nodes.filter((n) => !orphans.has(n.id))
    cut = orphans
  }
  return { nodes, edges }
}

/** The same graph with `withoutEdgesFrom(sources)` applied to the Test and to every Function body. */
export function graphWithoutEdgesFrom(graph: NestingGraph, sources: readonly string[]): NestingGraph {
  const rewriteDoc = <T extends { workflow: unknown }>(doc: T): T => ({
    ...doc,
    workflow: withoutEdgesFrom(doc.workflow as Workflow, sources),
  })
  const fixture = (published: PublishedFunctions) =>
    rewriteDoc(graph.fixture(published) as Record<string, unknown> & { workflow: unknown })
  const stub: PublishedFunctions = Object.fromEntries(
    graph.functions.map((fn) => [fn.key, { functionId: 'unpublished', name: fn.name, version: '1.0.0' }]),
  )
  const remaining = new Set((fixture(stub).workflow as Workflow).nodes.map((n) => n.id))
  return {
    ...graph,
    functions: graph.functions.map((plan) => ({ ...plan, build: (published) => rewriteDoc(plan.build(published)) })),
    fixture,
    testNodeIds: graph.testNodeIds.filter((id) => remaining.has(id)),
  }
}

function problemsOf(cellId: string, stage: string, problems: string[], requireValid: boolean): string | null {
  if (problems.length === 0) return null
  if (requireValid) expect(problems, `${cellId}: ${stage}`).toEqual([])
  return `${stage}: ${problems.join('; ')}`
}

/** Record a refused shape on the report; the cell asserts nothing further. */
export async function recordRefusal(cellId: string, refusal: string): Promise<void> {
  test.info().annotations.push({ type: 'refused', description: `${cellId} ${refusal}` })
  await test.info().attach(`${cellId}-refusal.txt`, { body: refusal, contentType: 'text/plain' })
}

/** Publish the Functions, import the Test and check import and run validation, then open it. */
export async function openSignalCell(
  page: Page,
  cellId: string,
  spec: Omit<NestingGraphSpec, 'name'>,
  opts: SignalCellOptions,
): Promise<OpenedSignalCell> {
  const token = newToken()
  const entry: Created = { token, functionIds: [] }
  created.set(test.info().testId, entry)
  const built = buildNestingGraph({ ...spec, name: `${cellId} ${TOKEN_PLACEHOLDER}` })
  const graph = opts.rewrite ? opts.rewrite(built) : built
  await ensureEnvironment(page.request)
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)

  const functions: PublishedFunctions = {}
  for (const plan of graph.functions) {
    const payload = withToken(plan.build(functions), token)
    const response = await page.request.post(`${BACKEND_URL}/functions`, {
      data: {
        ...payload,
        tags: [],
        dependencies: { functions: [], plugins: [] },
        version: '1.0.0',
        changelog: 'Initial release',
        details: '',
      },
    })
    const body = (await response.json().catch(() => null)) as { data?: { id?: string } } | null
    const id = body?.data?.id
    const refused = response.ok() && id ? [] : [`${plan.key} answered ${response.status()} ${JSON.stringify(body)}`]
    const refusal = problemsOf(cellId, 'POST /functions is accepted', refused, opts.requireValid)
    if (refusal !== null || !id) return { refusal: refusal ?? 'POST /functions returned no id', cell: null }
    entry.functionIds.push(id)
    functions[plan.key] = { functionId: id, name: payload.name, version: '1.0.0' }
  }

  let document = withToken(graph.fixture(functions), token)
  if (graph.sshOpenIds.length > 0) document = injectServiceHost(document)
  const createResponse = await page.request.post(`${BACKEND_URL}/tests`, {
    data: { ...document, name: `${String(document.name)} ${Date.now()}` },
  })
  const createdBody = (await createResponse.json().catch(() => null)) as
    | { data?: { id?: string }; id?: string; repairs?: unknown[] }
    | null
  const testId = createdBody?.data?.id ?? createdBody?.id
  const repaired = (createdBody?.repairs ?? []).map((r) => `repaired at save: ${JSON.stringify(r)}`)
  const importRefused = createResponse.ok() && testId ? repaired : [`${createResponse.status()} ${JSON.stringify(createdBody)}`]
  const importRefusal = problemsOf(cellId, 'POST /tests is accepted', importRefused, opts.requireValid)
  if (importRefusal !== null || !testId) return { refusal: importRefusal ?? 'POST /tests returned no id', cell: null }
  entry.testId = testId

  for (const context of ['import', 'run'] as const) {
    const result = await validateTest(page.request, testId, context)
    const found = result.errors.map((e) => JSON.stringify(e))
    if (result.status !== 200 && found.length === 0) found.push(`status ${result.status} ${result.errorCode ?? ''}`)
    const refusal = problemsOf(cellId, `${context}-context validation reports no errors`, found, opts.requireValid)
    if (refusal !== null) return { refusal, cell: null }
  }

  const surface = cellSurface(cellId)
  if (surface === 'canvas') await openTest(page, testId)
  return { refusal: null, cell: { cellId, token, graph, testId, functions, surface } }
}
