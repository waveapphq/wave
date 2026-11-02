/**
 * Shared seed for the Python block visual specs: one Test holding a Python
 * block in Source mode with the approved script, its two typed Input Variables
 * and its two Variable Exports, plus the two ways in (canvas, script sheet).
 *
 * Imported by V-PLUGIN-PYTHON-01 and every V-PYEDIT-* spec. Keep the exported
 * API stable.
 *
 * REQ: REQ-3.4.1.2
 */

import { expect, type APIRequestContext, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { createValidTest, openTest, validateTest } from '../../helpers/fn-seed'
import { ensureEnvironment } from '../../helpers/config'
import { openStringParamSheet } from '../../helpers/param-config'
import { deleteTest, openConfig } from '../../functional/file-picker/picker'

/** The Python block's node id, in the plain Test and inside the Remote Execution body. */
export const PYTHON_NODE_ID = 'python-block'

const REMOTE_CONTAINER_ID = 'remote-container'

/** The ten-line script of the approved Python editor mock. */
export const PYTHON_SCRIPT = [
  'import statistics',
  'import logging',
  '',
  'limit = float(threshold)',
  'values = [row["temp_c"] for row in readings]',
  'mean_temp = statistics.mean(values)',
  'out_of_range = [row for row in readings if row["temp_c"] > limit]',
  'logging.info("mean %.2f, %d readings above %.1f", mean_temp, len(out_of_range), limit)',
  'summary = {"mean": mean_temp, "above_limit": len(out_of_range)}',
  'assert len(out_of_range) < 3, "too many readings above the limit"',
].join('\n')

export interface PythonFixtureOptions {
  /** Test name; `seedPythonTest` appends the per-run unique suffix. */
  name?: string
  /** Put the block inside a Remote Execution body, so it runs on the remote host. */
  remote?: boolean
}

interface FixtureVariable {
  value: unknown
  type: string
  scope: string
}

export interface PythonFixture {
  name: string
  version: string
  description: string
  workflow: {
    nodes: Array<Record<string, unknown>>
    edges: Array<Record<string, unknown>>
  }
  variables: Record<string, FixtureVariable>
  metadata: { tags: string[]; suite_id: null; parent_suite: null }
}

const READINGS: FixtureVariable = {
  value: [
    { sensor: 'north', temp_c: 28.4, taken_at: '2026-09-18T08:00:00Z' },
    { sensor: 'south', temp_c: 31.2, taken_at: '2026-09-18T08:05:00Z' },
    { sensor: 'east', temp_c: 33.7, taken_at: '2026-09-18T08:10:00Z' },
  ],
  type: 'table',
  scope: 'test',
}

const BASE_VARIABLES: Record<string, FixtureVariable> = {
  readings: READINGS,
  threshold: { value: 30.5, type: 'float', scope: 'test' },
  summary: { value: {}, type: 'map', scope: 'test' },
  out_of_range: { value: [], type: 'array', scope: 'test' },
}

function pythonNode(position: { x: number; y: number }): Record<string, unknown> {
  return {
    id: PYTHON_NODE_ID,
    type: 'workflowNode',
    position,
    data: {
      label: 'Python',
      elementType: 'python',
      nodeType: 'plugin',
      category: 'system',
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      // Bare `{{name}}` references: the only form the editor reads an Input
      // Variable's type from (PYRUN-19), so the table is typed table and the
      // float Decimal.
      expressionFields: [],
      templateFields: ['input_vars.readings', 'input_vars.threshold'],
      config: {
        values: {
          script_type: 'source',
          script: PYTHON_SCRIPT,
          input_vars: { readings: '{{readings}}', threshold: '{{threshold}}' },
          script_variables: ['summary', 'out_of_range'],
        },
        outputBindings: { summary: 'summary', out_of_range: 'out_of_range' },
        outputSecretFields: [],
        profileBindings: [],
      },
    },
    measured: { width: 120, height: 62 },
  }
}

function remoteExecutionNode(): Record<string, unknown> {
  return {
    id: REMOTE_CONTAINER_ID,
    type: 'workflowNode',
    position: { x: -75, y: 100 },
    data: {
      label: 'Remote Execution',
      elementType: 'remote-execution',
      nodeType: 'plugin',
      category: 'remote',
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: ['session_id'],
      templateFields: [],
      config: {
        values: { session_id: 'sid' },
        outputBindings: { remote_session_id: 'rsid' },
        profileBindings: [],
      },
    },
    measured: { width: 160, height: 62 },
  }
}

/** The Test document: one Python block in Source mode, alone or in a Remote Execution body. */
export function pythonFixture(options: PythonFixtureOptions = {}): PythonFixture {
  const name = options.name ?? 'Python block'
  const metadata = { tags: [], suite_id: null, parent_suite: null } as PythonFixture['metadata']

  if (options.remote) {
    return {
      name,
      version: '1.0.0',
      description: '',
      workflow: {
        nodes: [remoteExecutionNode(), pythonNode({ x: -75, y: 260 })],
        edges: [
          { id: 'e-start', source: 'start-node', target: REMOTE_CONTAINER_ID },
          {
            id: 'e-body',
            source: REMOTE_CONTAINER_ID,
            sourceHandle: 'body',
            target: PYTHON_NODE_ID,
            type: 'default',
          },
        ],
      },
      variables: {
        ...BASE_VARIABLES,
        sid: { value: '', type: 'string', scope: 'test' },
        rsid: { value: '', type: 'string', scope: 'test' },
      },
      metadata,
    }
  }

  return {
    name,
    version: '1.0.0',
    description: '',
    workflow: {
      nodes: [pythonNode({ x: -75, y: 100 })],
      edges: [{ id: 'e-start', source: 'start-node', target: PYTHON_NODE_ID }],
    },
    variables: BASE_VARIABLES,
    metadata,
  }
}

/** Persist the fixture through POST /tests under a unique name; returns the test id.
 *  Open it on the canvas with `seedAndOpenPythonTest`, or with `openTest` from helpers/fn-seed. */
export async function seedPythonTest(
  request: APIRequestContext,
  name: string,
  options: PythonFixtureOptions = {},
): Promise<string> {
  const fixture = pythonFixture({ ...options, name })
  await ensureEnvironment(request)
  const testId = await createValidTest(request, {
    name: `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    nodes: fixture.workflow.nodes,
    edges: fixture.workflow.edges,
    variables: fixture.variables,
  })
  const result = await validateTest(request, testId, 'load')
  expect(
    result.errors,
    `seeded Test "${name}" failed validation: ${JSON.stringify(result.errors)}`,
  ).toHaveLength(0)
  return testId
}

/** Seed the Test and open it on the canvas; returns the test id for teardown. */
export async function seedAndOpenPythonTest(
  page: Page,
  name: string,
  options: PythonFixtureOptions = {},
): Promise<string> {
  const testId = await seedPythonTest(page.request, name, options)
  await openTest(page, testId)
  return testId
}

/** Open the block's config sheet, then the Script body row's "Edit value" sheet. */
export async function openPythonScriptSheet(
  page: Page,
  nodeId: string = PYTHON_NODE_ID,
): Promise<Locator> {
  const config = await openConfig(page, nodeId)
  return openStringParamSheet(config, page, 'script')
}

/** Replace the open script sheet's text without saving it.
 *  insertText, not type, so auto-close brackets and auto-indent leave it alone. */
export async function setPythonScript(page: Page, sheet: Locator, script: string): Promise<void> {
  const editor = sheet.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (script) await page.keyboard.insertText(script)
}

/** Remove a Test the spec seeded; the delete cascades to its data folder. */
export async function deletePythonTest(
  request: APIRequestContext,
  testId: string,
): Promise<void> {
  await deleteTest(request, testId)
}
