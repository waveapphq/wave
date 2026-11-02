/**
 * PasswordStrength Component Tests
 *
 * REQ-5.2.7.1: the strength score under a typed password (MCP-7): four segments
 * filled and colored by the score, and one word under them.
 *
 * Component under test: frontend/src/features/settings/components/password-strength.tsx
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import { PasswordStrength } from '@/features/settings/components/password-strength'
import type { PasswordStrengthResult } from '@/features/settings/api/password-strength'

// ============================================================================
// Fixtures
// ============================================================================

const EMPTY = 'bg-input'
const RED = 'bg-error'
const AMBER = 'bg-warning'
const GREEN = 'bg-success'
const SEGMENT_CLASSES = [EMPTY, RED, AMBER, GREEN] as const
const SEGMENT_COUNT = 4

interface ScoreCase {
  strength: PasswordStrengthResult
  filled: number
  tone: string
}

const SCORE_CASES: ScoreCase[] = [
  { strength: { score: 0, label: 'Very weak' }, filled: 0, tone: RED },
  { strength: { score: 1, label: 'Weak' }, filled: 1, tone: RED },
  { strength: { score: 2, label: 'Fair' }, filled: 2, tone: AMBER },
  { strength: { score: 3, label: 'Strong' }, filled: 3, tone: GREEN },
  { strength: { score: 4, label: 'Very strong' }, filled: 4, tone: GREEN },
]

const WEAK: PasswordStrengthResult = { score: 1, label: 'Weak' }

// ============================================================================
// Utilities
// ============================================================================

function segmentsIn(container: HTMLElement): HTMLElement[] {
  const selector = SEGMENT_CLASSES.map((name) => `.${name}`).join(', ')
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
}

/** The one fill class a segment carries. */
function fillOf(segment: HTMLElement): string {
  const fills = SEGMENT_CLASSES.filter((name) => segment.classList.contains(name))
  expect(fills).toHaveLength(1)
  return fills[0]
}

function sizingOf(segment: HTMLElement): string {
  return Array.from(segment.classList)
    .filter((name) => !SEGMENT_CLASSES.some((fill) => fill === name))
    .sort((a, b) => a.localeCompare(b))
    .join(' ')
}

/** What a sighted user reads: every text node outside the screen reader meter. */
function visibleText(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement
  copy.querySelectorAll('meter').forEach((meter) => meter.remove())
  return (copy.textContent ?? '').trim()
}

function meter(): HTMLElement {
  return screen.getByRole('meter', { name: 'Password strength' })
}

// ============================================================================
// Tests
// ============================================================================

describe('PasswordStrength', () => {
  describe('Without a result', () => {
    it('renders nothing', () => {
      const { container } = render(<PasswordStrength />)

      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    })

    it('renders nothing when the result is undefined, even with a test id', () => {
      const { container } = render(
        <PasswordStrength strength={undefined} data-testid="mcp-password-strength" />,
      )

      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByTestId('mcp-password-strength')).not.toBeInTheDocument()
    })
  })

  describe('Segments', () => {
    it.each(SCORE_CASES)(
      'score $strength.score draws four segments with $filled filled',
      ({ strength, filled }) => {
        const { container } = render(<PasswordStrength strength={strength} />)

        const segments = segmentsIn(container)
        expect(segments).toHaveLength(SEGMENT_COUNT)
        expect(segments.filter((segment) => fillOf(segment) !== EMPTY)).toHaveLength(filled)
        expect(segments.filter((segment) => fillOf(segment) === EMPTY)).toHaveLength(
          SEGMENT_COUNT - filled,
        )
      },
    )

    it.each(SCORE_CASES)(
      'score $strength.score colors its first $filled segments $tone and leaves the rest bg-input',
      ({ strength, filled, tone }) => {
        const { container } = render(<PasswordStrength strength={strength} />)

        const expected = Array.from({ length: SEGMENT_COUNT }, (_, index) =>
          index < filled ? tone : EMPTY,
        )
        expect(segmentsIn(container).map(fillOf)).toEqual(expected)
      },
    )

    it('draws the four segments the same size whatever their fill', () => {
      const { container } = render(<PasswordStrength strength={{ score: 2, label: 'Fair' }} />)

      const sizings = segmentsIn(container).map(sizingOf)
      expect(sizings).toHaveLength(SEGMENT_COUNT)
      expect(new Set(sizings).size).toBe(1)
    })

    it('hides every segment from screen readers', () => {
      const { container } = render(<PasswordStrength strength={{ score: 3, label: 'Strong' }} />)

      const segments = segmentsIn(container)
      expect(segments).toHaveLength(SEGMENT_COUNT)
      for (const segment of segments) {
        expect(segment.closest('[aria-hidden="true"]')).not.toBeNull()
      }
    })

    it('follows a new result', () => {
      const { container, rerender } = render(<PasswordStrength strength={WEAK} />)
      expect(segmentsIn(container).map(fillOf)).toEqual([RED, EMPTY, EMPTY, EMPTY])

      rerender(<PasswordStrength strength={{ score: 4, label: 'Very strong' }} />)

      expect(segmentsIn(container).map(fillOf)).toEqual([GREEN, GREEN, GREEN, GREEN])
      expect(visibleText(container)).toBe('Very strong')
    })
  })

  describe('Label', () => {
    it.each(SCORE_CASES)(
      'score $strength.score shows "$strength.label" as the only visible text',
      ({ strength }) => {
        const { container } = render(<PasswordStrength strength={strength} />)

        expect(visibleText(container)).toBe(strength.label)
      },
    )

    it('never shows the screen reader name as text', () => {
      const { container } = render(<PasswordStrength strength={WEAK} />)

      expect(container).not.toHaveTextContent(/Password strength/i)
    })
  })

  describe('Screen reader score', () => {
    it.each(SCORE_CASES)(
      'score $strength.score is a meter named "Password strength" whose value text is "$strength.label"',
      ({ strength }) => {
        render(<PasswordStrength strength={strength} />)

        expect(meter()).toHaveAttribute('aria-valuetext', strength.label)
      },
    )

    it.each(SCORE_CASES)(
      'score $strength.score is the meter value on a 0 to 4 scale',
      ({ strength }) => {
        render(<PasswordStrength strength={strength} />)

        expect(meter()).toHaveAttribute('min', '0')
        expect(meter()).toHaveAttribute('max', '4')
        expect(meter()).toHaveAttribute('value', String(strength.score))
      },
    )

    it('is one native meter element, kept off screen', () => {
      render(<PasswordStrength strength={WEAK} />)

      expect(screen.getAllByRole('meter')).toHaveLength(1)
      expect(meter().tagName).toBe('METER')
      expect(meter()).toHaveClass('sr-only')
    })

    it('is not hidden from screen readers', () => {
      render(<PasswordStrength strength={WEAK} />)

      expect(meter().closest('[aria-hidden="true"]')).toBeNull()
    })
  })

  describe('Test id', () => {
    it('puts the given test id on the element that holds the score', () => {
      render(<PasswordStrength strength={WEAK} data-testid="mcp-password-strength" />)

      const root = screen.getByTestId('mcp-password-strength')
      expect(within(root).getByRole('meter', { name: 'Password strength' })).toBeInTheDocument()
      expect(segmentsIn(root)).toHaveLength(SEGMENT_COUNT)
      expect(visibleText(root)).toBe('Weak')
    })
  })
})
