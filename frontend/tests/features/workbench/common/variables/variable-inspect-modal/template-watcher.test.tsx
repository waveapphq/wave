/**
 * Tests for the template-kind watcher in VariableInspectModal
 * (VMGR-72..75). A template is a first-class string value kind: it carries the
 * cyan `{{ }}` kind badge (the slot the expression `{x}` badge uses), a STRING
 * type pill, and a Rendered / Template View family (default Rendered) that
 * mirrors the expression Literal / Expression pair.
 *
 * Contract under test (read state):
 *   - `{{ }}` kind badge in the header; NO `{x}` expression badge
 *   - STRING type pill
 *   - View dropdown offers Rendered (default) + Template, NOT the literal-string
 *     Format dropdown
 *   - Rendered with no runtime value -> "Not rendered yet." + "no value yet"
 *     metric; with a value -> realized string + "N chars" metric
 *   - Template view -> the `{{ }}` source + "template" metric
 *
 * The CodeMirror / template stack is mocked (as in the sibling modal tests) so
 * the kind selection is observable without the real language modules.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.1.3.15: Template variables
 */

import { describe, it, expect, vi } from 'vitest'

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/workbench/api/workbench', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/workbench/api/workbench')>()
  return {
    ...actual,
    workbenchApi: { ...actual.workbenchApi, getSessionVariables: vi.fn() },
  }
})

vi.mock('@uiw/react-codemirror', () => ({
  default: (props: { value: string }) => (
    <div data-testid="codemirror-editor">{props.value}</div>
  ),
}))

vi.mock('@/lib/codemirror/json-data-editor', () => ({
  createJsonDataEditorExtensions: () => [],
}))

vi.mock('@/lib/codemirror/plain-text-editor', () => ({
  createPlainTextEditorExtensions: () => [],
}))

vi.mock('@/lib/codemirror/format-editor', () => ({
  createFormatExtensions: () => [],
}))

vi.mock('@/features/workbench/lib/codemirror/template-editor', () => ({
  buildTemplateExtensions: () => [],
}))

vi.mock('@/features/workbench/hooks/use-template-validation', () => ({
  useTemplateValidation: () => ({ templateHighlighter: null, templateTooltip: null }),
}))

import { VariableInspectModal } from '@/features/workbench/common/variables/variable-inspect-modal/variable-inspect-modal'
import type { Variable } from '@/features/workbench/common/variables/variable-manager-content/types'

const TEMPLATE_SOURCE = 'Hello {{user}}!'

function templateVariable(overrides: Partial<Variable> = {}): Variable {
  return {
    id: 'v1',
    name: 'greeting',
    value: TEMPLATE_SOURCE,
    type: 'string',
    isTemplate: true,
    ...overrides,
  } as Variable
}

interface ModalOverrides {
  variable?: Partial<Variable>
  runtimeValue?: unknown
  hasRuntimeValue?: boolean
  runtimeAvailable?: boolean
}

function renderModal(overrides: ModalOverrides = {}) {
  render(
    <VariableInspectModal
      variable={templateVariable(overrides.variable)}
      runtimeValue={overrides.runtimeValue}
      hasRuntimeValue={overrides.hasRuntimeValue ?? false}
      runtimeAvailable={overrides.runtimeAvailable ?? false}
      cascadeIndex={0}
      onClose={vi.fn()}
    />,
  )
}

function getModal(id = 'v1'): HTMLElement {
  return screen.getByTestId(`variable-inspect-modal-${id}`)
}

async function switchView(
  user: ReturnType<typeof userEvent.setup>,
  view: 'Rendered' | 'Template',
) {
  await user.click(within(getModal()).getByTestId('view-dropdown'))
  await user.click(await screen.findByRole('option', { name: view }))
}

describe('VariableInspectModal - template watcher kind badge + type', () => {
  it('renders the cyan {{ }} kind badge in the header', () => {
    renderModal()
    const badge = within(getModal()).getByTestId('inspect-template-badge')
    expect(badge).toHaveTextContent(/\{\{\s*\}\}/)
    expect(badge.className).toMatch(/cyan/)
  })

  it('does NOT render the {x} expression badge for a template', () => {
    renderModal()
    expect(
      within(getModal()).queryByTestId('inspect-expr-badge'),
    ).not.toBeInTheDocument()
  })

  it('renders the STRING type pill', () => {
    renderModal()
    const badge = within(getModal()).getByTestId('inspect-type-badge')
    expect(badge).toHaveTextContent(/string/i)
  })
})

describe('VariableInspectModal - template watcher View family', () => {
  it('shows the View dropdown (not the literal Format dropdown), defaulting to Rendered', () => {
    renderModal()
    const view = within(getModal()).getByTestId('view-dropdown')
    expect(view).toHaveTextContent('Rendered')
    expect(
      within(getModal()).queryByTestId('format-dropdown'),
    ).not.toBeInTheDocument()
  })

  it('offers exactly Rendered and Template view options', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(within(getModal()).getByTestId('view-dropdown'))
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Rendered',
      'Template',
    ])
  })
})

describe('VariableInspectModal - template watcher states', () => {
  it('Rendered with no runtime value shows "Not rendered yet." and no metric', () => {
    renderModal({ hasRuntimeValue: false, runtimeAvailable: true })
    expect(within(getModal()).getByText('Not rendered yet.')).toBeInTheDocument()
    // An empty state carries no metric (only a realized value gets "N chars").
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('Rendered with a runtime value shows the realized string and the char metric', () => {
    renderModal({
      runtimeValue: 'Hello Ada!',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    expect(getModal().textContent).toContain('Hello Ada!')
    expect(getModal().textContent).not.toContain(TEMPLATE_SOURCE)
    expect(within(getModal()).getByTestId('inspect-metric')).toHaveTextContent(
      '10 chars',
    )
  })

  it('Template view shows the {{ }} source with no metric', async () => {
    const user = userEvent.setup()
    renderModal({
      runtimeValue: 'Hello Ada!',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await switchView(user, 'Template')
    expect(getModal().textContent).toContain(TEMPLATE_SOURCE)
    // The {{ }} source is a template, not a counted value - no metric.
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('Initial mode pins to the {{ }} source with the View locked on Template', async () => {
    const user = userEvent.setup()
    // A runtime value exists, but Initial shows the source (definition), not it.
    renderModal({
      runtimeValue: 'Hello Ada!',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await user.click(within(getModal()).getByTestId('mode-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Initial' }))

    expect(getModal().textContent).toContain(TEMPLATE_SOURCE)
    expect(getModal().textContent).not.toContain('Hello Ada!')
    const view = within(getModal()).getByTestId('view-dropdown')
    expect(view).toHaveTextContent('Template')
    expect(view).toBeDisabled()
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })

  it('Compare shows the {{ }} source in both panes (source-vs-source) with no metric', async () => {
    const user = userEvent.setup()
    renderModal({
      runtimeValue: 'Hello Ada!',
      hasRuntimeValue: true,
      runtimeAvailable: true,
    })
    await user.click(within(getModal()).getByTestId('mode-dropdown'))
    await user.click(await screen.findByRole('option', { name: 'Compare' }))

    const initial = within(getModal()).getByTestId('compare-pane-initial')
    const current = within(getModal()).getByTestId('compare-pane-current')
    expect(initial.textContent).toContain(TEMPLATE_SOURCE)
    expect(current.textContent).toContain(TEMPLATE_SOURCE)
    expect(within(getModal()).getByTestId('view-dropdown')).toBeDisabled()
    expect(within(getModal()).queryByTestId('inspect-metric')).not.toBeInTheDocument()
  })
})
