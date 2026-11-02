/**
 * DetailsDialog - renders documentation as real Markdown (headings, lists,
 * bold, code) and wraps the description + long content.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { DetailsDialog } from '@/features/workbench/common/element-config/dialogs/details-dialog'

const DETAILS = [
  '# Doc heading',
  '## Section',
  '- point one',
  '- point two',
  '',
  '**bold text** and `inline code`',
  '',
  'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM',
].join('\n')

function renderDialog(props: Partial<Parameters<typeof DetailsDialog>[0]> = {}) {
  return render(
    <DetailsDialog
      isOpen
      onClose={vi.fn()}
      elementName="F1-Func"
      version="2.0.0"
      description="a short description"
      details={DETAILS}
      {...props}
    />,
  )
}

describe('DetailsDialog', () => {
  it('renders documentation as Markdown (headings, list, bold, code)', () => {
    renderDialog()
    expect(screen.getByRole('heading', { level: 1, name: 'Doc heading' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeInTheDocument()
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toContain('point one')
    expect(items).toContain('point two')
    expect(screen.getByText('bold text').tagName).toBe('STRONG')
    expect(screen.getByText('inline code').tagName).toBe('CODE')
    // Raw heading markdown must NOT render literally.
    expect(screen.queryByText('# Doc heading')).toBeNull()
  })

  it('wraps long markdown content with break-words (no horizontal run-off)', () => {
    const { container } = renderDialog()
    expect(container.ownerDocument.querySelector('.break-words')).not.toBeNull()
  })

  it('wraps the description so a long subtitle cannot overflow', () => {
    const longDescription =
      'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM'
    renderDialog({ description: longDescription })
    const node = screen.getByText(longDescription)
    expect(node.closest('.break-words')).not.toBeNull()
  })

  it('falls back to a placeholder when no details are provided', () => {
    renderDialog({ details: undefined })
    expect(screen.getByText(/No detailed documentation available/i)).toBeInTheDocument()
  })

  it('falls back to a generated subtitle when no description is given', () => {
    renderDialog({ description: undefined })
    expect(screen.getByText('Documentation for version 2.0.0')).toBeInTheDocument()
  })
})
