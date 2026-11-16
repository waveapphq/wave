/** Workflows whose wires repeat an id, and the answer every client path gives them (REQ-5.2.4.3). */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { expect } from '../../helpers/playwright-fixtures'

export const DUPLICATE_EDGE_ID = 'DUPLICATE_EDGE_ID'
/** The id both wires of `fixture-repeated-ids.json` carry. */
export const REPEATED_ID = 'e-repeat'

/** The finding text for a wire id more than one wire carries. */
export function repeatedIdMessage(edgeId: string): string {
  return `Edge ID '${edgeId}' is used by more than one edge`
}

export type Wire = {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
}

export interface Workflow {
  nodes: Array<Record<string, unknown>>
  edges: Wire[]
}

export interface TestDocument extends Record<string, unknown> {
  name: string
  version: string
  description: string
  workflow: Workflow
  variables: Record<string, unknown>
  metadata: Record<string, unknown>
}

/** A fixture beside the spec, read fresh so a spec may change its copy. */
export function fixture(file: string): TestDocument {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8')) as TestDocument
}

/** A Test or Function name of its own for one spec step. */
export function uniqueName(tag: string): string {
  return `V-EDGE-IDS ${tag} ${Date.now()}-${randomUUID().slice(0, 6)}`
}

/** `fixture-repeated-ids.json` under `name`: two wires carry `e-repeat`. */
export function repeatedTest(name: string): TestDocument {
  return { ...fixture('fixture-repeated-ids.json'), name }
}

/** The same Test with each wire on an id of its own. */
export function cleanTest(name: string): TestDocument {
  const doc = repeatedTest(name)
  doc.workflow.edges[1] = { ...doc.workflow.edges[1], id: 'e-ei-a-b' }
  return doc
}

/** Each wire as (id, source, target, source handle, target handle), the way a reader compares two lists. */
export function wireRows(edges: readonly Wire[]): Array<Array<string | null>> {
  return edges.map((e) => [e.id, e.source, e.target, e.sourceHandle ?? null, e.targetHandle ?? null])
}

/** A refused request's status, `error` and the code and message of each finding it lists. */
export interface Answer {
  status: number
  body: Record<string, any> | null
  error: Record<string, any> | null
  findings: Array<[string, string]>
}

export async function answerOf(resp: { status(): number; json(): Promise<unknown> }): Promise<Answer> {
  const body = (await resp.json().catch(() => null)) as Record<string, any> | null
  const error = (body?.error ?? null) as Record<string, any> | null
  const details = (Array.isArray(error?.details) ? error?.details : []) as Array<Record<string, unknown>>
  return {
    status: resp.status(),
    body,
    error,
    findings: details.map((d) => [String(d.code), String(d.message)]),
  }
}

/** The save refused the workflow as sent: 422, `<what> has 1 validation error(s)`, the one finding. */
export function expectSaveRefused(answer: Answer, route: string, what: 'Test' | 'Function'): void {
  expect(answer.status, `${route} answered ${answer.status}: ${JSON.stringify(answer.body)}`).toBe(422)
  expect(answer.error?.message, `${route} counts one finding`).toBe(`${what} has 1 validation error(s)`)
  expect(answer.findings, `${route} names the repeated id once`).toEqual([
    [DUPLICATE_EDGE_ID, repeatedIdMessage(REPEATED_ID)],
  ])
}
