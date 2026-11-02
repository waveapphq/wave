/**
 * Tests for the FunctionEmptySection placeholder (CANVAS-213).
 *
 * The empty-section placeholder is a single italic muted
 * line shown between the section dividers when the Function declares zero
 * inputs (or zero outputs).
 *
 * The empty-section placeholder is a role="note" element so screen
 * readers identify it as supplementary content.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { FunctionEmptySection } from '@/features/functions/canvas/function-empty-section'


describe('FunctionEmptySection - copy by kind', () => {
  it('inputs kind renders "This Function declares no inputs." verbatim', () => {
    render(<FunctionEmptySection kind="inputs" />)
    expect(
      screen.getByText('This Function declares no inputs.'),
    ).toBeInTheDocument()
  })

  it('outputs kind renders "This Function declares no outputs." verbatim', () => {
    render(<FunctionEmptySection kind="outputs" />)
    expect(
      screen.getByText('This Function declares no outputs.'),
    ).toBeInTheDocument()
  })
})


describe('FunctionEmptySection - accessibility', () => {
  it('exposes itself as role="note" for assistive tech', () => {
    render(<FunctionEmptySection kind="inputs" />)
    expect(screen.getByRole('note')).toBeInTheDocument()
  })
})


describe('FunctionEmptySection - styling hints', () => {
  it('applies italic styling so the placeholder reads as advisory text', () => {
    render(<FunctionEmptySection kind="inputs" />)
    const note = screen.getByRole('note')
    expect(note.className).toMatch(/italic/)
  })

  it('applies muted-text styling so the placeholder reads as advisory text', () => {
    render(<FunctionEmptySection kind="inputs" />)
    const note = screen.getByRole('note')
    expect(note.className).toMatch(/muted/)
  })
})
