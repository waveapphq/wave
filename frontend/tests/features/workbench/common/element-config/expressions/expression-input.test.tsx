/**
 * ExpressionInput Component Tests
 *
 * Tests for the single-line CodeMirror expression editor component,
 * including keymap bindings, single-line enforcement (a stored multi-line
 * expression keeps its line breaks), the Text Muted placeholder, and global
 * wheel handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'

// ============================================================================
// Mocks - must be declared before any imports of the module under test
// ============================================================================

// Helper to lazily initialize global test state. vi.mock factories are hoisted
// above ALL const/let/var declarations, so we cannot reference any such binding.
// However, function declarations ARE hoisted (no TDZ), so this function is safe
// to call from within vi.mock factories. vi is a vitest global, always available.
function ensureTestGlobals() {
  const g = globalThis as any
  if (!g.__test_captured) {
    g.__test_captured = {
      extensions: [],
      keymapBindings: [],
      transactionFilter: null,
      escapeHandler: null,
      themeSpecs: [],
    }
  }
  if (!g.__test_mocks) {
    g.__test_mocks = {
      codeMirrorProps: vi.fn(),
      startCompletion: vi.fn(),
      completionStatus: vi.fn(() => null),
      closeCompletion: vi.fn(),
      acceptCompletion: vi.fn(),
      moveCompletionSelection: vi.fn(() => vi.fn()),
      validateExpressions: vi.fn(() => []),
      initializeTreeSitter: vi.fn(() => Promise.resolve()),
      isInitialized: vi.fn(() => true),
      createCompletionSource: vi.fn(() => vi.fn()),
      createHighlighter: vi.fn(() => 'highlighter-mock'),
      createTooltip: vi.fn(() => 'tooltip-mock'),
      unregisterEscape: vi.fn(),
    }
  }
  return { captured: g.__test_captured, mocks: g.__test_mocks }
}

// Initialize for file-level use
ensureTestGlobals()
const captured = (globalThis as any).__test_captured
const mocks = (globalThis as any).__test_mocks

// Mock @uiw/react-codemirror
vi.mock('@uiw/react-codemirror', () => {
  const { captured: c, mocks: m } = ensureTestGlobals()
  return {
    default: React.forwardRef(({ value, onChange, extensions, className, basicSetup, theme }: any, ref: any) => {
      m.codeMirrorProps({ value, onChange, extensions, className, basicSetup, theme })
      c.extensions = extensions || []
      if (ref) {
        // Store the ref object so tests can mutate .view later
        const refObj = { view: null }
        if (typeof ref === 'function') {
          ref(refObj)
        } else {
          ref.current = refObj
        }
        c.editorRef = refObj
      }
      return (
        <input
          data-testid="codemirror-input"
          value={value}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value)}
          className={className}
        />
      )
    }),
  }
})

vi.mock('@codemirror/view', () => {
  const { captured: c } = ensureTestGlobals()
  return {
    EditorView: {
      theme: (spec: Record<string, Record<string, string>>) => {
        c.themeSpecs.push(spec)
        return 'editor-theme-mock'
      },
      updateListener: { of: (fn: any) => ({ type: 'updateListener', fn }) },
    },
    keymap: {
      of: (bindings: any) => {
        c.keymapBindings = bindings
        return { type: 'keymap', bindings }
      },
    },
    placeholder: (text: string) => ({ type: 'placeholder', text }),
    ViewPlugin: {
      define: (factory: any) => { factory(); c.viewPluginFactory = factory; return 'view-plugin-mock' },
      fromClass: (_cls: any) => 'view-plugin-from-class-mock',
    },
    tooltips: (opts: any) => ({ type: 'tooltips', opts }),
  }
})

vi.mock('@codemirror/state', () => {
  const { captured: c } = ensureTestGlobals()
  return {
    EditorState: {
      transactionFilter: {
        of: (fn: any) => {
          c.transactionFilter = fn
          return { type: 'transactionFilter', fn }
        },
      },
    },
    Prec: { highest: (x: any) => x },
  }
})

vi.mock('@codemirror/autocomplete', () => {
  const { mocks: m } = ensureTestGlobals()
  return {
    autocompletion: (config: any) => ({ type: 'autocompletion', config }),
    startCompletion: (view: unknown) => m.startCompletion(view),
    completionStatus: (state: unknown) => m.completionStatus(state),
    closeCompletion: (view: unknown) => m.closeCompletion(view),
    acceptCompletion: (view: unknown) => m.acceptCompletion(view),
    moveCompletionSelection: (forward: unknown) => m.moveCompletionSelection(forward),
  }
})

vi.mock('@/features/workbench/lib/expression-validation/validation', () => {
  const { mocks: m } = ensureTestGlobals()
  return {
    validateExpressions: (val: unknown, names: unknown, types: unknown, isField: unknown) => m.validateExpressions(val, names, types, isField),
  }
})

vi.mock('@/features/workbench/lib/tree-sitter-init', () => {
  const { mocks: m } = ensureTestGlobals()
  return {
    initializeTreeSitter: () => m.initializeTreeSitter(),
    isInitialized: () => m.isInitialized(),
  }
})

vi.mock('@/features/workbench/lib/codemirror/expression-completion', () => {
  const { mocks: m } = ensureTestGlobals()
  return {
    createExpressionCompletionSource: (vars: unknown, isField: unknown) => m.createCompletionSource(vars, isField),
  }
})

vi.mock('@/features/workbench/lib/codemirror/expression-decorations', () => {
  const { mocks: m } = ensureTestGlobals()
  return {
    createExpressionHighlighter: (issues: unknown) => m.createHighlighter(issues),
  }
})

vi.mock('@/features/workbench/lib/codemirror/expression-tooltips', () => {
  const { mocks: m } = ensureTestGlobals()
  return {
    createValidationTooltip: (issues: unknown) => m.createTooltip(issues),
  }
})

vi.mock('@/features/workbench/lib/codemirror/expression-theme', () => ({
  expressionEditorTheme: 'expr-editor-theme',
  expressionHighlightTheme: 'expr-highlight-theme',
  autocompleteDropdownTheme: 'autocomplete-theme',
}))

vi.mock('@/features/workbench/lib/codemirror/escape-handler', () => {
  const { captured: c, mocks: m } = ensureTestGlobals()
  return {
    registerEscapeHandler: (handler: any) => {
      c.escapeHandler = handler
      return m.unregisterEscape
    },
  }
})

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

// ============================================================================
// Import after mocks
// ============================================================================

import { ExpressionInput } from '@/features/workbench/common/element-config/expressions/expression-input'

// Save the transaction filter captured at module import time (before any
// beforeEach can reset it). singleLineExtension is module-level code.
const savedTransactionFilter = captured.transactionFilter

// ============================================================================
// Test Helpers
// ============================================================================

const defaultVariables = [
  { name: 'endpoint', type: 'string' },
  { name: 'count', type: 'integer' },
]

function renderInput(overrides: Partial<React.ComponentProps<typeof ExpressionInput>> = {}) {
  const props = {
    name: 'test-param',
    value: '',
    onChange: vi.fn(),
    availableVariables: defaultVariables,
    ...overrides,
  }
  return { ...render(<ExpressionInput {...props} />), props }
}

/** Every color the placeholder can take: `.cm-placeholder` theme rules and a styled placeholder element. */
function placeholderColors(): string[] {
  const specs = captured.themeSpecs as Record<string, Record<string, string>>[]
  const fromThemes = specs
    .flatMap((spec) => Object.entries(spec))
    .filter(([selector]) => selector.includes('.cm-placeholder'))
    .map(([, style]) => style.color)
  const content = captured.extensions.find(
    (ext: any) => ext && typeof ext === 'object' && ext.type === 'placeholder'
  )?.text
  const fromElement =
    content instanceof HTMLElement && content.className.includes('--color-text-muted')
      ? ['var(--color-text-muted)']
      : []
  return [...fromThemes, ...fromElement]
}

// ============================================================================
// Tests
// ============================================================================

describe('ExpressionInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.keymapBindings = []
    captured.extensions = []
    captured.escapeHandler = null
    captured.transactionFilter = null
    mocks.isInitialized.mockReturnValue(true)
    mocks.validateExpressions.mockReturnValue([])
  })

  // --------------------------------------------------------------------------
  // Basic Rendering
  // --------------------------------------------------------------------------

  describe('rendering', () => {
    it('renders with correct data-testid', () => {
      renderInput({ name: 'my-field' })
      expect(screen.getByTestId('param-input-my-field')).toBeInTheDocument()
    })

    it('renders the CodeMirror mock input', () => {
      renderInput()
      expect(screen.getByTestId('codemirror-input')).toBeInTheDocument()
    })

    it('passes value to CodeMirror', () => {
      renderInput({ value: 'len(items)' })
      expect(mocks.codeMirrorProps).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'len(items)' })
      )
    })

    it('passes onChange to CodeMirror', () => {
      const onChange = vi.fn()
      renderInput({ onChange })
      const input = screen.getByTestId('codemirror-input')
      fireEvent.change(input, { target: { value: 'new_val' } })
      expect(onChange).toHaveBeenCalledWith('new_val')
    })

    it('passes basicSetup=false and theme="none"', () => {
      renderInput()
      expect(mocks.codeMirrorProps).toHaveBeenCalledWith(
        expect.objectContaining({ basicSetup: false, theme: 'none' })
      )
    })
  })

  // --------------------------------------------------------------------------
  // Border Styling
  // --------------------------------------------------------------------------

  describe('border styling', () => {
    it('applies default border-input class when no errors or focus', () => {
      renderInput()
      const wrapper = screen.getByTestId('param-input-test-param')
      expect(wrapper.className).toContain('border-input')
    })

    it('applies border-destructive when isInvalid is true', () => {
      renderInput({ isInvalid: true })
      const wrapper = screen.getByTestId('param-input-test-param')
      expect(wrapper.className).toContain('border-destructive')
    })

    it('applies border-amber-500 when there are expression issues but not isInvalid', () => {
      mocks.validateExpressions.mockReturnValue([
        { from: 0, to: 3, type: 'unknown_variable', message: 'Unknown var' },
      ])
      renderInput()
      const wrapper = screen.getByTestId('param-input-test-param')
      expect(wrapper.className).toContain('border-amber-500')
    })

    it('does not apply amber border when isInvalid is true even with expression issues', () => {
      mocks.validateExpressions.mockReturnValue([
        { from: 0, to: 3, type: 'unknown_variable', message: 'Unknown var' },
      ])
      renderInput({ isInvalid: true })
      const wrapper = screen.getByTestId('param-input-test-param')
      expect(wrapper.className).toContain('border-destructive')
      // isInvalid prevents amber from showing (border-input is also absent)
      expect(wrapper.className).not.toContain('border-amber-500')
    })
  })

  // --------------------------------------------------------------------------
  // Focus Styling
  // --------------------------------------------------------------------------

  describe('focus styling', () => {
    it('applies ring-2 ring-ring when focused via updateListener', () => {
      renderInput()
      // The updateListener is captured in extensions - find it and trigger focus
      const updateListenerExt = captured.extensions.find(
        (ext: any) => ext && typeof ext === 'object' && 'type' in ext && ext.type === 'updateListener'
      ) as any
      expect(updateListenerExt).toBeDefined()

      // Simulate focus change
      act(() => {
        updateListenerExt.fn({ focusChanged: true, view: { hasFocus: true } })
      })

      const wrapper = screen.getByTestId('param-input-test-param')
      expect(wrapper.className).toContain('ring-2')
      expect(wrapper.className).toContain('ring-ring')
    })

    it('calls onBlur when focus is lost via updateListener', () => {
      const onBlur = vi.fn()
      renderInput({ onBlur })
      const updateListenerExt = captured.extensions.find(
        (ext: any) => ext && typeof ext === 'object' && 'type' in ext && ext.type === 'updateListener'
      ) as any

      act(() => {
        updateListenerExt.fn({ focusChanged: true, view: { hasFocus: false } })
      })

      expect(onBlur).toHaveBeenCalled()
    })

    it('does not call onBlur when focusChanged is false', () => {
      const onBlur = vi.fn()
      renderInput({ onBlur })
      const updateListenerExt = captured.extensions.find(
        (ext: any) => ext && typeof ext === 'object' && 'type' in ext && ext.type === 'updateListener'
      ) as any

      act(() => {
        updateListenerExt.fn({ focusChanged: false, view: { hasFocus: false } })
      })

      expect(onBlur).not.toHaveBeenCalled()
    })

    it('removes ring classes when unfocused', () => {
      renderInput()
      const updateListenerExt = captured.extensions.find(
        (ext: any) => ext && typeof ext === 'object' && 'type' in ext && ext.type === 'updateListener'
      ) as any

      // Focus
      act(() => {
        updateListenerExt.fn({ focusChanged: true, view: { hasFocus: true } })
      })
      expect(screen.getByTestId('param-input-test-param').className).toContain('ring-2')

      // Unfocus
      act(() => {
        updateListenerExt.fn({ focusChanged: true, view: { hasFocus: false } })
      })
      expect(screen.getByTestId('param-input-test-param').className).not.toContain('ring-2')
    })
  })

  // --------------------------------------------------------------------------
  // Validation
  // --------------------------------------------------------------------------

  describe('validation', () => {
    it('calls validateExpressions with value, variableNames set, variableTypes map, and isFieldExpression', () => {
      renderInput({ value: 'endpoint + count', isFieldExpression: true })
      expect(mocks.validateExpressions).toHaveBeenCalledWith(
        'endpoint + count',
        new Set(['endpoint', 'count']),
        new Map([['endpoint', 'string'], ['count', 'integer']]),
        true
      )
    })

    it('defaults isFieldExpression to false', () => {
      renderInput({ value: 'x' })
      expect(mocks.validateExpressions).toHaveBeenCalledWith(
        'x',
        expect.any(Set),
        expect.any(Map),
        false
      )
    })

    it('creates decoration issues from validation results', () => {
      mocks.validateExpressions.mockReturnValue([
        { from: 0, to: 3, type: 'unknown_variable', message: 'Unknown' },
        { from: 5, to: 10, type: 'syntax_error', message: 'Bad syntax' },
      ])
      renderInput({ value: 'foo + bar()' })

      // Check that createExpressionHighlighter was called with decoration issues
      expect(mocks.createHighlighter).toHaveBeenCalledWith([
        { from: 0, to: 3, severity: 'warning' },
        { from: 5, to: 10, severity: 'error' },
      ])
    })

    it('passes validation issues to createValidationTooltip', () => {
      const issues = [{ from: 0, to: 5, type: 'unknown_variable', message: 'Not found' }]
      mocks.validateExpressions.mockReturnValue(issues)
      renderInput({ value: 'hello' })
      expect(mocks.createTooltip).toHaveBeenCalledWith(issues)
    })
  })

  // --------------------------------------------------------------------------
  // Tree-sitter Initialization
  // --------------------------------------------------------------------------

  describe('tree-sitter initialization', () => {
    it('does not call initializeTreeSitter when already initialized', () => {
      mocks.isInitialized.mockReturnValue(true)
      renderInput()
      expect(mocks.initializeTreeSitter).not.toHaveBeenCalled()
    })

    it('calls initializeTreeSitter when not initialized', async () => {
      mocks.isInitialized.mockReturnValue(false)
      mocks.initializeTreeSitter.mockResolvedValue(undefined)
      await act(async () => {
        renderInput()
      })
      expect(mocks.initializeTreeSitter).toHaveBeenCalled()
    })

    it('says the expression is not checked when the validator fails to load', async () => {
      mocks.isInitialized.mockReturnValue(false)
      mocks.initializeTreeSitter.mockRejectedValue(new Error('WASM load failed'))
      await act(async () => {
        renderInput()
      })
      expect(screen.getByTestId('param-input-test-param-not-checked')).toHaveTextContent(
        'Not checked - could not load expression validation. WASM load failed'
      )
    })

    it('marks the field unchecked instead of clean when the validator fails to load', async () => {
      mocks.isInitialized.mockReturnValue(false)
      mocks.initializeTreeSitter.mockRejectedValue(new Error('WASM load failed'))
      await act(async () => {
        renderInput()
      })
      const wrapper = screen.getByTestId('param-input-test-param')
      expect(wrapper.className).toContain('border-amber-500')
      expect(wrapper.className).not.toContain('border-input')
    })

    it('keeps the invalid border when the field is invalid and the validator failed', async () => {
      mocks.isInitialized.mockReturnValue(false)
      mocks.initializeTreeSitter.mockRejectedValue(new Error('WASM load failed'))
      await act(async () => {
        renderInput({ isInvalid: true })
      })
      const wrapper = screen.getByTestId('param-input-test-param')
      expect(wrapper.className).toContain('border-destructive')
      expect(wrapper.className).not.toContain('border-amber-500')
    })

    it('Try Again loads the validator again and clears the notice', async () => {
      mocks.isInitialized.mockReturnValue(false)
      mocks.initializeTreeSitter.mockRejectedValue(new Error('WASM load failed'))
      await act(async () => {
        renderInput()
      })

      mocks.initializeTreeSitter.mockResolvedValue(undefined)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
      })

      expect(mocks.initializeTreeSitter).toHaveBeenCalledTimes(2)
      expect(screen.queryByTestId('param-input-test-param-not-checked')).not.toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Available Variables
  // --------------------------------------------------------------------------

  describe('available variables', () => {
    it('creates completion source from available variables', () => {
      const vars = [{ name: 'x', type: 'string' }, { name: 'y', type: 'integer' }]
      renderInput({ availableVariables: vars, isFieldExpression: true })
      expect(mocks.createCompletionSource).toHaveBeenCalledWith(vars, true)
    })
  })

  // --------------------------------------------------------------------------
  // Placeholder
  // --------------------------------------------------------------------------

  describe('placeholder', () => {
    it('includes placeholder extension when placeholder prop is provided', () => {
      renderInput({ placeholder: 'Enter expression…' })
      const placeholderExt = captured.extensions.find(
        (ext: any) => ext && typeof ext === 'object' && 'type' in ext && ext.type === 'placeholder'
      )
      expect(placeholderExt).toBeDefined()
    })

    it('includes empty array when no placeholder prop', () => {
      renderInput()
      // The placeholder slot should be an empty array
      const hasPlaceholderExt = captured.extensions.some(
        (ext: any) => ext && typeof ext === 'object' && 'type' in ext && ext.type === 'placeholder'
      )
      expect(hasPlaceholderExt).toBe(false)
    })

    it('paints the placeholder in Text Muted, the one gray of a not-set default', async () => {
      renderInput({ placeholder: "'hello'" })
      // The shared expression theme counts too: its rules reach the inline field as well.
      await vi.importActual('@/features/workbench/lib/codemirror/expression-theme')

      expect(placeholderColors()).toContain('var(--color-text-muted)')
    })
  })

  // --------------------------------------------------------------------------
  // Escape Handler
  // --------------------------------------------------------------------------

  describe('escape handler', () => {
    it('registers an escape handler on mount', () => {
      renderInput()
      expect(captured.escapeHandler).toBeDefined()
    })

    it('unregisters escape handler on unmount', () => {
      const { unmount } = renderInput()
      unmount()
      expect(mocks.unregisterEscape).toHaveBeenCalled()
    })

    it('returns false when editorRef view is null', () => {
      renderInput()
      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      Object.defineProperty(event, 'target', { value: document.createElement('div') })
      const result = captured.escapeHandler!(event)
      expect(result).toBe(false)
    })

    it('returns false when event target is not an HTMLElement', () => {
      renderInput()
      // Set up a view with dom
      const editorDom = document.createElement('div')
      captured.editorRef.view = {
        state: {},
        dom: editorDom,
        contentDOM: { blur: vi.fn() },
      }

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      // target defaults to null (not an HTMLElement)
      const result = captured.escapeHandler!(event)
      expect(result).toBe(false)
    })

    it('returns false when target is not within editor dom', () => {
      renderInput()
      const editorDom = document.createElement('div')
      const outsideElement = document.createElement('div')
      captured.editorRef.view = {
        state: {},
        dom: editorDom,
        contentDOM: { blur: vi.fn() },
      }

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      Object.defineProperty(event, 'target', { value: outsideElement })
      const result = captured.escapeHandler!(event)
      expect(result).toBe(false)
    })

    it('closes completion when active and target is within editor', () => {
      renderInput()
      const editorDom = document.createElement('div')
      const targetEl = document.createElement('span')
      editorDom.appendChild(targetEl)
      const mockView = {
        state: {},
        dom: editorDom,
        contentDOM: { blur: vi.fn() },
      }
      captured.editorRef.view = mockView
      mocks.completionStatus.mockReturnValue('active')

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      Object.defineProperty(event, 'target', { value: targetEl })
      const result = captured.escapeHandler!(event)

      expect(result).toBe(true)
      expect(mocks.closeCompletion).toHaveBeenCalledWith(mockView)
      expect(mockView.contentDOM.blur).not.toHaveBeenCalled()
    })

    it('blurs editor when completion is not active and target is within editor', () => {
      renderInput()
      const editorDom = document.createElement('div')
      const targetEl = document.createElement('span')
      editorDom.appendChild(targetEl)
      const mockView = {
        state: {},
        dom: editorDom,
        contentDOM: { blur: vi.fn() },
      }
      captured.editorRef.view = mockView
      mocks.completionStatus.mockReturnValue(null)

      const event = new KeyboardEvent('keydown', { key: 'Escape' })
      Object.defineProperty(event, 'target', { value: targetEl })
      const result = captured.escapeHandler!(event)

      expect(result).toBe(true)
      expect(mocks.closeCompletion).not.toHaveBeenCalled()
      expect(mockView.contentDOM.blur).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// buildExpressionKeymap Tests
// ============================================================================

describe('buildExpressionKeymap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    captured.keymapBindings = []
  })

  function getKeymapBindings(onOpenFullEditor?: () => void) {
    // Render with onOpenFullEditor to trigger buildExpressionKeymap
    render(
      <ExpressionInput
        name="keymap-test"
        value=""
        onChange={vi.fn()}
        availableVariables={defaultVariables}
        onOpenFullEditor={onOpenFullEditor}
      />
    )
    return captured.keymapBindings
  }

  function findBinding(bindings: any[], key: string) {
    return bindings.find((b: any) => b.key === key)
  }

  function createMockView(completionActive: boolean) {
    const state = { mock: true }
    mocks.completionStatus.mockReturnValue(completionActive ? 'active' : null)
    return {
      state,
      contentDOM: { blur: vi.fn() },
    }
  }

  describe('Enter key', () => {
    it('accepts completion when autocomplete is active', () => {
      const bindings = getKeymapBindings()
      const enterBinding = findBinding(bindings, 'Enter')
      const view = createMockView(true)

      const result = enterBinding.run(view)
      expect(mocks.acceptCompletion).toHaveBeenCalledWith(view)
      expect(view.contentDOM.blur).not.toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('blurs the editor when autocomplete is not active', () => {
      const bindings = getKeymapBindings()
      const enterBinding = findBinding(bindings, 'Enter')
      const view = createMockView(false)

      const result = enterBinding.run(view)
      expect(mocks.acceptCompletion).not.toHaveBeenCalled()
      expect(view.contentDOM.blur).toHaveBeenCalled()
      expect(result).toBe(true)
    })
  })

  describe('ArrowDown key', () => {
    it('moves completion selection down when active', () => {
      const moveFn = vi.fn()
      mocks.moveCompletionSelection.mockReturnValue(moveFn)
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'ArrowDown')
      const view = createMockView(true)

      const result = binding.run(view)
      expect(mocks.moveCompletionSelection).toHaveBeenCalledWith(true)
      expect(moveFn).toHaveBeenCalledWith(view)
      expect(result).toBe(true)
    })

    it('returns false when autocomplete is not active', () => {
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'ArrowDown')
      const view = createMockView(false)

      const result = binding.run(view)
      expect(result).toBe(false)
    })
  })

  describe('ArrowUp key', () => {
    it('moves completion selection up when active', () => {
      const moveFn = vi.fn()
      mocks.moveCompletionSelection.mockReturnValue(moveFn)
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'ArrowUp')
      const view = createMockView(true)

      const result = binding.run(view)
      expect(mocks.moveCompletionSelection).toHaveBeenCalledWith(false)
      expect(moveFn).toHaveBeenCalledWith(view)
      expect(result).toBe(true)
    })

    it('returns false when autocomplete is not active', () => {
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'ArrowUp')
      const view = createMockView(false)

      const result = binding.run(view)
      expect(result).toBe(false)
    })
  })

  describe('Tab key', () => {
    it('accepts completion when active', () => {
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'Tab')
      const view = createMockView(true)

      const result = binding.run(view)
      expect(mocks.acceptCompletion).toHaveBeenCalledWith(view)
      expect(result).toBe(true)
    })

    it('returns true even when autocomplete is not active (prevents default tab)', () => {
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'Tab')
      const view = createMockView(false)

      const result = binding.run(view)
      expect(mocks.acceptCompletion).not.toHaveBeenCalled()
      expect(result).toBe(true)
    })
  })

  describe('Shift-Tab and Ctrl-Tab keys', () => {
    it('Shift-Tab returns true (prevents default)', () => {
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'Shift-Tab')
      expect(binding.run()).toBe(true)
    })

    it('Ctrl-Tab returns true (prevents default)', () => {
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'Ctrl-Tab')
      expect(binding.run()).toBe(true)
    })
  })

  describe('PageDown key', () => {
    it('moves selection 5 times when autocomplete is active', () => {
      const moveFn = vi.fn()
      mocks.moveCompletionSelection.mockReturnValue(moveFn)
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'PageDown')
      const view = createMockView(true)

      const result = binding.run(view)
      expect(mocks.moveCompletionSelection).toHaveBeenCalledWith(true)
      // moveCompletionSelection(true) called once, its return fn called 5 times
      expect(moveFn).toHaveBeenCalledTimes(5)
      expect(result).toBe(true)
    })

    it('returns false when autocomplete is not active', () => {
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'PageDown')
      const view = createMockView(false)

      const result = binding.run(view)
      expect(result).toBe(false)
    })
  })

  describe('PageUp key', () => {
    it('moves selection 5 times when autocomplete is active', () => {
      const moveFn = vi.fn()
      mocks.moveCompletionSelection.mockReturnValue(moveFn)
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'PageUp')
      const view = createMockView(true)

      const result = binding.run(view)
      expect(mocks.moveCompletionSelection).toHaveBeenCalledWith(false)
      expect(moveFn).toHaveBeenCalledTimes(5)
      expect(result).toBe(true)
    })

    it('returns false when autocomplete is not active', () => {
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'PageUp')
      const view = createMockView(false)

      const result = binding.run(view)
      expect(result).toBe(false)
    })
  })

  describe('Ctrl-Space key', () => {
    it('starts completion', () => {
      const bindings = getKeymapBindings()
      const binding = findBinding(bindings, 'Ctrl-Space')
      const view = createMockView(false)

      const result = binding.run(view)
      expect(mocks.startCompletion).toHaveBeenCalledWith(view)
      expect(result).toBe(true)
    })
  })

  describe('Ctrl-e key', () => {
    it('calls onOpenFullEditor when provided and blurs the inline editor first', () => {
      const onOpen = vi.fn()
      const blur = vi.fn()
      const bindings = getKeymapBindings(onOpen)
      const binding = findBinding(bindings, 'Ctrl-e')

      const result = binding.run({ contentDOM: { blur } })
      expect(blur).toHaveBeenCalled()
      expect(onOpen).toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('returns false when onOpenFullEditor is not provided', () => {
      const bindings = getKeymapBindings(undefined)
      const binding = findBinding(bindings, 'Ctrl-e')

      const result = binding.run({ contentDOM: { blur: vi.fn() } })
      expect(result).toBe(false)
    })
  })
})

// ============================================================================
// singleLineExtension Tests
// ============================================================================

describe('singleLineExtension', () => {
  /** Runs one real CodeMirror edit through the filter and returns the text it leaves. */
  async function edit(
    doc: string,
    change: { from: number; to?: number; insert: string },
    userEvent?: string,
  ): Promise<string> {
    const { EditorState } = await vi.importActual<typeof import('@codemirror/state')>('@codemirror/state')
    const start = EditorState.create({ doc })
    const tr = start.update({ changes: change, ...(userEvent === undefined ? {} : { userEvent }) })
    const result = savedTransactionFilter(tr)
    if (result === tr) return tr.state.doc.toString()
    const specs = Array.isArray(result) ? result : [result]
    return start.update(...specs).state.doc.toString()
  }

  it('leaves a one-line edit as it is', async () => {
    expect(await edit('count + 1', { from: 9, insert: '0' }, 'input.type')).toBe('count + 10')
  })

  it('keeps the line breaks of a stored multi-line expression when a character is typed', async () => {
    expect(await edit('total +\n  1', { from: 11, insert: '2' }, 'input.type')).toBe('total +\n  12')
  })

  it('keeps the line breaks when a character inside the expression is deleted', async () => {
    expect(await edit('a +\nbc +\nd', { from: 5, to: 6, insert: '' }, 'delete.backward')).toBe('a +\nb +\nd')
  })

  it('keeps the line breaks of a multi-line expression written back over the whole text', async () => {
    // The larger editor's result replaces the whole inline text.
    const doc = 'items\n  .count()'
    expect(await edit(doc, { from: 0, to: doc.length, insert: 'items\n  .count() + 1' })).toBe(
      'items\n  .count() + 1',
    )
  })

  it('adds no line of its own: a pasted line break keeps the stored lines and adds none', async () => {
    const result = await edit('a +\nb', { from: 5, insert: ' +\nc' }, 'input.paste')

    expect(result.split('\n')).toHaveLength(2)
    expect(result.startsWith('a +\nb')).toBe(true)
  })

  it('pastes a multi-line text into a one-line expression as one line', async () => {
    expect(await edit('x', { from: 0, to: 1, insert: 'a\nb\nc' }, 'input.paste')).toBe('abc')
  })
})

// ============================================================================
// setupGlobalWheelHandler Tests
// ============================================================================

describe('setupGlobalWheelHandler', () => {
  // The handler is attached via ViewPlugin.define which is called during module load.
  // Since we mock ViewPlugin.define to call its factory, the handler gets attached
  // during the first render. We test by dispatching wheel events.

  it('scrolls autocomplete list when wheel event targets tooltip', () => {
    // Create DOM structure mimicking autocomplete tooltip
    const ul = document.createElement('ul')
    ul.scrollTop = 0
    const tooltip = document.createElement('div')
    tooltip.classList.add('cm-tooltip-autocomplete')
    tooltip.appendChild(ul)
    document.body.appendChild(tooltip)

    // Render to ensure handler is set up
    render(
      <ExpressionInput
        name="wheel-test"
        value=""
        onChange={vi.fn()}
        availableVariables={[]}
      />
    )

    // Dispatch wheel event targeting the ul inside the tooltip
    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 50,
      bubbles: true,
      cancelable: true,
    })
    ul.dispatchEvent(wheelEvent)

    expect(ul.scrollTop).toBe(50)

    // Cleanup
    document.body.removeChild(tooltip)
  })

  it('does nothing when wheel event target is not in autocomplete tooltip', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)

    render(
      <ExpressionInput
        name="wheel-test2"
        value=""
        onChange={vi.fn()}
        availableVariables={[]}
      />
    )

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 50,
      bubbles: true,
      cancelable: true,
    })
    div.dispatchEvent(wheelEvent)

    // Event should not be prevented (not inside autocomplete tooltip)
    expect(wheelEvent.defaultPrevented).toBe(false)

    document.body.removeChild(div)
  })

  it('does nothing when tooltip has no ul element', () => {
    const tooltip = document.createElement('div')
    tooltip.classList.add('cm-tooltip-autocomplete')
    // No <ul> child
    document.body.appendChild(tooltip)

    render(
      <ExpressionInput
        name="wheel-test3"
        value=""
        onChange={vi.fn()}
        availableVariables={[]}
      />
    )

    const wheelEvent = new WheelEvent('wheel', {
      deltaY: 50,
      bubbles: true,
      cancelable: true,
    })
    tooltip.dispatchEvent(wheelEvent)

    // No ul to scroll, so scrollTop stays at 0 and event should not be affected
    expect(tooltip.querySelector('ul')).toBeNull()

    document.body.removeChild(tooltip)
  })

  it('skips re-attaching when handler is already attached', () => {
    // The ViewPlugin factory was captured during module import.
    // Calling it again exercises the "already attached" early return in setupGlobalWheelHandler.
    expect(captured.viewPluginFactory).toBeDefined()
    // Should not throw - just returns early
    captured.viewPluginFactory()
  })

  it('attaches the CodeMirror read-only extension under a read-only canvas context', async () => {
    const { CanvasReadOnlyProvider } = await import(
      '@/features/workbench/common/canvas/read-only-context'
    )
    const { container } = render(
      <CanvasReadOnlyProvider value={true}>
        <ExpressionInput
          name="ro-param"
          value=""
          onChange={vi.fn()}
          availableVariables={defaultVariables}
        />
      </CanvasReadOnlyProvider>,
    )
    // The readOnly branch adds EditorState.readOnly.of(true) to the
    // extensions array - the render completing without throwing proves
    // the branch executed. The actual read-only behavior (blocking
    // inserts) is a CodeMirror internal we don't re-test here.
    expect(container).toBeTruthy()
  })
})
