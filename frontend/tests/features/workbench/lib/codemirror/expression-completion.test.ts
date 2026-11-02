/**
 * Tests for expression-completion shared module.
 *
 * This module provides the core autocomplete intelligence for expression editing,
 * including variable/function/method completions and smart cursor placement.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { CompletionContext, Completion, CompletionSection } from '@codemirror/autocomplete'
import {
  createFunctionApply,
  createMethodApply,
  createVariableApply,
  createSectionHeader,
  createExpressionCompletionSource,
  createTemplateCompletionSource,
  type AvailableVariable,
} from '@/features/workbench/lib/codemirror/expression-completion'

// ============================================
// Test Helpers
// ============================================

/**
 * Create a CompletionContext and invoke the completion source.
 * Returns the CompletionResult or null.
 */
function getCompletions(
  doc: string,
  pos: number,
  variables: AvailableVariable[],
  isFieldExpression = false,
  showInfo = false
) {
  const source = createExpressionCompletionSource(variables, isFieldExpression, showInfo)
  const state = EditorState.create({ doc })
  const context = new CompletionContext(state, pos, false)
  return source(context)
}

/**
 * Create a mounted EditorView with the given document.
 * Optionally set a selection range (anchor, head).
 * Returns the view and its parent element for cleanup.
 */
function createTestView(doc: string, selection?: { anchor: number; head: number }) {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const state = EditorState.create({
    doc,
    selection: selection
      ? EditorSelection.single(selection.anchor, selection.head)
      : undefined,
  })
  const view = new EditorView({ state, parent })
  return { view, parent }
}

// Track views/parents for cleanup
const views: EditorView[] = []
const parents: HTMLElement[] = []

afterEach(() => {
  for (const view of views) view.destroy()
  for (const parent of parents) parent.remove()
  views.length = 0
  parents.length = 0
})

/**
 * Extract the section name from a Completion.
 * Section can be string or CompletionSection object.
 */
function getSectionName(opt: Completion): string | undefined {
  if (!opt.section) return undefined
  if (typeof opt.section === 'string') return opt.section
  return (opt.section as CompletionSection).name
}

/**
 * Extract the section header factory from a Completion.
 * Only works when section is a CompletionSection object.
 */
function getSectionHeader(opt: Completion): ((section: CompletionSection) => HTMLElement) | undefined {
  if (!opt.section || typeof opt.section === 'string') return undefined
  return (opt.section as CompletionSection).header
}

// ============================================
// Sample Variables
// ============================================

const sampleVariables: AvailableVariable[] = [
  { name: 'endpoint', type: 'string', source: 'HTTP Plugin' },
  { name: 'timeout', type: 'integer' },
  { name: 'items', type: 'array' },
  { name: 'config', type: 'map' },
  { name: 'count', type: 'float' },
  { name: 'flag', type: 'boolean' },
]

const profileVariables: AvailableVariable[] = [
  { name: 'my_srv', type: 'string', source: 'Profile: staging' },
  { name: 'my_srv.host', type: 'string', source: 'Profile: staging' },
  { name: 'my_srv.port', type: 'integer', source: 'Profile: staging' },
  { name: 'my_srv.url', type: 'string', source: 'Profile: staging' },
]

// ============================================
// createFunctionApply
// ============================================

describe('createFunctionApply', () => {
  it('inserts function with cursor inside parens when hasParams is true', () => {
    const { view, parent } = createTestView('ab')
    views.push(view)
    parents.push(parent)

    const apply = createFunctionApply('abs', true)
    // Simulate applying completion at the full document range
    apply(view, {} as Completion, 0, 2)

    expect(view.state.doc.toString()).toBe('abs()')
    // Cursor should be inside parens: abs(|)  -> pos 4
    expect(view.state.selection.main.head).toBe(4)
  })

  it('inserts function with cursor after parens when hasParams is false', () => {
    const { view, parent } = createTestView('up')
    views.push(view)
    parents.push(parent)

    const apply = createFunctionApply('upper', false)
    apply(view, {} as Completion, 0, 2)

    expect(view.state.doc.toString()).toBe('upper()')
    // Cursor should be after parens: upper()| -> pos 7
    expect(view.state.selection.main.head).toBe(7)
  })

  it('handles insertion in middle of document', () => {
    const { view, parent } = createTestView('x + le')
    views.push(view)
    parents.push(parent)

    const apply = createFunctionApply('len', true)
    // Replace "le" at position 4..6
    apply(view, {} as Completion, 4, 6)

    expect(view.state.doc.toString()).toBe('x + len()')
    // Cursor inside parens: x + len(|) -> pos 4 + 3 + 1 = 8
    expect(view.state.selection.main.head).toBe(8)
  })
})

// ============================================
// createMethodApply
// ============================================

describe('createMethodApply', () => {
  it('inserts method with cursor inside parens when hasParams is true', () => {
    const { view, parent } = createTestView('re')
    views.push(view)
    parents.push(parent)

    const apply = createMethodApply('replace', true)
    apply(view, {} as Completion, 0, 2)

    expect(view.state.doc.toString()).toBe('replace()')
    // Cursor inside parens: replace(|) -> pos 8
    expect(view.state.selection.main.head).toBe(8)
  })

  it('inserts method with cursor after parens when hasParams is false', () => {
    const { view, parent } = createTestView('up')
    views.push(view)
    parents.push(parent)

    const apply = createMethodApply('upper', false)
    apply(view, {} as Completion, 0, 2)

    expect(view.state.doc.toString()).toBe('upper()')
    // Cursor after parens: upper()| -> pos 7
    expect(view.state.selection.main.head).toBe(7)
  })
})

// ============================================
// createVariableApply
// ============================================

describe('createVariableApply', () => {
  it('inserts variable name and positions cursor after it', () => {
    const { view, parent } = createTestView('en')
    views.push(view)
    parents.push(parent)

    const apply = createVariableApply('endpoint')
    apply(view, {} as Completion, 0, 2)

    expect(view.state.doc.toString()).toBe('endpoint')
    // Cursor after variable: endpoint| -> pos 8
    expect(view.state.selection.main.head).toBe(8)
  })

  it('handles insertion in middle of document', () => {
    const { view, parent } = createTestView('x + ti')
    views.push(view)
    parents.push(parent)

    const apply = createVariableApply('timeout')
    apply(view, {} as Completion, 4, 6)

    expect(view.state.doc.toString()).toBe('x + timeout')
    // Cursor after: x + timeout| -> pos 4 + 7 = 11
    expect(view.state.selection.main.head).toBe(11)
  })
})

// ============================================
// Selection replacement (all apply functions)
// ============================================

describe('apply functions replace selected text', () => {
  it('createVariableApply replaces forward selection', () => {
    // "old_var + 1" with "old_var" selected (forward: anchor=0, head=7)
    const { view, parent } = createTestView('old_var + 1', { anchor: 0, head: 7 })
    views.push(view)
    parents.push(parent)

    const apply = createVariableApply('new_var')
    // from/to from completion context would be based on token at head
    apply(view, {} as Completion, 0, 7)

    expect(view.state.doc.toString()).toBe('new_var + 1')
    expect(view.state.selection.main.head).toBe(7)
  })

  it('createVariableApply replaces backward selection', () => {
    // "old_var + 1" with "old_var" selected backward (anchor=7, head=0)
    const { view, parent } = createTestView('old_var + 1', { anchor: 7, head: 0 })
    views.push(view)
    parents.push(parent)

    const apply = createVariableApply('new_var')
    // When selection is backward, head=0, so completion from=0, to=0
    // But selection extends to 7, so it should still replace old_var
    apply(view, {} as Completion, 0, 0)

    expect(view.state.doc.toString()).toBe('new_var + 1')
    expect(view.state.selection.main.head).toBe(7)
  })

  it('createFunctionApply replaces selected text', () => {
    const { view, parent } = createTestView('old_func(x)', { anchor: 0, head: 11 })
    views.push(view)
    parents.push(parent)

    const apply = createFunctionApply('len', true)
    apply(view, {} as Completion, 0, 11)

    expect(view.state.doc.toString()).toBe('len()')
    expect(view.state.selection.main.head).toBe(4) // inside parens
  })

  it('createMethodApply replaces selected text', () => {
    const { view, parent } = createTestView('x.old_meth', { anchor: 2, head: 10 })
    views.push(view)
    parents.push(parent)

    const apply = createMethodApply('upper', false)
    apply(view, {} as Completion, 2, 10)

    expect(view.state.doc.toString()).toBe('x.upper()')
    expect(view.state.selection.main.head).toBe(9) // after parens
  })

  it('createVariableApply does not extend range when no selection', () => {
    // No selection - normal behavior, replace from..to only
    const { view, parent } = createTestView('x + old')
    views.push(view)
    parents.push(parent)

    const apply = createVariableApply('new_var')
    apply(view, {} as Completion, 4, 7)

    expect(view.state.doc.toString()).toBe('x + new_var')
    expect(view.state.selection.main.head).toBe(11)
  })
})

// ============================================
// createSectionHeader
// ============================================

describe('createSectionHeader', () => {
  it('returns a div element with cm-completionSection class', () => {
    const header = createSectionHeader('Variables')

    expect(header).toBeInstanceOf(HTMLElement)
    expect(header.tagName).toBe('DIV')
    expect(header.className).toBe('cm-completionSection')
    expect(header.textContent).toBe('Variables')
  })

  it('creates separate elements for different section names', () => {
    const h1 = createSectionHeader('Functions')
    const h2 = createSectionHeader('Methods')

    expect(h1.textContent).toBe('Functions')
    expect(h2.textContent).toBe('Methods')
    expect(h1).not.toBe(h2)
  })
})

// ============================================
// createExpressionCompletionSource - Variable completions
// ============================================

describe('createExpressionCompletionSource - variable completions', () => {
  it('returns variables with correct labels', () => {
    const result = getCompletions('', 0, sampleVariables)

    expect(result).not.toBeNull()
    const labels = result!.options.filter((o) => o.type === 'variable').map((o) => o.label)
    expect(labels).toContain('endpoint')
    expect(labels).toContain('timeout')
    expect(labels).toContain('items')
    expect(labels).toContain('config')
  })

  it('shows type detail with source info', () => {
    const result = getCompletions('', 0, sampleVariables)

    const endpointOpt = result!.options.find((o) => o.label === 'endpoint')
    // endpoint has source: 'HTTP Plugin'
    expect(endpointOpt!.detail).toBe('string \u2190 HTTP Plugin')
  })

  it('shows type detail without source for variables without source', () => {
    const result = getCompletions('', 0, sampleVariables)

    const timeoutOpt = result!.options.find((o) => o.label === 'timeout')
    expect(timeoutOpt!.detail).toBe('integer')
  })

  it('deduplicates variables with the same name', () => {
    const dupes: AvailableVariable[] = [
      { name: 'endpoint', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'timeout', type: 'integer' },
    ]
    const result = getCompletions('', 0, dupes)

    const endpointOptions = result!.options.filter(
      (o) => o.label === 'endpoint' && o.type === 'variable'
    )
    expect(endpointOptions).toHaveLength(1)
  })

  it('skips dotted profile field names in top-level completions', () => {
    const result = getCompletions('', 0, profileVariables)

    const labels = result!.options.filter((o) => o.type === 'variable').map((o) => o.label)
    // my_srv should be included, but my_srv.host, my_srv.port, my_srv.url should not
    expect(labels).toContain('my_srv')
    expect(labels).not.toContain('my_srv.host')
    expect(labels).not.toContain('my_srv.port')
    expect(labels).not.toContain('my_srv.url')
  })

  it('sets from offset to start of current token', () => {
    const result = getCompletions('end', 3, sampleVariables)

    expect(result).not.toBeNull()
    expect(result!.from).toBe(0) // "end" starts at 0
  })

  it('handles empty current token with from at cursor position', () => {
    const result = getCompletions('x + ', 4, sampleVariables)

    expect(result).not.toBeNull()
    expect(result!.from).toBe(4) // Empty token at position 4
  })

  it('includes description as info field when showInfo is true', () => {
    const vars: AvailableVariable[] = [
      { name: 'host', type: 'string', description: 'Target hostname' },
    ]
    const result = getCompletions('', 0, vars, false, true)

    const hostOpt = result!.options.find((o) => o.label === 'host')
    expect(hostOpt!.info).toBe('Target hostname')
  })

  it('omits info field when showInfo is false', () => {
    const vars: AvailableVariable[] = [
      { name: 'host', type: 'string', description: 'Target hostname' },
    ]
    const result = getCompletions('', 0, vars)

    const hostOpt = result!.options.find((o) => o.label === 'host')
    expect(hostOpt!.info).toBeUndefined()
  })

  it('includes info field on method completions when showInfo is true', () => {
    const vars: AvailableVariable[] = [
      { name: 'text', type: 'string' },
    ]
    const result = getCompletions('text.', 5, vars, false, true)
    expect(result).not.toBeNull()

    // String methods should have info set to their description
    const upperOpt = result!.options.find((o) => o.label === 'upper')
    expect(upperOpt).toBeDefined()
    expect(upperOpt!.info).toBeDefined()
    expect(typeof upperOpt!.info).toBe('string')
  })

  it('omits info field on method completions when showInfo is false', () => {
    const vars: AvailableVariable[] = [
      { name: 'text', type: 'string' },
    ]
    const result = getCompletions('text.', 5, vars, false, false)
    expect(result).not.toBeNull()

    const upperOpt = result!.options.find((o) => o.label === 'upper')
    expect(upperOpt).toBeDefined()
    expect(upperOpt!.info).toBeUndefined()
  })
})

// ============================================
// createExpressionCompletionSource - Profile alias completions
// ============================================

describe('createExpressionCompletionSource - profile completions', () => {
  it('places profile variables in Profiles section', () => {
    const vars: AvailableVariable[] = [
      { name: 'my_srv', type: 'string', source: 'Profile: staging' },
      { name: 'endpoint', type: 'string' },
    ]
    const result = getCompletions('', 0, vars)

    const profileOpt = result!.options.find((o) => o.label === 'my_srv')
    expect(getSectionName(profileOpt!)).toBe('Profiles')
  })

  it('places regular variables in Variables section', () => {
    const vars: AvailableVariable[] = [
      { name: 'my_srv', type: 'string', source: 'Profile: staging' },
      { name: 'endpoint', type: 'string' },
    ]
    const result = getCompletions('', 0, vars)

    const varOpt = result!.options.find((o) => o.label === 'endpoint')
    expect(getSectionName(varOpt!)).toBe('Variables')
  })

  it('places variables with non-Profile source in Variables section', () => {
    const vars: AvailableVariable[] = [
      { name: 'endpoint', type: 'string', source: 'HTTP Plugin' },
    ]
    const result = getCompletions('', 0, vars)

    const opt = result!.options.find((o) => o.label === 'endpoint')
    expect(getSectionName(opt!)).toBe('Variables')
  })
})

// ============================================
// createExpressionCompletionSource - Namespace completions
// ============================================

describe('createExpressionCompletionSource - namespace completions', () => {
  const namespaceVariables: AvailableVariable[] = [
    { name: 'system', type: 'object', source: 'System Variables' },
    { name: 'system.api_host', type: 'string', source: 'System Variables' },
    { name: 'system.timeout', type: 'integer', source: 'System Variables' },
    { name: 'endpoint', type: 'string' },
  ]

  it('places namespace variables in Namespaces section', () => {
    const result = getCompletions('', 0, namespaceVariables)

    const sysOpt = result!.options.find((o) => o.label === 'system')
    expect(getSectionName(sysOpt!)).toBe('Namespaces')
  })

  it('places regular variables in Variables section alongside namespaces', () => {
    const result = getCompletions('', 0, namespaceVariables)

    const varOpt = result!.options.find((o) => o.label === 'endpoint')
    expect(getSectionName(varOpt!)).toBe('Variables')
  })

  it('shows dotted namespace fields after typing system.', () => {
    const result = getCompletions('system.', 7, namespaceVariables)
    expect(result).not.toBeNull()

    const labels = result!.options.map((o) => o.label)
    expect(labels).toContain('system.api_host')
    expect(labels).toContain('system.timeout')
  })

  it('filters dotted fields by typed prefix', () => {
    const result = getCompletions('system.a', 8, namespaceVariables)
    expect(result).not.toBeNull()

    const labels = result!.options.map((o) => o.label)
    expect(labels).toContain('system.api_host')
    expect(labels).not.toContain('system.timeout')
  })

  it('recognizes Suite source as namespace', () => {
    const vars: AvailableVariable[] = [
      { name: 'suite', type: 'object', source: 'Suite' },
    ]
    const result = getCompletions('', 0, vars)

    const suiteOpt = result!.options.find((o) => o.label === 'suite')
    expect(getSectionName(suiteOpt!)).toBe('Namespaces')
  })

  it('recognizes Regression: source as namespace', () => {
    const vars: AvailableVariable[] = [
      { name: 'regression', type: 'object', source: 'Regression: Nightly' },
    ]
    const result = getCompletions('', 0, vars)

    const regOpt = result!.options.find((o) => o.label === 'regression')
    expect(getSectionName(regOpt!)).toBe('Namespaces')
  })

  it('provides Namespaces section header that returns DOM element', () => {
    const result = getCompletions('', 0, namespaceVariables)

    const sysOpt = result!.options.find((o) => o.label === 'system')
    const headerFn = getSectionHeader(sysOpt!)
    expect(headerFn).toBeDefined()

    const header = headerFn!({} as CompletionSection)
    expect(header).toBeInstanceOf(HTMLElement)
    expect(header.textContent).toBe('Namespaces')
  })

  it('ranks Namespaces between Variables and Profiles', () => {
    const vars: AvailableVariable[] = [
      { name: 'endpoint', type: 'string' },
      { name: 'system', type: 'object', source: 'System Variables' },
      { name: 'my_srv', type: 'string', source: 'Profile: staging' },
    ]
    const result = getCompletions('', 0, vars)

    const endpointOpt = result!.options.find((o) => o.label === 'endpoint')
    const systemOpt = result!.options.find((o) => o.label === 'system')
    const profileOpt = result!.options.find((o) => o.label === 'my_srv')

    // Variables rank 0, Namespaces rank 1, Profiles rank 2
    const varSection = endpointOpt!.section as CompletionSection
    const nsSection = systemOpt!.section as CompletionSection
    const profSection = profileOpt!.section as CompletionSection

    expect(varSection.rank as number).toBeLessThan(nsSection.rank as number)
    expect(nsSection.rank as number).toBeLessThan(profSection.rank as number)
  })
})

// ============================================
// createExpressionCompletionSource - Builtin function completions
// ============================================

describe('createExpressionCompletionSource - builtin functions', () => {
  it('returns builtin functions like len, str, int', () => {
    const result = getCompletions('', 0, [])

    const funcLabels = result!.options.filter((o) => o.type === 'function').map((o) => o.label)
    expect(funcLabels).toContain('len')
    expect(funcLabels).toContain('str')
    expect(funcLabels).toContain('int')
    expect(funcLabels).toContain('abs')
  })

  it('includes constructors when isFieldExpression is false', () => {
    const result = getCompletions('', 0, [], false)

    const funcLabels = result!.options.filter((o) => o.type === 'function').map((o) => o.label)
    expect(funcLabels).toContain('list')
    expect(funcLabels).toContain('dict')
    expect(funcLabels).toContain('set')
  })

  it('excludes constructors when isFieldExpression is true', () => {
    const result = getCompletions('', 0, [], true)

    const funcLabels = result!.options.filter((o) => o.type === 'function').map((o) => o.label)
    expect(funcLabels).not.toContain('list')
    expect(funcLabels).not.toContain('dict')
    expect(funcLabels).not.toContain('set')
  })

  it('places builtins in Functions section', () => {
    const result = getCompletions('', 0, [])

    const lenOpt = result!.options.find((o) => o.label === 'len')
    expect(getSectionName(lenOpt!)).toBe('Functions')
  })

  it('includes signature as detail', () => {
    const result = getCompletions('', 0, [])

    const lenOpt = result!.options.find((o) => o.label === 'len')
    expect(lenOpt!.detail).toBe('len(s)')
  })

  it('does not include blocked builtins like print, eval, exec', () => {
    const result = getCompletions('', 0, [])

    const funcLabels = result!.options.filter((o) => o.type === 'function').map((o) => o.label)
    expect(funcLabels).not.toContain('print')
    expect(funcLabels).not.toContain('eval')
    expect(funcLabels).not.toContain('exec')
    expect(funcLabels).not.toContain('open')
  })
})

// ============================================
// createExpressionCompletionSource - Dot-completion (methods)
// ============================================

describe('createExpressionCompletionSource - dot completion', () => {
  it('shows string methods after str variable dot', () => {
    const result = getCompletions('endpoint.', 9, sampleVariables)

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    expect(methodLabels).toContain('upper')
    expect(methodLabels).toContain('lower')
    expect(methodLabels).toContain('split')
    expect(methodLabels).toContain('strip')
  })

  it('shows list methods after list variable dot', () => {
    const result = getCompletions('items.', 6, sampleVariables)

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    expect(methodLabels).toContain('append')
    expect(methodLabels).toContain('index')
    expect(methodLabels).toContain('count')
    expect(methodLabels).toContain('copy')
  })

  it('shows dict methods after dict variable dot', () => {
    const result = getCompletions('config.', 7, sampleVariables)

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    expect(methodLabels).toContain('keys')
    expect(methodLabels).toContain('values')
    expect(methodLabels).toContain('items')
    expect(methodLabels).toContain('get')
  })

  it('returns null for unknown variable dot', () => {
    const result = getCompletions('unknown.', 8, sampleVariables)

    expect(result).toBeNull()
  })

  it('shows string methods after string literal dot', () => {
    const result = getCompletions("'hello'.", 8, [])

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    expect(methodLabels).toContain('upper')
    expect(methodLabels).toContain('lower')
  })

  it('returns null for number literal dot (no methods)', () => {
    const result = getCompletions('42.', 3, [])

    expect(result).toBeNull()
  })

  it('excludes mutating methods when isFieldExpression is true', () => {
    const result = getCompletions('items.', 6, sampleVariables, true)

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    // Non-mutating methods should be present
    expect(methodLabels).toContain('index')
    expect(methodLabels).toContain('count')
    expect(methodLabels).toContain('copy')
    // Mutating methods should be excluded
    expect(methodLabels).not.toContain('append')
    expect(methodLabels).not.toContain('pop')
    expect(methodLabels).not.toContain('clear')
    expect(methodLabels).not.toContain('sort')
    expect(methodLabels).not.toContain('reverse')
  })

  it('places methods in Methods section', () => {
    const result = getCompletions('endpoint.', 9, sampleVariables)

    const methodOpt = result!.options.find((o) => o.type === 'method')
    expect(getSectionName(methodOpt!)).toBe('Methods')
  })

  it('includes method signatures as detail', () => {
    const result = getCompletions('endpoint.', 9, sampleVariables)

    const upperOpts = result!.options.filter((o) => o.label === 'upper')
    expect(upperOpts.length).toBeGreaterThan(0)
    expect(upperOpts[0].detail).toBe('.upper() -> str')
  })

  it('sets from to method prefix position for pure method completion', () => {
    const result = getCompletions('endpoint.up', 11, sampleVariables)

    expect(result).not.toBeNull()
    // "up" starts at position 9 (after the dot)
    expect(result!.from).toBe(9)
  })
})

// ============================================
// createExpressionCompletionSource - Dotted profile fields
// ============================================

describe('createExpressionCompletionSource - dotted profile fields', () => {
  it('shows field completions when typing profile_alias.', () => {
    const result = getCompletions('my_srv.', 7, profileVariables)

    expect(result).not.toBeNull()
    const varLabels = result!.options.filter((o) => o.type === 'variable').map((o) => o.label)
    expect(varLabels).toContain('my_srv.host')
    expect(varLabels).toContain('my_srv.port')
    expect(varLabels).toContain('my_srv.url')
  })

  it('sets from to expression start when dotted vars are present', () => {
    const result = getCompletions('my_srv.', 7, profileVariables)

    expect(result).not.toBeNull()
    // When dotted vars are found, from is the expression start (0)
    expect(result!.from).toBe(0)
  })

  it('includes both field vars and type methods when type is known', () => {
    // my_srv is type string, so it should show both field vars and string methods
    const result = getCompletions('my_srv.', 7, profileVariables)

    expect(result).not.toBeNull()
    const varLabels = result!.options.filter((o) => o.type === 'variable').map((o) => o.label)
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)

    // Should have field variables
    expect(varLabels).toContain('my_srv.host')
    // Should also have string methods since my_srv is type string
    expect(methodLabels).toContain('upper')
  })

  it('places dotted vars in Fields section', () => {
    const result = getCompletions('my_srv.', 7, profileVariables)

    const fieldOpt = result!.options.find(
      (o) => o.type === 'variable' && o.label === 'my_srv.host'
    )
    expect(getSectionName(fieldOpt!)).toBe('Fields')
  })

  it('includes source info in dotted var detail', () => {
    const result = getCompletions('my_srv.', 7, profileVariables)

    const hostOpt = result!.options.find((o) => o.label === 'my_srv.host')
    expect(hostOpt!.detail).toBe('string \u2190 Profile: staging')
  })
})

// ============================================
// createExpressionCompletionSource - Method chain tracing
// ============================================

describe('createExpressionCompletionSource - method chain tracing', () => {
  it('shows string methods after endpoint.upper().', () => {
    // endpoint is string -> upper() returns str -> should show str methods
    const result = getCompletions('endpoint.upper().', 17, sampleVariables)

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    expect(methodLabels).toContain('upper')
    expect(methodLabels).toContain('lower')
    expect(methodLabels).toContain('strip')
  })

  it('shows list methods after endpoint.split().', () => {
    // endpoint is string -> split() returns list -> should show list methods
    const result = getCompletions('endpoint.split().', 17, sampleVariables)

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    expect(methodLabels).toContain('append')
    expect(methodLabels).toContain('index')
  })

  it('shows string methods after str() builtin call dot', () => {
    // str(42). -> str returns str -> string methods
    const result = getCompletions('str(42).', 8, [])

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    expect(methodLabels).toContain('upper')
    expect(methodLabels).toContain('lower')
  })
})

// ============================================
// createExpressionCompletionSource - Empty / edge cases
// ============================================

describe('createExpressionCompletionSource - edge cases', () => {
  it('returns completions for empty document', () => {
    const result = getCompletions('', 0, sampleVariables)

    expect(result).not.toBeNull()
    expect(result!.options.length).toBeGreaterThan(0)
  })

  it('returns completions with no variables (only builtins)', () => {
    const result = getCompletions('', 0, [])

    expect(result).not.toBeNull()
    // Should have builtin functions
    const funcLabels = result!.options.filter((o) => o.type === 'function').map((o) => o.label)
    expect(funcLabels).toContain('len')
  })

  it('handles dot at start of document', () => {
    // A dot at position 0 means beforeDot is empty
    const result = getCompletions('.', 1, sampleVariables)

    // Empty beforeDot -> unknown type -> no methods -> null
    expect(result).toBeNull()
  })

  it('creates a closure that captures variables', () => {
    const source = createExpressionCompletionSource(sampleVariables, false)

    const state1 = EditorState.create({ doc: '' })
    const ctx1 = new CompletionContext(state1, 0, false)
    const result1 = source(ctx1)

    expect(result1).not.toBeNull()
    const labels1 = result1!.options.filter((o) => o.type === 'variable').map((o) => o.label)
    expect(labels1).toContain('endpoint')
  })

  it('returns completions with current token filtering from', () => {
    // When cursor is at "end" (pos 3), from should be 0
    const result = getCompletions('end', 3, sampleVariables)

    expect(result).not.toBeNull()
    expect(result!.from).toBe(0)
  })

  it('provides section headers that return DOM elements', () => {
    const result = getCompletions('', 0, sampleVariables)

    // Check that Variables section header factory works
    const varOpt = result!.options.find(
      (o) => o.type === 'variable' && getSectionName(o) === 'Variables'
    )
    expect(varOpt).toBeDefined()
    const headerFn = getSectionHeader(varOpt!)
    expect(headerFn).toBeDefined()
    const headerEl = headerFn!({ name: '' })
    expect(headerEl).toBeInstanceOf(HTMLElement)
    expect(headerEl.className).toBe('cm-completionSection')
  })

  it('provides Functions section header that returns DOM element', () => {
    const result = getCompletions('', 0, [])

    const funcOpt = result!.options.find((o) => o.type === 'function')
    expect(funcOpt).toBeDefined()
    const headerFn = getSectionHeader(funcOpt!)
    expect(headerFn).toBeDefined()
    const headerEl = headerFn!({ name: '' })
    expect(headerEl).toBeInstanceOf(HTMLElement)
  })

  it('provides Profiles section header that returns DOM element', () => {
    const vars: AvailableVariable[] = [
      { name: 'my_srv', type: 'string', source: 'Profile: staging' },
    ]
    const result = getCompletions('', 0, vars)

    const profileOpt = result!.options.find((o) => getSectionName(o) === 'Profiles')
    expect(profileOpt).toBeDefined()
    const headerFn = getSectionHeader(profileOpt!)
    expect(headerFn).toBeDefined()
    const headerEl = headerFn!({ name: '' })
    expect(headerEl).toBeInstanceOf(HTMLElement)
  })

  it('provides Fields section header when dotted vars present', () => {
    const result = getCompletions('my_srv.', 7, profileVariables)

    const fieldOpt = result!.options.find((o) => getSectionName(o) === 'Fields')
    expect(fieldOpt).toBeDefined()
    const headerFn = getSectionHeader(fieldOpt!)
    expect(headerFn).toBeDefined()
    const headerEl = headerFn!({ name: '' })
    expect(headerEl).toBeInstanceOf(HTMLElement)
  })

  it('provides Methods section header in dot completion', () => {
    const result = getCompletions('endpoint.', 9, sampleVariables)

    const methodOpt = result!.options.find((o) => getSectionName(o) === 'Methods')
    expect(methodOpt).toBeDefined()
    const headerFn = getSectionHeader(methodOpt!)
    expect(headerFn).toBeDefined()
    const headerEl = headerFn!({ name: '' })
    expect(headerEl).toBeInstanceOf(HTMLElement)
  })

  it('handles list literal dot completion', () => {
    const result = getCompletions('[1,2].', 6, [])

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    expect(methodLabels).toContain('append')
    expect(methodLabels).toContain('index')
  })

  it('handles dict literal dot completion', () => {
    const result = getCompletions('{}.', 3, [])

    expect(result).not.toBeNull()
    const methodLabels = result!.options.filter((o) => o.type === 'method').map((o) => o.label)
    expect(methodLabels).toContain('keys')
    expect(methodLabels).toContain('values')
  })

  it('handles boolean variable dot (no methods)', () => {
    const result = getCompletions('flag.', 5, sampleVariables)

    // boolean has no methods in getMethodsForType
    expect(result).toBeNull()
  })

  it('does not include description field on dotted field vars without description', () => {
    const result = getCompletions('my_srv.', 7, profileVariables)

    const hostOpt = result!.options.find((o) => o.label === 'my_srv.host')
    // profileVariables don't have description field set
    expect(hostOpt!.info).toBeUndefined()
  })

  it('includes description field on dotted field vars when showInfo is true', () => {
    const vars: AvailableVariable[] = [
      { name: 'srv.host', type: 'string', source: 'Profile: dev', description: 'Server hostname' },
    ]
    const result = getCompletions('srv.', 4, vars, false, true)

    expect(result).not.toBeNull()
    const hostOpt = result!.options.find((o) => o.label === 'srv.host')
    expect(hostOpt!.info).toBe('Server hostname')
  })

  it('shows type-only detail for dotted vars without source', () => {
    const vars: AvailableVariable[] = [
      { name: 'obj.field', type: 'string' },
    ]
    const result = getCompletions('obj.', 4, vars)

    expect(result).not.toBeNull()
    const fieldOpt = result!.options.find((o) => o.label === 'obj.field')
    expect(fieldOpt).toBeDefined()
    // Without source, detail should just be the type
    expect(fieldOpt!.detail).toBe('string')
  })
})

// ============================================
// Template Completion Source
// ============================================

describe('createTemplateCompletionSource', () => {
  const vars: AvailableVariable[] = [
    { name: 'host', type: 'string' },
    { name: 'port', type: 'integer' },
  ]

  function getTemplateCompletions(
    doc: string,
    pos: number,
    variables: AvailableVariable[] = vars,
    showInfo = false
  ) {
    const source = createTemplateCompletionSource(variables, showInfo)
    const state = EditorState.create({ doc })
    const context = new CompletionContext(state, pos, false)
    return source(context)
  }

  it('returns null when cursor is outside {{ }}', () => {
    const result = getTemplateCompletions('plain text', 5)
    expect(result).toBeNull()
  })

  it('returns null when cursor is after a closed {{ }} marker', () => {
    const result = getTemplateCompletions('{{host}} trailing', 12)
    expect(result).toBeNull()
  })

  it('returns completions when cursor is inside {{ }}', () => {
    const result = getTemplateCompletions('url: {{h}}', 8)
    expect(result).not.toBeNull()
    expect(result!.options.some(o => o.label === 'host')).toBe(true)
  })

  it('returns completions at start of {{ marker', () => {
    const result = getTemplateCompletions('value: {{ }}', 9)
    expect(result).not.toBeNull()
    expect(result!.options.some(o => o.label === 'host')).toBe(true)
    expect(result!.options.some(o => o.label === 'port')).toBe(true)
  })

  it('passes showInfo through to completions', () => {
    const varsWithSource: AvailableVariable[] = [
      { name: 'endpoint', type: 'string', source: 'profile', description: 'API endpoint' },
    ]
    const result = getTemplateCompletions('{{e}}', 3, varsWithSource, true)
    expect(result).not.toBeNull()
    const opt = result!.options.find(o => o.label === 'endpoint')
    expect(opt!.info).toBe('API endpoint')
  })
})

// ============================================
// f-string interpolation
// ============================================

describe('createExpressionCompletionSource - f-string interpolation', () => {
  it('offers dotted profile fields after `cpr.` inside an f-string single-quoted', () => {
    const cprVars: AvailableVariable[] = [
      { name: 'cpr', type: 'map', source: 'Profile: staging' },
      { name: 'cpr.v1', type: 'string', source: 'Profile: staging' },
      { name: 'cpr.v2', type: 'string', source: 'Profile: staging' },
    ]
    const doc = "f'var is {cpr."
    const result = getCompletions(doc, doc.length, cprVars)
    expect(result).not.toBeNull()
    const labels = result!.options.map(o => o.label)
    expect(labels).toContain('cpr.v1')
    expect(labels).toContain('cpr.v2')
  })

  it('offers dotted profile fields inside an f-string double-quoted', () => {
    const cprVars: AvailableVariable[] = [
      { name: 'cpr', type: 'map', source: 'Profile: staging' },
      { name: 'cpr.v1', type: 'string', source: 'Profile: staging' },
    ]
    const doc = 'f"var is {cpr.'
    const result = getCompletions(doc, doc.length, cprVars)
    expect(result).not.toBeNull()
    expect(result!.options.some(o => o.label === 'cpr.v1')).toBe(true)
  })

  it('offers system namespace dotted entries inside an f-string', () => {
    const sysVars: AvailableVariable[] = [
      { name: 'system.env', type: 'string', source: 'System' },
      { name: 'system.user', type: 'string', source: 'System' },
    ]
    const doc = "f'hello {system."
    const result = getCompletions(doc, doc.length, sysVars)
    expect(result).not.toBeNull()
    const labels = result!.options.map(o => o.label)
    expect(labels).toContain('system.env')
    expect(labels).toContain('system.user')
  })

  it('offers top-level variables right after the opening brace', () => {
    const vars: AvailableVariable[] = [
      { name: 'cpr', type: 'map', source: 'Profile: staging' },
      { name: 'endpoint', type: 'string' },
    ]
    const doc = "f'value: {"
    const result = getCompletions(doc, doc.length, vars)
    expect(result).not.toBeNull()
    const labels = result!.options.map(o => o.label)
    expect(labels).toContain('cpr')
    expect(labels).toContain('endpoint')
  })

  it('does not return f-string completions after the brace is closed', () => {
    const cprVars: AvailableVariable[] = [
      { name: 'cpr', type: 'map', source: 'Profile: staging' },
      { name: 'cpr.v1', type: 'string', source: 'Profile: staging' },
    ]
    // Brace already closed - cursor sits in plain f-string text, no dot context
    const doc = "f'var is {cpr.v1} and "
    const result = getCompletions(doc, doc.length, cprVars)
    // Top-level completions are still returned (not null) but they should be
    // the regular ones, not dotted fields - and there's no dot context here.
    expect(result).not.toBeNull()
    // No dotted-field completions when there's no trailing `.`
    expect(result!.options.find(o => o.label === 'cpr.v1')).toBeUndefined()
  })

  it('preserves normal expression completions outside any f-string', () => {
    const cprVars: AvailableVariable[] = [
      { name: 'cpr', type: 'map', source: 'Profile: staging' },
      { name: 'cpr.v1', type: 'string', source: 'Profile: staging' },
    ]
    const doc = 'cpr.'
    const result = getCompletions(doc, doc.length, cprVars)
    expect(result).not.toBeNull()
    expect(result!.options.some(o => o.label === 'cpr.v1')).toBe(true)
  })

  it('falls back to whole-input completion when an f-string has no open brace yet', () => {
    // Inside f'... but no { typed yet. The slicer should bail and let the
    // standard expression logic handle the input (in which case there are no
    // dotted matches because the input is a string literal, not an expression).
    const vars: AvailableVariable[] = [
      { name: 'cpr', type: 'map', source: 'Profile: staging' },
      { name: 'cpr.v1', type: 'string', source: 'Profile: staging' },
    ]
    const doc = "f'hello "
    const result = getCompletions(doc, doc.length, vars)
    // Some completion result is returned (top-level vars), not null.
    expect(result).not.toBeNull()
  })
})

// ============================================
// createExpressionCompletionSource - blocked builtins option
// ============================================

describe('createExpressionCompletionSource - blocked builtins option', () => {
  /** Invoke the source with the options argument the Python editor uses. */
  function getCompletionsWithOptions(
    doc: string,
    pos: number,
    variables: AvailableVariable[],
    options?: { includeBlockedBuiltins?: boolean }
  ) {
    const source = createExpressionCompletionSource(variables, false, false, options)
    const state = EditorState.create({ doc })
    const context = new CompletionContext(state, pos, false)
    return source(context)
  }

  it('keeps the blocked builtins out when no options argument is given', () => {
    const result = getCompletionsWithOptions('', 0, [])

    const labels = result!.options.map((o) => o.label)
    expect(labels).not.toContain('print')
    expect(labels).not.toContain('eval')
    expect(labels).not.toContain('exec')
    expect(labels).not.toContain('open')
  })

  it('keeps the blocked builtins out when an empty options object is given', () => {
    const result = getCompletionsWithOptions('', 0, [], {})

    const labels = result!.options.map((o) => o.label)
    expect(labels).not.toContain('print')
    expect(labels).not.toContain('open')
  })

  it('keeps the blocked builtins out when includeBlockedBuiltins is false', () => {
    const result = getCompletionsWithOptions('', 0, [], { includeBlockedBuiltins: false })

    const labels = result!.options.map((o) => o.label)
    expect(labels).not.toContain('print')
    expect(labels).not.toContain('open')
    expect(labels).toContain('len')
  })

  it('offers the sandbox table types to an expression and to a field expression', () => {
    for (const field of [false, true]) {
      const labels = getCompletions('', 0, [], field)!.options.map((o) => o.label)
      expect(labels).toEqual(expect.arrayContaining(['Table', 'TableRowView', 'ColumnType']))
    }
  })

  it('keeps the sandbox table types out of a script, where they are not defined', () => {
    const labels = getCompletionsWithOptions('', 0, [], { includeBlockedBuiltins: true })!.options.map((o) => o.label)
    expect(labels).not.toContain('Table')
    expect(labels).not.toContain('ColumnType')
  })

  it('offers the blocked builtins when includeBlockedBuiltins is true', () => {
    const result = getCompletionsWithOptions('', 0, [], { includeBlockedBuiltins: true })

    const labels = result!.options.map((o) => o.label)
    expect(labels).toContain('print')
    expect(labels).toContain('eval')
    expect(labels).toContain('exec')
    expect(labels).toContain('open')
    expect(labels).toContain('len')
  })

  it('leaves the field-expression filter unchanged when no options argument is given', () => {
    const result = getCompletions('', 0, [], true)

    const labels = result!.options.map((o) => o.label)
    expect(labels).not.toContain('list')
    expect(labels).not.toContain('dict')
    expect(labels).not.toContain('print')
    expect(labels).toContain('len')
  })

  it('places an unlocked builtin in the Functions section with its signature', () => {
    const result = getCompletionsWithOptions('', 0, [], { includeBlockedBuiltins: true })

    const printOption = result!.options.find((o) => o.label === 'print')
    expect(getSectionName(printOption!)).toBe('Functions')
    expect(printOption!.detail).toBe(String.raw`print(*objects, sep=" ", end="\n")`)
  })
})
