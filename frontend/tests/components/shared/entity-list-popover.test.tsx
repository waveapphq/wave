/**
 * EntityListPopover Tests
 *
 * Tests for the shared EntityListPopover component extracted from
 * collision-resolution-modal.tsx so it can be reused by the canvas
 * breadcrumb collapse popover.
 *
 * Contract:
 *   - Opens on trigger click
 *   - Closes on Escape
 *   - Renders one row per entity
 *   - Calls onNavigate(href) when a row with href is clicked
 *   - Renders a non-interactive label row when no href
 *   - Optional leading icon slot per entity
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EntityListPopover } from '@/components/shared/entity-list-popover'

const ENTITIES = [
  { id: 'sa', name: 'Suite A', href: '/suites/sa' },
  { id: 'sb', name: 'Suite B', href: '/suites/sb' },
  { id: 'sc', name: 'Suite C', href: '/suites/sc' },
]

describe('EntityListPopover', () => {
  it('renders the trigger but keeps the list closed by default', () => {
    render(
      <EntityListPopover
        triggerLabel="3 suites"
        entities={ENTITIES}
        label="Suites"
        testId="entity-popover"
      />,
    )
    expect(screen.getByTestId('entity-popover-trigger')).toBeInTheDocument()
    expect(screen.queryByTestId('entity-popover-list')).not.toBeInTheDocument()
  })

  it('opens the list when the trigger is clicked', async () => {
    const user = userEvent.setup()
    render(
      <EntityListPopover
        triggerLabel="3 suites"
        entities={ENTITIES}
        label="Suites"
        testId="entity-popover"
      />,
    )
    await user.click(screen.getByTestId('entity-popover-trigger'))
    expect(await screen.findByTestId('entity-popover-list')).toBeInTheDocument()
    expect(screen.getByText('Suite A')).toBeInTheDocument()
    expect(screen.getByText('Suite B')).toBeInTheDocument()
    expect(screen.getByText('Suite C')).toBeInTheDocument()
  })

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup()
    render(
      <EntityListPopover
        triggerLabel="3 suites"
        entities={ENTITIES}
        testId="entity-popover"
      />,
    )
    await user.click(screen.getByTestId('entity-popover-trigger'))
    expect(await screen.findByTestId('entity-popover-list')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByTestId('entity-popover-list')).not.toBeInTheDocument()
    })
  })

  it('renders one row per entity', async () => {
    const user = userEvent.setup()
    render(
      <EntityListPopover
        triggerLabel="3 suites"
        entities={ENTITIES}
        testId="entity-popover"
      />,
    )
    await user.click(screen.getByTestId('entity-popover-trigger'))
    const list = await screen.findByTestId('entity-popover-list')
    const rows = list.querySelectorAll('[data-testid^="entity-popover-row-"]')
    expect(rows).toHaveLength(3)
  })

  it('calls onNavigate(href) when a row with href is clicked', async () => {
    const user = userEvent.setup()
    const handleNavigate = vi.fn()
    render(
      <EntityListPopover
        triggerLabel="3 suites"
        entities={ENTITIES}
        testId="entity-popover"
        onNavigate={handleNavigate}
      />,
    )
    await user.click(screen.getByTestId('entity-popover-trigger'))
    await screen.findByTestId('entity-popover-list')
    await user.click(screen.getByText('Suite B'))
    expect(handleNavigate).toHaveBeenCalledWith('/suites/sb')
  })

  it('does not call onNavigate for rows without an href', async () => {
    const user = userEvent.setup()
    const handleNavigate = vi.fn()
    const entities = [
      { id: 'one', name: 'Static Label' },
      { id: 'two', name: 'Clickable', href: '/x' },
    ]
    render(
      <EntityListPopover
        triggerLabel="2"
        entities={entities}
        testId="entity-popover"
        onNavigate={handleNavigate}
      />,
    )
    await user.click(screen.getByTestId('entity-popover-trigger'))
    await screen.findByTestId('entity-popover-list')
    await user.click(screen.getByText('Static Label'))
    expect(handleNavigate).not.toHaveBeenCalled()
  })

  it('renders the optional leading icon for each entity', async () => {
    const user = userEvent.setup()
    const entities = [
      {
        id: 'one',
        name: 'With Icon',
        href: '/x',
        icon: <span data-testid="row-icon">i</span>,
      },
    ]
    render(
      <EntityListPopover
        triggerLabel="1"
        entities={entities}
        testId="entity-popover"
      />,
    )
    await user.click(screen.getByTestId('entity-popover-trigger'))
    await screen.findByTestId('entity-popover-list')
    expect(screen.getByTestId('row-icon')).toBeInTheDocument()
  })

  it('uses explicit triggerTestId + listTestId overrides instead of the testId-derived names', async () => {
    const user = userEvent.setup()
    render(
      <EntityListPopover
        triggerLabel="3"
        entities={ENTITIES}
        triggerTestId="custom-trigger"
        listTestId="custom-list"
      />,
    )
    expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    expect(screen.queryByTestId('custom-list')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('custom-trigger'))
    expect(await screen.findByTestId('custom-list')).toBeInTheDocument()
  })
})
