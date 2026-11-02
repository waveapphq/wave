/**
 * MirrorBanner browsing variant.
 *
 * While the watcher browses freely the banner states the canvas is read-only
 * because the holder has the workbench, hints at a run in flight, and offers a
 * Watch Session pill back to the live mirror. Follow Changes disappears while
 * browsing; See Connection and Take Over remain.
 *
 * Component under test:
 * frontend/src/features/workbench/common/canvas/chrome/mirror-banner.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  MirrorBanner,
  type MirrorBannerProps,
} from '@/features/workbench/common/canvas/chrome/mirror-banner'

const HOLDS_PHRASE = 'holds the workbench'
const RUNNING_PHRASE = 'is running a test in the workbench'

function renderBanner(props: Partial<MirrorBannerProps> = {}) {
  const defaultProps: MirrorBannerProps = {
    holderLabel: 'Chrome (macOS)',
    holderKind: 'person',
    browsing: true,
    onWatchSession: vi.fn(),
    onTakeOver: vi.fn(),
    onSeeConnection: vi.fn(),
    ...props,
  }
  return { ...render(<MirrorBanner {...defaultProps} />), props: defaultProps }
}

describe('MirrorBanner - browsing phrase', () => {
  it('states read-only because a person session holds the workbench', () => {
    renderBanner()

    const banner = screen.getByTestId('mirror-banner')
    expect(banner).toHaveTextContent('Read-only')
    expect(banner).toHaveTextContent(`another session on Chrome (macOS) ${HOLDS_PHRASE}`)
    expect(banner).not.toHaveTextContent("You're watching")
  })

  it('states read-only because the assistant holds the workbench', () => {
    renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)' })

    const banner = screen.getByTestId('mirror-banner')
    expect(banner).toHaveTextContent(`Claude Code (MCP) ${HOLDS_PHRASE}`)
  })

  it('hints at the run in flight instead of the hold phrase', () => {
    renderBanner({ runActive: true })

    const banner = screen.getByTestId('mirror-banner')
    expect(banner).toHaveTextContent(RUNNING_PHRASE)
    expect(banner).not.toHaveTextContent(HOLDS_PHRASE)
    expect(banner).not.toHaveTextContent('running live')
  })

  it('falls back to the generic session name when no label is supplied', () => {
    renderBanner({ holderLabel: '' })

    expect(screen.getByTestId('mirror-banner')).toHaveTextContent(
      `another session ${HOLDS_PHRASE}`,
    )
  })
})

describe('MirrorBanner - browsing pills', () => {
  it('offers Watch Session and wires it', async () => {
    const user = userEvent.setup()
    const { props } = renderBanner()

    await user.click(screen.getByTestId('mirror-watch-session-button'))

    expect(props.onWatchSession).toHaveBeenCalledTimes(1)
  })

  it('renders no Watch Session pill without a handler', () => {
    renderBanner({ onWatchSession: undefined })

    expect(screen.queryByTestId('mirror-watch-session-button')).not.toBeInTheDocument()
  })

  it('renders no Watch Session pill while watching normally', () => {
    renderBanner({ browsing: false })

    expect(screen.queryByTestId('mirror-watch-session-button')).not.toBeInTheDocument()
  })

  it('hides Follow Changes while browsing even when a toggle is wired', () => {
    renderBanner({ onToggleFollow: vi.fn() })

    expect(screen.queryByTestId('mirror-follow-changes-button')).not.toBeInTheDocument()
  })

  it('keeps See Connection and Take Over while browsing', async () => {
    const user = userEvent.setup()
    const { props } = renderBanner()

    await user.click(screen.getByTestId('mirror-see-connection-button'))
    await user.click(screen.getByTestId('mirror-take-over-button'))

    expect(props.onSeeConnection).toHaveBeenCalledTimes(1)
    expect(props.onTakeOver).toHaveBeenCalledTimes(1)
  })
})

describe('MirrorBanner - detached tone', () => {
  it('paints the banner amber for a person holder instead of indigo', () => {
    renderBanner()

    const banner = screen.getByTestId('mirror-banner')
    expect(banner.className).toContain('bg-amber-500/10')
    expect(banner.className).not.toContain('bg-indigo-500/10')
  })

  it('paints the banner amber for an assistant holder instead of violet', () => {
    renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)' })

    const banner = screen.getByTestId('mirror-banner')
    expect(banner.className).toContain('bg-amber-500/10')
    expect(banner.className).not.toContain('bg-violet-500/10')
  })

  it('tints the pills amber too', () => {
    renderBanner()

    expect(screen.getByTestId('mirror-take-over-button').className).toContain('border-amber-500/40')
    expect(screen.getByTestId('mirror-watch-session-button').className).toContain(
      'border-amber-500/40',
    )
  })

  it('keeps naming the holder kind while detached', () => {
    renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)' })

    expect(screen.getByTestId('mirror-banner')).toHaveAttribute('data-holder-kind', 'mcp')
  })
})

describe('MirrorBanner - detached while a holder still exists', () => {
  it('leaves Watch Session live', async () => {
    const user = userEvent.setup()
    const { props } = renderBanner()

    const watch = screen.getByTestId('mirror-watch-session-button')
    expect(watch).not.toHaveAttribute('aria-disabled')

    await user.click(watch)
    expect(props.onWatchSession).toHaveBeenCalledTimes(1)
  })

  it('leaves See Connection live', () => {
    renderBanner()

    expect(screen.getByTestId('mirror-see-connection-button')).not.toHaveAttribute('aria-disabled')
  })

  it('still offers Take Over, not Take Session', () => {
    renderBanner()

    const take = screen.getByTestId('mirror-take-over-button')
    expect(take).toHaveTextContent('Take Over')
    expect(take).not.toHaveTextContent('Take Session')
  })
})
