/**
 * Branch-coverage companion for `LibraryCard`'s name-measurement layout effect.
 *
 * `NameWithTooltip` runs a `useLayoutEffect` whose first statement is
 * `const el = spanRef.current; if (!el) return`. In normal rendering React
 * attaches the ref before layout effects run, so the guard's truthy side is
 * always taken. To exercise the early-return branch we mock React's `useRef`
 * for exactly one `useRef(null)` call and lock its `current` to `null`, so the
 * span ref is still null when the layout effect fires.
 *
 * The override is gated behind `forceNullRef` (default false) so it only
 * affects the single test that opts in; every other `useRef` call in the file
 * keeps the real implementation. The mock is isolated to this file (vitest
 * hoists `vi.mock` per module), keeping the rest of the LibraryCard suite on
 * real React.
 */

import { describe, it, expect, vi } from 'vitest'

let forceNullRef = false

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    default: actual,
    useRef: (init?: unknown) => {
      const ref = actual.useRef(init)
      if (forceNullRef && init === null) {
        forceNullRef = false
        return {
          get current() {
            return null
          },
          set current(_value: unknown) {
            // Swallow React's ref assignment so spanRef.current stays null
            // when the layout effect reads it.
          },
        } as typeof ref
      }
      return ref
    },
  }
})

import { render, screen } from '@testing-library/react'

import { LibraryCard } from '@/features/functions/library/library-card'

import type { FunctionSummary } from '@/features/functions/api/types'

function makeSummary(overrides: Partial<FunctionSummary> = {}): FunctionSummary {
  return {
    id: 'fn-1',
    name: 'Greet User',
    description: 'Greets a named user with a salutation.',
    tags: ['demo', 'greet'],
    created_at: '2026-05-25T00:00:00Z',
    updated_at: '2026-05-25T00:00:00Z',
    latest_version: '1.0.0',
    ...overrides,
  } as FunctionSummary
}

describe('LibraryCard - name measurement layout-effect guard', () => {
  it('short-circuits the layout effect when the span ref is null', () => {
    // With spanRef.current locked to null, the `if (!el) return` guard in the
    // useLayoutEffect must take its early-return branch without throwing and
    // without flagging the name as truncated (no ResizeObserver wiring).
    forceNullRef = true
    expect(() =>
      render(<LibraryCard function={makeSummary({ name: 'short' })} />),
    ).not.toThrow()
    // The guard returned before measuring, so isTruncated stays false and the
    // name span never picks up the truncated `cursor-help` affordance.
    const nameSpan = screen.getByTestId('library-card-name')
    expect(nameSpan.className).not.toMatch(/cursor-help/)
    // The override consumed itself on the single targeted useRef(null) call.
    expect(forceNullRef).toBe(false)
  })
})
