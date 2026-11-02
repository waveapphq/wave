/**
 * DetailHeader Component Tests
 *
 * Covers:
 * - The Run / Export / Delete affordances.
 * - The breadcrumb extensions: `entityType`
 *   leading icon, `breadcrumbPrefix` parent link(s), the State-B collapse
 *   cascade (full prefix -> `…` + popover), and the skeleton placeholder
 *   while a prefix label is still loading.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { DetailHeader } from '@/components/shared/detail-header'

const baseProps = {
  name: 'My Entity',
  onBack: () => {},
}

function withSizes(scrollWidth: number, clientWidth: number, body: () => Promise<void> | void) {
  const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
  const clientDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      return scrollWidth
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return clientWidth
    },
  })
  return Promise.resolve(body()).finally(() => {
    if (scrollDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollDescriptor)
    }
    if (clientDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientDescriptor)
    }
  })
}

describe('DetailHeader', () => {
  it('renders a Run button when onRun is provided', () => {
    render(<DetailHeader {...baseProps} onRun={vi.fn()} />)
    expect(screen.getByTestId('detail-run-btn')).toBeInTheDocument()
  })

  it('does NOT render a Run button when onRun is omitted', () => {
    render(<DetailHeader {...baseProps} onExport={vi.fn()} />)
    expect(screen.queryByTestId('detail-run-btn')).toBeNull()
  })

  it('invokes onRun when the Run button is clicked', async () => {
    const onRun = vi.fn()
    render(<DetailHeader {...baseProps} onRun={onRun} />)

    await userEvent.setup().click(screen.getByTestId('detail-run-btn'))
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('uses a custom test id when runTestId is provided', () => {
    render(<DetailHeader {...baseProps} onRun={vi.fn()} runTestId="suite-run-btn" />)
    expect(screen.getByTestId('suite-run-btn')).toBeInTheDocument()
  })

  it('renders Run before Export and Delete in DOM order', () => {
    render(
      <DetailHeader
        {...baseProps}
        onRun={vi.fn()}
        onExport={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const buttons = screen.getAllByRole('button')
    const ids = buttons.map((b) => b.getAttribute('data-testid'))
    const runIdx = ids.indexOf('detail-run-btn')
    const exportIdx = ids.indexOf('export-btn')
    const deleteIdx = ids.indexOf('delete-btn')

    expect(runIdx).toBeGreaterThanOrEqual(0)
    expect(exportIdx).toBeGreaterThan(runIdx)
    expect(deleteIdx).toBeGreaterThan(exportIdx)
  })

  describe('entityType icon', () => {
    it('renders the entity icon when entityType is set', () => {
      render(<DetailHeader {...baseProps} entityType="suite" />)
      expect(screen.getByTestId('detail-entity-icon-suite')).toBeInTheDocument()
    })

    it('does NOT render an entity icon when entityType is omitted', () => {
      render(<DetailHeader {...baseProps} />)
      expect(screen.queryByTestId('detail-entity-icon-suite')).toBeNull()
      expect(screen.queryByTestId('detail-entity-icon-regression')).toBeNull()
      expect(screen.queryByTestId('detail-entity-icon-execution')).toBeNull()
    })
  })

  describe('breadcrumbPrefix - default (uncollapsed) state', () => {
    it('renders one anchor per prefix entry with its icon + label', () => {
      const prefix = [
        {
          type: 'regression' as const,
          label: 'Smoke - Prod',
          href: '/regressions/reg-1',
          onNavigate: vi.fn(),
        },
      ]
      render(
        <DetailHeader
          {...baseProps}
          entityType="suite"
          breadcrumbPrefix={prefix}
        />,
      )
      const wrapper = screen.getByTestId('detail-breadcrumb-regression')
      expect(wrapper).toBeInTheDocument()
      expect(wrapper).toHaveTextContent('Smoke - Prod')
    })

    it('fires the onNavigate callback when the prefix link is clicked', async () => {
      const onNavigate = vi.fn()
      const prefix = [
        {
          type: 'regression' as const,
          label: 'Smoke - Prod',
          href: '/regressions/reg-1',
          onNavigate,
        },
      ]
      render(
        <DetailHeader {...baseProps} entityType="suite" breadcrumbPrefix={prefix} />,
      )
      const wrapper = screen.getByTestId('detail-breadcrumb-regression')
      const link = wrapper.querySelector('a')
      expect(link).not.toBeNull()
      await userEvent.setup().click(link!)
      expect(onNavigate).toHaveBeenCalledTimes(1)
    })

    it('renders a Skeleton placeholder when a prefix label is null (still loading)', () => {
      const prefix = [
        {
          type: 'regression' as const,
          label: null,
          href: '/regressions/reg-1',
          onNavigate: vi.fn(),
        },
      ]
      render(
        <DetailHeader {...baseProps} entityType="suite" breadcrumbPrefix={prefix} />,
      )
      const wrapper = screen.getByTestId('detail-breadcrumb-regression')
      // Skeleton renders as an inline div with the bg-muted class.
      expect(wrapper.querySelector('.bg-muted')).not.toBeNull()
    })
  })

  describe('breadcrumbPrefix - collapsed state', () => {
    it('collapses to `...` + popover when the row overflows', async () => {
      const onNavigate = vi.fn()
      const prefix = [
        {
          type: 'regression' as const,
          label: 'Smoke - Prod',
          href: '/regressions/reg-1',
          onNavigate,
        },
      ]
      await withSizes(900, 200, async () => {
        render(
          <DetailHeader
            {...baseProps}
            entityType="suite"
            breadcrumbPrefix={prefix}
          />,
        )
        // Collapse trigger replaces the per-prefix anchor.
        const collapsed = await screen.findByTestId('detail-breadcrumb-collapsed')
        expect(collapsed).toBeInTheDocument()
        expect(
          screen.getByTestId('detail-breadcrumb-collapse-button'),
        ).toBeInTheDocument()
        expect(screen.queryByTestId('detail-breadcrumb-regression')).toBeNull()
      })
    })

    it('opens the parent-path popover when `...` is clicked and lists each parent', async () => {
      const onNavigate = vi.fn()
      const prefix = [
        {
          type: 'regression' as const,
          label: 'Smoke - Prod',
          href: '/regressions/reg-1',
          onNavigate,
        },
      ]
      const user = userEvent.setup()
      await withSizes(900, 200, async () => {
        render(
          <DetailHeader
            {...baseProps}
            entityType="suite"
            breadcrumbPrefix={prefix}
          />,
        )
        await user.click(await screen.findByTestId('detail-breadcrumb-collapse-button'))
        const list = await screen.findByTestId('detail-breadcrumb-parents-list')
        expect(list).toBeInTheDocument()
        expect(list).toHaveTextContent('Parent path')
        expect(list).toHaveTextContent('Smoke - Prod')
      })
    })

    it('navigates to the parent when the popover entry is clicked', async () => {
      const onNavigate = vi.fn()
      const prefix = [
        {
          type: 'regression' as const,
          label: 'Smoke - Prod',
          href: '/regressions/reg-1',
          onNavigate,
        },
      ]
      const user = userEvent.setup()
      await withSizes(900, 200, async () => {
        render(
          <DetailHeader
            {...baseProps}
            entityType="suite"
            breadcrumbPrefix={prefix}
          />,
        )
        await user.click(await screen.findByTestId('detail-breadcrumb-collapse-button'))
        await screen.findByTestId('detail-breadcrumb-parents-list')
        await user.click(screen.getByText('Smoke - Prod'))
        expect(onNavigate).toHaveBeenCalledTimes(1)
      })
    })
  })
})
