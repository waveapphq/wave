/**
 * Tests for ValidationStrip - the shared validation strip above a variable modal
 * footer (single message, or first message + a "(+N more)" expander for a
 * multi-problem result). Used by the inspect/create modals and the locked-data
 * "Edit value" sheet.
 *
 * The strip carries `select-text` so a reported error can be
 * highlighted AND copied (the draggable sheet defaults to `select-none`). This
 * file guards the selectability contract at the unit level; the end-to-end
 * "select + Ctrl+C copies the text" behavior is a Playwright test
 * (jsdom does not model the parent sheet's clipboard interception).
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ValidationStrip } from '@/features/workbench/common/variables/variable-inspect-modal/validation-strip'

describe('ValidationStrip - single message', () => {
  it('renders the message as a polite alert', () => {
    render(<ValidationStrip testId="vstrip" message="Line 1: Unexpected token" messages={null} />)
    const strip = screen.getByTestId('vstrip')
    expect(strip).toHaveAttribute('role', 'alert')
    expect(strip).toHaveAttribute('aria-live', 'polite')
    expect(strip).toHaveTextContent('Line 1: Unexpected token')
  })

  it('does not render the "(+N more)" expander for a single message', () => {
    render(<ValidationStrip testId="vstrip" message="only one" messages={['only one']} />)
    expect(screen.queryByTestId('vstrip-more')).not.toBeInTheDocument()
  })
})

describe('ValidationStrip - multiple messages', () => {
  it('renders the first message plus a "(+N more)" expander', () => {
    render(
      <ValidationStrip
        testId="vstrip"
        message="first problem"
        messages={['first problem', 'second problem', 'third problem']}
      />,
    )
    expect(screen.getByText('first problem')).toBeInTheDocument()
    expect(screen.getByTestId('vstrip-more')).toHaveTextContent('(+2 more)')
  })
})

// The strip MUST stay user-selectable so the error is copyable.
// `select-text` overrides the draggable sheet's `select-none`; a regression that
// reintroduces `select-none` here breaks copy.
describe('ValidationStrip - selectable text', () => {
  it('carries select-text so the error can be highlighted', () => {
    render(<ValidationStrip testId="vstrip" message="copy me" messages={null} />)
    expect(screen.getByTestId('vstrip').className).toContain('select-text')
  })

  it('does NOT carry select-none (which would block copy)', () => {
    render(<ValidationStrip testId="vstrip" message="copy me" messages={null} />)
    expect(screen.getByTestId('vstrip').className).not.toContain('select-none')
  })
})
