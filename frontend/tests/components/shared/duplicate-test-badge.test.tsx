/**
 * DuplicateTestBadge Component Tests
 *
 * Small badge placed next to a test that appears in 2+ suites of the same
 * regression. Hovering opens a HoverCard with a scrollable list of the
 * containing suites (names, in regression order).
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { DuplicateTestBadge } from '@/components/shared/duplicate-test-badge'

describe('DuplicateTestBadge', () => {
  it('renders the badge trigger when suites length >= 2', () => {
    render(<DuplicateTestBadge suites={[{ id: 's1', name: 'Alpha' }, { id: 's2', name: 'Beta' }]} />)
    expect(screen.getByTestId('duplicate-test-badge')).toBeInTheDocument()
  })

  it('renders nothing when fewer than 2 suites are supplied', () => {
    const { container } = render(<DuplicateTestBadge suites={[{ id: 's1', name: 'Only One' }]} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the hover-card content listing all suite names in order on hover', async () => {
    const suites = [
      { id: 's1', name: 'Authentication' },
      { id: 's2', name: 'Billing' },
      { id: 's3', name: 'Checkout' },
    ]
    render(<DuplicateTestBadge suites={suites} />)

    await userEvent.setup().hover(screen.getByTestId('duplicate-test-badge'))

    const content = await screen.findByTestId('duplicate-test-badge-content')
    const names = within(content).getAllByTestId('duplicate-test-badge-suite').map((n) => n.textContent)
    expect(names).toEqual(['Authentication', 'Billing', 'Checkout'])
  })

  it('uses a scrollable area so long suite lists do not overflow the viewport', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `s-${i}`, name: `Suite ${i}` }))
    render(<DuplicateTestBadge suites={many} />)

    await userEvent.setup().hover(screen.getByTestId('duplicate-test-badge'))

    const scroll = await screen.findByTestId('duplicate-test-badge-scroll')
    expect(scroll).toBeInTheDocument()
  })
})
