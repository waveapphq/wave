/**
 * MirrorBanner Component Tests
 *
 * The read-only mirroring banner shown to a watcher while another holder owns
 * the workbench draft. Pure presentational contract - person vs mcp variant, the caller-owned
 * holder label, the mcp-only "See connection" affordance, and the always-present
 * "Take Over" action.
 *
 * Component under test:
 * frontend/src/features/workbench/common/canvas/chrome/mirror-banner.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  MirrorBanner,
  type MirrorBannerProps,
} from '@/features/workbench/common/canvas/chrome/mirror-banner'

// ============================================================================
// Render helper
// ============================================================================

function renderBanner(props: Partial<MirrorBannerProps> = {}) {
  const defaultProps: MirrorBannerProps = {
    holderLabel: 'Chrome (macOS)',
    holderKind: 'person',
    onTakeOver: vi.fn(),
    onSeeConnection: vi.fn(),
    ...props,
  }
  return { ...render(<MirrorBanner {...defaultProps} />), props: defaultProps }
}

/** Radix opens on keyboard focus without waiting out the hover delay. */
function revealTooltip(element: HTMLElement): void {
  act(() => {
    fireEvent.focus(element)
  })
}

function tooltipContent(): Element | null {
  return document.querySelector('[data-slot="tooltip-content"]')
}

// ============================================================================
// Tests
// ============================================================================

describe('MirrorBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Person variant', () => {
    it('renders the banner shell with the holder kind reflected', () => {
      renderBanner({ holderKind: 'person' })

      const banner = screen.getByTestId('mirror-banner')
      expect(banner).toBeInTheDocument()
      expect(banner).toHaveAttribute('data-holder-kind', 'person')
    })

    it('reads as "another session on {connection}" and never leaks a raw tab label', () => {
      renderBanner({ holderKind: 'person', holderLabel: 'Chrome (macOS)' })

      const banner = screen.getByTestId('mirror-banner')
      expect(banner).toHaveTextContent('another session on Chrome (macOS)')
      expect(banner).not.toHaveTextContent('Tab 7f3a')
    })

    it('reads simply as "another session" when no connection label is supplied', () => {
      renderBanner({ holderKind: 'person', holderLabel: '' })

      const banner = screen.getByTestId('mirror-banner')
      expect(banner).toHaveTextContent('another session')
      expect(banner).not.toHaveTextContent('another session on')
    })

    it('renders a "See Connection" button that calls onSeeConnection', async () => {
      const user = userEvent.setup()
      const { props } = renderBanner({ holderKind: 'person' })

      const seeConnection = screen.getByRole('button', { name: 'See Connection' })
      expect(seeConnection).toBeInTheDocument()

      await user.click(seeConnection)
      expect(props.onSeeConnection).toHaveBeenCalledTimes(1)
    })

    it('renders a "Take Over" button that calls onTakeOver', async () => {
      const user = userEvent.setup()
      const { props } = renderBanner({ holderKind: 'person' })

      const takeOver = screen.getByRole('button', { name: 'Take Over' })
      expect(takeOver).toBeInTheDocument()

      await user.click(takeOver)
      expect(props.onTakeOver).toHaveBeenCalledTimes(1)
    })

    it('falls back to the person look when the holder kind is unknown', () => {
      renderBanner({ holderKind: null, holderLabel: 'Chrome (macOS)' })

      const banner = screen.getByTestId('mirror-banner')
      expect(banner).toHaveAttribute('data-holder-kind', 'person')
      expect(banner).toHaveTextContent('another session on Chrome (macOS)')
    })
  })

  describe('MCP variant', () => {
    it('reflects the mcp holder kind and renders the caller-supplied label', () => {
      renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)' })

      const banner = screen.getByTestId('mirror-banner')
      expect(banner).toHaveAttribute('data-holder-kind', 'mcp')
      expect(banner).toHaveTextContent('Claude Code (MCP)')
    })

    it('renders a "See Connection" button that calls onSeeConnection', async () => {
      const user = userEvent.setup()
      const { props } = renderBanner({
        holderKind: 'mcp',
        holderLabel: 'Claude Code (MCP)',
      })

      const seeConnection = screen.getByRole('button', { name: 'See Connection' })
      expect(seeConnection).toBeInTheDocument()

      await user.click(seeConnection)
      expect(props.onSeeConnection).toHaveBeenCalledTimes(1)
    })

    it('renders a "Take Over" button that calls onTakeOver', async () => {
      const user = userEvent.setup()
      const { props } = renderBanner({
        holderKind: 'mcp',
        holderLabel: 'Claude Code (MCP)',
      })

      await user.click(screen.getByRole('button', { name: 'Take Over' }))
      expect(props.onTakeOver).toHaveBeenCalledTimes(1)
    })
  })

  describe('Follow Changes toggle', () => {
    it('renders "Follow Changes" on an MCP banner and calls onToggleFollow', async () => {
      const user = userEvent.setup()
      const onToggleFollow = vi.fn()
      renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)', onToggleFollow })

      const follow = screen.getByTestId('mirror-follow-changes-button')
      expect(follow).toHaveTextContent('Follow Changes')
      expect(follow).toHaveAttribute('aria-pressed', 'false')

      await user.click(follow)
      expect(onToggleFollow).toHaveBeenCalledTimes(1)
    })

    it('reads "Stop Following" and is pressed while following', () => {
      renderBanner({
        holderKind: 'mcp',
        holderLabel: 'Claude Code (MCP)',
        onToggleFollow: vi.fn(),
        isFollowing: true,
      })

      const follow = screen.getByTestId('mirror-follow-changes-button')
      expect(follow).toHaveTextContent('Stop Following')
      expect(follow).toHaveAttribute('aria-pressed', 'true')
    })

    it('also renders on a person watch banner (two-tab mirroring)', async () => {
      const user = userEvent.setup()
      const onToggleFollow = vi.fn()
      renderBanner({ holderKind: 'person', onToggleFollow })

      const follow = screen.getByTestId('mirror-follow-changes-button')
      expect(follow).toHaveTextContent('Follow Changes')

      await user.click(follow)
      expect(onToggleFollow).toHaveBeenCalledTimes(1)
    })

    it('does not render without a follow handler', () => {
      renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)' })

      expect(screen.queryByTestId('mirror-follow-changes-button')).not.toBeInTheDocument()
    })
  })

  describe('Detached with no holder', () => {
    function renderDetached(props: Partial<MirrorBannerProps> = {}) {
      return renderBanner({
        holderKind: null,
        holderLabel: '',
        browsing: true,
        onWatchSession: vi.fn(),
        ...props,
      })
    }

    it('states that nobody holds the workbench', () => {
      renderDetached()

      const banner = screen.getByTestId('mirror-banner')
      expect(banner).toHaveTextContent('Read-only · nobody holds the workbench')
      expect(banner).not.toHaveTextContent('another session')
    })

    it('marks the banner as holding nobody', () => {
      renderDetached()

      expect(screen.getByTestId('mirror-banner')).toHaveAttribute('data-holder-kind', 'none')
    })

    it('paints the banner amber, never indigo or violet', () => {
      renderDetached()

      const banner = screen.getByTestId('mirror-banner')
      expect(banner.className).toContain('bg-amber-500/10')
      expect(banner.className).not.toContain('bg-indigo-500/10')
      expect(banner.className).not.toContain('bg-violet-500/10')
    })

    it('offers to take the session rather than take it over', async () => {
      const user = userEvent.setup()
      const { props } = renderDetached()

      const take = screen.getByTestId('mirror-take-over-button')
      expect(take).toHaveTextContent('Take Session')
      expect(take).not.toHaveTextContent('Take Over')

      await user.click(take)
      expect(props.onTakeOver).toHaveBeenCalledTimes(1)
    })

    it('disables Watch Session and never rejoins from it', async () => {
      const user = userEvent.setup()
      const { props } = renderDetached()

      const watch = screen.getByTestId('mirror-watch-session-button')
      expect(watch).toHaveAttribute('aria-disabled', 'true')
      expect(watch.className).toContain('opacity-50')
      expect(watch.className).toContain('cursor-not-allowed')

      await user.click(watch)
      expect(props.onWatchSession).not.toHaveBeenCalled()
    })

    it('explains why Watch Session does nothing', () => {
      renderDetached()

      revealTooltip(screen.getByTestId('mirror-watch-session-button'))

      expect(tooltipContent()).toHaveTextContent('No active session to watch')
    })

    it('disables See Connection and never opens the connection from it', async () => {
      const user = userEvent.setup()
      const { props } = renderDetached()

      const seeConnection = screen.getByTestId('mirror-see-connection-button')
      expect(seeConnection).toHaveAttribute('aria-disabled', 'true')
      expect(seeConnection.className).toContain('opacity-50')
      expect(seeConnection.className).toContain('cursor-not-allowed')

      await user.click(seeConnection)
      expect(props.onSeeConnection).not.toHaveBeenCalled()
    })

    it('explains why See Connection does nothing', () => {
      renderDetached()

      revealTooltip(screen.getByTestId('mirror-see-connection-button'))

      expect(tooltipContent()).toHaveTextContent('No active session to show')
    })

    it('never offers Follow Changes', () => {
      renderDetached({ onToggleFollow: vi.fn() })

      expect(screen.queryByTestId('mirror-follow-changes-button')).not.toBeInTheDocument()
    })
  })
})
