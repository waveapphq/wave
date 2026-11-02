/** Save-path checks shared by the null-entry specs: a Test save the backend must refuse. */

import { expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { getTest } from '../../helpers/element-types'

export type StoredNode = { id: string; data: Record<string, any> }

export interface SaveFinding {
  code?: string
  message?: string
  node_id?: string
}

/** PUT the stored workflow with one Block changed; the save must answer 422 and change nothing. */
export async function refusedBlockSave(
  request: APIRequestContext,
  testId: string,
  nodeId: string,
  change: (data: Record<string, any>) => void,
): Promise<SaveFinding[]> {
  const before = await getTest(request, testId)
  const workflow = JSON.parse(JSON.stringify(before.workflow)) as { nodes: StoredNode[] }
  const node = workflow.nodes.find((candidate) => candidate.id === nodeId)
  expect(node, `Block ${nodeId} is stored`).toBeTruthy()
  change(node!.data)

  const resp = await request.put(`${BACKEND_URL}/tests/${testId}`, { data: { workflow } })
  const body = await resp.json().catch(() => null)
  expect(resp.status(), `the save must be refused: ${JSON.stringify(body)}`).toBe(422)
  expect(body?.error?.code).toBe('VALIDATION_ERROR')

  const after = await getTest(request, testId)
  expect(after.workflow, 'a refused save stores nothing').toEqual(before.workflow)
  return (body?.error?.details ?? []) as SaveFinding[]
}

/** The findings as `[code, message, node]` rows, for an exact comparison. */
export function findingRows(findings: readonly SaveFinding[]): Array<[string, string, string]> {
  return findings.map((finding) => [finding.code ?? '', finding.message ?? '', finding.node_id ?? ''])
}
