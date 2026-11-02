/**
 * ReportLogsPanel Tests
 *
 * Logs section per RVIEW-9 and REQ-3.7.2.8 (viewer side): composes the
 * store-free shared console primitives with local state - Level dropdown
 * defaulting to INFO over the report's log stream plus a live
 * "N of M entries" count.
 *
 * Module: frontend/src/features/reports/detail/report-logs-panel.tsx
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/design-system/theme-provider'
import type { LogEntry } from '@/types/console'
import { ReportLogsPanel } from '@/features/reports/detail/report-logs-panel'

function entry(id: string, level: LogEntry['level'], message: string): LogEntry {
  return {
    id,
    timestamp: '2026-06-10T11:06:52.100Z',
    level,
    message,
    source: 'Log : Step',
    sequence: Number(id.split('-')[1]),
  }
}

const ENTRIES: LogEntry[] = [
  entry('log-0', 'INFO', 'execution started'),
  entry('log-1', 'DEBUG', 'iteration 1 pending'),
  entry('log-2', 'DEBUG', 'iteration 2 complete'),
  entry('log-3', 'INFO', 'fetched status complete'),
  entry('log-4', 'WARN', 'retrying request'),
  entry('log-5', 'ERROR', 'validation rejected payload'),
  entry('log-6', 'FATAL', 'reconciliation aborted'),
]

function renderPanel(entries: LogEntry[] = ENTRIES) {
  return render(
    <ThemeProvider>
      <>
        <ReportLogsPanel entries={entries} />
      </>
    </ThemeProvider>,
  )
}

describe('ReportLogsPanel - level filtering', () => {
  it('defaults the level dropdown to INFO and hides DEBUG entries', () => {
    renderPanel()

    expect(screen.getByLabelText('Minimum log level')).toHaveTextContent('INFO')
    expect(screen.queryByText('iteration 1 pending')).toBeNull()
    expect(screen.queryByText('iteration 2 complete')).toBeNull()
    expect(screen.getByText('execution started')).toBeInTheDocument()
    expect(screen.getByText('validation rejected payload')).toBeInTheDocument()
  })

  it('shows DEBUG entries after lowering the level to DEBUG', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByLabelText('Minimum log level'))
    await user.click(await screen.findByRole('option', { name: 'DEBUG' }))

    expect(await screen.findByText('iteration 1 pending')).toBeInTheDocument()
    expect(screen.getByText('iteration 2 complete')).toBeInTheDocument()
  })

  it('hides everything below ERROR when the level is raised', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByLabelText('Minimum log level'))
    await user.click(await screen.findByRole('option', { name: 'ERROR' }))

    expect(screen.queryByText('execution started')).toBeNull()
    expect(screen.queryByText('retrying request')).toBeNull()
    expect(screen.getByText('validation rejected payload')).toBeInTheDocument()
    expect(screen.getByText('reconciliation aborted')).toBeInTheDocument()
  })
})

describe('ReportLogsPanel - live entry count', () => {
  it('shows the visible-of-total count for the default INFO level', () => {
    renderPanel()

    expect(screen.getByTestId('report-logs-count')).toHaveTextContent('5 of 7 entries')
  })

  it('updates the count when the level changes', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByLabelText('Minimum log level'))
    await user.click(await screen.findByRole('option', { name: 'DEBUG' }))

    expect(screen.getByTestId('report-logs-count')).toHaveTextContent('7 of 7 entries')
  })
})

describe('ReportLogsPanel - column selector', () => {
  it('defaults all columns on and hides the source column when toggled off', async () => {
    const user = userEvent.setup()
    renderPanel()

    expect(screen.getAllByTestId('log-entry-source').length).toBeGreaterThan(0)

    await user.click(screen.getByTestId('report-logs-columns'))
    const source = await screen.findByRole('menuitemcheckbox', { name: /source/i })
    expect(source).toHaveAttribute('aria-checked', 'true')

    await user.click(source)
    expect(screen.queryAllByTestId('log-entry-source')).toHaveLength(0)
  })

  it('toggles the Time and Level columns', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByTestId('report-logs-columns'))
    const time = await screen.findByRole('menuitemcheckbox', { name: /time/i })
    const level = await screen.findByRole('menuitemcheckbox', { name: /^level$/i })

    await user.click(time)
    await user.click(level)

    expect(time).toHaveAttribute('aria-checked', 'false')
    expect(level).toHaveAttribute('aria-checked', 'false')
  })
})

describe('ReportLogsPanel - rendering', () => {
  it('renders inside the report-logs section with the Logs heading', () => {
    renderPanel()

    expect(screen.getByTestId('report-logs')).toHaveTextContent(/Logs/i)
  })

  it('renders FATAL rows with the fatal level class (row tint)', () => {
    renderPanel()

    expect(screen.getByTestId('log-entry-log-6').className).toContain('log-level-fatal')
  })

  it('renders an empty count for a report without logs', () => {
    renderPanel([])

    expect(screen.getByTestId('report-logs-count')).toHaveTextContent('0 of 0 entries')
  })
})
