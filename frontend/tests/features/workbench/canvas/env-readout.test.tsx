/**
 * EnvReadout - the read-only environment display (RUNM-3).
 *
 * The history bar's inline "Env: <name>" readout is promoted to a shared
 * component so the watcher's toolbar can show the RUN's environment in the
 * selector's slot instead of the watcher's own local selection. The history bar
 * must render identically through the promoted component.
 *
 * Component under test:
 * frontend/src/features/workbench/common/canvas/canvas-action-bar/env-readout.tsx
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { EnvReadout } from '@/features/workbench/common/canvas/canvas-action-bar/env-readout'
import { HistoryActionBar } from '@/features/workbench/history/action-bar'

describe('EnvReadout', () => {
  it('renders the Env label and the environment name', () => {
    render(<EnvReadout environmentName="Staging" />)

    const readout = screen.getByTestId('environment-selector')
    expect(readout).toHaveTextContent('Env:')
    expect(readout).toHaveTextContent('Staging')
  })

  it('falls back to None when no environment is recorded', () => {
    render(<EnvReadout environmentName={null} />)

    expect(screen.getByTestId('environment-selector')).toHaveTextContent('None')
  })

  it('is a disabled control - it displays, it never selects', () => {
    render(<EnvReadout environmentName="Staging" />)

    expect(screen.getByTestId('environment-selector')).toBeDisabled()
  })

  it('carries the environment name in its accessible name', () => {
    render(<EnvReadout environmentName="Production EU" />)

    expect(screen.getByRole('button', { name: /Production EU/ })).toBeInTheDocument()
  })

  it('never renders the interactive selector placeholder', () => {
    render(<EnvReadout environmentName={null} />)

    expect(screen.getByTestId('environment-selector')).not.toHaveTextContent('Select Environment')
  })
})

describe('HistoryActionBar through the promoted readout', () => {
  it('renders the same Env readout it always did', () => {
    render(<HistoryActionBar environmentName="Staging" />)

    const readout = screen.getByTestId('environment-selector')
    expect(readout).toHaveTextContent('Env:')
    expect(readout).toHaveTextContent('Staging')
    expect(readout).toBeDisabled()
  })

  it('still shows None when the run recorded no environment', () => {
    render(<HistoryActionBar environmentName={null} />)

    expect(screen.getByTestId('environment-selector')).toHaveTextContent('None')
  })

  it('keeps its other toolbar controls', () => {
    render(<HistoryActionBar environmentName="Staging" />)

    expect(screen.getByTestId('history-report-button')).toBeInTheDocument()
    expect(screen.getByTestId('open-in-workbench-button')).toBeInTheDocument()
  })
})
