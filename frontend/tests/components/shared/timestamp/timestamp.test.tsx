/**
 * Tests for the centralized <Timestamp> React component.
 *
 * User-selectable Time Zone for UI timestamps.
 *
 * The component reads the preference from useTimezoneStore (selector) and
 * delegates string formatting to lib/timestamp-format. It re-renders when
 * the store's mode changes - that is the mechanism that flips every visible
 * timestamp in one frame when the user toggles the preference.
 *
 * Vitest config pins TZ=America/Los_Angeles, so summer dates render as PDT
 * in local mode.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import { useTimezoneStore } from '@/stores/timezone-store'

const SUMMER_UTC_ISO = '2026-07-15T18:32:14.027Z' // 11:32 PDT, 18:32 UTC

describe('Timestamp component', () => {
  beforeEach(() => {
    useTimezoneStore.setState({ mode: 'local' })
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('renders the formatted string for each style in local mode', () => {
    it("style='time' renders HH:MM:SS.mmm with local zone suffix", () => {
      render(<Timestamp value={SUMMER_UTC_ISO} style="time" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('11:32:14.027 PDT')
    })

    it("style='datetime' renders MMM d, HH:MM with local zone suffix", () => {
      render(<Timestamp value={SUMMER_UTC_ISO} style="datetime" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('Jul 15, 11:32 PDT')
    })

    it("style='date' renders MMM d, YYYY with local zone suffix", () => {
      render(<Timestamp value={SUMMER_UTC_ISO} style="date" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('Jul 15, 2026 PDT')
    })
  })

  describe('renders the formatted string for each style in UTC mode', () => {
    beforeEach(() => {
      useTimezoneStore.setState({ mode: 'utc' })
    })

    it("style='time' renders HH:MM:SS.mmm UTC", () => {
      render(<Timestamp value={SUMMER_UTC_ISO} style="time" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('18:32:14.027 UTC')
    })

    it("style='datetime' renders MMM d, HH:MM UTC", () => {
      render(<Timestamp value={SUMMER_UTC_ISO} style="datetime" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('Jul 15, 18:32 UTC')
    })

    it("style='date' renders MMM d, YYYY UTC", () => {
      render(<Timestamp value={SUMMER_UTC_ISO} style="date" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('Jul 15, 2026 UTC')
    })
  })

  describe('reactivity to preference changes', () => {
    it('flips the rendered string when the store mode changes from local to utc', () => {
      render(<Timestamp value={SUMMER_UTC_ISO} style="time" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('11:32:14.027 PDT')

      act(() => {
        useTimezoneStore.getState().setMode('utc')
      })
      expect(screen.getByTestId('ts')).toHaveTextContent('18:32:14.027 UTC')
    })

    it('flips the rendered string when the store mode changes from utc to local', () => {
      useTimezoneStore.setState({ mode: 'utc' })
      render(<Timestamp value={SUMMER_UTC_ISO} style="datetime" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('Jul 15, 18:32 UTC')

      act(() => {
        useTimezoneStore.getState().setMode('local')
      })
      expect(screen.getByTestId('ts')).toHaveTextContent('Jul 15, 11:32 PDT')
    })
  })

  describe('null / undefined values', () => {
    it('renders "-" for null', () => {
      render(<Timestamp value={null} style="datetime" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('-')
    })

    it('renders "-" for undefined', () => {
      render(<Timestamp value={undefined} style="date" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('-')
    })

    it("renders 'Never' for null under style='relative'", () => {
      render(<Timestamp value={null} style="relative" data-testid="ts" />)
      expect(screen.getByTestId('ts')).toHaveTextContent('Never')
    })
  })

  describe('data-testid passthrough', () => {
    it('uses the data-testid prop as the span attribute', () => {
      const { container } = render(
        <Timestamp value={SUMMER_UTC_ISO} style="time" data-testid="last-run-cell" />
      )
      expect(container.querySelector('[data-testid="last-run-cell"]')).not.toBeNull()
    })

    it('renders without a testid when none is provided', () => {
      const { container } = render(<Timestamp value={SUMMER_UTC_ISO} style="time" />)
      // No testid attribute on the rendered element
      expect(container.firstChild).toHaveTextContent('11:32:14.027 PDT')
    })
  })
})
