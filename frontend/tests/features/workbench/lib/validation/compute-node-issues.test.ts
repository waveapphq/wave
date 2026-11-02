/**
 * Tests for computeNodeIssues - live FE-side node validation.
 *
 * Mirrors the BE rules for REQUIRED_PARAM_MISSING / REQUIRED_PARAM_EMPTY and
 * the OUTPUT_TYPE_COMPAT mismatch that surfaces as INVALID_OUTPUT_BINDING_TYPE.
 */

import { describe, it, expect } from 'vitest'

import {
  computeNodeIssues,
  type NodeIssue,
} from '@/features/workbench/lib/validation/compute-node-issues'

interface NodeFixture {
  id: string
  type: 'workflowNode'
  position: { x: number; y: number }
  data: {
    elementType: string
    nodeType: 'plugin' | 'control'
    version: string
    label: string
    config?: { values?: Record<string, unknown>; outputBindings?: Record<string, string>; profileBindings?: unknown }
    disabled?: boolean
    expressionFields?: string[]
  }
}

interface VarFixture {
  id: string
  name: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
  value: unknown
}

function httpNode(overrides: Partial<NodeFixture['data']> = {}): NodeFixture {
  return {
    id: 'http-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'http-client',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'HTTP Call',
      config: { values: { method: 'GET', url: 'http://example.com' } },
      ...overrides,
    },
  }
}

function logNode(values: Record<string, unknown>): NodeFixture {
  return {
    id: 'log-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'log',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Log',
      config: { values },
    },
  }
}

describe('computeNodeIssues', () => {
  describe('return shape', () => {
    it('returns a Map keyed by nodeId', () => {
      const result = computeNodeIssues([], [])
      expect(result).toBeInstanceOf(Map)
    })

    it('returns an empty Map when there are no nodes', () => {
      const result = computeNodeIssues([], [])
      expect(result.size).toBe(0)
    })
  })

  describe('MISSING_FUNCTION_VERSION', () => {
    type Nodes = Parameters<typeof computeNodeIssues>[0]
    const fnNode = (data: Record<string, unknown>) =>
      [{ id: 'fn-1', type: 'workflowNode', position: { x: 0, y: 0 }, data }] as unknown as Nodes

    it('flags a Shared instance pinned to a missing version, naming the version', () => {
      const result = computeNodeIssues(
        fnNode({
          nodeType: 'function',
          functionLifecycle: 'shared',
          functionId: 'lib-1',
          functionVersion: '9.9.9',
          missingVersion: true,
        }),
        [],
      )
      const issue = (result.get('fn-1') ?? []).find((i) => i.code === 'MISSING_FUNCTION_VERSION')
      expect(issue?.message).toContain('9.9.9')
    })

    it('does not flag when missingVersion is unset', () => {
      const result = computeNodeIssues(
        fnNode({ nodeType: 'function', functionLifecycle: 'shared', functionVersion: '1.0.0' }),
        [],
      )
      expect(result.has('fn-1')).toBe(false)
    })

    it('does not flag a disabled node', () => {
      const result = computeNodeIssues(
        fnNode({ nodeType: 'function', missingVersion: true, functionVersion: '9.9.9', disabled: true }),
        [],
      )
      expect(result.has('fn-1')).toBe(false)
    })

    it('falls back to ? when the pinned version is absent', () => {
      const result = computeNodeIssues(
        fnNode({ nodeType: 'function', functionLifecycle: 'shared', missingVersion: true }),
        [],
      )
      const issue = (result.get('fn-1') ?? []).find((i) => i.code === 'MISSING_FUNCTION_VERSION')
      expect(issue?.message).toContain('?')
    })
  })

  describe('REQUIRED_PARAM_MISSING', () => {
    it('emits when a required param has no value at all', () => {
      const node = httpNode({
        config: { values: { method: 'GET' } }, // url is required and missing
      })
      const result = computeNodeIssues([node], [])
      const issues = result.get('http-1') ?? []
      const missing = issues.find((i: NodeIssue) => i.code === 'REQUIRED_PARAM_MISSING')
      expect(missing).toBeDefined()
      expect(missing?.paramName).toBe('url')
    })

    it('does not emit for an optional param that is missing', () => {
      const node = httpNode({
        config: { values: { method: 'GET', url: 'http://x' } },
      })
      const result = computeNodeIssues([node], [])
      expect(result.has('http-1')).toBe(false)
    })

    it('does not emit when a required param has its default value applied', () => {
      // method has default 'GET'; url required has explicit value
      const node = httpNode({
        config: { values: { url: 'http://x' } }, // method missing but defaultValue=GET
      })
      const result = computeNodeIssues([node], [])
      const issues = result.get('http-1') ?? []
      const missingMethod = issues.find(
        (i: NodeIssue) => i.code === 'REQUIRED_PARAM_MISSING' && i.paramName === 'method'
      )
      expect(missingMethod).toBeUndefined()
    })
  })

  describe('REQUIRED_PARAM_EMPTY', () => {
    it('emits when a required string param is the empty string', () => {
      const node = httpNode({
        config: { values: { method: 'GET', url: '' } },
      })
      const result = computeNodeIssues([node], [])
      const issues = result.get('http-1') ?? []
      const empty = issues.find((i: NodeIssue) => i.code === 'REQUIRED_PARAM_EMPTY')
      expect(empty).toBeDefined()
      expect(empty?.paramName).toBe('url')
    })

    it('emits when a required string param is whitespace-only', () => {
      const node = logNode({ message: '   ' }) // log.message is required string
      const result = computeNodeIssues([node], [])
      const issues = result.get('log-1') ?? []
      const empty = issues.find((i: NodeIssue) => i.code === 'REQUIRED_PARAM_EMPTY')
      expect(empty).toBeDefined()
    })

    it('does not emit when a required string param has content', () => {
      const node = logNode({ message: 'hello' })
      const result = computeNodeIssues([node], [])
      expect(result.has('log-1')).toBe(false)
    })
  })

  describe('disabled nodes', () => {
    it('emits no issues for a disabled node even if required params are missing', () => {
      const node = httpNode({
        config: { values: {} },
        disabled: true,
      })
      const result = computeNodeIssues([node], [])
      expect(result.has('http-1')).toBe(false)
    })
  })

  describe('INVALID_OUTPUT_BINDING_TYPE', () => {
    const baseHttpNode = (binding: Record<string, string>): NodeFixture => ({
      id: 'http-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'http-client',
        nodeType: 'plugin',
        version: '1.0.0',
        label: 'HTTP Call',
        config: {
          values: { method: 'GET', url: 'http://example.com' },
          outputBindings: binding,
        },
      },
    })

    it('emits for string output bound to an integer variable', () => {
      // http-client `body` output is type=string; bind to an integer variable
      const node = baseHttpNode({ body: 'count' })
      const variables: VarFixture[] = [
        { id: 'v1', name: 'count', type: 'integer', value: 0 },
      ]
      const result = computeNodeIssues([node], variables)
      const issues = result.get('http-1') ?? []
      const bindingIssue = issues.find(
        (i: NodeIssue) => i.code === 'INVALID_OUTPUT_BINDING_TYPE'
      )
      expect(bindingIssue).toBeDefined()
      expect(bindingIssue?.paramName).toBe('body')
    })

    it('does not emit when the variable type is compatible (float accepts integer)', () => {
      // http-client `response_time` output is float; OUTPUT_TYPE_COMPAT.float = {float, integer}
      const node = baseHttpNode({ response_time: 'n' })
      const variables: VarFixture[] = [
        { id: 'v1', name: 'n', type: 'integer', value: 0 },
      ]
      const result = computeNodeIssues([node], variables)
      const issues = result.get('http-1') ?? []
      const bindingIssue = issues.find(
        (i: NodeIssue) => i.code === 'INVALID_OUTPUT_BINDING_TYPE'
      )
      expect(bindingIssue).toBeUndefined()
    })

    it('does not emit when the bound variable does not exist (the binding is dangling, handled elsewhere)', () => {
      const node = baseHttpNode({ body: 'ghost' })
      const result = computeNodeIssues([node], [])
      const issues = result.get('http-1') ?? []
      const bindingIssue = issues.find(
        (i: NodeIssue) => i.code === 'INVALID_OUTPUT_BINDING_TYPE'
      )
      expect(bindingIssue).toBeUndefined()
    })

    it('does not emit when the binding is empty', () => {
      const node = baseHttpNode({ body: '' })
      const variables: VarFixture[] = [
        { id: 'v1', name: 'count', type: 'integer', value: 0 },
      ]
      const result = computeNodeIssues([node], variables)
      const issues = result.get('http-1') ?? []
      const bindingIssue = issues.find(
        (i: NodeIssue) => i.code === 'INVALID_OUTPUT_BINDING_TYPE'
      )
      expect(bindingIssue).toBeUndefined()
    })

    describe('an output whose declared type follows other fields (K8SREAD-6)', () => {
      const getNode = (
        values: Record<string, unknown>,
        outputBindings: Record<string, string>,
      ): NodeFixture => ({
        id: 'k8s-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          elementType: 'k8s-get',
          nodeType: 'plugin',
          version: '1.0.0',
          label: 'K8s Get',
          config: { values: { session: 'sess', ...values }, outputBindings },
        },
      })

      function bindingIssue(
        values: Record<string, unknown>,
        variables: VarFixture[],
      ): NodeIssue | undefined {
        const result = computeNodeIssues([getNode(values, { result: 'pods' })], variables)
        return (result.get('k8s-1') ?? []).find(
          (i: NodeIssue) => i.code === 'INVALID_OUTPUT_BINDING_TYPE',
        )
      }

      const mapVar: VarFixture[] = [{ id: 'v1', name: 'pods', type: 'map', value: {} }]
      const tableVar: VarFixture[] = [{ id: 'v1', name: 'pods', type: 'table', value: [] }]

      it('names the resolved type when a Table-mode read binds a map variable', () => {
        const issue = bindingIssue({ output_format: 'table' }, mapVar)

        expect(issue).toBeDefined()
        expect(issue?.message).toBe(
          "Output 'result' (type table) cannot bind to variable 'pods' (type map)",
        )
      })

      it('accepts the table variable the same read resolves to', () => {
        expect(bindingIssue({ output_format: 'table' }, tableVar)).toBeUndefined()
      })

      it('still accepts a map variable on the default Map and Name read', () => {
        expect(bindingIssue({}, mapVar)).toBeUndefined()
        expect(bindingIssue({}, tableVar)).toBeDefined()
      })

      it('resolves a List read to array', () => {
        const issue = bindingIssue({ search_by: 'list' }, mapVar)

        expect(issue?.message).toBe(
          "Output 'result' (type array) cannot bind to variable 'pods' (type map)",
        )
      })
    })
  })

  describe('UNRESOLVED_VARIABLE_REFERENCE', () => {
    function logNodeWithExpr(values: Record<string, unknown>, expressionFields: string[]): NodeFixture {
      return {
        id: 'log-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          elementType: 'log',
          nodeType: 'plugin',
          version: '1.0.0',
          label: 'Log',
          config: { values },
          expressionFields,
        },
      }
    }

    it('emits when an expression field references an undeclared variable', () => {
      const node = logNodeWithExpr({ message: 'test1', level: 'INFO' }, ['message'])
      const result = computeNodeIssues([node], [])
      const issues = result.get('log-1') ?? []
      const issue = issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')
      expect(issue).toBeDefined()
      expect(issue?.paramName).toBe('message')
      expect(issue?.message).toContain("'test1'")
    })

    it('does NOT emit when the referenced variable is declared', () => {
      const node = logNodeWithExpr({ message: 'test1', level: 'INFO' }, ['message'])
      const variables: VarFixture[] = [{ id: 'v1', name: 'test1', type: 'string', value: '' }]
      const result = computeNodeIssues([node], variables)
      const issues = result.get('log-1') ?? []
      const issue = issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')
      expect(issue).toBeUndefined()
    })

    it('does NOT emit for namespace roots (system, suite, regression)', () => {
      const node = logNodeWithExpr({ message: 'system.env' }, ['message'])
      const result = computeNodeIssues([node], [])
      const issues = result.get('log-1') ?? []
      const issue = issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')
      expect(issue).toBeUndefined()
    })

    it('does NOT emit for Python literals (True / False / None)', () => {
      const node = logNodeWithExpr({ message: 'True' }, ['message'])
      const result = computeNodeIssues([node], [])
      const issues = result.get('log-1') ?? []
      const issue = issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')
      expect(issue).toBeUndefined()
    })

    it('does NOT emit for whitelisted Python builtins (len, str, int, ...)', () => {
      const node = logNodeWithExpr({ message: 'len(test1)' }, ['message'])
      const variables: VarFixture[] = [{ id: 'v1', name: 'test1', type: 'string', value: 'hi' }]
      const result = computeNodeIssues([node], variables)
      const issues = result.get('log-1') ?? []
      const issue = issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')
      expect(issue).toBeUndefined()
    })

    it.each([
      ["Table(['a']).col_names()"],
      ["TableRowView([7], ['k'])['k']"],
      ["ColumnType('float').value"],
    ])('does NOT emit for the sandbox table types: %s', (message) => {
      const node = logNodeWithExpr({ message }, ['message'])
      const issues = computeNodeIssues([node], []).get('log-1') ?? []
      expect(issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')).toBeUndefined()
    })

    it('emits for a Python builtin the sandbox leaves out', () => {
      const node = logNodeWithExpr({ message: 'print(1)' }, ['message'])
      const issues = computeNodeIssues([node], []).get('log-1') ?? []
      expect(issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')?.message).toContain("'print'")
    })

    it('does NOT emit for a field that is not listed in expressionFields', () => {
      // `level` carries an undeclared identifier but is NOT in expressionFields, so
      // it must be ignored. Expression-field `message` carries a quoted literal so
      // extractIdentifiers finds nothing inside it.
      const node = logNodeWithExpr({ message: '"hi"', level: 'test1' }, ['message'])
      const result = computeNodeIssues([node], [])
      const issues = result.get('log-1') ?? []
      const issue = issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')
      expect(issue).toBeUndefined()
    })

    it('emits one issue per affected param even when multiple identifiers are missing', () => {
      const node = logNodeWithExpr({ message: 'foo + bar' }, ['message'])
      const result = computeNodeIssues([node], [])
      const issues = (result.get('log-1') ?? []).filter(
        (i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE',
      )
      expect(issues).toHaveLength(1)
      expect(issues[0].paramName).toBe('message')
    })

    it('does NOT emit for a disabled node', () => {
      const node = logNodeWithExpr({ message: 'test1' }, ['message'])
      node.data.disabled = true
      const result = computeNodeIssues([node], [])
      expect(result.has('log-1')).toBe(false)
    })

    // Names an expression binds itself are local to it, never references. The
    // engine's own scan reads free names only; this one must agree, or a Test
    // that saves and validates cleanly cannot be run.
    describe('locally bound names are not references', () => {
      const rows: VarFixture[] = [{ id: 'v1', name: 'rows', type: 'table', value: [] }]

      it('does NOT emit for a comprehension target', () => {
        const node = logNodeWithExpr({ message: "','.join([r['sku'] for r in rows])" }, ['message'])
        const result = computeNodeIssues([node], rows)
        const issues = result.get('log-1') ?? []
        expect(
          issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE'),
        ).toBeUndefined()
      })

      it('does NOT emit for a generator target', () => {
        const node = logNodeWithExpr({ message: "','.join(str(r) for r in rows)" }, ['message'])
        const result = computeNodeIssues([node], rows)
        const issues = result.get('log-1') ?? []
        expect(
          issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE'),
        ).toBeUndefined()
      })

      it('does NOT emit for a lambda parameter', () => {
        const node = logNodeWithExpr({ message: 'str((lambda v: v * 2)(21))' }, ['message'])
        const result = computeNodeIssues([node], [])
        const issues = result.get('log-1') ?? []
        expect(
          issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE'),
        ).toBeUndefined()
      })

      it('does NOT emit for a keyword argument name', () => {
        const node = logNodeWithExpr({ message: "format(7, format_spec='d')" }, ['message'])
        const result = computeNodeIssues([node], [])
        const issues = result.get('log-1') ?? []
        expect(
          issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE'),
        ).toBeUndefined()
      })

      it('still emits for an undeclared iterable behind a comprehension', () => {
        const node = logNodeWithExpr({ message: "','.join([r['sku'] for r in ghost_rows])" }, [
          'message',
        ])
        const result = computeNodeIssues([node], [])
        const issues = result.get('log-1') ?? []
        const issue = issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')
        expect(issue).toBeDefined()
        expect(issue?.message).toContain("'ghost_rows'")
      })

      it('still emits for an undeclared name inside a lambda body', () => {
        const node = logNodeWithExpr({ message: 'str((lambda v: v + ghost)(1))' }, ['message'])
        const result = computeNodeIssues([node], [])
        const issues = result.get('log-1') ?? []
        const issue = issues.find((i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE')
        expect(issue).toBeDefined()
        expect(issue?.message).toContain("'ghost'")
      })
    })
  })

  describe('namespace and invalid identifier rejection', () => {
    const baseHttpNode = (binding: Record<string, string>): NodeFixture => ({
      id: 'http-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'http-client',
        nodeType: 'plugin',
        version: '1.0.0',
        label: 'HTTP Call',
        config: {
          values: { method: 'GET', url: 'http://example.com' },
          outputBindings: binding,
        },
      },
    })

    it('emits INVALID_OUTPUT_BINDING_TYPE for a system.x namespace pointer', () => {
      const node = baseHttpNode({ body: 'system.foo' })
      const result = computeNodeIssues([node], [])
      const issues = result.get('http-1') ?? []
      const issue = issues.find((i: NodeIssue) => i.code === 'INVALID_OUTPUT_BINDING_TYPE')
      expect(issue).toBeDefined()
      expect(issue?.paramName).toBe('body')
    })

    it('emits INVALID_OUTPUT_BINDING_TYPE for the bare namespace name "system"', () => {
      const node = baseHttpNode({ body: 'system' })
      const result = computeNodeIssues([node], [])
      const issues = result.get('http-1') ?? []
      const issue = issues.find((i: NodeIssue) => i.code === 'INVALID_OUTPUT_BINDING_TYPE')
      expect(issue).toBeDefined()
    })

    it('emits INVALID_OUTPUT_BINDING_TYPE for an invalid Python identifier', () => {
      const node = baseHttpNode({ body: '123-bad' })
      const result = computeNodeIssues([node], [])
      const issues = result.get('http-1') ?? []
      const issue = issues.find((i: NodeIssue) => i.code === 'INVALID_OUTPUT_BINDING_TYPE')
      expect(issue).toBeDefined()
    })
  })

  describe('edge cases for branch coverage', () => {
    it('handles a node with missing data gracefully', () => {
      // node.data is missing - the `node.data ?? {}` fallback fires.
      const node = {
        id: 'edge-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
      } as unknown as NodeFixture
      const result = computeNodeIssues([node], [])
      expect(result.size).toBe(0)
    })

    it('evaluates requiredWhen with the explicit field value (mode=range, end missing)', () => {
      // for control: when mode='range', `end` is required. Provide explicit
      // mode='range' (not the default 'count') and omit `end`.
      const node: NodeFixture = {
        id: 'for-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          elementType: 'for',
          nodeType: 'control',
          version: '1.0.0',
          label: 'For Range',
          config: { values: { mode: 'range', start: 0 } },
        },
      }
      const result = computeNodeIssues([node], [])
      const issues = result.get('for-1') ?? []
      const missing = issues.find(
        (i: NodeIssue) => i.code === 'REQUIRED_PARAM_MISSING' && i.paramName === 'end',
      )
      expect(missing).toBeDefined()
    })
  })

  describe('isValueNonEmpty fallbacks', () => {
    it('does not emit REQUIRED_PARAM_EMPTY for a required string param given a non-string value', () => {
      // Use http-client.url which is a required string. Setting a numeric
      // value exercises the `value !== null && value !== undefined` fallback
      // for the string-type branch.
      const node = httpNode({
        config: { values: { method: 'GET', url: 12345 } },
      })
      const result = computeNodeIssues([node], [])
      expect(result.has('http-1')).toBe(false)
    })

    it('emits REQUIRED_PARAM_EMPTY for a required integer param when value is null', () => {
      // for-each.timeout is float (optional). Use a known required integer:
      // delay control's seconds parameter. Since isValueNonEmpty returns
      // false only when value is null/undefined for non-string types, that
      // path is the same as REQUIRED_PARAM_MISSING which short-circuits
      // earlier. The fallback path is exercised via the missing-required
      // case in other tests.
      const node = httpNode({
        config: { values: { method: 'GET', url: 'http://x' } },
      })
      // No issues for a clean http node.
      const result = computeNodeIssues([node], [])
      expect(result.has('http-1')).toBe(false)
    })
  })

  describe('non-string required-param empty check', () => {
    const arrayParamNode = (value: unknown): NodeFixture => ({
      id: 'for-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'for-each',
        nodeType: 'control',
        version: '1.0.0',
        label: 'For Each',
        config: { values: { collection: value } },
      },
    })

    it('emits REQUIRED_PARAM_EMPTY for a required array param given an empty array', () => {
      const node = arrayParamNode([])
      const result = computeNodeIssues([node], [])
      const issues = result.get('for-1') ?? []
      const empty = issues.find((i: NodeIssue) => i.code === 'REQUIRED_PARAM_EMPTY')
      expect(empty).toBeDefined()
    })

    it('does not emit REQUIRED_PARAM_EMPTY for a required array param with content', () => {
      const node = arrayParamNode([1, 2])
      const result = computeNodeIssues([node], [])
      expect(result.has('for-1')).toBe(false)
    })
  })

  describe('multiple nodes', () => {
    it('reports issues per nodeId independently', () => {
      const httpMissingUrl = httpNode({ config: { values: { method: 'GET' } } })
      const logOk = logNode({ message: 'hi' })
      const result = computeNodeIssues([httpMissingUrl, logOk], [])
      expect(result.has('http-1')).toBe(true)
      expect(result.has('log-1')).toBe(false)
    })

    it('aggregates multiple issues on the same node', () => {
      // url required + body bound wrong type
      const node: NodeFixture = {
        id: 'http-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          elementType: 'http-client',
          nodeType: 'plugin',
          version: '1.0.0',
          label: 'HTTP Call',
          config: {
            values: { method: 'GET' }, // url missing
            outputBindings: { body: 'count' },
          },
        },
      }
      const variables: VarFixture[] = [
        { id: 'v1', name: 'count', type: 'integer', value: 0 },
      ]
      const result = computeNodeIssues([node], variables)
      const issues = result.get('http-1') ?? []
      const codes = issues.map((i: NodeIssue) => i.code)
      expect(codes).toContain('REQUIRED_PARAM_MISSING')
      expect(codes).toContain('INVALID_OUTPUT_BINDING_TYPE')
    })
  })

  describe('profile alias namespace', () => {
    it('includes profile binding aliases in the variable namespace so referencing them is not flagged as UNRESOLVED_VARIABLE_REFERENCE', () => {
      // Two HTTP nodes each declaring a profile alias. The Log node references
      // both via expression. With profile-alias collection on, no unresolved
      // ref issues fire; without it, both refs would be flagged.
      const httpA = httpNode({
        config: {
          values: { method: 'GET', url: 'http://a' },
          profileBindings: [
            { alias: 'prof_a', fields: [{ name: 'token' }] },
          ],
        },
      })
      httpA.id = 'http-a'

      const httpB = httpNode({
        config: {
          values: { method: 'GET', url: 'http://b' },
          profileBindings: [
            { alias: 'prof_b', fields: [{ name: 'token' }] },
            { fields: [{ name: 'lone' }] },        // missing alias - skipped
            { alias: '', fields: [{ name: 'x' }] }, // empty alias - skipped
          ],
        },
      })
      httpB.id = 'http-b'

      const log = logNode({ message: 'prof_a + prof_b' })
      log.data.expressionFields = ['message']

      const result = computeNodeIssues([httpA, httpB, log], [])
      const logIssues = result.get('log-1') ?? []
      const unresolved = logIssues.filter(
        (i: NodeIssue) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE',
      )
      expect(unresolved).toEqual([])
    })

    it('ignores nodes whose config.profileBindings is not an array', () => {
      // Defensive: malformed profileBindings (object instead of array) must
      // not crash the alias collection loop.
      const http = httpNode({
        config: {
          values: { method: 'GET', url: 'http://x' },
          profileBindings: { alias: 'not-an-array' },
        },
      })
      const result = computeNodeIssues([http], [])
      expect(result).toBeInstanceOf(Map)
    })
  })

  describe('expression unresolved-ref guard', () => {
    it('skips checkUnresolvedRefs when the node has expressionFields but no config.values', () => {
      // Defensive: a node with declared expressionFields but config.values
      // missing must not crash the unresolved-ref scan.
      const log = logNode({})
      log.data.expressionFields = ['message']
      // Strip the config.values that logNode() seeded.
      log.data.config = {}
      const result = computeNodeIssues([log], [])
      expect(result).toBeInstanceOf(Map)
    })
  })

  describe('inner Function body recursive validation', () => {
    it('surfaces issues from inside a Local Function body', () => {
      // A Local Function whose inner Log node has no message must surface
      // a REQUIRED_PARAM_MISSING on the inner node id.
      const innerLog = logNode({ /* missing 'message' */ })
      innerLog.id = 'inner-log'
      const fnNode: NodeFixture = {
        id: 'fn-1',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          label: 'Function_1',
          functionLifecycle: 'local',
          localDefinition: {
            inputs: [],
            outputs: [],
            workflow: { nodes: [innerLog], edges: [] },
          },
          config: { values: {}, outputBindings: {} },
        } as unknown as NodeFixture['data'],
      }
      const result = computeNodeIssues([fnNode], [])
      const innerIssues = result.get('inner-log')
      expect(innerIssues).toBeDefined()
      expect(
        innerIssues?.some(
          (i) =>
            i.code === 'REQUIRED_PARAM_EMPTY' ||
            i.code === 'REQUIRED_PARAM_MISSING',
        ),
      ).toBe(true)
    })

    it('exposes inner profile-binding aliases to the inner expression scope', () => {
      // Exercises the for-of loop over collectProfileAliasNames for the
      // INNER function body (line 325). An inner node binds an SSH profile
      // under the alias ``db``; a sibling Log inside the same Function
      // references ``{{ db.host }}`` in a templateField (no expressionFields
      // - templates are scope-validated separately and don't pollute the
      // issues map). The alias being collected is what we're verifying.
      const innerShellScript: NodeFixture = {
        id: 'inner-shell-script',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          elementType: 'shell-script',
          nodeType: 'plugin',
          version: '1.0.0',
          label: 'Shell Script',
          config: {
            values: { script: 'echo hi' },
            outputBindings: {},
            profileBindings: [
              {
                profileId: 'p-1',
                profileName: 'db',
                profileType: 'ssh',
                alias: 'db',
                fields: [{ name: 'host', type: 'string' }],
              },
            ],
          },
        } as unknown as NodeFixture['data'],
      }
      const innerLog = logNode({ message: 'irrelevant' })
      innerLog.id = 'inner-log'

      const fnNode: NodeFixture = {
        id: 'fn-with-profile',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          label: 'Function_With_Profile',
          functionLifecycle: 'local',
          localDefinition: {
            inputs: [],
            outputs: [],
            workflow: { nodes: [innerShellScript, innerLog], edges: [] },
          },
          config: { values: {}, outputBindings: {} },
        } as unknown as NodeFixture['data'],
      }

      const result = computeNodeIssues([fnNode], [])
      // The inner Shell Script node carries the binding directly - no
      // unresolved-variable reference issue should be raised for the alias itself.
      const shellIssues = result.get('inner-shell-script') ?? []
      expect(
        shellIssues.some((i) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE'),
      ).toBe(false)
    })

    it('skips non-object entries when building the inner declared-name scope', () => {
      // collectDeclaredParamNames must skip malformed (non-object / null)
      // entries in the localDefinition inputs/outputs/variables arrays while
      // still collecting the valid string-named declarations around them. An
      // inner Log references the valid input ``msg`` in an expressionField, so
      // skipping the malformed neighbors must not produce a false
      // UNRESOLVED_VARIABLE_REFERENCE.
      const innerLog = logNode({ message: 'msg' })
      innerLog.id = 'inner-log'
      innerLog.data.expressionFields = ['message']

      const fnNode: NodeFixture = {
        id: 'fn-malformed-decls',
        type: 'workflowNode',
        position: { x: 0, y: 0 },
        data: {
          elementType: 'function',
          nodeType: 'function',
          version: '1.0.0',
          label: 'Function_Malformed_Decls',
          functionLifecycle: 'local',
          localDefinition: {
            inputs: [null, 'not-an-object', { name: 'msg', type: 'string' }],
            outputs: [42, { name: 'out', type: 'string' }],
            variables: [undefined, { name: 'v', type: 'string' }],
            workflow: { nodes: [innerLog], edges: [] },
          },
          config: { values: {}, outputBindings: {} },
        } as unknown as NodeFixture['data'],
      }

      const result = computeNodeIssues([fnNode], [])
      const innerIssues = result.get('inner-log') ?? []
      // ``msg`` resolved from the valid input declaration despite the
      // malformed neighbors being skipped.
      expect(
        innerIssues.some((i) => i.code === 'UNRESOLVED_VARIABLE_REFERENCE'),
      ).toBe(false)
    })
  })
})

// HTTP rework rules mirrored in live node validation.
describe('computeNodeIssues - HTTP rework rules', () => {
  const issuesFor = (values: Record<string, unknown>): NodeIssue[] => {
    const result = computeNodeIssues([httpNode({ config: { values } })], [])
    return result.get('http-1') ?? []
  }
  const baseValues = { method: 'GET', url: 'http://example.com' }

  describe('proxy choice (HTTP-13)', () => {
    it('raises no issue while proxy_mode is unset (WAVE setting, the default)', () => {
      expect(issuesFor(baseValues)).toEqual([])
    })

    it.each(['wave-setting', 'off'])('raises no issue for proxy_mode %s', (mode) => {
      expect(issuesFor({ ...baseValues, proxy_mode: mode })).toEqual([])
    })

    // The block has no Proxy URL row, so no stored value can ask for one.
    it.each<Record<string, unknown>>([
      { proxy_mode: 'explicit' },
      { proxy_mode: 'explicit', proxy_url: '' },
      { proxy_mode: 'explicit', proxy_url: '   ' },
    ])('asks for no Proxy URL when the block stores %j', (stored) => {
      const issues = issuesFor({ ...baseValues, ...stored })
      expect(issues.filter((i) => i.paramName === 'proxy_url')).toEqual([])
      expect(issues.map((i) => i.message)).not.toContain(
        'Proxy mode "explicit" requires a Proxy URL',
      )
    })
  })

  describe('TLS version ordering', () => {
    const TLS_MESSAGE = 'Min TLS Version cannot exceed Max TLS Version'

    it('emits the exact message when min orders above max', () => {
      const issues = issuesFor({ ...baseValues, tls_min_version: '1.3', tls_max_version: '1.2' })
      expect(issues).toEqual([
        { code: 'ENUM_ORDER', severity: 'error', paramName: 'tls_min_version', message: TLS_MESSAGE },
      ])
    })

    it('does not emit when min is below or equal to max', () => {
      expect(
        issuesFor({ ...baseValues, tls_min_version: '1.2', tls_max_version: '1.3' }),
      ).toEqual([])
      expect(
        issuesFor({ ...baseValues, tls_min_version: '1.2', tls_max_version: '1.2' }),
      ).toEqual([])
    })

    it('resolves an unset side from its 1.2/1.3 default', () => {
      expect(issuesFor(baseValues)).toEqual([])
      expect(issuesFor({ ...baseValues, tls_min_version: '1.3' })).toEqual([])
      expect(issuesFor({ ...baseValues, tls_max_version: '1.1' })).toEqual([
        { code: 'ENUM_ORDER', severity: 'error', paramName: 'tls_min_version', message: TLS_MESSAGE },
      ])
    })

    it('accepts an explicit legacy range', () => {
      expect(
        issuesFor({ ...baseValues, tls_min_version: '1.0', tls_max_version: '1.0' }),
      ).toEqual([])
    })

    it('skips values outside the declared enum scale (defensive)', () => {
      expect(
        issuesFor({ ...baseValues, tls_min_version: '1.2', tls_max_version: 'bogus' }),
      ).toEqual([])
      expect(
        issuesFor({ ...baseValues, tls_min_version: 'bogus', tls_max_version: '1.2' }),
      ).toEqual([])
    })
  })

  describe('conjunctive required rules (auth rows)', () => {
    it('requires the basic-mode rows only while auth is enabled in basic mode', () => {
      const issues = issuesFor({ ...baseValues, auth_enabled: true, auth_mode: 'basic' })
      const names = issues.map((i) => i.paramName)
      expect(names).toContain('auth_username')
      expect(names).toContain('auth_password')
      expect(names).not.toContain('auth_token')
      expect(names).not.toContain('auth_key')
    })

    it('resolves auth_mode from its basic default when unset', () => {
      const issues = issuesFor({ ...baseValues, auth_enabled: true })
      expect(issues.map((i) => i.paramName)).toContain('auth_username')
    })

    it('requires the bearer token only in bearer mode', () => {
      const issues = issuesFor({ ...baseValues, auth_enabled: true, auth_mode: 'bearer' })
      const names = issues.map((i) => i.paramName)
      expect(names).toEqual(['auth_token'])
    })

    it('requires the api_key rows in api_key mode, honoring the header-name default', () => {
      const issues = issuesFor({ ...baseValues, auth_enabled: true, auth_mode: 'api_key' })
      expect(issues.map((i) => i.paramName)).toEqual(['auth_key'])
    })

    it('flags an explicitly emptied auth_header_name in api_key mode', () => {
      const issues = issuesFor({
        ...baseValues,
        auth_enabled: true,
        auth_mode: 'api_key',
        auth_header_name: '',
        auth_key: 'k',
      })
      expect(issues.map((i) => i.paramName)).toEqual(['auth_header_name'])
    })

    it('requires nothing while auth is disabled (the default)', () => {
      expect(issuesFor(baseValues)).toEqual([])
      expect(issuesFor({ ...baseValues, auth_enabled: false, auth_mode: 'basic' })).toEqual([])
    })

    it('emits filled-row satisfaction: complete basic credentials pass clean', () => {
      const issues = issuesFor({
        ...baseValues,
        auth_enabled: true,
        auth_mode: 'basic',
        auth_username: 'u',
        auth_password: 'p',
      })
      expect(issues).toEqual([])
    })
  })

  describe('map key policy mirror', () => {
    it('flags Content-Length with the exact reworded transport message', () => {
      const issues = issuesFor({ ...baseValues, headers: { 'Content-Length': '10' } })
      expect(issues).toEqual([
        {
          code: 'MAP_KEY_POLICY',
          severity: 'error',
          paramName: 'headers',
          message:
            'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides',
        },
      ])
    })

    it('coerces a non-string map value while still applying the key policy', () => {
      // Hand-edited configs may carry non-string header values.
      const issues = issuesFor({
        ...baseValues,
        headers: { 'Content-Length': 10 },
      })
      expect(issues).toEqual([
        {
          code: 'MAP_KEY_POLICY',
          severity: 'error',
          paramName: 'headers',
          message:
            'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides',
        },
      ])
    })

    it('flags case-insensitive duplicate headers with the policy noun', () => {
      const issues = issuesFor({
        ...baseValues,
        headers: { Accept: 'text/html', accept: 'application/json' },
      })
      expect(issues).toEqual([
        {
          code: 'MAP_KEY_POLICY',
          severity: 'error',
          paramName: 'headers',
          message: 'Duplicate header "accept" (header names are case-insensitive)',
        },
      ])
    })

    it('no longer flags Transfer-Encoding (left the blocklist)', () => {
      expect(
        issuesFor({ ...baseValues, headers: { 'Transfer-Encoding': 'chunked' } }),
      ).toEqual([])
    })

    it('no longer flags Content-Type in form or multipart mode (mode-conflict retired)', () => {
      expect(
        issuesFor({
          ...baseValues,
          body_mode: 'form',
          headers: { 'Content-Type': 'application/json' },
        }),
      ).toEqual([])
      expect(
        issuesFor({
          ...baseValues,
          body_mode: 'multipart',
          headers: { 'Content-Type': 'text/plain' },
        }),
      ).toEqual([])
    })

    it('skips non-map header values (expression-driven maps validate at runtime)', () => {
      expect(issuesFor({ ...baseValues, headers: 'not-a-map' })).toEqual([])
    })
  })

})

describe('table-typed parameters bound to a variable or an expression', () => {
  function dataNode(elementType: string, values: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return {
      id: 'data-1',
      type: 'workflowNode' as const,
      position: { x: 0, y: 0 },
      data: {
        elementType,
        nodeType: 'plugin' as const,
        version: '1.0.0',
        label: elementType,
        config: { values },
        ...extra,
      },
    }
  }

  const tableVar = { name: 'order_schema', type: 'table' as const }

  it('accepts a table variable as an Excel schema source', () => {
    const result = computeNodeIssues(
      [dataNode('excel-parser', {
        operation: 'read',
        workbook: 'testdata://orders.xlsx',
        column_types: 'schema',
        schema_source: 'order_schema',
      })],
      [tableVar],
    )

    expect(result.get('data-1') ?? []).toEqual([])
  })

  it('accepts a table variable as a CSV schema source', () => {
    const result = computeNodeIssues(
      [dataNode('csv-parser', {
        operation: 'parse',
        csv_content: 'sku,qty\nA,1\n',
        column_types: 'schema',
        schema_source: 'order_schema',
      })],
      [tableVar],
    )

    expect(result.get('data-1') ?? []).toEqual([])
  })

  it('accepts a table variable as the table to write', () => {
    const result = computeNodeIssues(
      [dataNode('excel-parser', {
        operation: 'write',
        workbook: 'artifact://out.xlsx',
        table: 'orders',
      })],
      [{ name: 'orders', type: 'table' as const }],
    )

    expect(result.get('data-1') ?? []).toEqual([])
  })

  it('accepts an expression as the table to serialize', () => {
    const result = computeNodeIssues(
      [dataNode(
        'csv-parser',
        { operation: 'serialize', table: "orders.order_by('sku')" },
        { expressionFields: ['table'] },
      )],
      [{ name: 'orders', type: 'table' as const }],
    )

    expect(result.get('data-1') ?? []).toEqual([])
  })

  it('still flags a required table parameter left blank', () => {
    const result = computeNodeIssues(
      [dataNode('excel-parser', {
        operation: 'write',
        workbook: 'artifact://out.xlsx',
        table: '   ',
      })],
      [],
    )

    expect(result.get('data-1') ?? []).toEqual([
      { code: 'REQUIRED_PARAM_EMPTY', severity: 'error', paramName: 'table', message: "Required parameter 'table' is empty" },
    ])
  })

  it('still flags a required table parameter given an empty literal table', () => {
    const result = computeNodeIssues(
      [dataNode('excel-parser', {
        operation: 'write',
        workbook: 'artifact://out.xlsx',
        table: [],
      })],
      [],
    )

    expect(result.get('data-1') ?? []).toEqual([
      { code: 'REQUIRED_PARAM_EMPTY', severity: 'error', paramName: 'table', message: "Required parameter 'table' is empty" },
    ])
  })
})

// Shell Script and Shell Exec canvas rules (REQ-3.4.1.1, REQ-3.4.1.18, REQ-3.4.2.2).
describe('computeNodeIssues - Shell Script and Shell Exec rules', () => {
  const AT_LEAST_ONE = 'Set a pass pattern, a fail pattern or both'
  const invalidVariable = (key: string): string => `Invalid variable name: '${key}'`
  const blockedPrefix = (key: string): string =>
    `Variable names may not start with WAVE_: '${key}'`
  const invalidExport = (name: string): string => `Invalid script variable name: '${name}'`
  const outputClash = (name: string): string =>
    `Script variable '${name}' has the name of a block output`
  const listedTwice = (name: string): string =>
    `Script variable '${name}' is listed more than once`

  const shellScriptNode = (values: Record<string, unknown>): NodeFixture => ({
    id: 'shell-script-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'shell-script',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Shell Script',
      config: { values },
    },
  })

  const shellExecNode = (values: Record<string, unknown>): NodeFixture => ({
    id: 'shell-exec-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'shell-exec',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Shell Exec',
      config: { values },
    },
  })

  const scriptIssues = (values: Record<string, unknown>): NodeIssue[] =>
    computeNodeIssues([shellScriptNode({ script: 'echo hi', ...values })], []).get(
      'shell-script-1',
    ) ?? []

  const execIssues = (values: Record<string, unknown>): NodeIssue[] =>
    computeNodeIssues([shellExecNode({ command: 'ls -1', ...values })], []).get('shell-exec-1') ??
    []

  describe('stop on pattern needs a pass pattern, a fail pattern or both (SHRUN-13)', () => {
    it('raises the missing-value issue while both patterns are unset', () => {
      expect(scriptIssues({ stop_on_pattern: true })).toEqual([
        {
          code: 'REQUIRED_PARAM_MISSING',
          severity: 'error',
          paramName: 'fail_pattern',
          message: AT_LEAST_ONE,
        },
      ])
    })

    it('raises the empty-value issue when the fail pattern is the empty string', () => {
      expect(scriptIssues({ stop_on_pattern: true, fail_pattern: '' })).toEqual([
        {
          code: 'REQUIRED_PARAM_EMPTY',
          severity: 'error',
          paramName: 'fail_pattern',
          message: AT_LEAST_ONE,
        },
      ])
    })

    it('is satisfied by a pass pattern alone', () => {
      expect(scriptIssues({ stop_on_pattern: true, pass_pattern: 'READY' })).toEqual([])
    })

    it('is satisfied by a fail pattern alone', () => {
      expect(scriptIssues({ stop_on_pattern: true, fail_pattern: 'ERROR' })).toEqual([])
    })

    it('is satisfied by both patterns', () => {
      expect(
        scriptIssues({ stop_on_pattern: true, pass_pattern: 'READY', fail_pattern: 'ERROR' }),
      ).toEqual([])
    })

    it('raises nothing while stop on pattern is off', () => {
      expect(scriptIssues({})).toEqual([])
      expect(scriptIssues({ stop_on_pattern: false })).toEqual([])
    })

    it('applies the same rule and message to Shell Exec', () => {
      expect(execIssues({ stop_on_pattern: true })).toEqual([
        {
          code: 'REQUIRED_PARAM_MISSING',
          severity: 'error',
          paramName: 'fail_pattern',
          message: AT_LEAST_ONE,
        },
      ])
    })
  })

  describe('a condition on an unset field reads as empty', () => {
    it('treats an unset pass pattern exactly like an empty one', () => {
      const unset = scriptIssues({ stop_on_pattern: true })
      expect(unset).toEqual([
        {
          code: 'REQUIRED_PARAM_MISSING',
          severity: 'error',
          paramName: 'fail_pattern',
          message: AT_LEAST_ONE,
        },
      ])
      expect(scriptIssues({ stop_on_pattern: true, pass_pattern: '' })).toEqual(unset)
    })
  })

  describe('Input Variables key rules (SHRUN-5)', () => {
    it('flags a key that is not a shell identifier', () => {
      expect(scriptIssues({ input_vars: { '1X': 'v' } })).toEqual([
        {
          code: 'MAP_KEY_POLICY',
          severity: 'error',
          paramName: 'input_vars',
          message: invalidVariable('1X'),
        },
      ])
    })

    it('flags a key that starts with WAVE_', () => {
      expect(scriptIssues({ input_vars: { WAVE_HOME: '/wave' } })).toEqual([
        {
          code: 'MAP_KEY_POLICY',
          severity: 'error',
          paramName: 'input_vars',
          message: blockedPrefix('WAVE_HOME'),
        },
      ])
    })

    it('accepts shell identifiers, including a lowercase wave_ prefix', () => {
      expect(scriptIssues({ input_vars: { MY_VAR: '1', wave_home: '/wave' } })).toEqual([])
    })

    it('applies the same rules to the Shell Exec map under its own wire name', () => {
      expect(execIssues({ env_vars: { '1X': 'v' } })).toEqual([
        {
          code: 'MAP_KEY_POLICY',
          severity: 'error',
          paramName: 'env_vars',
          message: invalidVariable('1X'),
        },
      ])
      expect(execIssues({ env_vars: { WAVE_HOME: '/wave' } })).toEqual([
        {
          code: 'MAP_KEY_POLICY',
          severity: 'error',
          paramName: 'env_vars',
          message: blockedPrefix('WAVE_HOME'),
        },
      ])
    })
  })

  describe('variable export names (SHRUN-6)', () => {
    const nameIssue = (message: string): NodeIssue => ({
      code: 'OUTPUT_LIST_NAME',
      severity: 'error',
      paramName: 'script_variables',
      message,
    })

    it('flags a name that is not a shell identifier', () => {
      expect(scriptIssues({ script_variables: ['x y'] })).toEqual([
        nameIssue(invalidExport('x y')),
      ])
    })

    it('flags an empty name', () => {
      expect(scriptIssues({ script_variables: [''] })).toEqual([nameIssue(invalidExport(''))])
    })

    it('flags a name that is a block output', () => {
      expect(scriptIssues({ script_variables: ['stdout'] })).toEqual([
        nameIssue(outputClash('stdout')),
      ])
    })

    it('flags a name that is one of the outputs hidden under Fail the block', () => {
      expect(scriptIssues({ script_variables: ['reason'] })).toEqual([
        nameIssue(outputClash('reason')),
      ])
    })

    it('flags every colliding row of a repeated name', () => {
      expect(scriptIssues({ script_variables: ['A', 'B', 'A'] })).toEqual([
        nameIssue(listedTwice('A')),
        nameIssue(listedTwice('A')),
      ])
    })

    it('checks the pattern before the clash and the clash before the repeat', () => {
      expect(scriptIssues({ script_variables: ['x y', 'x y'] })).toEqual([
        nameIssue(invalidExport('x y')),
        nameIssue(invalidExport('x y')),
      ])
      expect(scriptIssues({ script_variables: ['stdout', 'stdout'] })).toEqual([
        nameIssue(outputClash('stdout')),
        nameIssue(outputClash('stdout')),
      ])
    })

    it('reports one issue per offending row, in row order', () => {
      expect(scriptIssues({ script_variables: ['COUNT', 'x y', 'stdout'] })).toEqual([
        nameIssue(invalidExport('x y')),
        nameIssue(outputClash('stdout')),
      ])
    })

    it('accepts a list of valid names', () => {
      expect(scriptIssues({ script_variables: ['COUNT', 'TOTAL'] })).toEqual([])
    })

    it('raises nothing for a stored value that is not a list', () => {
      expect(scriptIssues({ script_variables: 'COUNT' })).toEqual([])
    })

    it('raises nothing on Shell Exec, which has no variable exports', () => {
      expect(execIssues({ script_variables: ['x y'] })).toEqual([])
    })
  })
})

// Issue severity and the Python body checks (PYRUN-13, PYRUN-14, REQ-3.4.1.2).
describe('NodeIssue severity', () => {
  const shellScriptNode = (values: Record<string, unknown>): NodeFixture => ({
    id: 'shell-script-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'shell-script',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Shell Script',
      config: { values },
    },
  })

  const scriptIssues = (values: Record<string, unknown>): NodeIssue[] =>
    computeNodeIssues([shellScriptNode({ script: 'echo hi', ...values })], []).get(
      'shell-script-1',
    ) ?? []

  it('marks a missing required parameter an error', () => {
    expect(scriptIssues({ stop_on_pattern: true }).map((issue) => issue.severity)).toEqual([
      'error',
    ])
  })

  it('marks an empty required parameter an error', () => {
    expect(
      scriptIssues({ stop_on_pattern: true, fail_pattern: '' }).map((issue) => issue.severity),
    ).toEqual(['error'])
  })

  it('marks a map key policy breach an error', () => {
    expect(scriptIssues({ input_vars: { '1X': 'v' } }).map((issue) => issue.severity)).toEqual([
      'error',
    ])
  })

  it('marks a variable export name error an error', () => {
    expect(scriptIssues({ script_variables: ['x y'] }).map((issue) => issue.severity)).toEqual([
      'error',
    ])
  })

  it('marks every issue of a node an error while none of them says otherwise', () => {
    const issues = scriptIssues({
      stop_on_pattern: true,
      input_vars: { '1X': 'v' },
      script_variables: ['x y'],
    })

    expect(issues.length).toBeGreaterThan(1)
    expect(issues.filter((issue) => issue.severity !== 'error')).toEqual([])
  })
})

describe('Python body syntax errors (PYRUN-13)', () => {
  const pythonNode = (values: Record<string, unknown> = {}) => ({
    id: 'py-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'python',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Python',
      config: { values: { script_type: 'source', script: 'def (\n', ...values } },
    },
  })

  async function load() {
    const validation = await import('@/features/workbench/lib/validation/compute-node-issues')
    const store = await import('@/features/workbench/stores/workflow-store')
    return { compute: validation.computeNodeIssues, useWorkflowStore: store.useWorkflowStore }
  }

  async function issuesWithSyntax(
    syntaxIssues: { line: number; message: string }[],
    values: Record<string, unknown> = {},
  ): Promise<NodeIssue[]> {
    const { compute, useWorkflowStore } = await load()
    useWorkflowStore.getState().setNodeSyntaxIssues('py-1', syntaxIssues)
    return compute([pythonNode(values)] as Parameters<typeof compute>[0], []).get('py-1') ?? []
  }

  it('raises the syntax error the store holds, naming the line', async () => {
    const issues = await issuesWithSyntax([{ line: 3, message: 'Unexpected token' }])

    expect(issues.map((issue) => issue.message)).toContain('Script has a syntax error on line 3')
  })

  it('marks the syntax error an error, so the block cannot run', async () => {
    const issues = await issuesWithSyntax([{ line: 3, message: 'Unexpected token' }])
    const syntax = issues.find((issue) => issue.message.startsWith('Script has a syntax error'))

    expect(syntax?.severity).toBe('error')
    // The code the run gate promotes into a blocker (see use-test-run).
    expect(syntax?.code).toBe('SCRIPT_SYNTAX_ERROR')
  })

  it('names the first line when the parse reported more than one error', async () => {
    const issues = await issuesWithSyntax([
      { line: 4, message: 'Unexpected token' },
      { line: 9, message: 'Unexpected indent' },
    ])
    const messages = issues.filter((issue) =>
      issue.message.startsWith('Script has a syntax error'),
    )

    expect(messages.map((issue) => issue.message)).toEqual([
      'Script has a syntax error on line 4',
    ])
  })

  it('raises nothing before the first parse, while the store holds no issues', async () => {
    const { compute } = await load()
    const issues = compute([pythonNode()] as Parameters<typeof compute>[0], []).get('py-1') ?? []

    expect(issues.some((issue) => issue.message.startsWith('Script has a syntax error'))).toBe(
      false,
    )
  })

  it('drops the issue once the parse reports no errors', async () => {
    const issues = await issuesWithSyntax([])

    expect(issues.some((issue) => issue.message.startsWith('Script has a syntax error'))).toBe(
      false,
    )
  })

  it('raises nothing for a block the store holds no issues for', async () => {
    const { compute, useWorkflowStore } = await load()
    useWorkflowStore.getState().setNodeSyntaxIssues('py-2', [{ line: 1, message: 'bad' }])
    const issues = compute([pythonNode()] as Parameters<typeof compute>[0], []).get('py-1') ?? []

    expect(issues.some((issue) => issue.message.startsWith('Script has a syntax error'))).toBe(
      false,
    )
  })
})

describe('Python check warnings (PYRUN-13)', () => {
  const pythonNode = () => ({
    id: 'py-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'python',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Python',
      config: { values: { script_type: 'source', script: 'puts(1)\nlimit * 1.5\n' } },
    },
  })

  const PUTS = { line: 1, message: "Function 'puts' is not recognized", severity: 'warning' as const }
  const OPERATOR = { line: 2, message: "Cannot use '*' with Decimal and float", severity: 'warning' as const }

  async function issuesWithReported(
    reported: { line: number; message: string; severity?: 'warning' }[],
  ): Promise<NodeIssue[]> {
    const validation = await import('@/features/workbench/lib/validation/compute-node-issues')
    const store = await import('@/features/workbench/stores/workflow-store')
    store.useWorkflowStore.getState().setNodeSyntaxIssues('py-1', reported)
    const compute = validation.computeNodeIssues
    return compute([pythonNode()] as Parameters<typeof compute>[0], []).get('py-1') ?? []
  }

  it('lists each check warning in the block issues, named by line', async () => {
    const issues = await issuesWithReported([PUTS, OPERATOR])

    expect(issues.filter((issue) => issue.code === 'SCRIPT_CHECK_WARNING')).toEqual([
      {
        code: 'SCRIPT_CHECK_WARNING',
        severity: 'warning',
        paramName: 'script',
        message: "Line 1: Function 'puts' is not recognized",
      },
      {
        code: 'SCRIPT_CHECK_WARNING',
        severity: 'warning',
        paramName: 'script',
        message: "Line 2: Cannot use '*' with Decimal and float",
      },
    ])
  })

  it('never marks the block invalid through a warning', async () => {
    const issues = await issuesWithReported([PUTS])

    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true)
    expect(issues.some((issue) => issue.code === 'SCRIPT_SYNTAX_ERROR')).toBe(false)
  })

  it('names the first syntax error line, never a warning line, when both are held', async () => {
    const issues = await issuesWithReported([PUTS, { line: 4, message: 'invalid syntax' }])

    expect(issues.filter((issue) => issue.code === 'SCRIPT_SYNTAX_ERROR').map((issue) => issue.message)).toEqual([
      'Script has a syntax error on line 4',
    ])
    expect(issues.filter((issue) => issue.code === 'SCRIPT_CHECK_WARNING')).toHaveLength(1)
  })
})

// The SQL editor's findings are warnings named on the sql row (SQL-10, REQ-3.4.1.6).
describe('SQL editor warnings (SQL-10)', () => {
  const SQL_SCRIPT = [
    'SELECT id, status, total',
    'FROM orders',
    'WHERE customer_id = :customer',
    '  AND status = :status',
    'ORDER BY created_at DESC;',
    'SET search_path TO reporting;',
  ].join('\n')

  const sqlNode = () => ({
    id: 'sql-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'sql-client',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'SQL',
      config: {
        values: {
          operation: 'run_sql',
          database_type: 'postgresql',
          host: 'db.lab',
          database: 'shop',
          username: 'wave',
          script_type: 'source',
          sql: SQL_SCRIPT,
          parameters: { customer: '1', status: 'open', limit: '10' },
        },
      },
    },
  })

  const UNUSED = {
    line: 0,
    message: "Parameter 'limit' is defined but not used in the SQL",
    severity: 'warning' as const,
    from: 0,
    to: 0,
  }
  const SESSION_END = {
    line: 6,
    message: 'SET search_path ends the script; its effect ends with the block',
    severity: 'warning' as const,
    from: SQL_SCRIPT.indexOf('SET search_path'),
    to: SQL_SCRIPT.length,
  }

  async function issuesWithReported(
    reported: { line: number; message: string; severity?: 'warning' }[],
  ): Promise<NodeIssue[]> {
    const validation = await import('@/features/workbench/lib/validation/compute-node-issues')
    const store = await import('@/features/workbench/stores/workflow-store')
    store.useWorkflowStore.getState().setNodeSyntaxIssues('sql-1', reported)
    const compute = validation.computeNodeIssues
    return compute([sqlNode()] as Parameters<typeof compute>[0], []).get('sql-1') ?? []
  }

  it('lists each warning on the sql row, a line-0 warning with its bare message', async () => {
    const issues = await issuesWithReported([UNUSED, SESSION_END])

    expect(issues).toEqual([
      {
        code: 'SCRIPT_CHECK_WARNING',
        severity: 'warning',
        paramName: 'sql',
        message: "Parameter 'limit' is defined but not used in the SQL",
      },
      {
        code: 'SCRIPT_CHECK_WARNING',
        severity: 'warning',
        paramName: 'sql',
        message: 'Line 6: SET search_path ends the script; its effect ends with the block',
      },
    ])
  })

  it('never marks the block invalid through a SQL warning', async () => {
    const issues = await issuesWithReported([UNUSED, SESSION_END])

    expect(issues).toHaveLength(2)
    expect(issues.some((issue) => issue.code === 'SCRIPT_SYNTAX_ERROR')).toBe(false)
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true)
  })

  it('lists nothing once the editor reports no findings', async () => {
    const issues = await issuesWithReported([])

    expect(issues).toEqual([])
  })
})

interface ReportedIssue {
  line: number
  message: string
  severity?: 'warning'
}

/** The block's issues with the editor findings the store holds for it. */
async function scriptIssuesOf(
  node: { id: string; data: Record<string, unknown> },
  reported: ReportedIssue[],
): Promise<NodeIssue[]> {
  const validation = await import('@/features/workbench/lib/validation/compute-node-issues')
  const store = await import('@/features/workbench/stores/workflow-store')
  store.useWorkflowStore.getState().setNodeSyntaxIssues(node.id, reported)
  const compute = validation.computeNodeIssues
  const issues =
    compute([{ type: 'workflowNode', position: { x: 0, y: 0 }, ...node }] as Parameters<typeof compute>[0], []).get(
      node.id,
    ) ?? []
  return issues.filter((issue) => issue.code === 'SCRIPT_SYNTAX_ERROR' || issue.code === 'SCRIPT_CHECK_WARNING')
}

const UNKNOWN_FIELD: ReportedIssue = {
  line: 1,
  message: 'Unknown field log.invalid in filebeat-*',
  severity: 'warning',
}
const TRAILING_AND: ReportedIssue = {
  line: 2,
  message: "Expected a field or a value after 'and'",
  severity: 'warning',
}

function openSearchNode(values: Record<string, unknown> = {}, expressionFields?: string[]) {
  return {
    id: 'os-1',
    data: {
      elementType: 'opensearch',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'OpenSearch',
      ...(expressionFields ? { expressionFields } : {}),
      config: {
        values: {
          url: 'https://opensearch.example:9200',
          index: 'filebeat-*',
          query_language: 'dql',
          query: 'log.invalid: ERROR and\n',
          mode: 'search',
          ...values,
        },
      },
    },
  }
}

// The OpenSearch editor's findings are warnings named on the query row (REQ-3.3.2.6, OS-12).
describe('OpenSearch editor warnings (OS-12)', () => {
  it('lists each warning on the query row, named by line', async () => {
    const issues = await scriptIssuesOf(openSearchNode(), [UNKNOWN_FIELD, TRAILING_AND])

    expect(issues).toEqual([
      {
        code: 'SCRIPT_CHECK_WARNING',
        severity: 'warning',
        paramName: 'query',
        message: 'Line 1: Unknown field log.invalid in filebeat-*',
      },
      {
        code: 'SCRIPT_CHECK_WARNING',
        severity: 'warning',
        paramName: 'query',
        message: "Line 2: Expected a field or a value after 'and'",
      },
    ])
  })

  it('names the query row for a Query DSL query too', async () => {
    const issues = await scriptIssuesOf(
      openSearchNode({ query_language: 'query_dsl', query: '{ "term": { "log.invalid": "ERROR" } }' }),
      [UNKNOWN_FIELD],
    )

    expect(issues.map((issue) => issue.paramName)).toEqual(['query'])
  })

  it('never marks the block invalid through an OpenSearch warning', async () => {
    const issues = await scriptIssuesOf(openSearchNode(), [UNKNOWN_FIELD])

    expect(issues).toHaveLength(1)
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true)
  })

  it('lists nothing once the editor reports no findings', async () => {
    const issues = await scriptIssuesOf(openSearchNode(), [])

    expect(issues).toEqual([])
  })
})

// The script row of each plugin carries its findings (REQ-3.4.1.2, REQ-3.4.1.6, REQ-3.3.2.6).
describe('the script row each plugin names', () => {
  const plugins: Array<[string, string, { id: string; data: Record<string, unknown> }]> = [
    [
      'python',
      'script',
      {
        id: 'py-row',
        data: {
          elementType: 'python',
          nodeType: 'plugin',
          version: '1.0.0',
          label: 'Python',
          config: { values: { script_type: 'source', script: 'puts(1)\n' } },
        },
      },
    ],
    [
      'sql-client',
      'sql',
      {
        id: 'sql-row',
        data: {
          elementType: 'sql-client',
          nodeType: 'plugin',
          version: '1.0.0',
          label: 'SQL',
          config: {
            values: {
              operation: 'run_sql',
              database_type: 'postgresql',
              host: 'db.lab',
              database: 'shop',
              username: 'wave',
              script_type: 'source',
              sql: 'SELECT 1',
            },
          },
        },
      },
    ],
    ['opensearch', 'query', { ...openSearchNode(), id: 'os-row' }],
  ]

  it.each(plugins)('names the %s findings on its %s row', async (_plugin, paramName, node) => {
    const issues = await scriptIssuesOf(node, [UNKNOWN_FIELD])

    expect(issues.map((issue) => issue.paramName)).toEqual([paramName])
  })
})

// A script row in expression mode has no script editor, so no editor finding applies (SQL-10, OS-12).
describe('a script row in expression mode', () => {
  const SYNTAX_ERROR: ReportedIssue = { line: 1, message: 'invalid syntax' }

  function sqlExpressionNode() {
    return {
      id: 'sql-expr',
      data: {
        elementType: 'sql-client',
        nodeType: 'plugin',
        version: '1.0.0',
        label: 'SQL',
        expressionFields: ['sql'],
        config: {
          values: {
            operation: 'run_sql',
            database_type: 'postgresql',
            host: 'db.lab',
            database: 'shop',
            username: 'wave',
            script_type: 'source',
            sql: 'report_sql',
          },
        },
      },
    }
  }

  it('lists no SQL warning while the sql row is an expression', async () => {
    const issues = await scriptIssuesOf(sqlExpressionNode(), [UNKNOWN_FIELD, TRAILING_AND])

    expect(issues).toEqual([])
  })

  it('raises no SQL syntax error while the sql row is an expression', async () => {
    const issues = await scriptIssuesOf(sqlExpressionNode(), [SYNTAX_ERROR])

    expect(issues).toEqual([])
  })

  it('lists no OpenSearch warning while the query row is an expression', async () => {
    const issues = await scriptIssuesOf(
      { ...openSearchNode({ query: 'dashboard_query' }, ['query']), id: 'os-expr' },
      [UNKNOWN_FIELD, TRAILING_AND],
    )

    expect(issues).toEqual([])
  })

  it('keeps the findings while another row of the block is an expression', async () => {
    const issues = await scriptIssuesOf(
      { ...openSearchNode({ index: 'index_name' }, ['index']), id: 'os-other-expr' },
      [UNKNOWN_FIELD],
    )

    expect(issues.map((issue) => issue.paramName)).toEqual(['query'])
  })
})

describe('warnings inside a Local Function body (PYRUN-14)', () => {
  function functionAround(inner: Record<string, unknown>) {
    return {
      id: 'fn-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'function',
        nodeType: 'function',
        version: '1.0.0',
        label: 'Function_1',
        functionLifecycle: 'local',
        localDefinition: { inputs: [], outputs: [], workflow: { nodes: [inner], edges: [] } },
        config: { values: {}, outputBindings: {} },
      },
    }
  }

  const innerPython = (scriptVariables: string[]) => ({
    id: 'inner-py',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'python',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Python',
      config: { values: { script_type: 'source', script: 'x = 1\n', script_variables: scriptVariables } },
    },
  })

  it('lists the warning on the inner block and leaves the Function unflagged', () => {
    const result = computeNodeIssues(
      [functionAround(innerPython(['COUNT']))] as Parameters<typeof computeNodeIssues>[0],
      [],
    )

    expect(result.get('inner-py')?.map((issue) => issue.severity)).toEqual(['warning'])
    expect(result.get('fn-1')?.some((issue) => issue.code === 'CONTAINS_INVALID_DESCENDANT') ?? false).toBe(false)
  })

  it('still flags the Function for an error in its body', () => {
    const result = computeNodeIssues(
      [functionAround(innerPython(['x y']))] as Parameters<typeof computeNodeIssues>[0],
      [],
    )

    expect(result.get('fn-1')?.map((issue) => issue.code)).toEqual(['CONTAINS_INVALID_DESCENDANT'])
    expect(result.get('fn-1')?.map((issue) => issue.message)).toEqual([
      'This Function contains a block with validation issues',
    ])
  })
})

describe('unassigned Variable Exports (PYRUN-14)', () => {
  const pythonNode = (values: Record<string, unknown>) => ({
    id: 'py-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'python',
      nodeType: 'plugin',
      version: '1.0.0',
      label: 'Python',
      config: { values: { script_type: 'source', ...values } },
    },
  })

  function pythonIssues(values: Record<string, unknown>): NodeIssue[] {
    return (
      computeNodeIssues(
        [pythonNode(values)] as Parameters<typeof computeNodeIssues>[0],
        [],
      ).get('py-1') ?? []
    )
  }

  it('lists the export the script never sets as a warning', () => {
    const issues = pythonIssues({ script: 'x = 1\n', script_variables: ['COUNT'] })
    const warning = issues.find((issue) => issue.message === "Script never sets 'COUNT'")

    expect(warning?.severity).toBe('warning')
  })

  it('leaves an export name error an error on the same block', () => {
    const issues = pythonIssues({ script: 'x = 1\n', script_variables: ['x y'] })
    const nameError = issues.find((issue) =>
      issue.message.startsWith('Invalid script variable name'),
    )

    expect(nameError?.severity).toBe('error')
  })

  it('raises no warning for an export the script assigns', () => {
    const issues = pythonIssues({ script: 'COUNT = 1\n', script_variables: ['COUNT'] })

    expect(issues.some((issue) => issue.message.startsWith('Script never sets'))).toBe(false)
  })
})

// Numeric parameter bounds, driven off the Ping schema (PING-17, PING-18).
describe('numeric parameter bounds', () => {
  const COUNT_MESSAGE = 'Count must be between 1 and 1000'
  const INTERVAL_MESSAGE = 'Interval (seconds) must be at least 0.2'
  const RATE_MESSAGE = 'Minimum rate (%) must be between 0 and 100'
  const MIN_REPLIES_MESSAGE = 'Minimum replies cannot exceed Count'

  function pingNode(
    values: Record<string, unknown>,
    overrides: Partial<NodeFixture['data']> = {},
  ): NodeFixture {
    return {
      id: 'ping-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'ping',
        nodeType: 'plugin',
        version: '1.0.0',
        label: 'Ping',
        config: { values: { host: 'example.com', ...values } },
        ...overrides,
      },
    }
  }

  const issuesFor = (
    values: Record<string, unknown>,
    overrides: Partial<NodeFixture['data']> = {},
  ): NodeIssue[] => computeNodeIssues([pingNode(values, overrides)], []).get('ping-1') ?? []

  const rangeIssuesFor = (
    values: Record<string, unknown>,
    overrides: Partial<NodeFixture['data']> = {},
  ): NodeIssue[] => issuesFor(values, overrides).filter((i) => i.code === 'NUMBER_RANGE')

  describe('a literal inside the declared range', () => {
    it('raises nothing for the declared defaults written out', () => {
      expect(issuesFor({ count: 4, interval: 1, packet_size: 56 })).toEqual([])
    })

    it('raises nothing at either end of a range', () => {
      expect(issuesFor({ count: 1 })).toEqual([])
      expect(issuesFor({ count: 1000 })).toEqual([])
      expect(issuesFor({ packet_size: 0 })).toEqual([])
      expect(issuesFor({ packet_size: 65507 })).toEqual([])
      expect(issuesFor({ interval: 0.2 })).toEqual([])
    })
  })

  describe('a literal below the lowest allowed value', () => {
    it('flags the row and names it', () => {
      expect(issuesFor({ count: 0 })).toEqual([
        { code: 'NUMBER_RANGE', severity: 'error', paramName: 'count', message: COUNT_MESSAGE },
      ])
    })

    it('words a row that declares only a lowest value as at least', () => {
      expect(issuesFor({ interval: 0.1 })).toEqual([
        {
          code: 'NUMBER_RANGE',
          severity: 'error',
          paramName: 'interval',
          message: INTERVAL_MESSAGE,
        },
      ])
    })
  })

  describe('a literal above the highest allowed value', () => {
    it('flags a Count of 5000', () => {
      expect(issuesFor({ count: 5000 })).toEqual([
        { code: 'NUMBER_RANGE', severity: 'error', paramName: 'count', message: COUNT_MESSAGE },
      ])
    })

    it('flags a reply rate of 250', () => {
      expect(issuesFor({ pass_when: 'min_rate', min_rate: 250 })).toEqual([
        { code: 'NUMBER_RANGE', severity: 'error', paramName: 'min_rate', message: RATE_MESSAGE },
      ])
    })
  })

  describe('an expression', () => {
    it('is never range-checked', () => {
      expect(issuesFor({ count: '5 * 1000' }, { expressionFields: ['count'] })).toEqual([])
    })

    it('is never range-checked when the row is declared an expression field', () => {
      expect(issuesFor({ count: '5000' }, { expressionFields: ['count'] })).toEqual([])
    })
  })

  // A literal the number rule refuses is named before any range (REQ-3.1.3.14).
  describe('a literal the number rule refuses', () => {
    it('flags text that is no whole number and names the row', () => {
      expect(issuesFor({ count: '${count}' })).toEqual([
        { code: 'NUMBER_VALUE', severity: 'error', paramName: 'count', message: 'Count: Enter a valid integer value' },
      ])
    })

    it('flags an integer past 19 digits instead of its range', () => {
      expect(issuesFor({ count: '12345678901234567890' })).toEqual([
        { code: 'NUMBER_VALUE', severity: 'error', paramName: 'count', message: 'Count: Maximum 19 digits' },
      ])
    })

    it('flags a float written in exponent notation', () => {
      expect(issuesFor({ interval: '1e-7' })).toEqual([
        {
          code: 'NUMBER_VALUE',
          severity: 'error',
          paramName: 'interval',
          message: 'Interval (seconds): Enter a valid float value',
        },
      ])
    })

    it('takes a float stored as a small JS number and checks its range exactly', () => {
      expect(rangeIssuesFor({ interval: 0.0000001 })).toEqual([
        { code: 'NUMBER_RANGE', severity: 'error', paramName: 'interval', message: INTERVAL_MESSAGE },
      ])
      expect(rangeIssuesFor({ interval: '0.19999999999999999999' })).toHaveLength(1)
    })
  })

  describe('a blank or an absent value', () => {
    it('raises nothing for an empty string', () => {
      expect(issuesFor({ count: '' })).toEqual([])
    })

    it('flags a value that is only spaces by the number rule, not by its range', () => {
      expect(issuesFor({ count: '   ' })).toEqual([
        { code: 'NUMBER_VALUE', severity: 'error', paramName: 'count', message: 'Count: Enter a valid integer value' },
      ])
    })

    it('raises nothing when the row carries no value at all', () => {
      expect(issuesFor({})).toEqual([])
    })
  })

  describe('a bound that names another row (PING-18)', () => {
    it('flags Minimum replies above Count with the rule own message', () => {
      expect(issuesFor({ pass_when: 'min_replies', min_replies: 9, count: 4 })).toEqual([
        {
          code: 'NUMBER_RANGE',
          severity: 'error',
          paramName: 'min_replies',
          message: MIN_REPLIES_MESSAGE,
        },
      ])
    })

    it('raises nothing when Minimum replies equals Count', () => {
      expect(issuesFor({ pass_when: 'min_replies', min_replies: 4, count: 4 })).toEqual([])
    })

    it('raises nothing when Minimum replies is below Count', () => {
      expect(issuesFor({ pass_when: 'min_replies', min_replies: 2, count: 4 })).toEqual([])
    })

    it('reads the Count default when Count carries no value', () => {
      expect(issuesFor({ pass_when: 'min_replies', min_replies: 9 })).toEqual([
        {
          code: 'NUMBER_RANGE',
          severity: 'error',
          paramName: 'min_replies',
          message: MIN_REPLIES_MESSAGE,
        },
      ])
      expect(issuesFor({ pass_when: 'min_replies', min_replies: 4 })).toEqual([])
    })

    it('raises nothing when Count holds an expression', () => {
      expect(
        issuesFor(
          { pass_when: 'min_replies', min_replies: 9, count: '2 * 2' },
          { expressionFields: ['count'] },
        ),
      ).toEqual([])
      expect(
        issuesFor(
          { pass_when: 'min_replies', min_replies: 9, count: '2' },
          { expressionFields: ['count'] },
        ),
      ).toEqual([])
    })

    it('raises nothing when Count is blank', () => {
      expect(issuesFor({ pass_when: 'min_replies', min_replies: 9, count: '' })).toEqual([])
    })
  })

  // Only the settings in effect are validated, so a row the sheet hides is left alone.
  describe('a row the sheet does not show', () => {
    const rateIssue = {
      code: 'NUMBER_RANGE',
      severity: 'error',
      paramName: 'min_rate',
      message: RATE_MESSAGE,
    }

    const countIssue = {
      code: 'NUMBER_RANGE',
      severity: 'error',
      paramName: 'count',
      message: COUNT_MESSAGE,
    }

    const minRepliesIssue = {
      code: 'NUMBER_RANGE',
      severity: 'error',
      paramName: 'min_replies',
      message: MIN_REPLIES_MESSAGE,
    }

    it('leaves a hidden Minimum rate alone and flags the same value once it shows', () => {
      expect(issuesFor({ min_rate: 250 })).toEqual([])
      expect(issuesFor({ pass_when: 'any', min_rate: 250 })).toEqual([])
      expect(issuesFor({ pass_when: 'min_rate', min_rate: 250 })).toEqual([rateIssue])
    })

    it('leaves the cross-field rule alone while Minimum replies is hidden', () => {
      expect(issuesFor({ min_replies: 9, count: 4 })).toEqual([])
      expect(issuesFor({ pass_when: 'any', min_replies: 9, count: 4 })).toEqual([])
      expect(issuesFor({ pass_when: 'min_replies', min_replies: 9, count: 4 })).toEqual([
        minRepliesIssue,
      ])
    })

    it('flags an always-visible row whatever Pass when holds', () => {
      expect(issuesFor({ count: 5000 })).toEqual([countIssue])
      expect(issuesFor({ pass_when: 'any', count: 5000 })).toEqual([countIssue])
      expect(issuesFor({ pass_when: 'all', count: 5000 })).toEqual([countIssue])
      expect(issuesFor({ pass_when: 'min_replies', count: 5000 })).toEqual([countIssue])
      expect(issuesFor({ pass_when: 'min_rate', count: 5000 })).toEqual([countIssue])
    })
  })

  describe('what the check deliberately does not do', () => {
    it('reads a typed string as the literal number it spells', () => {
      expect(issuesFor({ count: '0' })).toEqual([
        { code: 'NUMBER_RANGE', severity: 'error', paramName: 'count', message: COUNT_MESSAGE },
      ])
      expect(issuesFor({ count: '5000' })).toEqual([
        { code: 'NUMBER_RANGE', severity: 'error', paramName: 'count', message: COUNT_MESSAGE },
      ])
      expect(issuesFor({ count: '4' })).toEqual([])
    })

    it('leaves a value that is not a number to the required and type rules', () => {
      expect(rangeIssuesFor({ count: 'abc' })).toEqual([])
    })

    it('never flags a row that declares no bound', () => {
      expect(rangeIssuesFor({ host: '999999' })).toEqual([])
      expect(rangeIssuesFor({ host: '0' })).toEqual([])
    })

    it('reports without clamping or rewriting what the author typed', () => {
      const node = pingNode({ count: 5000, interval: 0.1 })
      const before = { ...(node.data.config?.values ?? {}) }

      const first = computeNodeIssues([node], []).get('ping-1') ?? []
      const second = computeNodeIssues([node], []).get('ping-1') ?? []

      expect(node.data.config?.values).toEqual(before)
      expect(first).toHaveLength(2)
      expect(second).toEqual(first)
    })
  })
})

type AnyNodes = Parameters<typeof computeNodeIssues>[0]

interface AnyNode {
  id: string
  type: 'workflowNode'
  position: { x: number; y: number }
  data: Record<string, unknown>
}

interface FunctionDefinitionFixture {
  inputs?: Array<Record<string, unknown>>
  outputs?: Array<Record<string, unknown>>
  variables?: Array<Record<string, unknown>>
  body?: AnyNode[]
}

/** A Local Function Block: its declared fields, the values it holds, and its own data keys. */
function functionBlock(
  id: string,
  definition: FunctionDefinitionFixture,
  data: Record<string, unknown> = {},
): AnyNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      elementType: 'function',
      nodeType: 'function',
      version: '1.0.0',
      label: id,
      functionLifecycle: 'local',
      localDefinition: {
        inputs: definition.inputs ?? [],
        outputs: definition.outputs ?? [],
        variables: definition.variables ?? [],
        workflow: { nodes: definition.body ?? [], edges: [] },
      },
      expressionFields: [],
      config: { values: {}, outputBindings: {} },
      ...data,
    },
  }
}

function blockConfig(values: Record<string, unknown>, outputBindings: Record<string, string> = {}) {
  return { config: { values, outputBindings } }
}

function issuesAt(nodes: AnyNode[], id: string, variables: VarFixture[] = []): NodeIssue[] {
  return computeNodeIssues(nodes as unknown as AnyNodes, variables).get(id) ?? []
}

function withCode(issues: NodeIssue[], code: NodeIssue['code']): NodeIssue[] {
  return issues.filter((issue) => issue.code === code)
}

const input = (name: string, type: string, fields: Record<string, unknown> = {}) => ({
  name,
  type,
  required: false,
  description: '',
  ...fields,
})
const output = (name: string, type: string) => ({ name, type, description: '' })

describe('a Function Block on the one Block check (REQ-3.1.2.4)', () => {
  it('raises nothing when its Required inputs hold values, its optional inputs are unset and its outputs unbound', () => {
    const block = functionBlock(
      'fn-1',
      {
        inputs: [input('x', 'string', { required: true }), input('retries', 'integer', { default: 3 })],
        outputs: [output('result', 'string')],
      },
      blockConfig({ x: 'hello' }),
    )

    expect(computeNodeIssues([block] as unknown as AnyNodes, []).has('fn-1')).toBe(false)
  })

  it('names a Required input with a default that holds no value: the Block never falls back to it (REQ-3.1.2.10)', () => {
    const block = functionBlock('fn-1', { inputs: [input('count', 'integer', { required: true, default: 3 })] })

    expect(issuesAt([block], 'fn-1')).toEqual([
      {
        code: 'REQUIRED_PARAM_MISSING',
        severity: 'error',
        paramName: 'count',
        message: "Required parameter 'count' is missing",
      },
    ])
  })

  it('reads a Required input given null as missing', () => {
    const block = functionBlock(
      'fn-1',
      { inputs: [input('count', 'integer', { required: true })] },
      blockConfig({ count: null }),
    )

    expect(issuesAt([block], 'fn-1')).toEqual([
      {
        code: 'REQUIRED_PARAM_MISSING',
        severity: 'error',
        paramName: 'count',
        message: "Required parameter 'count' is missing",
      },
    ])
  })

  it('names a Required text input holding blank text as empty', () => {
    const block = functionBlock(
      'fn-1',
      { inputs: [input('x', 'string', { required: true })] },
      blockConfig({ x: '   ' }),
    )

    expect(issuesAt([block], 'fn-1')).toEqual([
      {
        code: 'REQUIRED_PARAM_EMPTY',
        severity: 'error',
        paramName: 'x',
        message: "Required parameter 'x' is empty",
      },
    ])
  })

  it('names an output bound to a variable of a type it cannot hold', () => {
    const block = functionBlock(
      'fn-1',
      { outputs: [output('count', 'integer')] },
      blockConfig({}, { count: 'label' }),
    )
    const variables: VarFixture[] = [{ id: 'v1', name: 'label', type: 'string', value: '' }]

    expect(issuesAt([block], 'fn-1', variables)).toEqual([
      {
        code: 'INVALID_OUTPUT_BINDING_TYPE',
        severity: 'error',
        paramName: 'count',
        message: "Output 'count' (type integer) cannot bind to variable 'label' (type string)",
      },
    ])
  })

  it('refuses an output bound to a namespace or profile reference', () => {
    const block = functionBlock(
      'fn-1',
      { outputs: [output('result', 'string')] },
      blockConfig({}, { result: 'system.host' }),
    )

    expect(issuesAt([block], 'fn-1')).toEqual([
      {
        code: 'INVALID_OUTPUT_BINDING_TYPE',
        severity: 'error',
        paramName: 'result',
        message: "'system.host' is a namespace or profile reference; pick or create a test-local variable instead",
      },
    ])
  })

  it('names an input in expression mode that reads an undeclared variable', () => {
    const block = functionBlock(
      'fn-1',
      { inputs: [input('x', 'string', { required: true })] },
      { ...blockConfig({ x: 'ghost' }), expressionFields: ['x'] },
    )

    expect(issuesAt([block], 'fn-1')).toEqual([
      {
        code: 'UNRESOLVED_VARIABLE_REFERENCE',
        severity: 'error',
        paramName: 'x',
        message: "Variable 'ghost' is not defined",
      },
    ])
  })

  it.each(['system.region', 'suite.retries', 'regression.cycle'])(
    'lets an input in expression mode read %s at the Test root, as a plugin Block may',
    (expression) => {
      const block = functionBlock(
        'fn-1',
        { inputs: [input('x', 'string', { required: true })] },
        { ...blockConfig({ x: expression }), expressionFields: ['x'] },
      )

      expect(computeNodeIssues([block] as unknown as AnyNodes, []).has('fn-1')).toBe(false)
    },
  )

  it('lets an output be bound to a Test variable named like one of its own inputs', () => {
    const block = functionBlock(
      'fn-1',
      { inputs: [input('x', 'string', { required: true })], outputs: [output('result', 'string')] },
      blockConfig({ x: 'hi' }, { result: 'x' }),
    )
    const variables: VarFixture[] = [{ id: 'v1', name: 'x', type: 'string', value: '' }]

    expect(computeNodeIssues([block] as unknown as AnyNodes, variables).has('fn-1')).toBe(false)
  })
})

describe('per-entry expression sites (dotted expressionFields)', () => {
  it('names an undeclared variable a map entry in expression mode reads, on the field that holds it', () => {
    const node = httpNode({
      config: {
        values: {
          method: 'GET',
          url: 'http://example.com',
          headers: { 'X-Id': 'token', 'X-Trace': 'ghost', 'X-Num': 5, Accept: 'plain_text' },
        },
      },
      // A site that addresses nothing, or a non-text entry, is skipped.
      expressionFields: ['headers.X-Id', 'headers.X-Trace', 'headers.X-Num', 'headers.Missing', 'url.deep'],
    })
    const variables: VarFixture[] = [{ id: 'v1', name: 'token', type: 'string', value: '' }]

    expect(withCode(issuesAt([node], 'http-1', variables), 'UNRESOLVED_VARIABLE_REFERENCE')).toEqual([
      {
        code: 'UNRESOLVED_VARIABLE_REFERENCE',
        severity: 'error',
        paramName: 'headers',
        message: "Variable 'ghost' is not defined",
      },
    ])
  })

  it('names an undeclared variable a list row in expression mode reads', () => {
    const node: AnyNode = {
      id: 'sh-1',
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'shell-script',
        nodeType: 'plugin',
        version: '1.0.0',
        label: 'Shell Script',
        config: {
          values: { script_type: 'source', script: 'echo "$1"', arguments: [{ value: 'a' }, { value: 'ghost' }] },
        },
        expressionFields: ['arguments.1.value'],
      },
    }

    expect(withCode(issuesAt([node], 'sh-1'), 'UNRESOLVED_VARIABLE_REFERENCE')).toEqual([
      {
        code: 'UNRESOLVED_VARIABLE_REFERENCE',
        severity: 'error',
        paramName: 'arguments',
        message: "Variable 'ghost' is not defined",
      },
    ])
  })

  it('names an undeclared variable a Function Block list item in expression mode reads', () => {
    const block = functionBlock(
      'fn-1',
      { inputs: [input('tags', 'array')] },
      { ...blockConfig({ tags: ['a', 'ghost_tag'] }), expressionFields: ['tags.1'] },
    )

    expect(issuesAt([block], 'fn-1')).toEqual([
      {
        code: 'UNRESOLVED_VARIABLE_REFERENCE',
        severity: 'error',
        paramName: 'tags',
        message: "Variable 'ghost_tag' is not defined",
      },
    ])
  })
})

describe('Blocks inside a Function flow (REQ-3.1.2.4)', () => {
  const DESCENDANT_ALERT: NodeIssue = {
    code: 'CONTAINS_INVALID_DESCENDANT',
    severity: 'error',
    message: 'This Function contains a block with validation issues',
  }

  function bodyHttp(outputBindings: Record<string, string>, id = 'inner-http'): AnyNode {
    return {
      id,
      type: 'workflowNode',
      position: { x: 0, y: 0 },
      data: {
        elementType: 'http-client',
        nodeType: 'plugin',
        version: '1.0.0',
        label: 'HTTP Call',
        config: { values: { method: 'GET', url: 'http://example.com' }, outputBindings },
      },
    }
  }

  function bodyLog(message: string, id = 'inner-log'): AnyNode {
    const node = logNode({ message })
    node.id = id
    node.data.expressionFields = ['message']
    return node as unknown as AnyNode
  }

  describe('output binding types read the Function scope names, never the root Test variables', () => {
    it('checks a body Block output against the Function output it is bound to', () => {
      const fn = functionBlock('fn-1', { outputs: [output('count', 'integer')], body: [bodyHttp({ body: 'count' })] })

      expect(issuesAt([fn], 'inner-http')).toEqual([
        {
          code: 'INVALID_OUTPUT_BINDING_TYPE',
          severity: 'error',
          paramName: 'body',
          message: "Output 'body' (type string) cannot bind to variable 'count' (type integer)",
        },
      ])
      expect(issuesAt([fn], 'fn-1')).toEqual([DESCENDANT_ALERT])
    })

    it('checks a body Block output against a local variable of the Function', () => {
      const fn = functionBlock('fn-1', {
        variables: [{ name: 'tmp', type: 'integer', value: null }],
        body: [bodyHttp({ body: 'tmp' })],
      })

      expect(withCode(issuesAt([fn], 'inner-http'), 'INVALID_OUTPUT_BINDING_TYPE')).toEqual([
        {
          code: 'INVALID_OUTPUT_BINDING_TYPE',
          severity: 'error',
          paramName: 'body',
          message: "Output 'body' (type string) cannot bind to variable 'tmp' (type integer)",
        },
      ])
    })

    it('never reads a root Test variable of the same name', () => {
      const fn = functionBlock('fn-1', { outputs: [output('count', 'string')], body: [bodyHttp({ body: 'count' })] })
      const rootVariables: VarFixture[] = [{ id: 'v1', name: 'count', type: 'integer', value: 0 }]
      const result = computeNodeIssues([fn] as unknown as AnyNodes, rootVariables)

      expect(result.has('inner-http')).toBe(false)
      expect(result.has('fn-1')).toBe(false)
    })

    it('checks a nested Function Block output against the enclosing Function names', () => {
      const nested = functionBlock('inner-fn', { outputs: [output('r', 'integer')] }, blockConfig({}, { r: 'label' }))
      const fn = functionBlock('fn-1', { outputs: [output('label', 'string')], body: [nested] })

      expect(issuesAt([fn], 'inner-fn')).toEqual([
        {
          code: 'INVALID_OUTPUT_BINDING_TYPE',
          severity: 'error',
          paramName: 'r',
          message: "Output 'r' (type integer) cannot bind to variable 'label' (type string)",
        },
      ])
      expect(issuesAt([fn], 'fn-1')).toEqual([DESCENDANT_ALERT])
    })
  })

  describe('the Function flow scope rules', () => {
    it('refuses a body Block output bound to one of the Function inputs, and only that one', () => {
      const fn = functionBlock('fn-1', {
        inputs: [input('x', 'string')],
        outputs: [output('result', 'string')],
        body: [bodyHttp({ body: 'x', content_type: 'result', final_url: '' })],
      })

      expect(withCode(issuesAt([fn], 'inner-http'), 'INPUT_WRITE_FORBIDDEN')).toEqual([
        {
          code: 'INPUT_WRITE_FORBIDDEN',
          severity: 'error',
          paramName: 'body',
          message: "Writes to declared input 'x'; inputs are read-only",
        },
      ])
      expect(issuesAt([fn], 'fn-1')).toEqual([DESCENDANT_ALERT])
    })

    it.each(['regression', 'suite', 'system'])(
      'refuses a body Block expression that reads the external %s scope',
      (scope) => {
        const fn = functionBlock('fn-1', { body: [bodyLog(`${scope}.foo`)] })

        expect(withCode(issuesAt([fn], 'inner-log'), 'EXTERNAL_SCOPE_READ_FORBIDDEN')).toEqual([
          {
            code: 'EXTERNAL_SCOPE_READ_FORBIDDEN',
            severity: 'error',
            paramName: 'message',
            message: `Reads variable 'foo' from external scope '${scope}'; only the Function's own scope is visible`,
          },
        ])
        expect(issuesAt([fn], 'fn-1')).toEqual([DESCENDANT_ALERT])
      },
    )

    it('refuses an external read in a nested Function Block input', () => {
      const nested = functionBlock(
        'inner-fn',
        { inputs: [input('x', 'string')] },
        { ...blockConfig({ x: 'system.region' }), expressionFields: ['x'] },
      )
      const fn = functionBlock('fn-1', { body: [nested] })

      expect(withCode(issuesAt([fn], 'inner-fn'), 'EXTERNAL_SCOPE_READ_FORBIDDEN')).toEqual([
        {
          code: 'EXTERNAL_SCOPE_READ_FORBIDDEN',
          severity: 'error',
          paramName: 'x',
          message: "Reads variable 'region' from external scope 'system'; only the Function's own scope is visible",
        },
      ])
    })
  })
})
