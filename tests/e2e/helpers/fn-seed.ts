/**
 * Function-validation seeding helpers (REQ-3.1.2.4).
 *
 * The canonical validation pipeline blocks a Test whose top-level
 * Shared instance pins a missing version / missing id, or whose nested Local
 * body has an unresolved issue. POST /tests therefore rejects those states
 * with 422, so a Test that must PERSIST in a broken state (e.g. "the library
 * version was deleted after the Test was saved") has to be raw-persisted
 * through the admin bulk endpoint, which bypasses the write-path validation.
 *
 * These helpers centralize the raw-persist + library-publish + open-in-canvas
 * patterns the Function-validation V-tests share, and the canvas node-data shapes
 * the backend expects (verified against the live validate contract).
 */

import { expect, type APIRequestContext, type Page } from './playwright-fixtures'
import { waitForCanvasLoad } from './canvas'
import { BACKEND_URL } from './config'
import { randomUUID } from 'node:crypto'

const NODE_DIMS = { width: 120, height: 62 }

/** Activate admin mode (required before the /admin/bulk/* endpoints work).
 *  Idempotent + best-effort: WAVE_ADMIN_ALLOWED=true is set for every E2E
 *  stack, so enabling is always permitted. */
export async function enableAdmin(request: APIRequestContext): Promise<void> {
  await request
    .post(`${BACKEND_URL}/admin/enable`, { data: { reason: 'function-validation E2E seed' } })
    .catch(() => {})
}

/** A standard expression-mode Log plugin node. `message` is a REQUIRED Log
 *  param, so passing an empty string stages a REQUIRED_PARAM_MISSING leaf. */
export function logNode(
  id: string,
  label: string,
  message: string,
  position = { x: 200, y: 200 },
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label,
      elementType: 'log',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      expressionFields: ['message'],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: { message, level: 'INFO' }, outputBindings: {}, profileBindings: [] },
    },
    measured: { ...NODE_DIMS },
  }
}

/** A Delay control node (duration in ms) - used to hold a run open long
 *  enough for mid-run UI assertions. */
export function delayNode(
  id: string,
  label: string,
  durationMs: number,
  position = { x: 200, y: 200 },
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label,
      elementType: 'delay',
      nodeType: 'control',
      category: 'timing',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      config: { values: { duration: durationMs }, outputBindings: {}, profileBindings: [] },
    },
    measured: { ...NODE_DIMS },
  }
}

export interface LocalFunctionBody {
  nodes: Array<Record<string, unknown>>
  edges?: Array<Record<string, unknown>>
  inputs?: Array<Record<string, unknown>>
  outputs?: Array<Record<string, unknown>>
  /** Persisted as the canvas ARRAY shape (`[{name,type,value}]`). */
  variables?: Array<Record<string, unknown>>
}

/** A Local Function node carrying an embedded `localDefinition` body. */
export function localFunctionNode(
  id: string,
  label: string,
  body: LocalFunctionBody,
  position = { x: 300, y: 200 },
): Record<string, unknown> {
  return {
    id,
    type: 'workflowNode',
    position,
    data: {
      label,
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      category: 'function',
      version: '1.0.0',
      expressionFields: [],
      templateFields: [],
      variableExpressionKeys: [],
      localDefinition: {
        workflow: { nodes: body.nodes, edges: body.edges ?? [] },
        inputs: body.inputs ?? [],
        outputs: body.outputs ?? [],
        variables: body.variables ?? [],
        name: label,
      },
    },
    measured: { ...NODE_DIMS },
  }
}

/** A Function Block's input fields in the stored shape every Block uses (REQ-3.1.2.1). */
export interface FunctionBlockFields {
  /** Field values by input name, stored in `config.values`. */
  values?: Record<string, unknown>
  /** Inputs whose value is an expression. */
  expressionFields?: string[]
}

/** Inputs bound to expressions: each value is the expression text. */
export function expressionInputs(bindings: Record<string, string>): FunctionBlockFields {
  return { values: { ...bindings }, expressionFields: Object.keys(bindings) }
}

/** Give a seeded Function Block node its input fields, replacing any it held. */
export function setFunctionFields<T>(node: T, fields: FunctionBlockFields): T {
  const data = (node as { data: Record<string, unknown> }).data
  const config = (data.config ?? { outputBindings: {}, profileBindings: [] }) as Record<string, unknown>
  data.config = { ...config, values: { ...(fields.values ?? {}) } }
  data.expressionFields = [...(fields.expressionFields ?? [])]
  return node
}

export interface SharedNodeOptions extends FunctionBlockFields {
  functionId: string
  functionVersion: string
  label?: string
  originalLibraryName?: string
  disabled?: boolean
  position?: { x: number; y: number }
}

/** A Shared (Published) Function reference node. */
export function sharedNode(id: string, opts: SharedNodeOptions): Record<string, unknown> {
  const label = opts.label ?? 'Shared'
  const data: Record<string, unknown> = {
    label,
    elementType: 'function',
    nodeType: 'function',
    functionLifecycle: 'shared',
    functionId: opts.functionId,
    functionVersion: opts.functionVersion,
    originalLibraryName: opts.originalLibraryName ?? label,
    category: 'function',
    version: '1.0.0',
    hasNewerVersion: false,
    expressionFields: [...(opts.expressionFields ?? [])],
    templateFields: [],
    variableExpressionKeys: [],
    config: { values: { ...(opts.values ?? {}) }, outputBindings: {}, profileBindings: [] },
  }
  if (opts.disabled) data.disabled = true
  return {
    id,
    type: 'workflowNode',
    position: opts.position ?? { x: 300, y: 200 },
    data,
    measured: { ...NODE_DIMS },
  }
}

/** An edge from the implicit start node to `target`. */
export function startEdge(target: string): Record<string, unknown> {
  return { id: `e-start-${target}`, source: 'start-node', target }
}

export interface EditModeSharedNodeOptions extends SharedNodeOptions {
  /** Draft body the in-Test edit session carries (defaults to an empty workflow). */
  draftWorkflow?: Record<string, unknown>
  draftInputs?: Array<Record<string, unknown>>
  draftOutputs?: Array<Record<string, unknown>>
}

/** A Shared Function reference pre-seeded in EDIT MODE (editMode marker,
 *  upstreamLink, and a draft snapshotted from the pinned source version). */
export function editModeSharedNode(
  id: string,
  opts: EditModeSharedNodeOptions,
): Record<string, unknown> {
  const node = sharedNode(id, opts) as { data: Record<string, unknown> }
  node.data.editMode = true
  node.data.upstreamLink = { functionId: opts.functionId, sourceVersion: opts.functionVersion }
  node.data.draft = {
    name: (opts.label ?? 'Shared') as string,
    description: '',
    tags: [],
    inputs: opts.draftInputs ?? [],
    outputs: opts.draftOutputs ?? [],
    dependencies: { functions: [], plugins: [] },
    workflow: opts.draftWorkflow ?? { nodes: [], edges: [] },
  }
  return node as unknown as Record<string, unknown>
}

export interface SeededLibraryFunction {
  functionId: string
  name: string
  version: string
}

/** Publish a Function to the library via POST /functions and return its id. */
export async function publishLibraryFunction(
  request: APIRequestContext,
  opts: {
    name?: string
    description?: string
    tags?: string[]
    inputs?: Array<Record<string, unknown>>
    outputs?: Array<Record<string, unknown>>
    /** The Function's own local variables, in the stored list shape (`[{name, type, value}]`). */
    variables?: Array<Record<string, unknown>>
    version?: string
    workflow?: Record<string, unknown>
    changelog?: string
    details?: string
  } = {},
): Promise<SeededLibraryFunction> {
  const name = opts.name ?? `Fn ${randomUUID().slice(0, 8)}`
  const version = opts.version ?? '1.0.0'
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: opts.description ?? 'functional E2E library entry',
      tags: opts.tags ?? [],
      inputs: opts.inputs ?? [],
      outputs: opts.outputs ?? [],
      ...(opts.variables ? { variables: opts.variables } : {}),
      dependencies: { functions: [], plugins: [] },
      workflow: opts.workflow ?? { nodes: [], edges: [] },
      version,
      changelog: opts.changelog ?? 'Initial release',
      details: opts.details ?? '',
    },
  })
  const body = await resp.json().catch(() => null)
  expect(resp.ok(), `POST /functions failed: ${resp.status()} ${JSON.stringify(body)}`).toBeTruthy()
  return { functionId: body.data.id, name, version }
}

export interface AddVersionOptions {
  sourceVersion: string
  targetVersion: string
  inputs?: Array<Record<string, unknown>>
  outputs?: Array<Record<string, unknown>>
  workflow?: Record<string, unknown>
  changelog?: string
  description?: string
  tags?: string[]
  details?: string
  /** When true, return the HTTP status instead of asserting success (to prove a target is rejected). */
  expectReject?: boolean
}

/** Add an immutable library version through the test-independent publish route
 *  (POST /functions/{id}/versions). Returns the HTTP status. Asserts success
 *  unless `expectReject` is set (so a backport / duplicate can be proven rejected). */
export async function addLibraryVersion(
  request: APIRequestContext,
  fn: SeededLibraryFunction,
  opts: AddVersionOptions,
): Promise<number> {
  const resp = await request.post(`${BACKEND_URL}/functions/${fn.functionId}/versions`, {
    data: {
      source_version: opts.sourceVersion,
      target_version: opts.targetVersion,
      draft_definition: {
        name: fn.name,
        description: opts.description ?? '',
        tags: opts.tags ?? [],
        inputs: opts.inputs ?? [],
        outputs: opts.outputs ?? [],
        dependencies: { functions: [], plugins: [] },
        workflow: opts.workflow ?? { nodes: [], edges: [] },
      },
      changelog: opts.changelog ?? `Bump to ${opts.targetVersion}`,
      description: opts.description ?? '',
      tags: opts.tags ?? [],
      details: opts.details ?? '',
    },
  })
  if (!opts.expectReject) {
    expect(
      resp.ok(),
      `POST /functions/${fn.functionId}/versions ${opts.targetVersion}: ${resp.status()} ${await resp.text()}`,
    ).toBeTruthy()
  }
  return resp.status()
}

export interface RawTestSpec {
  nodes: Array<Record<string, unknown>>
  edges?: Array<Record<string, unknown>>
  variables?: Record<string, unknown>
  name?: string
  id?: string
}

/**
 * Persist a Test directly through the admin bulk endpoint, BYPASSING the
 * write-path validation. Use this to stage an intentionally-broken Test
 * (missing version, missing id, unresolved nested body) that POST /tests
 * would reject with 422. Returns the test id.
 */
export async function rawPersistTest(
  request: APIRequestContext,
  spec: RawTestSpec,
): Promise<string> {
  await enableAdmin(request)
  const id = spec.id ?? randomUUID()
  const entity = {
    id,
    name: spec.name ?? `Raw ${Date.now()}-${randomUUID().slice(0, 6)}`,
    version: '1.0.0',
    workflow: { nodes: spec.nodes, edges: spec.edges ?? [] },
    variables: spec.variables ?? {},
    metadata: {},
  }
  const resp = await request.post(`${BACKEND_URL}/admin/bulk/tests`, {
    data: { operations: [{ op: 'add', entity }] },
  })
  expect(
    resp.ok(),
    `POST /admin/bulk/tests failed: ${resp.status()} ${await resp.text()}`,
  ).toBeTruthy()
  return id
}

/** Create a valid Test via POST /tests (the normal write path). Asserts the
 *  create succeeds; use for clean baselines (not broken states). */
export async function createValidTest(
  request: APIRequestContext,
  spec: RawTestSpec,
): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: spec.name ?? `Valid ${Date.now()}-${randomUUID().slice(0, 6)}`,
      version: '1.0.0',
      description: 'functional E2E valid baseline',
      workflow: { nodes: spec.nodes, edges: spec.edges ?? [] },
      variables: spec.variables ?? {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

const OWNERSHIP_RESET_ID = 'e2e-open-test-reset'

/** Force the single global workbench slot free (force take-over, then release). */
export async function releaseWorkbenchOwnership(
  request: APIRequestContext,
): Promise<void> {
  await request
    .post(`${BACKEND_URL}/workbench/ownership/takeover/force`, {
      data: { requester_id: OWNERSHIP_RESET_ID, requester_label: 'E2E Open Test' },
    })
    .catch(() => undefined)
  await request
    .post(`${BACKEND_URL}/workbench/ownership/release`, {
      data: { holder_id: OWNERSHIP_RESET_ID },
    })
    .catch(() => undefined)
}

/** Open a Test in the workbench canvas (clears any stale session + localStorage
 *  first, mirroring the established open pattern across the function specs).
 *
 *  The workbench editing slot is one GLOBAL server slot. Opening a Test means
 *  working on it, so the slot is freed first: a leftover holder would make this
 *  tab a read-only watcher, and a watcher is never promoted - it would stay
 *  read-only for the rest of the test. */
export async function openTest(page: Page, testId: string): Promise<void> {
  await releaseWorkbenchOwnership(page.request)
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

/** Open a published Function in the read-only library View canvas.
 *  Clears any stale session + leftover draft first, then boots
 *  `/workbench?viewFunction={id}&version={v}` and waits for the drilled
 *  read-only chrome (Edit Function) so callers start from a settled View. */
export async function openFunctionView(
  page: Page,
  functionId: string,
  version: string,
): Promise<void> {
  const url = `/workbench?viewFunction=${functionId}&version=${version}`
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(url)
  await page.evaluate(() => localStorage.clear())
  await page.goto(url)
  await expect(
    page.locator('[data-testid="action-bar-edit-function-button"]'),
    'read-only View chrome did not boot',
  ).toBeVisible({ timeout: 20_000 })
}

export interface ValidateResult {
  status: number
  errors: Array<Record<string, unknown>>
  warnings: Array<Record<string, unknown>>
  errorCode?: string
}

/** Call POST /tests/{id}/validate and normalize the two response envelopes:
 *  200 -> {data:{errors,warnings}}; 422 -> {error:{code, details:[{errors,warnings}]}}. */
export async function validateTest(
  request: APIRequestContext,
  testId: string,
  context: 'load' | 'run' | 'import' = 'load',
): Promise<ValidateResult> {
  const resp = await request.post(`${BACKEND_URL}/tests/${testId}/validate?context=${context}`)
  const body = (await resp.json().catch(() => ({}))) as Record<string, any>
  if (resp.status() === 200) {
    const d = body.data ?? {}
    return { status: 200, errors: d.errors ?? [], warnings: d.warnings ?? [] }
  }
  const detail = (body.error?.details ?? [{}])[0] ?? {}
  return {
    status: resp.status(),
    errors: detail.errors ?? [],
    warnings: detail.warnings ?? [],
    errorCode: body.error?.code,
  }
}

/** The `code` of every entry in a findings list. */
export function codesOf(entries: Array<Record<string, unknown>>): string[] {
  return entries.map((e) => String(e.code))
}

/** Attempt to create a Test via the normal write path and return the HTTP
 *  status WITHOUT asserting. Use to prove Save is blocked (422) for a state
 *  the validation pipeline rejects. */
export async function postTestStatus(
  request: APIRequestContext,
  spec: RawTestSpec,
): Promise<number> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: spec.name ?? `Save-probe ${Date.now()}-${randomUUID().slice(0, 6)}`,
      version: '1.0.0',
      description: 'save-blocked probe',
      workflow: { nodes: spec.nodes, edges: spec.edges ?? [] },
      variables: spec.variables ?? {},
      metadata: {},
    },
  })
  return resp.status()
}

/** Validation-dialog selectors (the unified ValidationErrorDialog surface). */
export const VALIDATION = {
  dialog: '[data-testid="validation-error-dialog"]',
  list: '[data-testid="validation-error-list"]',
  count: '[data-testid="validation-error-count"]',
  closeBtn: '[data-testid="validation-close-btn"]',
  fixAllBtn: '[data-testid="validation-fix-all-btn"]',
} as const

/** Close the load-time "Test Issues Found" dialog if it surfaced (a Test with
 *  content-only issues raises it on open; dismissing keeps the canvas loaded).
 *  Tolerant of the async appearance: waits briefly for the dialog before
 *  deciding it is absent, so callers can invoke it right after a load. */
export async function dismissLoadDialogIfPresent(page: Page): Promise<void> {
  const dialog = page.locator(VALIDATION.dialog)
  await dialog.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {})
  if (await dialog.isVisible().catch(() => false)) {
    await page.locator(VALIDATION.closeBtn).click()
    await expect(dialog).toBeHidden({ timeout: 5_000 })
  }
}

/** The declarations of a saved Local Function, read from the stored Test. */
export interface StoredLocalDefinition {
  inputs: Array<Record<string, unknown>>
  outputs: Array<Record<string, unknown>>
  variables: Array<Record<string, unknown>>
}

/** Read a Local Function's inputs, outputs and locals from the stored Test (GET /tests/{id}). */
export async function storedLocalDefinition(
  request: APIRequestContext,
  testId: string,
  nodeId: string,
): Promise<StoredLocalDefinition> {
  const resp = await request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId} failed: ${resp.status()}`).toBeTruthy()
  const nodes = ((await resp.json()).data?.workflow?.nodes ?? []) as Array<Record<string, any>>
  const node = nodes.find((n) => n.id === nodeId)
  expect(node, `block ${nodeId} is in the stored Test`).toBeTruthy()
  const definition = (node?.data?.localDefinition ?? {}) as Record<string, unknown>
  return {
    inputs: (definition.inputs ?? []) as Array<Record<string, unknown>>,
    outputs: (definition.outputs ?? []) as Array<Record<string, unknown>>,
    variables: (definition.variables ?? []) as Array<Record<string, unknown>>,
  }
}
