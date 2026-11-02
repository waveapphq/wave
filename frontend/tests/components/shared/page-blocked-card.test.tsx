/**
 * PageBlockedCard - the non-modal card that names a failed load step.
 *
 * Non-modal on purpose: a Radix modal root would scrim and disable the whole
 * window, and the application sidebar has to stay fully usable because that is
 * what replaces Cancel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'

import { PageBlockedCard } from '@/components/shared/page-blocked-card'
import {
  usePageBlockStore,
  type PageBlock,
  type PageBlockRead,
} from '@/stores/page-block-store'
import { clipboardMock } from '../../setup'

const DETAIL = {
  method: 'GET',
  path: '/environments/names',
  status: 500,
  statusText: 'Internal Server Error',
  durationMs: 1421,
  requestId: '4f2a91c7-6d3e-4b02-9f18-7c5ad9e01b44',
  occurredAt: new Date(2026, 7, 10, 17, 42, 9).toISOString(),
  message: 'Profile store unavailable\nTraceback (most recent call last):\n  File "routes.py"',
}

const EXPECTED_PAYLOAD = [
  'GET  /environments/names',
  '500  Internal Server Error',
  '1421 ms',
  'request 4f2a91c7-6d3e-4b02-9f18-7c5ad9e01b44',
  '17:42:09 local',
  '',
  'Profile store unavailable',
  'Traceback (most recent call last):',
  '  File "routes.py"',
].join('\n')

function failedRead(owner: string, label: string): PageBlockRead {
  return { owner, label, detail: DETAIL, retry: vi.fn().mockResolvedValue(undefined) }
}

function blockPage(overrides: Partial<PageBlock> = {}): PageBlock {
  const block: PageBlock = {
    title: 'Could not load environments',
    detail: DETAIL,
    retry: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  usePageBlockStore.setState({ block })
  return block
}

async function openDetails() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('page-blocked-details-trigger'))
  })
}

beforeEach(() => {
  usePageBlockStore.setState({ block: null, retrying: false })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PageBlockedCard', () => {
  it('renders nothing when no page is blocked', () => {
    const { container } = render(<PageBlockedCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names what did not load and states the page cannot be used', () => {
    blockPage()
    render(<PageBlockedCard />)

    expect(screen.getByTestId('page-blocked-title')).toHaveTextContent(
      'Could not load environments'
    )
    expect(screen.getByTestId('page-blocked-description')).toHaveTextContent(
      'This page cannot be used until it loads.'
    )
  })

  it('says "until it loads" when one read failed', () => {
    blockPage({ reads: [failedRead('one', 'environments')] })
    render(<PageBlockedCard />)

    expect(screen.getByTestId('page-blocked-description')).toHaveTextContent(
      'This page cannot be used until it loads.'
    )
  })

  it('says "until they load" when the title names several reads', () => {
    blockPage({
      title: 'Could not load tags and environments',
      reads: [failedRead('one', 'tags'), failedRead('two', 'environments')],
    })
    render(<PageBlockedCard />)

    expect(screen.getByTestId('page-blocked-description')).toHaveTextContent(
      'This page cannot be used until they load.'
    )
  })

  it('counts one read when two surfaces failed the same one, matching the title', () => {
    blockPage({ reads: [failedRead('one', 'tags'), failedRead('two', 'tags')] })
    render(<PageBlockedCard />)

    expect(screen.getByTestId('page-blocked-description')).toHaveTextContent(
      'This page cannot be used until it loads.'
    )
  })

  it('carries the alert role and takes focus when it appears', () => {
    blockPage()
    render(<PageBlockedCard />)

    const card = screen.getByTestId('page-blocked-card')
    expect(card).toHaveAttribute('role', 'alert')
    expect(card).toHaveFocus()
  })

  it('renders no modal root and no viewport-covering scrim', () => {
    blockPage()
    const { container } = render(<PageBlockedCard />)

    expect(container.children).toHaveLength(1)
    expect(container.firstElementChild).toBe(screen.getByTestId('page-blocked-wash'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(document.querySelector('.fixed')).toBeNull()
  })

  it('never lets the wash catch input, so only inert blocks the page', () => {
    blockPage()
    render(<PageBlockedCard />)

    const wash = screen.getByTestId('page-blocked-wash')
    expect(wash).toHaveClass('pointer-events-none')
    expect(wash).not.toHaveClass('fixed')
    expect(screen.getByTestId('page-blocked-card')).toHaveClass('pointer-events-auto')
  })

  it('offers no way to dismiss the block', () => {
    blockPage()
    render(<PageBlockedCard />)

    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
  })

  it('folds the details away by default', () => {
    blockPage()
    render(<PageBlockedCard />)

    expect(screen.getByTestId('page-blocked-details-trigger')).toBeInTheDocument()
    expect(screen.queryByTestId('page-blocked-details-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page-blocked-copy')).not.toBeInTheDocument()
  })

  it('shows the whole payload in a scrollable panel when the details open', async () => {
    blockPage()
    render(<PageBlockedCard />)

    await openDetails()

    const panel = screen.getByTestId('page-blocked-details-panel')
    expect(panel).toHaveTextContent('GET  /environments/names', { normalizeWhitespace: false })
    expect(panel.textContent).toBe(EXPECTED_PAYLOAD)
    expect(panel.className).toContain('overflow-auto')
    expect(panel.className).toContain('max-h-')
    expect(panel.className).toContain('font-mono')
  })

  it('names every read that failed and lists every reason', async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    usePageBlockStore
      .getState()
      .setBlock({ owner: 'a', label: 'tags', detail: { message: 'Tag store down' }, retry })
    usePageBlockStore.getState().setBlock({
      owner: 'b',
      label: 'environments',
      detail: { message: 'Environments down' },
      retry,
    })
    render(<PageBlockedCard />)

    expect(screen.getByTestId('page-blocked-title')).toHaveTextContent(
      'Could not load tags and environments'
    )

    await openDetails()

    expect(screen.getByTestId('page-blocked-details-panel').textContent).toBe(
      ['tags', 'Tag store down', '', 'environments', 'Environments down'].join('\n')
    )
  })

  it('shows the copy control only while the details are open', async () => {
    blockPage()
    render(<PageBlockedCard />)

    await openDetails()
    expect(screen.getByTestId('page-blocked-copy')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('page-blocked-details-trigger'))
    })

    expect(screen.queryByTestId('page-blocked-copy')).not.toBeInTheDocument()
  })

  it('copies the whole payload, not just the visible part', async () => {
    blockPage()
    render(<PageBlockedCard />)
    await openDetails()

    await act(async () => {
      fireEvent.click(screen.getByTestId('page-blocked-copy'))
    })

    expect(clipboardMock.writeText).toHaveBeenCalledWith(EXPECTED_PAYLOAD)
    expect(screen.getByTestId('page-blocked-copy-success')).toBeInTheDocument()
    expect(screen.getByText('Failure details copied to clipboard')).toBeInTheDocument()
  })

  it('clears the copied cue after a moment', async () => {
    blockPage()
    render(<PageBlockedCard />)
    await openDetails()

    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByTestId('page-blocked-copy'))
    })
    expect(screen.getByTestId('page-blocked-copy-success')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.queryByTestId('page-blocked-copy-success')).not.toBeInTheDocument()
  })

  it('stays silent when the copy fails', async () => {
    clipboardMock.writeText.mockRejectedValueOnce(new Error('denied'))
    blockPage()
    render(<PageBlockedCard />)
    await openDetails()

    await act(async () => {
      fireEvent.click(screen.getByTestId('page-blocked-copy'))
    })

    expect(screen.queryByTestId('page-blocked-copy-success')).not.toBeInTheDocument()
    expect(screen.queryByText('Failure details copied to clipboard')).not.toBeInTheDocument()
  })

  it('reruns only the failed read when Try Again is pressed', async () => {
    const retry = vi.fn().mockResolvedValue(undefined)
    blockPage({ retry })
    render(<PageBlockedCard />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('page-blocked-retry'))
    })

    expect(retry).toHaveBeenCalledTimes(1)
    expect(usePageBlockStore.getState().retrying).toBe(false)
  })

  it('shows a busy, disabled button while the retry is in flight', async () => {
    let release: () => void = () => {}
    const retry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    blockPage({ retry })
    render(<PageBlockedCard />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('page-blocked-retry'))
    })

    const button = screen.getByTestId('page-blocked-retry')
    expect(usePageBlockStore.getState().retrying).toBe(true)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    await act(async () => {
      release()
    })

    await waitFor(() => {
      expect(screen.getByTestId('page-blocked-retry')).not.toBeDisabled()
    })
  })

  it('leaves the block in place when the retry fails, and does not reject', async () => {
    const retry = vi.fn().mockRejectedValue(new Error('still down'))
    blockPage({ retry })
    render(<PageBlockedCard />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('page-blocked-retry'))
    })

    expect(usePageBlockStore.getState().block).not.toBeNull()
    expect(usePageBlockStore.getState().retrying).toBe(false)
    expect(screen.getByTestId('page-blocked-card')).toBeInTheDocument()
  })

  it('does not clear the block itself when the retry resolves', async () => {
    blockPage()
    render(<PageBlockedCard />)

    await act(async () => {
      fireEvent.click(screen.getByTestId('page-blocked-retry'))
    })

    expect(usePageBlockStore.getState().block).not.toBeNull()
  })

  it('disappears once the owner clears the block', async () => {
    blockPage()
    render(<PageBlockedCard />)
    expect(screen.getByTestId('page-blocked-card')).toBeInTheDocument()

    await act(async () => {
      usePageBlockStore.getState().clearBlock()
    })

    expect(screen.queryByTestId('page-blocked-card')).not.toBeInTheDocument()
  })
})
