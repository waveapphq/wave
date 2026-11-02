/**
 * MirrorBanner run variant (RUNM-2).
 *
 * While the holder has a run in flight the banner's trailing phrase reads
 * "read-only, running live" for a person holder and an assistant holder alike.
 * The build/idle phrases and every banner pill are unchanged.
 *
 * Component under test:
 * frontend/src/features/workbench/common/canvas/chrome/mirror-banner.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  MirrorBanner,
  type MirrorBannerProps,
} from '@/features/workbench/common/canvas/chrome/mirror-banner'

const RUN_PHRASE = 'read-only, running live'
const PERSON_IDLE_PHRASE = 'read-only, updates as they edit'
const MCP_BUILD_PHRASE = 'read-only, building live'

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

describe('MirrorBanner - run phrase', () => {
  it('reads "running live" for a person holder with a run in flight', () => {
    renderBanner({ holderKind: 'person', runActive: true })

    expect(screen.getByTestId('mirror-banner')).toHaveTextContent(RUN_PHRASE)
  })

  it('reads "running live" for an assistant holder with a run in flight', () => {
    renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)', runActive: true })

    expect(screen.getByTestId('mirror-banner')).toHaveTextContent(RUN_PHRASE)
  })

  it('keeps the person idle phrase when no run is in flight', () => {
    renderBanner({ holderKind: 'person', runActive: false })

    const banner = screen.getByTestId('mirror-banner')
    expect(banner).toHaveTextContent(PERSON_IDLE_PHRASE)
    expect(banner).not.toHaveTextContent(RUN_PHRASE)
  })

  it('keeps the assistant build phrase when no run is in flight', () => {
    renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)', runActive: false })

    const banner = screen.getByTestId('mirror-banner')
    expect(banner).toHaveTextContent(MCP_BUILD_PHRASE)
    expect(banner).not.toHaveTextContent(RUN_PHRASE)
  })

  it('defaults to the idle phrase when the run flag is omitted', () => {
    renderBanner({ holderKind: 'person' })

    expect(screen.getByTestId('mirror-banner')).toHaveTextContent(PERSON_IDLE_PHRASE)
  })

  it('drops the build phrase while an assistant run is in flight', () => {
    renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)', runActive: true })

    expect(screen.getByTestId('mirror-banner')).not.toHaveTextContent(MCP_BUILD_PHRASE)
  })

  it('says nobody holds the workbench even with a run still announced', () => {
    renderBanner({
      holderKind: null,
      holderLabel: '',
      browsing: true,
      runActive: true,
      onWatchSession: vi.fn(),
    })

    const banner = screen.getByTestId('mirror-banner')
    expect(banner).toHaveTextContent('nobody holds the workbench')
    expect(banner).not.toHaveTextContent('is running a test in the workbench')
  })
})

describe('MirrorBanner - run variant keeps its chrome', () => {
  it('still names the holder during a run', () => {
    renderBanner({ holderKind: 'person', holderLabel: 'Chrome (macOS)', runActive: true })

    expect(screen.getByTestId('mirror-banner')).toHaveTextContent(
      'another session on Chrome (macOS)',
    )
  })

  it('still reflects the holder kind during a run', () => {
    renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)', runActive: true })

    expect(screen.getByTestId('mirror-banner')).toHaveAttribute('data-holder-kind', 'mcp')
  })

  it('keeps See Connection and Take Over during a run', () => {
    renderBanner({ holderKind: 'mcp', holderLabel: 'Claude Code (MCP)', runActive: true })

    expect(screen.getByTestId('mirror-see-connection-button')).toBeInTheDocument()
    expect(screen.getByTestId('mirror-take-over-button')).toBeInTheDocument()
  })

  it('keeps Follow Changes on the banner during a run', () => {
    renderBanner({
      holderKind: 'mcp',
      holderLabel: 'Claude Code (MCP)',
      runActive: true,
      onToggleFollow: vi.fn(),
    })

    expect(screen.getByTestId('mirror-follow-changes-button')).toBeInTheDocument()
  })
})
