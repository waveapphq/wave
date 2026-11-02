/**
 * ModeDropdown color-coded pill (VMGR-62).
 *
 * The Mode trigger becomes a prominent color-coded pill: indigo Initial
 * (definition), amber Current (live/transient), slate Compare (an active
 * neutral, NOT the muted/disabled palette), always with its chevron (the
 * dropdown is interactive).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  ModeDropdown,
  type InspectMode,
} from '@/features/workbench/common/variables/variable-inspect-modal/mode-dropdown'

function renderPill(value: InspectMode) {
  render(<ModeDropdown value={value} onValueChange={vi.fn()} />)
  return screen.getByTestId('mode-dropdown')
}

describe('ModeDropdown pill color', () => {
  it('renders the Initial pill in indigo with the Initial label', () => {
    const trigger = renderPill('initial')
    expect(trigger).toHaveTextContent('Initial')
    expect(trigger.className).toMatch(/indigo/)
  })

  it('renders the Current pill in amber with the Current label', () => {
    const trigger = renderPill('current')
    expect(trigger).toHaveTextContent('Current')
    expect(trigger.className).toMatch(/amber/)
  })

  it('renders the Compare pill as an active slate neutral (not the muted/disabled palette)', () => {
    const trigger = renderPill('compare')
    expect(trigger).toHaveTextContent('Compare')
    expect(trigger.className).not.toMatch(/indigo/)
    expect(trigger.className).not.toMatch(/amber/)
    // Slate active-neutral: distinct from the indigo/amber modes and never the muted gray.
    expect(trigger.className).toMatch(/slate/)
    expect(trigger.className).not.toMatch(/text-muted-foreground/)
  })
})

describe('ModeDropdown chevron', () => {
  it('shows the chevron in view mode (interactive dropdown)', () => {
    renderPill('current')
    expect(screen.getByTestId('mode-pill-chevron')).toBeInTheDocument()
  })
})
