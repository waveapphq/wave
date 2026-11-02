/**
 * HistoryVariableManager tests
 *
 * Covers the `buildVariablesFromDefinitions` + `buildRuntimeValuesMap`
 * transforms (type inference, expression / secret carry-through, sort
 * order, fallback when the source test was deleted) and the thin React
 * wrapper that renders `VariableManagerContent` in
 * read-only mode for snapshot inspection. History keeps
 * the panel readOnly: pencil + trash are rendered but disabled; the eye
 * stays usable as a view-toggle so a reviewer can flip between the test's
 * declared definition and the actual evaluated outcome.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  buildRuntimeValuesMap,
  buildVariablesFromDefinitions,
  HistoryVariableManager,
} from '@/features/workbench/history/variable-manager'
import { ThemeProvider } from '@/design-system/theme-provider'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'
import type { HistoricalCanvasVariableDefinition } from '@/features/executions/api/types'

describe('buildVariablesFromDefinitions', () => {
  it('uses the test definition (type / value / flags) when present', () => {
    const defs: Record<string, HistoricalCanvasVariableDefinition> = {
      counter: { type: 'integer', value: 0 },
      api_url: { type: 'string', value: "'https://api.test/x'", isExpression: true },
      password: { type: 'string', value: '********', secret: true },
    }
    const result = buildVariablesFromDefinitions(defs, {})
    const byName = (name: string) => result.find((v: Variable) => v.name === name)!

    expect(byName('counter').type).toBe('integer')
    expect(byName('counter').value).toBe(0)
    expect(byName('counter').isExpression).toBeUndefined()
    expect(byName('api_url').isExpression).toBe(true)
    expect(byName('api_url').value).toBe("'https://api.test/x'")
    expect(byName('password').isSecret).toBe(true)
  })

  it('infers type from the definition value when the declared type is unknown', () => {
    const defs: Record<string, HistoricalCanvasVariableDefinition> = {
      mystery: { type: 'unknown', value: [1, 2, 3] },
    }
    const result = buildVariablesFromDefinitions(defs, {})
    expect(result[0].type).toBe('array')
  })

  it('falls back to the runtime snapshot when the test was deleted (no definitions)', () => {
    // Test entity gone -> BE returns variable_definitions={}. The panel
    // still has to render something, so we rebuild Variable[] from the
    // runtime values and infer types from each value.
    const result = buildVariablesFromDefinitions(
      {},
      {
        str: 'hello',
        bool_true: true,
        bool_false: false,
        int_value: 42,
        float_value: 3.14,
        list: [1, 2, 3],
        obj: { a: 1 },
        password: '********',
        n: null,
      },
    )
    const byName = (name: string) => result.find((v: Variable) => v.name === name)!

    expect(byName('str').type).toBe('string')
    expect(byName('bool_true').type).toBe('boolean')
    expect(byName('bool_false').type).toBe('boolean')
    expect(byName('int_value').type).toBe('integer')
    expect(byName('float_value').type).toBe('float')
    expect(byName('list').type).toBe('array')
    expect(byName('obj').type).toBe('map')
    expect(byName('n').type).toBe('string')
    expect(byName('password').isSecret).toBe(true)
    expect(byName('str').isSecret).toBeUndefined()
  })

  it('sorts the output alphabetically by name', () => {
    const result = buildVariablesFromDefinitions(
      {
        banana: { type: 'integer', value: 1 },
        apple: { type: 'integer', value: 2 },
        cherry: { type: 'integer', value: 3 },
      },
      {},
    )
    expect(result.map((v: Variable) => v.name)).toEqual(['apple', 'banana', 'cherry'])
  })

  it('uses the variable name as the id', () => {
    const result = buildVariablesFromDefinitions(
      { x: { type: 'integer', value: 42 } },
      {},
    )
    expect(result[0].id).toBe('x')
    expect(result[0].name).toBe('x')
  })

  it('returns empty array when both definitions and runtime fallback are empty', () => {
    expect(buildVariablesFromDefinitions({}, {})).toEqual([])
  })
})

describe('buildRuntimeValuesMap', () => {
  it('returns the snapshot values keyed by variable name', () => {
    const map = buildRuntimeValuesMap({ counter: 5, items: [1, 2] })
    expect(map.size).toBe(2)
    expect(map.get('counter')).toBe(5)
    expect(map.get('items')).toEqual([1, 2])
  })

  it('drops masked secret entries (the row already renders ********)', () => {
    const map = buildRuntimeValuesMap({ counter: 5, password: '********' })
    expect(map.size).toBe(1)
    expect(map.has('password')).toBe(false)
  })

  it('returns an empty map for an empty snapshot', () => {
    expect(buildRuntimeValuesMap({}).size).toBe(0)
  })
})

function renderManager(
  variables: Variable[] = [],
  runtimeValues: Map<string, unknown> = new Map(),
  collapsed = false,
) {
  return render(
    <ThemeProvider>
      <>
        <HistoryVariableManager
          variables={variables}
          runtimeValues={runtimeValues}
          collapsed={collapsed}
          onCollapsedChange={() => {}}
        />
      </>
    </ThemeProvider>,
  )
}

describe('HistoryVariableManager', () => {
  it('renders the shared VariableManagerPanel wrapper', () => {
    renderManager()
    expect(screen.getByTestId('variable-manager')).toBeInTheDocument()
  })

  it('renders the expanded variable-manager content when not collapsed', () => {
    renderManager([
      { id: 'x', name: 'x', value: 1, type: 'integer' },
    ])
    expect(screen.getByTestId('variable-manager-content')).toBeInTheDocument()
  })

  it('renders the variable names inside the content', () => {
    renderManager([
      { id: 'x', name: 'x', value: 1, type: 'integer' },
      { id: 'y', name: 'y', value: 'hello', type: 'string' },
    ])
    expect(screen.getByText('x')).toBeInTheDocument()
    expect(screen.getByText('y')).toBeInTheDocument()
  })

  it('does not render the Add button', () => {
    renderManager([{ id: 'x', name: 'x', value: 1, type: 'integer' }])
    expect(screen.queryByTestId('add-variable-button')).not.toBeInTheDocument()
  })

  it('renders the per-row Edit pencil but disables it (readOnly)', () => {
    renderManager([{ id: 'x', name: 'x', value: 1, type: 'integer' }])
    const edit = screen.getByTestId('edit-button-x')
    expect(edit).toBeInTheDocument()
    expect(edit).toHaveAttribute('aria-disabled', 'true')
  })

  it('renders the per-row Delete trash but disables it (readOnly)', () => {
    renderManager([{ id: 'x', name: 'x', value: 1, type: 'integer' }])
    const del = screen.getByTestId('delete-button-x')
    expect(del).toBeInTheDocument()
    expect(del).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps the eye toggle usable on snapshot rows', async () => {
    const user = userEvent.setup()
    renderManager([{ id: 'x', name: 'x', value: 1, type: 'integer' }])

    const eye = screen.getByTestId('view-toggle-button-x')
    expect(eye).toBeInTheDocument()
    expect(eye).not.toHaveAttribute('aria-disabled', 'true')

    // Click should not throw; toggle state is internal to the panel.
    await user.click(eye)
  })

  it('eye toggle flips between definition and runtime values in history mode', async () => {
    // variable.value is the test's declared initial and the runtime overlay lives
    // in the runtimeValues map - the toggle flips between the two.
    const user = userEvent.setup()
    const variables: Variable[] = [
      { id: 'counter', name: 'counter', value: 0, type: 'integer' },
    ]
    const runtime = new Map<string, unknown>([['counter', 5]])
    renderManager(variables, runtime)

    const value = screen.getByTestId('variable-value-counter')

    // Default (eye-ON): runtime view shows the snapshot's evaluated outcome.
    expect(value.textContent).toContain('5')

    // Eye-OFF: definition view shows the test's declared initial.
    await user.click(screen.getByTestId('view-toggle-button-counter'))
    expect(value.textContent).toContain('0')
    expect(value.className).toMatch(/italic/)

    // Eye-ON again: back to the snapshot value.
    await user.click(screen.getByTestId('view-toggle-button-counter'))
    expect(value.textContent).toContain('5')
  })

  it('eye toggle flips between expression source and evaluated runtime value', async () => {
    const user = userEvent.setup()
    const variables: Variable[] = [
      {
        id: 'computed',
        name: 'computed',
        value: 'counter + 10',
        type: 'integer',
        isExpression: true,
      },
    ]
    const runtime = new Map<string, unknown>([['computed', 15]])
    renderManager(variables, runtime)

    const value = screen.getByTestId('variable-value-computed')

    // Default (eye-ON): evaluated runtime value.
    expect(value.textContent).toContain('15')

    // Eye-OFF: the expression source the test declared.
    await user.click(screen.getByTestId('view-toggle-button-computed'))
    expect(value.textContent).toContain('counter + 10')
  })

  it('masks secrets by rendering "********" and the SECRET flag badge', () => {
    renderManager([
      { id: 'password', name: 'password', value: '********', type: 'string', isSecret: true },
    ])
    expect(screen.getByTestId('secret-badge-password')).toBeInTheDocument()
    expect(screen.getByTestId('variable-value-password').textContent).toContain('********')
  })

  it('treats row body click as a no-op (no expand modal)', async () => {
    const user = userEvent.setup()
    renderManager([{ id: 'x', name: 'x', value: 42, type: 'integer' }])

    const row = screen.getByTestId('variable-row-x')
    const name = within(row).getByText('x')
    await user.click(name)

    expect(screen.queryByTestId('scalar-variable-edit-dialog')).not.toBeInTheDocument()
  })
})

describe('HistoryVariableManager - a drilled Function shows its own scope', () => {
  afterEach(() => {
    act(() => {
      useWorkflowStore.setState({ nodes: [] as never, drillPath: [] })
    })
  })

  it('lists the Function inputs, outputs and locals instead of the Test variables once drilled', () => {
    act(() => {
      useWorkflowStore.setState({
        nodes: [
          {
            id: 'fn-1',
            type: 'workflowNode',
            position: { x: 0, y: 0 },
            data: {
              label: 'Fn',
              nodeType: 'function',
              functionLifecycle: 'local',
              localDefinition: {
                workflow: { nodes: [], edges: [] },
                inputs: [{ name: 'region', type: 'string' }],
                outputs: [{ name: 'result', type: 'string' }],
                variables: [{ id: 'loc-1', name: 'loc_n', type: 'integer', value: 2 }],
              },
            },
          },
        ] as never,
        drillPath: [{ nodeId: 'fn-1', label: 'Fn' }],
      })
    })
    renderManager([{ id: 'count', name: 'count', value: 1, type: 'integer' }])

    for (const name of ['region', 'result', 'loc_n']) expect(screen.getByText(name)).toBeInTheDocument()
    expect(screen.queryByText('count')).not.toBeInTheDocument()
  })
})
