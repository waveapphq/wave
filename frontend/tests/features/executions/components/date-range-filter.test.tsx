/**
 * DateRangePicker Component Tests
 *
 * A filter pill that opens a Popover containing preset radio chips above a
 * shadcn Calendar in range mode. Picking a preset applies immediately and
 * closes the popover. Picking "Custom range" reveals the Calendar + Apply /
 * Cancel buttons. The component emits a discriminated value to the parent:
 *
 *   { kind: 'all-time' }
 *   { kind: 'preset', preset: 'today' | 'last-7' | 'last-30' | 'last-90' }
 *   { kind: 'custom', from: ISOString, to: ISOString }
 *
 * The parent (ExecutionsFilters) decides how to serialize this into backend
 * query params (presets resolve to concrete from/to at request time).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

beforeEach(() => {
  localStorage.clear()
})

describe('<DateRangePicker />', () => {
  it('renders an idle pill labeled "Date" when value kind is all-time', async () => {
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )
    render(
      <DateRangePicker value={{ kind: 'all-time' }} onChange={vi.fn()} />,
    )
    expect(
      screen.getByRole('button', { name: /Date/i }),
    ).toBeInTheDocument()
  })

  it('renders the preset label when a preset is active', async () => {
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )
    render(
      <DateRangePicker
        value={{ kind: 'preset', preset: 'last-7' }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/Last 7 days/i)).toBeInTheDocument()
  })

  it('opens a popover with all preset options on trigger click', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )

    render(
      <DateRangePicker value={{ kind: 'all-time' }} onChange={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: /Date/i }))

    expect(screen.getByRole('radio', { name: /All time/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Today/i })).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Last 7 days/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Last 30 days/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Last 90 days/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /Custom range/i }),
    ).toBeInTheDocument()
  })

  it('picking a preset calls onChange with the symbolic preset value', async () => {
    const onChange = vi.fn()
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )

    render(
      <DateRangePicker value={{ kind: 'all-time' }} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: /Date/i }))
    await user.click(screen.getByRole('radio', { name: /Last 7 days/i }))

    expect(onChange).toHaveBeenCalledWith({
      kind: 'preset',
      preset: 'last-7',
    })
  })

  it('picking a preset closes the popover', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )

    render(
      <DateRangePicker value={{ kind: 'all-time' }} onChange={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: /Date/i }))
    expect(
      screen.getByRole('radio', { name: /Last 30 days/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Last 30 days/i }))

    expect(
      screen.queryByRole('radio', { name: /Last 30 days/i }),
    ).not.toBeInTheDocument()
  })

  it('picking All time calls onChange with { kind: "all-time" } clearing the filter', async () => {
    const onChange = vi.fn()
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )

    render(
      <DateRangePicker
        value={{ kind: 'preset', preset: 'last-30' }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Last 30 days/i }))
    await user.click(screen.getByRole('radio', { name: /All time/i }))

    expect(onChange).toHaveBeenCalledWith({ kind: 'all-time' })
  })

  it('picking Custom range reveals Calendar + Apply + Cancel buttons', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )

    render(
      <DateRangePicker value={{ kind: 'all-time' }} onChange={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: /Date/i }))
    await user.click(screen.getByRole('radio', { name: /Custom range/i }))

    expect(
      screen.getByRole('button', { name: /Apply/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Cancel/i }),
    ).toBeInTheDocument()
    // react-day-picker renders a grid with role "application" / buttons for
    // days. Assert the calendar is present by its aria role structure.
    expect(screen.getByRole('grid')).toBeInTheDocument()
  })

  it('opens Custom range with today pre-selected so Apply is enabled', async () => {
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )

    render(
      <DateRangePicker value={{ kind: 'all-time' }} onChange={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: /Date/i }))
    await user.click(screen.getByRole('radio', { name: /Custom range/i }))

    expect(screen.getByRole('button', { name: /Apply/i })).toBeEnabled()
  })

  it('Cancel returns to the preset list without calling onChange', async () => {
    const onChange = vi.fn()
    const { userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )

    render(
      <DateRangePicker value={{ kind: 'all-time' }} onChange={onChange} />,
    )
    await user.click(screen.getByRole('button', { name: /Date/i }))
    await user.click(screen.getByRole('radio', { name: /Custom range/i }))
    expect(
      screen.getByRole('button', { name: /Cancel/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Cancel/i }))

    expect(onChange).not.toHaveBeenCalled()
    // Back to preset list.
    expect(
      screen.getByRole('radio', { name: /All time/i }),
    ).toBeInTheDocument()
  })

  it('rehydrates the pill label from a custom value prop', async () => {
    const { DateRangePicker } = await import(
      '@/components/shared/filters/date-range-picker'
    )
    render(
      <DateRangePicker
        value={{
          kind: 'custom',
          from: '2026-04-01T00:00:00.000Z',
          to: '2026-04-15T23:59:59.999Z',
        }}
        onChange={vi.fn()}
      />,
    )
    // The pill label shows the formatted range.
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toMatch(/Apr/i)
  })
})
