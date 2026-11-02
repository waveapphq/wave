/**
 * SaveBlockedNote: the red note that names what keeps a parent's Save disabled.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { SaveBlockedNote } from '@/components/shared/child-editors/save-blocked-note'

describe('SaveBlockedNote', () => {
  it('renders nothing while nothing blocks Save', () => {
    const { container } = render(<SaveBlockedNote note={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('names what blocks Save in red', () => {
    render(<SaveBlockedNote note="Save is disabled: the settings have errors" />)

    const note = screen.getByTestId('save-blocked-note')
    expect(note).toHaveTextContent(/^Save is disabled: the settings have errors$/)
    expect(note.className).toContain('text-destructive')
  })

  it('takes layout classes from its host', () => {
    render(<SaveBlockedNote note="Save is disabled: the settings have errors" className="text-right" />)

    expect(screen.getByTestId('save-blocked-note').className).toContain('text-right')
  })

})
