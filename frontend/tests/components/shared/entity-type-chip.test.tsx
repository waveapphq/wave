/**
 * EntityTypeChip - colored entity-type pill (Regression / Suite / Test).
 *
 * Module: frontend/src/components/shared/entity-type-chip.tsx
 *
 * Renders a labeled, entity-colored chip (violet regression / amber suite /
 * green test), optionally with the entity icon. Unknown / null types fall back
 * to a neutral chip showing the raw value (or a dash).
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EntityTypeChip } from '@/components/shared/entity-type-chip'

describe('EntityTypeChip', () => {
  it('renders a labeled chip for a known entity type', () => {
    render(<EntityTypeChip type="regression" data-testid="chip" />)

    expect(screen.getByTestId('chip')).toHaveTextContent('Regression')
  })

  it('renders the entity icon when showIcon is set', () => {
    render(<EntityTypeChip type="suite" showIcon data-testid="chip" />)

    expect(screen.getByTestId('chip').querySelector('svg')).not.toBeNull()
  })

  it('omits the icon by default', () => {
    render(<EntityTypeChip type="test" data-testid="chip" />)

    expect(screen.getByTestId('chip').querySelector('svg')).toBeNull()
    expect(screen.getByTestId('chip')).toHaveTextContent('Test')
  })

  it('renders the raw value as a neutral chip for an unknown type', () => {
    render(<EntityTypeChip type="cron" data-testid="chip" />)

    expect(screen.getByTestId('chip')).toHaveTextContent('cron')
  })

  it('renders a dash for a null type', () => {
    render(<EntityTypeChip type={null} data-testid="chip" />)

    expect(screen.getByTestId('chip')).toHaveTextContent('-')
  })
})
