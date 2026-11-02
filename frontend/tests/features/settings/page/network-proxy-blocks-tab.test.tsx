// REQ-4.7.14 Proxy Blocks page (NET-10, SETTINGS-18): every state, driven through a hook-result prop
vi.mock('@/features/settings/api/proxy')

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { BlockRef, ProxyBlocks } from '@/features/settings/api/proxy'
import type { UseProxyBlocksResult } from '@/features/settings/container/use-proxy-blocks'
import { NetworkProxyBlocksTab } from '@/features/settings/page/network-proxy-blocks-tab'

// ============================================================================
// Fixtures
// ============================================================================

type SectionKey = keyof ProxyBlocks
type Overrides = Partial<UseProxyBlocksResult>

const PAGE_TITLE = 'Proxy Blocks'

const SECTION_KEYS: readonly SectionKey[] = ['supported', 'unsupported', 'not_applicable']

// Each section's title and one block the loaded read puts in it.
const SECTIONS: Record<SectionKey, { title: string; block: string }> = {
  supported: { title: 'Blocks that use this proxy', block: 'HTTP' },
  unsupported: { title: 'Blocks that do not use this proxy', block: 'Shell Script' },
  not_applicable: { title: 'Not applicable', block: 'Ping' },
}

const TITLES = SECTION_KEYS.map((key) => SECTIONS[key].title)

// Any reason the API gives; the page shows it as received.
const READ_FAILURE = 'Internal Server Error'

function sent(id: string, name: string, category: string): BlockRef {
  return { id, name, category }
}

const BLOCKS: ProxyBlocks = {
  supported: [sent('http-client', 'HTTP Client', 'network'), sent('opensearch', 'OpenSearch', 'database')],
  unsupported: [sent('python', 'Python', 'system'), sent('shell-script', 'Shell Script', 'system')],
  not_applicable: [sent('ping', 'Ping', 'network'), sent('sql-client', 'SQL', 'database')],
}

const OTHER_BLOCKS: ProxyBlocks = {
  supported: [sent('helm-status', 'Helm Status', 'helm')],
  unsupported: [sent('shell-exec', 'Shell Exec', 'system')],
  not_applicable: [sent('log', 'Log', 'system')],
}

const PENDING: Overrides = { status: 'pending', blocks: undefined }
const FAILED: Overrides = { status: 'failed', error: READ_FAILURE, blocks: undefined }
const LOADED: Overrides = { status: 'loaded', blocks: BLOCKS }

const STATES: readonly [string, Overrides][] = [
  ['while the first read is pending', PENDING],
  ['after the first read failed', FAILED],
  ['once the read has loaded', LOADED],
]

function makeResult(overrides: Overrides = {}): UseProxyBlocksResult {
  return { status: 'loaded', blocks: BLOCKS, retry: vi.fn(), ...overrides }
}

function renderTab(overrides: Overrides = {}) {
  const result = makeResult(overrides)
  const view = render(<NetworkProxyBlocksTab blocks={result} />)
  return { result, ...view }
}

// ============================================================================
// Helpers
// ============================================================================

function pageTitle(): HTMLElement {
  return screen.getByRole('heading', { name: PAGE_TITLE })
}

function header(key: SectionKey): HTMLElement {
  return screen.getByRole('button', { name: SECTIONS[key].title })
}

function buttonTexts(): (string | null)[] {
  return screen.queryAllByRole('button').map((button) => button.textContent)
}

function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

// A header says open or closed, and a closed section does not draw its block.
function expectOpen(open: Record<SectionKey, boolean>): void {
  for (const key of SECTION_KEYS) {
    expect(header(key)).toHaveAttribute('aria-expanded', String(open[key]))
    expect(screen.queryByText(SECTIONS[key].block) !== null, `"${SECTIONS[key].block}" drawn`).toBe(
      open[key],
    )
  }
}

// Every piece of text drawn under a root, in document order.
function writtenTexts(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: string[] = []
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim()
    if (text) texts.push(text)
  }
  return texts
}

const AT_FIRST = { supported: true, unsupported: true, not_applicable: false }

// ============================================================================
// Tests
// ============================================================================

describe('NetworkProxyBlocksTab', () => {
  describe('In every state', () => {
    it.each(STATES)('shows the title "Proxy Blocks" %s', (_state, overrides) => {
      renderTab(overrides)

      expect(pageTitle()).toBeInTheDocument()
    })

    it.each(STATES)('has no Cancel and no Save %s', (_state, overrides) => {
      renderTab(overrides)

      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })

    it.each(STATES)('draws the page inside its root %s', (_state, overrides) => {
      const { container } = renderTab(overrides)

      const root = screen.getByTestId('network-proxy-blocks-tab')
      expect(root).toContainElement(pageTitle())
      expect(writtenTexts(root)).toEqual(writtenTexts(container))
    })

    it.each(STATES)('does not read again by itself %s', (_state, overrides) => {
      const { result } = renderTab(overrides)

      expect(result.retry).not.toHaveBeenCalled()
    })
  })

  describe('First read pending', () => {
    it('shows the title alone, with no line under it', () => {
      const { container } = renderTab(PENDING)

      expect(writtenTexts(container)).toEqual([PAGE_TITLE])
      expect(screen.getAllByRole('heading')).toHaveLength(1)
    })

    it('shows one skeleton row', () => {
      const { container } = renderTab(PENDING)

      const skeleton = screen.getByTestId('proxy-blocks-skeleton')
      expect(skeleton).toHaveAttribute('aria-busy', 'true')
      expect(skeleton.children).toHaveLength(1)
      expect(skeleton.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
      expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1)
    })

    it('puts the skeleton row under the title', () => {
      renderTab(PENDING)

      expect(follows(pageTitle(), screen.getByTestId('proxy-blocks-skeleton'))).toBe(true)
    })

    it('shows no section, no read failure and no button', () => {
      renderTab(PENDING)

      expect(buttonTexts()).toEqual([])
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })

  describe('First read failed', () => {
    it("shows the section error with the API's reason", () => {
      renderTab(FAILED)

      expect(screen.getByRole('alert')).toHaveTextContent(READ_FAILURE)
    })

    it('shows the title alone, with the section error under the heading line', () => {
      renderTab(FAILED)

      expect(screen.getAllByRole('heading')).toHaveLength(1)
      expect(follows(pageTitle(), screen.getByRole('alert'))).toBe(true)
    })

    it('writes the title, the reason and "Try Again", with no line under the title', () => {
      const { container } = renderTab(FAILED)

      expect(writtenTexts(container)).toEqual([PAGE_TITLE, READ_FAILURE, 'Try Again'])
    })

    it('offers "Try Again" as its only button', () => {
      renderTab(FAILED)

      expect(buttonTexts()).toEqual(['Try Again'])
    })

    it('calls retry when "Try Again" is clicked', async () => {
      const user = userEvent.setup()
      const { result } = renderTab(FAILED)

      await user.click(screen.getByRole('button', { name: 'Try Again' }))

      expect(result.retry).toHaveBeenCalledTimes(1)
    })

    it('shows no skeleton row and no section', () => {
      const { container } = renderTab(FAILED)

      expect(screen.queryByTestId('proxy-blocks-skeleton')).not.toBeInTheDocument()
      expect(container.querySelectorAll('.skeleton')).toHaveLength(0)
      for (const title of TITLES) {
        expect(screen.queryByRole('button', { name: title })).not.toBeInTheDocument()
      }
    })

    it('still offers "Try Again" when the read failed without a reason', async () => {
      const user = userEvent.setup()
      const { result } = renderTab({ ...FAILED, error: undefined })

      expect(screen.getByRole('alert')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try Again' }))

      expect(result.retry).toHaveBeenCalledTimes(1)
    })
  })

  describe('Loaded', () => {
    it('shows the three sections in order under the title, as the only buttons', () => {
      renderTab(LOADED)

      expect(buttonTexts()).toEqual(TITLES)
      expect(follows(pageTitle(), header('supported'))).toBe(true)
    })

    it('opens the first two sections and keeps "Not applicable" closed', () => {
      renderTab(LOADED)

      expectOpen(AT_FIRST)
    })

    it('writes the title, the sections and their blocks, with no line under the title', () => {
      const { container } = renderTab(LOADED)

      expect(writtenTexts(container)).toEqual([
        PAGE_TITLE,
        'Blocks that use this proxy',
        'Network',
        'HTTP',
        'Database',
        'OpenSearch',
        'Blocks that do not use this proxy',
        'System',
        'Shell Script',
        'Python',
        'Not applicable',
      ])
    })

    it('draws the lists the read returned', () => {
      const { container } = renderTab({ blocks: OTHER_BLOCKS })

      expect(writtenTexts(container)).toEqual([
        PAGE_TITLE,
        'Blocks that use this proxy',
        'Helm',
        'Helm Status',
        'Blocks that do not use this proxy',
        'System',
        'Shell Exec',
        'Not applicable',
      ])
    })

    it('shows no skeleton row and no read failure', () => {
      const { container } = renderTab(LOADED)

      expect(screen.queryByTestId('proxy-blocks-skeleton')).not.toBeInTheDocument()
      expect(container.querySelectorAll('.skeleton')).toHaveLength(0)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
    })
  })

  describe('A header clicked', () => {
    it('closes its open section and does not move the others', async () => {
      const user = userEvent.setup()
      renderTab(LOADED)

      await user.click(header('unsupported'))

      expectOpen({ supported: true, unsupported: false, not_applicable: false })
    })

    it('opens "Not applicable" and does not move the others', async () => {
      const user = userEvent.setup()
      renderTab(LOADED)

      await user.click(header('not_applicable'))

      expectOpen({ supported: true, unsupported: true, not_applicable: true })
      expect(screen.getByText('SQL')).toBeInTheDocument()
    })

    it('opens the section again with a second click', async () => {
      const user = userEvent.setup()
      renderTab(LOADED)

      await user.click(header('supported'))
      expectOpen({ supported: false, unsupported: true, not_applicable: false })
      await user.click(header('supported'))

      expectOpen(AT_FIRST)
    })

    it('keeps the open state for the browser session: the page opens as the user left it (SHELL-9)', async () => {
      const user = userEvent.setup()
      const { unmount } = renderTab(LOADED)
      await user.click(header('supported'))
      await user.click(header('not_applicable'))
      expectOpen({ supported: false, unsupported: true, not_applicable: true })
      unmount()

      renderTab(LOADED)

      expectOpen({ supported: false, unsupported: true, not_applicable: true })
    })
  })

  describe('A section with no block', () => {
    it.each(SECTION_KEYS.map((key) => [SECTIONS[key].title, key] as const))(
      'does not show "%s" when its list is empty',
      (title, key) => {
        renderTab({ blocks: { ...BLOCKS, [key]: [] } })

        expect(screen.queryByRole('button', { name: title })).not.toBeInTheDocument()
        expect(buttonTexts()).toEqual(TITLES.filter((other) => other !== title))
      },
    )

    it('shows the title alone when no list holds a block', () => {
      const { container } = renderTab({
        blocks: { supported: [], unsupported: [], not_applicable: [] },
      })

      expect(writtenTexts(container)).toEqual([PAGE_TITLE])
      expect(buttonTexts()).toEqual([])
    })
  })
})
