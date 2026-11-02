/**
 * Required rows are checked only while the sheet shows them: a row its reveal gate
 * hides never marks the block incomplete (SFTP-2, paired per-operation rows).
 *
 * REQ-3.4.2.2
 */

import { describe, it, expect } from 'vitest'

import { computeNodeIssues } from '@/features/workbench/lib/validation/compute-node-issues'

function requiredIssues(values: Record<string, unknown>): { paramName?: string; message: string }[] {
  const node = {
    id: 'sftp-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'sftp',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'SFTP',
      config: { values },
    },
  }
  const issues = computeNodeIssues([node], []).get('sftp-1') ?? []
  return issues
    .filter((issue) => issue.code === 'REQUIRED_PARAM_MISSING' || issue.code === 'REQUIRED_PARAM_EMPTY')
    .map(({ paramName, message }) => ({ paramName, message }))
}

describe('an SFTP block with every row its operation shows filled', () => {
  it.each([
    ['upload', { source: 'testdata://orders.csv', destination: '/inbound/orders.tmp' }],
    ['download', { source: '/outbound/orders.out' }],
    ['list', { path: '/outbound/*.out' }],
    ['stats', { path: '/outbound/orders.out' }],
    ['delete', { path: '/outbound/orders.out' }],
    ['move', { source: '/inbound/orders.tmp', destination: '/inbound/orders.csv' }],
    ['create_folder', { path: '/inbound/new' }],
  ])('is complete on %s, whatever the other operations require', (operation, rows) => {
    expect(requiredIssues({ session_id: 'ssh_session', operation, ...rows })).toEqual([])
  })

  it('is complete on the default operation with no Operation value stored', () => {
    expect(
      requiredIssues({ session_id: 'ssh_session', source: 'testdata://a.csv', destination: '/in/' }),
    ).toEqual([])
  })
})

describe('an SFTP block missing a row its operation shows', () => {
  it('names only that row', () => {
    expect(requiredIssues({ session_id: 'ssh_session', operation: 'list' })).toEqual([
      { paramName: 'path', message: "Required parameter 'path' is missing" },
    ])
  })

  it('names a blank visible row as empty', () => {
    expect(
      requiredIssues({ session_id: 'ssh_session', operation: 'move', source: '/a', destination: '  ' }),
    ).toEqual([{ paramName: 'destination', message: "Required parameter 'destination' is empty" }])
  })
})
