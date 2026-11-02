/**
 * HistoryActionBar Tests
 *
 * Paint-only toolbar for the historical test canvas. Right group order
 * per RVIEW-13: environment display, Report (outline), Open in
 * Workbench. The historical canvas IS the detail surface for test
 * executions, so the Report entry point lives here.
 *
 * Module: frontend/src/features/workbench/history/action-bar.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HistoryActionBar } from '@/features/workbench/history/action-bar'

describe('HistoryActionBar', () => {
  it('renders the environment name in the disabled env display', () => {
    render(<HistoryActionBar environmentName="Staging" />)

    const env = screen.getByTestId('environment-selector')
    expect(env).toBeDisabled()
    expect(env).toHaveTextContent('Staging')
  })

  it('renders None when no environment was recorded', () => {
    render(<HistoryActionBar environmentName={null} />)

    expect(screen.getByTestId('environment-selector')).toHaveTextContent('None')
  })

  it('renders the Report button between the env display and Open in Workbench', () => {
    render(<HistoryActionBar environmentName="Staging" />)

    const group = screen.getByTestId('toolbar-right-group')
    const report = within(group).getByTestId('history-report-button')
    expect(report).toHaveTextContent('Report')

    const buttons = within(group).getAllByRole('button')
    const envIndex = buttons.findIndex((b) => b === screen.getByTestId('environment-selector'))
    const reportIndex = buttons.indexOf(report)
    const openIndex = buttons.findIndex(
      (b) => b === screen.getByTestId('open-in-workbench-button'),
    )
    expect(envIndex).toBeLessThan(reportIndex)
    expect(reportIndex).toBeLessThan(openIndex)
  })

  it('calls onOpenReport when the Report button is clicked', async () => {
    const user = userEvent.setup()
    const onOpenReport = vi.fn()
    render(<HistoryActionBar environmentName="Staging" onOpenReport={onOpenReport} />)

    await user.click(screen.getByTestId('history-report-button'))

    expect(onOpenReport).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenInWorkbench when the Open in Workbench button is clicked', async () => {
    const user = userEvent.setup()
    const onOpenInWorkbench = vi.fn()
    render(
      <HistoryActionBar environmentName="Staging" onOpenInWorkbench={onOpenInWorkbench} />,
    )

    await user.click(screen.getByTestId('open-in-workbench-button'))

    expect(onOpenInWorkbench).toHaveBeenCalledTimes(1)
  })
})
