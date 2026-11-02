/**
 * Tests for the promoted NAMESPACE_ROOTS constant and the three consumers that
 * read the same three names.
 *
 * Design decisions: VARPICK-2 (namespace roots excluded from pickers), VARPICK-1.
 */

import { describe, it, expect } from 'vitest'

import { NAMESPACE_ROOTS } from '@/features/workbench/lib/namespace-roots'
import {
  isOutputBindable,
  describeBindingRejection,
} from '@/features/workbench/lib/validation/output-binding-rules'
import { validateName } from '@/features/workbench/common/variables/variable-setter-editor/validation'
import {
  computeNodeIssues,
  type NodeIssue,
} from '@/features/workbench/lib/validation/compute-node-issues'

const ROOTS = ['system', 'suite', 'regression'] as const

interface NodeFixture {
  id: string
  data: {
    elementType: string
    nodeType: string
    version: string
    label: string
    config: { values: Record<string, unknown> }
    expressionFields: string[]
  }
}

function logNodeWithExpr(message: string): NodeFixture {
  return {
    id: 'log-1',
    data: {
      elementType: 'log',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Log',
      config: { values: { message, level: 'INFO' } },
      expressionFields: ['message'],
    },
  }
}

function unresolvedRefIssue(node: NodeFixture): NodeIssue | undefined {
  const issues = computeNodeIssues([node], []).get('log-1') ?? []
  return issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')
}

describe('NAMESPACE_ROOTS', () => {
  it('holds exactly system, suite and regression', () => {
    expect([...NAMESPACE_ROOTS].sort()).toEqual(['regression', 'suite', 'system'])
  })

  it('is exposed as a ReadonlySet', () => {
    const roots: ReadonlySet<string> = NAMESPACE_ROOTS
    expect(roots).toBeInstanceOf(Set)
    expect(roots.size).toBe(3)
  })

  it('excludes dotted members, profile aliases and ordinary variable names', () => {
    expect(NAMESPACE_ROOTS.has('system.timeout')).toBe(false)
    expect(NAMESPACE_ROOTS.has('profile')).toBe(false)
    expect(NAMESPACE_ROOTS.has('timeout')).toBe(false)
  })
})

describe('output-binding rules read the shared roots', () => {
  it('rejects every namespace root as an output-binding target', () => {
    for (const root of ROOTS) {
      expect(isOutputBindable(root)).toBe(false)
      expect(describeBindingRejection(root)).toBe(
        `'${root}' is a read-only namespace and cannot receive an output`,
      )
    }
  })

  it('does not treat a dotted member as a namespace root', () => {
    // Still unbindable, but through the dotted-reference rule, not the root set.
    expect(isOutputBindable('system.timeout')).toBe(false)
    expect(describeBindingRejection('system.timeout')).toBe(
      "'system.timeout' is a namespace or profile reference; pick or create a test-local variable instead",
    )
  })

  it('accepts an ordinary variable name', () => {
    expect(isOutputBindable('timeout')).toBe(true)
    expect(describeBindingRejection('timeout')).toBeNull()
  })
})

describe('variable-setter name validation reads the shared roots', () => {
  it('rejects every namespace root as a setter target', () => {
    for (const root of ROOTS) {
      expect(validateName(root, [root], 0, []).error).toBe(
        `Cannot modify namespace variable '${root}'`,
      )
    }
  })

  it('does not treat a dotted member as a namespace root', () => {
    // Rejected by the identifier pattern, which fires before the root check.
    expect(validateName('system.timeout', ['system.timeout'], 0, []).error).toBe(
      'Name must start with a letter or underscore, and contain only letters, numbers, and underscores',
    )
  })

  it('accepts an ordinary variable name', () => {
    expect(validateName('timeout', ['timeout'], 0, []).error).toBeNull()
  })
})

describe('node-issue validation reads the shared roots', () => {
  it('resolves every namespace root as an available identifier', () => {
    for (const root of ROOTS) {
      expect(unresolvedRefIssue(logNodeWithExpr(`${root}.env`))).toBeUndefined()
    }
  })

  it('still reports an undeclared ordinary identifier', () => {
    expect(unresolvedRefIssue(logNodeWithExpr('timeout'))).toBeDefined()
  })
})
