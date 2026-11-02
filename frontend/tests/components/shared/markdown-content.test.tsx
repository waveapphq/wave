/**
 * MarkdownContent - the shared markdown renderer: turns markdown source into
 * real elements (headings/lists) and carries the prose + long-token-wrapping
 * classes. Real styling (typography sizing, bullets, wrapping) is verified in
 * the browser by the v-fn-config-dialogs-md Playwright guard; jsdom has no
 * layout/stylesheet engine so it can only assert structure + class presence.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { MarkdownContent } from '@/components/shared/markdown-content'

describe('MarkdownContent', () => {
  it('renders markdown source as real elements, not literal text', () => {
    render(<MarkdownContent text={'# Title\n\n- one\n- two'} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText('# Title')).toBeNull()
  })

  it('applies the prose + long-token-wrapping classes', () => {
    const { container } = render(<MarkdownContent text="hello" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('prose')
    expect(root.className).toContain('[overflow-wrap:anywhere]')
  })
})
