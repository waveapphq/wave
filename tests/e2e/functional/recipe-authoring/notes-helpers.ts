/** Recipe Notes over MCP (V-MCP-RECIPE-NOTES-FUNCTIONAL, V-MCP-RECIPE-FUNCTION-NOTES-FUNCTIONAL): recipe parts, seeds, stored wires, readbacks. */

import { expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import { controlBlock, pluginBlock, storedTest, type BlockFields, type Rec } from '../../helpers/fn-block'
import { callTool, enableMcpUntilRestart, recipeData } from '../../helpers/mcp'

// One MCP port per stack so host-mode parallel workers never collide.
export const MCP_PORT = Number(BACKEND_PORT) + 765

export type Doc = Record<string, any>

interface Wire {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

/** The Blocks and wires of one canvas: a Test's own or a local Function's. */
export interface Canvas {
  nodes: Doc[]
  edges: Wire[]
}

export const NOT_REACHED = 'Compiled block is unreachable from the start of the flow'

/** Turn the MCP listener on for this stack. */
export async function startMcp(page: Page, request: APIRequestContext): Promise<void> {
  await ensureEnvironment(request)
  await enableMcpUntilRestart(page, MCP_PORT)
}

/** Call one MCP tool and return its answer. */
export function tool(name: string, args: Record<string, unknown>): Doc {
  return callTool(MCP_PORT, name, args).payload
}

export function logStep(message: string): Doc {
  return { block: 'log', settings: { message, level: 'INFO' } }
}

export function noteStep(text: string, color: string): Doc {
  return { note: { text, color } }
}

/** The recipe text of `doc`: JSON is YAML, so the recipe parser reads it as written. */
export function recipeOf(doc: Doc): string {
  return JSON.stringify(doc, null, 2)
}

/** `doc` as a readback writes it: the stored Test's version beside its name. */
export function asReadBack(doc: Doc): Doc {
  return { ...doc, test: { ...doc.test, version: '1.0.0' } }
}

/** One refusal finding in the shape the authoring tools return. */
export function refusal(step: string, code: string, problem: string, fix: string | null): Doc {
  return { step, code, severity: 'error', problem, fix }
}

/** The `get_test_recipe` answer of `testId` and its recipe read as data. */
export function readBack(testId: string): { answer: Doc; recipe: Doc } {
  const answer = tool('get_test_recipe', { test_ref: testId })
  return { answer, recipe: recipeData(String(answer.recipe ?? '')) }
}

/** A Log as the canvas stores it, its message plain text. */
export function logAt(id: string, label: string, message: string, y: number): Rec {
  return pluginBlock(id, label, 'log', 'system', {
    values: { message, level: 'INFO' },
    position: { x: 200, y },
  })
}

/** A Note as the canvas stores it. */
export function noteAt(id: string, text: string, color: string, y: number, fields: BlockFields = {}): Rec {
  return {
    ...controlBlock(id, 'Note', 'note', 'misc', { ...fields, values: { text, color }, position: { x: 200, y } }),
    type: 'noteNode',
  }
}

/** The Test's own canvas as stored. */
export async function storedCanvas(request: APIRequestContext, testId: string): Promise<Canvas> {
  const workflow = ((await storedTest(request, testId)).workflow ?? {}) as Doc
  return { nodes: workflow.nodes ?? [], edges: workflow.edges ?? [] }
}

/** The canvas of the one local Function Block on `canvas`. */
export function functionCanvas(canvas: Canvas): Canvas {
  const block = canvas.nodes.find((node) => node.data?.elementType === 'function')
  expect(block, `a Function Block is stored: ${JSON.stringify(canvas.nodes)}`).toBeTruthy()
  const workflow = (block?.data?.localDefinition?.workflow ?? {}) as Doc
  return { nodes: workflow.nodes ?? [], edges: workflow.edges ?? [] }
}

/** The stored Note on `canvas` holding `text`. */
export function noteWithText(canvas: Canvas, text: string): Doc {
  const note = canvas.nodes.find(
    (node) => node.type === 'noteNode' && node.data?.config?.values?.text === text,
  )
  expect(note, `a Note '${text}' is stored: ${JSON.stringify(canvas.nodes)}`).toBeTruthy()
  return note as Doc
}

function nodeText(canvas: Canvas, id: string): string {
  if (id === 'start-node') return 'start'
  const node = canvas.nodes.find((item) => item.id === id)
  const values = node?.data?.config?.values ?? {}
  if (node?.type === 'noteNode') return `note ${values.text}`
  if (node?.data?.elementType === 'log') return `log ${values.message}`
  return String(node?.data?.elementType ?? id)
}

function wireText(canvas: Canvas, wire: Wire): string {
  const text = `${nodeText(canvas, wire.source)} -> ${nodeText(canvas, wire.target)}`
  const handles = [wire.sourceHandle, wire.targetHandle].filter(Boolean).join(' ')
  return handles ? `${text} (${handles})` : text
}

/** Every stored wire of `canvas` as `<from> -> <to>`, sorted. */
export function allWires(canvas: Canvas): string[] {
  return canvas.edges.map((wire) => wireText(canvas, wire)).sort()
}

/** The stored wires into and out of the node `id`, sorted. */
export function wiresAt(canvas: Canvas, id: string): string[] {
  return canvas.edges
    .filter((wire) => wire.source === id || wire.target === id)
    .map((wire) => wireText(canvas, wire))
    .sort()
}
