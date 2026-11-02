/**
 * Tests for rename-with-refactoring across template variable values. Renaming
 * a variable rewrites its references inside node expression fields, and a
 * `{{ oldName }}` marker inside another variable's template source is
 * rewritten to `{{ newName }}` as well. The rewrite is scoped to the
 * `{{ }}` markers (single pass) and to template-kind values, so literal text -
 * and non-template values - are left untouched.
 *
 * REQ-3.1.3.15: Template variables
 */

import { describe, it, expect } from 'vitest'

import type { WorkflowVariable } from '../../../../src/features/workbench/stores/workflow-store'

async function seed(variables: WorkflowVariable[]) {
  const { useWorkflowStore } = await import(
    '../../../../src/features/workbench/stores/workflow-store'
  )
  useWorkflowStore.setState({
    variables,
    nodes: [],
    edges: [],
    drillPath: [],
    isDirty: false,
  })
  return useWorkflowStore
}

describe('renameVariable - template reference refactoring', () => {
  it('rewrites a {{ }} marker in another variable template value on rename', async () => {
    const store = await seed([
      { id: 'u', name: 'user', value: 'Ada', type: 'string' },
      {
        id: 'g',
        name: 'greeting',
        value: 'Hello {{user}}!',
        type: 'string',
        isTemplate: true,
      } as WorkflowVariable,
    ])

    const result = store.getState().renameVariable('u', 'person')

    expect(result.success).toBe(true)
    const vars = store.getState().variables
    expect(vars.find((v) => v.id === 'u')?.name).toBe('person')
    expect(vars.find((v) => v.id === 'g')?.value).toBe('Hello {{person}}!')
  })

  it('rewrites every marker but leaves the literal text between markers untouched', async () => {
    const store = await seed([
      { id: 'u', name: 'user', value: 'Ada', type: 'string' },
      {
        id: 't',
        name: 'tpl',
        value: 'user logged in: {{user}} / {{user}} again',
        type: 'string',
        isTemplate: true,
      } as WorkflowVariable,
    ])

    store.getState().renameVariable('u', 'person')

    // The bare literal "user" prefix is preserved; only the markers change.
    expect(store.getState().variables.find((v) => v.id === 't')?.value).toBe(
      'user logged in: {{person}} / {{person}} again',
    )
  })

  it('respects word boundaries so a longer name sharing the prefix is not rewritten', async () => {
    const store = await seed([
      { id: 'u', name: 'user', value: 'Ada', type: 'string' },
      { id: 'u2', name: 'username', value: 'ada99', type: 'string' },
      {
        id: 't',
        name: 'tpl',
        value: '{{user}} ({{username}})',
        type: 'string',
        isTemplate: true,
      } as WorkflowVariable,
    ])

    store.getState().renameVariable('u', 'person')

    expect(store.getState().variables.find((v) => v.id === 't')?.value).toBe(
      '{{person}} ({{username}})',
    )
  })

  it('does NOT rewrite a non-template value that merely contains the marker text', async () => {
    const store = await seed([
      { id: 'u', name: 'user', value: 'Ada', type: 'string' },
      { id: 'n', name: 'note', value: 'see {{user}} docs', type: 'string' },
    ])

    store.getState().renameVariable('u', 'person')

    // A literal string is not a template - its text is left verbatim.
    expect(store.getState().variables.find((v) => v.id === 'n')?.value).toBe(
      'see {{user}} docs',
    )
  })

  it('leaves an unterminated {{ marker untouched (no closing }})', async () => {
    const store = await seed([
      { id: 'u', name: 'user', value: 'Ada', type: 'string' },
      {
        id: 't',
        name: 'tpl',
        value: 'open {{user but never closed',
        type: 'string',
        isTemplate: true,
      } as WorkflowVariable,
    ])

    store.getState().renameVariable('u', 'person')

    // Without a closing }} there is no marker to rewrite - left verbatim.
    expect(store.getState().variables.find((v) => v.id === 't')?.value).toBe(
      'open {{user but never closed',
    )
  })
})
