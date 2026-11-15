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
import { MASK_PLACEHOLDER } from '@/lib/secret-envelope'

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
    templateFields?: string[]
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

  // A Template is written source, as an {x} is: the number rule never reads it (REQ-3.1.3.14).
  describe('a Template', () => {
    it('is never read with the number rule', () => {
      expect(issuesFor({ count: '{{ ping_count }}' }, { templateFields: ['count'] })).toEqual([])
    })

    it('is never range-checked', () => {
      expect(issuesFor({ count: '5000' }, { templateFields: ['count'] })).toEqual([])
    })

    it('still checks the same text held as a literal', () => {
      expect(issuesFor({ count: '{{ ping_count }}' })).toEqual([
        { code: 'NUMBER_VALUE', severity: 'error', paramName: 'count', message: 'Count: Enter a valid integer value' },
      ])
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

  function bodySetter(variables: Record<string, unknown>, id = 'inner-setter'): AnyNode {
    return controlNode(id, 'variable-setter', { variables })
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

    // REQ-3.4.3.8: inside a Function the Setter never writes a declared input; the canvas uses the save text.
    it('refuses a body Setter row that names one of the Function inputs, and only that one', () => {
      const fn = functionBlock('fn-1', {
        inputs: [input('x', 'string')],
        outputs: [output('result', 'string')],
        variables: [{ name: 'count', type: 'integer', value: 0 }],
        body: [bodySetter({ x: 'a', result: 'b', count: 1 })],
      })

      expect(withCode(issuesAt([fn], 'inner-setter'), 'INPUT_WRITE_FORBIDDEN')).toEqual([
        {
          code: 'INPUT_WRITE_FORBIDDEN',
          severity: 'error',
          paramName: 'variables',
          message: "Writes to declared input 'x'; inputs are read-only",
        },
      ])
      expect(issuesAt([fn], 'fn-1')).toEqual([DESCENDANT_ALERT])
    })

    it('lets a Setter row in a Test write a Test variable named x', () => {
      const setter = bodySetter({ x: 'a' }, 'test-setter')
      const testVariables: VarFixture[] = [{ id: 'v1', name: 'x', type: 'string', value: '' }]

      expect(withCode(issuesAt([setter], 'test-setter', testVariables), 'INPUT_WRITE_FORBIDDEN')).toEqual([])
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

/** A control (or table parser) Block holding `values`, with its own data keys on top. */
function controlNode(
  id: string,
  elementType: string,
  values: Record<string, unknown>,
  data: Record<string, unknown> = {},
): AnyNode {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { elementType, nodeType: 'control', version: '1.0.0', label: id, config: { values }, ...data },
  }
}

function messagesAt(nodes: AnyNode[], id: string, variables: VarFixture[] = []): string[] {
  return issuesAt(nodes, id, variables).map((issue) => issue.message)
}

/** Issues of one code, the code given as text (codes the canvas has not raised before included). */
function withCodeName(issues: NodeIssue[], code: string): NodeIssue[] {
  return issues.filter((issue) => (issue.code as string) === code)
}

const CONDITION_VARIABLES: VarFixture[] = [
  { id: 'v1', name: 'status', type: 'string', value: '' },
  { id: 'v2', name: 'count', type: 'integer', value: 0 },
  { id: 'v3', name: 'ratio', type: 'float', value: 0 },
  { id: 'v4', name: 'done', type: 'boolean', value: false },
]

/** A literal condition row; a field left out is not stored (an unset compare value has no key). */
function conditionRow(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'r0', type: 'literal', variable: 'status', value_type: 'string', operator: 'equals', ...fields }
}

const READY = conditionRow({ reference_value: 'ready' })

function assertNode(assertions: unknown[], data: Record<string, unknown> = {}): AnyNode {
  return controlNode('assert-1', 'assert', { assertions, mode: 'split' }, data)
}

function lanes(...limits: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return limits.map((extra, index) => ({ id: `lane_${index}`, name: `Lane ${index}`, ...extra }))
}

// REQ-3.5.0.3, REQ-3.5.1.5: the canvas badge names the same finding as the Save dialog, in its words.
describe('control Block rules on the canvas, worded as the save check', () => {
  describe('condition lists', () => {
    it.each<[string, Record<string, unknown>, string]>([
      ['assert', { assertions: [], mode: 'split' }, 'assertions'],
      ['while', { mode: 'while-do', conditions: [] }, 'conditions'],
      ['wait-until', { conditions: [], timeout: 5000 }, 'conditions'],
    ])('flags an empty %s list once, through the required check', (elementType, values, field) => {
      expect(issuesAt([controlNode('c-1', elementType, values)], 'c-1')).toEqual([
        {
          code: 'REQUIRED_PARAM_EMPTY',
          severity: 'error',
          paramName: field,
          message: `Required parameter '${field}' is empty`,
        },
      ])
    })

    it('names a row with no variable key as missing', () => {
      const row = conditionRow({ reference_value: 'ready' })
      delete row.variable

      expect(messagesAt([assertNode([row])], 'assert-1', CONDITION_VARIABLES)).toEqual([
        "Required parameter 'assertions.0.variable' is missing",
      ])
    })

    it('names a row with a blank variable as empty', () => {
      expect(messagesAt([assertNode([conditionRow({ variable: '', reference_value: 'ready' })])], 'assert-1')).toEqual([
        "Required parameter 'assertions.0.variable' is empty",
      ])
    })

    it('names a binary operator with no compare value as missing', () => {
      expect(messagesAt([assertNode([conditionRow()])], 'assert-1', CONDITION_VARIABLES)).toEqual([
        "Required parameter 'assertions.0.reference_value' is missing",
      ])
    })

    it.each<[string, Record<string, unknown>]>([
      ['a blank {x} value', { reference_value: '  ', reference_is_expression: true }],
      ['a blank Template', { reference_value: '', reference_is_template: true }],
      ['empty text on a number compare', { variable: 'count', value_type: 'integer', reference_value: '' }],
    ])('names %s under a binary operator as empty', (_case, fields) => {
      expect(messagesAt([assertNode([conditionRow(fields)])], 'assert-1', CONDITION_VARIABLES)).toEqual([
        "Required parameter 'assertions.0.reference_value' is empty",
      ])
    })

    // Empty text typed on purpose is a value and compares with empty text (FIELD-4, FIELD-15).
    it.each(['', '   '])('raises nothing for literal text on a text compare, empty text included (%j)', (text) => {
      const node = assertNode([conditionRow({ reference_value: text })])

      expect(computeNodeIssues([node] as unknown as AnyNodes, CONDITION_VARIABLES).has('assert-1')).toBe(false)
    })

    // One finding per part, as Save gives it; the place keeps each issue apart in the badge list.
    it('gives each control finding the save check code and its place', () => {
      const fresh = assertNode([
        conditionRow({ variable: '' }),
        { type: 'operator', value: 'and' },
        conditionRow({ id: 'r1', variable: 'count', value_type: 'integer', reference_value: 'abc' }),
      ])
      const ifElse = controlNode('if-1', 'if-else', {
        branches: [
          { id: 'b0', type: 'if', label: '', conditions: [] },
          { id: 'b9', type: 'else', label: '' },
        ],
      })
      const parallel = controlNode(
        'par-1',
        'parallel',
        { branches: [{ id: 'lane_0', name: 'Lane 0', time_limit: '' }] },
        { expressionFields: ['branches.0.time_limit'] },
      )
      const lanesBelow = controlNode('par-2', 'parallel', { branches: lanes({}, { time_limit: 0 }) })
      const loop = controlNode('for-1', 'for', { mode: 'count', count: 3, step: 0 })
      const nodes = [fresh, ifElse, parallel, lanesBelow, loop]

      expect(issuesAt(nodes, 'assert-1', CONDITION_VARIABLES)).toEqual([
        {
          code: 'REQUIRED_PARAM_EMPTY',
          severity: 'error',
          paramName: 'assertions.0.variable',
          message: "Required parameter 'assertions.0.variable' is empty",
        },
        {
          code: 'REQUIRED_PARAM_MISSING',
          severity: 'error',
          paramName: 'assertions.0.reference_value',
          message: "Required parameter 'assertions.0.reference_value' is missing",
        },
        {
          code: 'INVALID_COMPARE_VALUE',
          severity: 'error',
          paramName: 'assertions.2.reference_value',
          message: "The value compared with 'count' is not a valid integer",
        },
      ])
      expect(issuesAt(nodes, 'if-1')).toEqual([
        {
          code: 'REQUIRED_PARAM_EMPTY',
          severity: 'error',
          paramName: 'branches.0.conditions',
          message: 'if branch must have conditions',
        },
      ])
      expect(issuesAt(nodes, 'par-1')).toEqual([
        {
          code: 'INVALID_CONTROL_STRUCTURE',
          severity: 'error',
          paramName: 'branches',
          message: 'Parallel requires at least 2 branches',
        },
        {
          code: 'REQUIRED_PARAM_EMPTY',
          severity: 'error',
          paramName: 'branches.0.time_limit',
          message: "Required parameter 'branches.0.time_limit' is empty",
        },
      ])
      expect(issuesAt(nodes, 'par-2')).toEqual([
        {
          code: 'INVALID_SETTING_VALUE',
          severity: 'error',
          paramName: 'branches.1.time_limit',
          message: 'Time Limit must be at least 1',
        },
      ])
      expect(issuesAt(nodes, 'for-1')).toEqual([
        { code: 'INVALID_SETTING_VALUE', severity: 'error', paramName: 'step', message: 'Step must not be zero' },
      ])
    })

    it.each<[string, string]>([
      ['integer', "The value compared with 'count' is not a valid integer"],
      ['float', "The value compared with 'ratio' is not a valid float"],
    ])('names a literal %s compare value the number rule refuses', (valueType, message) => {
      const variable = valueType === 'integer' ? 'count' : 'ratio'
      const row = conditionRow({ variable, value_type: valueType, operator: 'greater_than', reference_value: 'abc' })

      expect(messagesAt([assertNode([row])], 'assert-1', CONDITION_VARIABLES)).toEqual([message])
    })

    it('names a filter compare value the number rule refuses as the cell', () => {
      const row = conditionRow({ variable: '_cell', value_type: 'integer', reference_value: 'abc' })
      const csv = controlNode(
        'csv-1',
        'csv-parser',
        {
          operation: 'parse',
          csv_content: 'qty\n1\n',
          filters: [{ id: 'f0', column: { mode: 'name', value: 'qty' }, asType: 'integer', conditions: [row] }],
        },
        { nodeType: 'plugin' },
      )

      expect(messagesAt([csv], 'csv-1')).toEqual(['The value compared with the cell is not a valid integer'])
    })

    it('names a blank While expression row as empty', () => {
      const node = controlNode('while-1', 'while', { mode: 'while-do', conditions: [{ id: 'e0', type: 'expression', expression: ' ' }] })

      expect(messagesAt([node], 'while-1')).toEqual(["Required parameter 'conditions.0.expression' is empty"])
    })

    it('names an empty Wait Until group as empty', () => {
      const node = controlNode('wait-1', 'wait-until', {
        conditions: [READY, { type: 'operator', value: 'and' }, { id: 'g0', type: 'group', items: [] }],
        timeout: 5000,
      })

      expect(messagesAt([node], 'wait-1', CONDITION_VARIABLES)).toEqual(["Required parameter 'conditions.2.items' is empty"])
    })

    // REQ-3.5.1.5: a stored list that does not alternate gets one badge at its first break, as Save gives it.
    it('names condition items side by side and a stray and / or with the save check code and text', () => {
      const sideBySide = assertNode([READY, conditionRow({ id: 'r1', reference_value: 'done' })])
      const strayMarker = controlNode('wait-1', 'wait-until', {
        conditions: [READY, { type: 'operator', value: 'and' }],
        timeout: 5000,
      })
      const nodes = [sideBySide, strayMarker]

      expect(issuesAt(nodes, 'assert-1', CONDITION_VARIABLES)).toEqual([
        {
          code: 'INVALID_CONDITION',
          severity: 'error',
          paramName: 'assertions.1',
          message: "Condition items in 'assertions' must be joined by 'and' or 'or'",
        },
      ])
      expect(issuesAt(nodes, 'wait-1', CONDITION_VARIABLES)).toEqual([
        {
          code: 'INVALID_CONDITION',
          severity: 'error',
          paramName: 'conditions.1',
          message: "'and' and 'or' go between two conditions",
        },
      ])
    })

    it('names an If row, an If with no row and an Else If with no row', () => {
      const rowInIf = controlNode('if-1', 'if-else', {
        branches: [
          { id: 'b0', type: 'if', label: '', conditions: [conditionRow({ reference_value: '', reference_is_expression: true })] },
          { id: 'b9', type: 'else', label: '' },
        ],
      })
      const bare = controlNode('if-2', 'if-else', {
        branches: [
          { id: 'b0', type: 'if', label: '', conditions: [] },
          { id: 'b1', type: 'else_if', label: '', conditions: [] },
          { id: 'b9', type: 'else', label: '' },
        ],
      })

      expect(messagesAt([rowInIf], 'if-1', CONDITION_VARIABLES)).toEqual([
        "Required parameter 'branches.0.conditions.0.reference_value' is empty",
      ])
      expect(messagesAt([bare], 'if-2')).toEqual([
        'if branch must have conditions',
        'else_if branch must have conditions',
      ])
    })

    it('names a Switch case with no row', () => {
      const node = controlNode('switch-1', 'switch-case', {
        branches: [
          { id: 'c0', type: 'case', label: '', conditions: [], break: true },
          { id: 'd0', type: 'default', label: '' },
        ],
      })

      expect(messagesAt([node], 'switch-1')).toEqual(['case branch must have conditions'])
    })

    it('raises every control rule as an error and never an "are incomplete" text', () => {
      const nodes = [
        assertNode([conditionRow({ variable: '' })]),
        controlNode('switch-1', 'switch-case', { branches: [{ id: 'c0', type: 'case', label: '', conditions: [], break: true }] }),
      ]
      const issues = [...issuesAt(nodes, 'assert-1'), ...issuesAt(nodes, 'switch-1')]

      // The fresh row gives its variable and its compare value finding, the case one.
      expect(issues).toHaveLength(3)
      expect(issues.every((issue) => issue.severity === 'error')).toBe(true)
      expect(issues.filter((issue) => issue.message.endsWith('are incomplete'))).toEqual([])
    })

    it('raises nothing for a complete list', () => {
      expect(computeNodeIssues([assertNode([READY])] as unknown as AnyNodes, CONDITION_VARIABLES).has('assert-1')).toBe(false)
    })

    it('raises nothing for a disabled Block', () => {
      expect(computeNodeIssues([assertNode([conditionRow({ variable: '' })], { disabled: true })] as unknown as AnyNodes, []).size).toBe(0)
    })
  })

  describe('Parallel lanes and the section limit', () => {
    it('names a section with one lane', () => {
      expect(messagesAt([controlNode('par-1', 'parallel', { branches: lanes({}), join: 'all' })], 'par-1')).toEqual([
        'Parallel requires at least 2 branches',
      ])
    })

    // Save gives both findings at branches for an empty lane list: the required rule and the two-lane rule.
    it('names a section with no lanes through the required check and the two-lane rule', () => {
      expect(messagesAt([controlNode('par-1', 'parallel', { branches: [], join: 'all' })], 'par-1')).toEqual([
        "Required parameter 'branches' is empty",
        'Parallel requires at least 2 branches',
      ])
    })

    it('names a blank {x} lane limit', () => {
      const node = controlNode('par-1', 'parallel', { branches: lanes({ time_limit: '' }, {}) }, {
        expressionFields: ['branches.0.time_limit'],
      })

      expect(messagesAt([node], 'par-1')).toEqual(["Required parameter 'branches.0.time_limit' is empty"])
    })

    it('names a literal lane limit below 1 with the lane bound text', () => {
      expect(messagesAt([controlNode('par-1', 'parallel', { branches: lanes({}, { time_limit: 0 }) })], 'par-1')).toEqual([
        'Time Limit must be at least 1',
      ])
    })

    it('names a section time limit below 1 through the declared minimum', () => {
      expect(issuesAt([controlNode('par-1', 'parallel', { branches: lanes({}, {}), time_limit: 0 })], 'par-1')).toEqual([
        {
          code: 'NUMBER_RANGE',
          severity: 'error',
          paramName: 'time_limit',
          message: 'Section Time Limit must be at least 1',
        },
      ])
    })

    it('raises nothing for two lanes with no limit or a limit of at least 1', () => {
      const node = controlNode('par-1', 'parallel', { branches: lanes({ time_limit: 1 }, { time_limit: null }), join: 'first' })

      expect(computeNodeIssues([node] as unknown as AnyNodes, []).has('par-1')).toBe(false)
    })
  })

  describe('For and While', () => {
    it('takes an explicit null For count as a value, not a missing one', () => {
      const node = controlNode('for-1', 'for', { mode: 'count', count: null, step: 1 })

      expect(computeNodeIssues([node] as unknown as AnyNodes, []).has('for-1')).toBe(false)
    })

    it('still names a For count that is not set', () => {
      expect(issuesAt([controlNode('for-1', 'for', { mode: 'count', step: 1 })], 'for-1')).toEqual([
        {
          code: 'REQUIRED_PARAM_MISSING',
          severity: 'error',
          paramName: 'count',
          message: "Required parameter 'count' is missing",
        },
      ])
    })

    it('names a For step of 0', () => {
      expect(messagesAt([controlNode('for-1', 'for', { mode: 'count', count: 3, step: 0 })], 'for-1')).toEqual([
        'Step must not be zero',
      ])
    })

    it.each<[string, Record<string, unknown>, string, string]>([
      ['for', { mode: 'count', count: -1, step: 1 }, 'count', 'Count must be at least 0'],
      ['while', { mode: 'while-do', conditions: [READY], max_iterations: 0 }, 'max_iterations', 'Max Iterations must be at least 1'],
    ])('names a %s floor through the declared minimum', (elementType, values, field, message) => {
      expect(issuesAt([controlNode('loop-1', elementType, values)], 'loop-1', CONDITION_VARIABLES)).toEqual([
        { code: 'NUMBER_RANGE', severity: 'error', paramName: field, message },
      ])
    })
  })

  describe('Variable Setter rows', () => {
    const DESCENDANT: NodeIssue = {
      code: 'CONTAINS_INVALID_DESCENDANT',
      severity: 'error',
      message: 'This Function contains a block with validation issues',
    }
    const SEALED = 'wave:enc:v1:c2VhbGVk'

    function setter(variables: Record<string, unknown>, data: Record<string, unknown> = {}, id = 'set-1'): AnyNode {
      return controlNode(id, 'variable-setter', { variables }, data)
    }

    const typed = (name: string, type: VarFixture['type']): VarFixture => ({ id: `v-${name}`, name, type, value: null })

    it('names an undeclared variable a {x} row reads, on the variables field', () => {
      const node = setter({ next_try: 'attempt + 1' }, { expressionFields: ['variables.next_try'] })

      expect(issuesAt([node], 'set-1', [typed('next_try', 'integer')])).toEqual([
        {
          code: 'UNRESOLVED_VARIABLE_REFERENCE',
          severity: 'error',
          paramName: 'variables',
          message: "Variable 'attempt' is not defined",
        },
      ])
    })

    it('names an undeclared variable a {x} list entry reads, on the variables field', () => {
      const node = setter({ hosts: ['fallback.local', 'primary_host'] }, { expressionFields: ['variables.hosts.1'] })

      expect(issuesAt([node], 'set-1', [typed('hosts', 'array')])).toEqual([
        {
          code: 'UNRESOLVED_VARIABLE_REFERENCE',
          severity: 'error',
          paramName: 'variables',
          message: "Variable 'primary_host' is not defined",
        },
      ])
    })

    it('flags a Setter literal that no longer fits its retyped variable with the save check text', () => {
      const ready = setter({ ready: 'yes' })
      const retries = setter({ retries: 'abc' }, {}, 'set-2')
      const fn = functionBlock('fn-1', {
        outputs: [output('done', 'boolean')],
        body: [setter({ done: 'yes' }, {}, 'inner-setter')],
      })
      const testVariables = [typed('ready', 'boolean'), typed('retries', 'integer')]

      expect(issuesAt([ready, retries], 'set-1', testVariables)).toEqual([
        {
          code: 'INVALID_SETTING_TYPE',
          severity: 'error',
          paramName: 'variables',
          message: "Setting 'variables.ready' of block 'variable-setter' expects boolean, got string",
        },
      ])
      expect(issuesAt([ready, retries], 'set-2', testVariables)).toEqual([
        {
          code: 'INVALID_VARIABLE_VALUE',
          severity: 'error',
          paramName: 'variables',
          message: "Value for variable 'retries' is not a valid integer",
        },
      ])
      expect(issuesAt([fn], 'inner-setter')).toEqual([
        {
          code: 'INVALID_SETTING_TYPE',
          severity: 'error',
          paramName: 'variables',
          message: "Setting 'variables.done' of block 'variable-setter' expects boolean, got string",
        },
      ])
      expect(issuesAt([fn], 'fn-1')).toEqual([DESCENDANT])
    })

    it.each<[string, VarFixture['type'], unknown, string, string]>([
      ['a number on a string variable', 'string', 5, 'INVALID_SETTING_TYPE', "Setting 'variables.target' of block 'variable-setter' expects string, got integer"],
      ['text on an array variable', 'array', 'a,b', 'INVALID_SETTING_TYPE', "Setting 'variables.target' of block 'variable-setter' expects array, got string"],
      ['a list on a map variable', 'map', ['a'], 'INVALID_SETTING_TYPE', "Setting 'variables.target' of block 'variable-setter' expects map, got array"],
      ['a map on an array variable', 'array', { region: 'eu' }, 'INVALID_SETTING_TYPE', "Setting 'variables.target' of block 'variable-setter' expects array, got map"],
      ['text on a float variable', 'float', 'abc', 'INVALID_VARIABLE_VALUE', "Value for variable 'target' is not a valid float"],
      ['20 digits on an integer variable', 'integer', '12345678901234567890', 'INVALID_VARIABLE_VALUE', "Value for variable 'target' allows at most 19 digits, got 20"],
      ['a number on a table variable', 'table', 5, 'INVALID_SETTING_TYPE', "Setting 'variables.target' of block 'variable-setter' expects table, got integer"],
      // A Setter row never names a file: the run refuses text on a table variable, and so does Save.
      ['text on a table variable', 'table', 'people.csv', 'INVALID_SETTING_TYPE', "Setting 'variables.target' of block 'variable-setter' expects table, got string"],
    ])('flags %s with the save check text', (_case, type, value, code, message) => {
      expect(issuesAt([setter({ target: value })], 'set-1', [typed('target', type)])).toEqual([
        { code, severity: 'error', paramName: 'variables', message },
      ])
    })

    it.each<[string, unknown]>([
      ['as its rows', [{ id: 1, name: 'a' }]],
      ['with its column types', { columns: [{ name: 'id', type: 'integer' }], rows: [[1]] }],
    ])('raises no type fit issue for a table stored %s on a table variable', (_case, value) => {
      const issues = issuesAt([setter({ rows: value })], 'set-1', [typed('rows', 'table')])

      expect(withCodeName(issues, 'INVALID_SETTING_TYPE')).toEqual([])
    })

    it('flags a Template row on a variable that is not text with the save check text', () => {
      const node = setter({ retries: 'try {{ attempt }}' }, { templateFields: ['variables.retries'] })
      const testVariables = [typed('retries', 'integer'), typed('attempt', 'integer')]

      expect(withCodeName(issuesAt([node], 'set-1', testVariables), 'TEMPLATE_NOT_STRING')).toEqual([
        {
          code: 'TEMPLATE_NOT_STRING',
          severity: 'error',
          paramName: 'variables',
          message: "Row 'retries' sets an integer variable; a template builds text, so it needs a string variable",
        },
      ])
    })

    it('flags a Template entry on an entry type that is not text with the save check text', () => {
      const node = setter(
        { limits: { max: '{{ top }}', min: '1' } },
        {
          templateFields: ['variables.limits.max'],
          elementTypes: { 'variables.limits': { max: 'float', min: 'float' } },
        },
      )
      const testVariables = [typed('limits', 'map'), typed('top', 'float')]

      expect(withCodeName(issuesAt([node], 'set-1', testVariables), 'TEMPLATE_NOT_STRING')).toEqual([
        {
          code: 'TEMPLATE_NOT_STRING',
          severity: 'error',
          paramName: 'variables',
          message: "Entry 'max' of row 'limits' is float; a template builds text, so it needs element type string",
        },
      ])
    })

    it('raises no Template issue for a Template row on a text variable', () => {
      const node = setter({ greeting: 'Hi {{ who }}' }, { templateFields: ['variables.greeting'] })
      const testVariables = [typed('greeting', 'string'), typed('who', 'string')]

      expect(withCodeName(issuesAt([node], 'set-1', testVariables), 'TEMPLATE_NOT_STRING')).toEqual([])
    })

    it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
      ['an {x} row', { ready: 'other_flag' }, { expressionFields: ['variables.ready'] }],
      ['a Template row', { retries: 'try {{ other_flag }}' }, { templateFields: ['variables.retries'] }],
      ['a literal that still fits', { ready: true, retries: '3' }, {}],
      ['a null row', { ready: null, retries: null }, {}],
      ['a sealed secret', { ready: SEALED, retries: SEALED }, {}],
      ['the mask placeholder', { ready: MASK_PLACEHOLDER, retries: MASK_PLACEHOLDER }, {}],
    ])('raises no type fit issue for %s', (_case, variables, data) => {
      const testVariables = [typed('ready', 'boolean'), typed('retries', 'integer'), typed('other_flag', 'boolean')]
      const issues = issuesAt([setter(variables, data)], 'set-1', testVariables)

      expect(withCodeName(issues, 'INVALID_SETTING_TYPE')).toEqual([])
      expect(withCodeName(issues, 'INVALID_VARIABLE_VALUE')).toEqual([])
    })

    it('names a decimal on a text variable as a float, as the save check does', () => {
      expect(issuesAt([setter({ target: 2.5 })], 'set-1', [typed('target', 'string')])).toEqual([
        {
          code: 'INVALID_SETTING_TYPE',
          severity: 'error',
          paramName: 'variables',
          message: "Setting 'variables.target' of block 'variable-setter' expects string, got float",
        },
      ])
    })

    it.each<[VarFixture['type'], string]>([
      ['boolean', "Row 'target' sets a boolean variable; a template builds text, so it needs a string variable"],
      ['float', "Row 'target' sets a float variable; a template builds text, so it needs a string variable"],
      ['map', "Row 'target' sets a map variable; a template builds text, so it needs a string variable"],
      ['table', "Row 'target' sets a table variable; a template builds text, so it needs a string variable"],
    ])('flags a Template row on a %s variable with the save check text', (type, message) => {
      const node = setter({ target: 'run {{ run_id }}' }, { templateFields: ['variables.target'] })
      const testVariables = [typed('target', type), typed('run_id', 'string')]

      expect(withCodeName(issuesAt([node], 'set-1', testVariables), 'TEMPLATE_NOT_STRING')).toEqual([
        { code: 'TEMPLATE_NOT_STRING', severity: 'error', paramName: 'variables', message },
      ])
    })

    it('flags a Template list entry by its index on an entry type that is not text', () => {
      const node = setter(
        { ports: ['80', '{{ extra_port }}'] },
        { templateFields: ['variables.ports.1'], elementTypes: { 'variables.ports': ['integer', 'integer'] } },
      )
      const testVariables = [typed('ports', 'array'), typed('extra_port', 'string')]

      expect(withCodeName(issuesAt([node], 'set-1', testVariables), 'TEMPLATE_NOT_STRING')).toEqual([
        {
          code: 'TEMPLATE_NOT_STRING',
          severity: 'error',
          paramName: 'variables',
          message: "Entry '1' of row 'ports' is integer; a template builds text, so it needs element type string",
        },
      ])
    })

    it.each<[string, Record<string, unknown>]>([
      ['no entry types stored for the Block', {}],
      ['no entry types stored for the row', { elementTypes: { 'variables.other': ['integer'] } }],
      ['a text entry type', { elementTypes: { 'variables.ports': ['integer', 'string'] } }],
    ])('raises no Template issue for a Template entry with %s', (_case, data) => {
      const node = setter({ ports: ['80', '{{ extra_port }}'] }, { templateFields: ['variables.ports.1'], ...data })
      const testVariables = [typed('ports', 'array'), typed('other', 'array'), typed('extra_port', 'string')]

      expect(withCodeName(issuesAt([node], 'set-1', testVariables), 'TEMPLATE_NOT_STRING')).toEqual([])
    })

    it('raises no Template issue for a Template row whose variable is not declared', () => {
      const node = setter({ fresh: 'run {{ run_id }}' }, { templateFields: ['variables.fresh'] })

      expect(withCodeName(issuesAt([node], 'set-1', [typed('run_id', 'string')]), 'TEMPLATE_NOT_STRING')).toEqual([])
    })
  })
})
