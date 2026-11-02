// REQ-4.7.14 Proxy Blocks page (NET-10): the three block sections, drawn from a `blocks` prop
vi.mock('@/features/settings/api/proxy')

import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LucideIcon } from 'lucide-react'

import type { BlockRef, ProxyBlocks } from '@/features/settings/api/proxy'
import { ProxyBlockLists } from '@/features/settings/components/network/proxy-block-lists'
import { getIconComponent } from '@/features/workbench/lib/icon-registry'
import {
  PLUGIN_CATEGORIES,
  PLUGIN_DEFINITIONS,
  getPluginById,
  type CategoryDefinition,
} from '@/features/workbench/lib/plugin-definitions'

// ============================================================================
// Fixtures
// ============================================================================

type SectionKey = keyof ProxyBlocks

interface GroupRow {
  group: string
  blocks: string[]
}

const SECTION_KEYS: readonly SectionKey[] = ['supported', 'unsupported', 'not_applicable']

const SECTIONS: Record<SectionKey, { title: string; testId: string }> = {
  supported: { title: 'Blocks that use this proxy', testId: 'proxy-blocks-supported' },
  unsupported: { title: 'Blocks that do not use this proxy', testId: 'proxy-blocks-unsupported' },
  not_applicable: { title: 'Not applicable', testId: 'proxy-blocks-not-applicable' },
}

const TITLES = SECTION_KEYS.map((key) => SECTIONS[key].title)
const SECTION_CASES = SECTION_KEYS.map((key) => [SECTIONS[key].title, key] as const)

const MUTED_TEXT = 'text-muted-foreground'

function sent(id: string, name: string, category: string): BlockRef {
  return { id, name, category }
}

// The whole catalog as the backend lists it: by id, under the backend's own names.
const CATALOG: ProxyBlocks = {
  supported: [
    sent('helm-install', 'Helm Install', 'helm'),
    sent('helm-rollback', 'Helm Rollback', 'helm'),
    sent('helm-status', 'Helm Status', 'helm'),
    sent('helm-test', 'Helm Test', 'helm'),
    sent('helm-uninstall', 'Helm Uninstall', 'helm'),
    sent('helm-upgrade', 'Helm Upgrade', 'helm'),
    sent('http-client', 'HTTP Client', 'network'),
    sent('k8s-apply', 'K8s Apply', 'kubernetes'),
    sent('k8s-connect', 'K8s Connect', 'kubernetes'),
    sent('k8s-copy', 'K8s Copy', 'kubernetes'),
    sent('k8s-delete', 'K8s Delete', 'kubernetes'),
    sent('k8s-events', 'K8s Events', 'kubernetes'),
    sent('k8s-exec', 'K8s Exec', 'kubernetes'),
    sent('k8s-get', 'K8s Get', 'kubernetes'),
    sent('k8s-logs', 'K8s Logs', 'kubernetes'),
    sent('k8s-rollout', 'K8s Rollout', 'kubernetes'),
    sent('k8s-scale', 'K8s Scale', 'kubernetes'),
    sent('k8s-script', 'K8s Script', 'kubernetes'),
    sent('k8s-top', 'K8s Top', 'kubernetes'),
    sent('opensearch', 'OpenSearch', 'database'),
  ],
  unsupported: [
    sent('python', 'Python', 'system'),
    sent('shell-exec', 'Shell Exec', 'system'),
    sent('shell-script', 'Shell Script', 'system'),
  ],
  not_applicable: [
    sent('csv-parser', 'CSV Parser', 'data'),
    sent('excel-parser', 'Excel Parser', 'data'),
    sent('file-io', 'File I/O', 'system'),
    sent('json-parser', 'JSON Parser', 'data'),
    sent('log', 'Log', 'system'),
    sent('netcat', 'Netcat', 'network'),
    sent('ping', 'Ping', 'network'),
    sent('sftp', 'SFTP', 'remote'),
    sent('sql-client', 'SQL', 'database'),
    sent('ssh-session-close', 'SSH Session Close', 'remote'),
    sent('ssh-session-exec', 'SSH Session Exec', 'remote'),
    sent('ssh-session-open', 'SSH Session Open', 'remote'),
    sent('ssh-session-script', 'SSH Session Script', 'remote'),
    sent('ssh-tunnel-close', 'SSH Tunnel Close', 'remote'),
    sent('ssh-tunnel-open', 'SSH Tunnel Open', 'remote'),
    sent('xml-parser', 'XML Parser', 'data'),
  ],
}

// What the palette's groups, names and order make of the catalog.
const CATALOG_ROWS: Record<SectionKey, GroupRow[]> = {
  supported: [
    { group: 'Network', blocks: ['HTTP'] },
    { group: 'Database', blocks: ['OpenSearch'] },
    {
      group: 'Kubernetes',
      blocks: [
        'K8s Connect',
        'K8s Get',
        'K8s Events',
        'K8s Logs',
        'K8s Top',
        'K8s Apply',
        'K8s Delete',
        'K8s Scale',
        'K8s Rollout',
        'K8s Exec',
        'K8s Script',
        'K8s Copy',
      ],
    },
    {
      group: 'Helm',
      blocks: [
        'Helm Install',
        'Helm Upgrade',
        'Helm Rollback',
        'Helm Uninstall',
        'Helm Test',
        'Helm Status',
      ],
    },
  ],
  unsupported: [{ group: 'System', blocks: ['Shell Script', 'Shell Exec', 'Python'] }],
  not_applicable: [
    { group: 'Network', blocks: ['Ping', 'Netcat'] },
    {
      group: 'Remote',
      blocks: [
        'SSH Session Open',
        'SSH Session Exec',
        'SSH Session Script',
        'SSH Session Close',
        'SSH Tunnel Open',
        'SSH Tunnel Close',
        'SFTP',
      ],
    },
    { group: 'Database', blocks: ['SQL'] },
    { group: 'System', blocks: ['File I/O', 'Log'] },
    { group: 'Data', blocks: ['CSV', 'Excel', 'XML', 'JSON'] },
  ],
}

const SENT_IN_CATALOG =
  CATALOG.supported.length + CATALOG.unsupported.length + CATALOG.not_applicable.length

const HTTP = sent('http-client', 'HTTP Client', 'network')
const OPENSEARCH = sent('opensearch', 'OpenSearch', 'database')
const HELM_STATUS = sent('helm-status', 'Helm Status', 'helm')
const SHELL_SCRIPT = sent('shell-script', 'Shell Script', 'system')
const PYTHON = sent('python', 'Python', 'system')
const PING = sent('ping', 'Ping', 'network')
const CSV = sent('csv-parser', 'CSV Parser', 'data')

// A few blocks per section, none in the palette's order.
const SMALL: ProxyBlocks = {
  supported: [OPENSEARCH, HTTP],
  unsupported: [PYTHON, SHELL_SCRIPT],
  not_applicable: [CSV, PING],
}

// Blocks no palette definition names.
const QUEUE = sent('acme-queue', 'Acme Queue', 'messaging')
const CACHE = sent('acme-cache', 'Acme Cache', 'storage')
const TOPIC = sent('acme-topic', 'Acme Topic', 'messaging')

const WITH_UNKNOWN: ProxyBlocks = {
  supported: [QUEUE, HELM_STATUS, CACHE, HTTP, TOPIC],
  unsupported: [],
  not_applicable: [],
}

function only(key: SectionKey, blocks: BlockRef[]): ProxyBlocks {
  return { supported: [], unsupported: [], not_applicable: [], [key]: blocks }
}

function reversed(blocks: ProxyBlocks): ProxyBlocks {
  return {
    supported: blocks.supported.toReversed(),
    unsupported: blocks.unsupported.toReversed(),
    not_applicable: blocks.not_applicable.toReversed(),
  }
}

// ============================================================================
// Helpers
// ============================================================================

function header(key: SectionKey): HTMLElement {
  return screen.getByRole('button', { name: SECTIONS[key].title })
}

function groupsIn(key: SectionKey): HTMLElement[] {
  return within(screen.getByTestId(SECTIONS[key].testId)).queryAllByTestId('proxy-block-group')
}

function groupName(group: HTMLElement): HTMLElement {
  return within(group).getByTestId('proxy-block-group-name')
}

function rowsIn(key: SectionKey): GroupRow[] {
  return groupsIn(key).map((group) => ({
    group: groupName(group).textContent ?? '',
    blocks: within(group)
      .queryAllByTestId('proxy-block')
      .map((block) => block.textContent ?? ''),
  }))
}

function groupNamed(key: SectionKey, name: string): HTMLElement {
  const group = groupsIn(key).find((row) => groupName(row).textContent === name)
  if (!group) throw new Error(`No "${name}" group in the ${key} section`)
  return group
}

function blockNamed(group: HTMLElement, name: string): HTMLElement {
  const block = within(group)
    .getAllByTestId('proxy-block')
    .find((entry) => entry.textContent === name)
  if (!block) throw new Error(`No "${name}" block in the group`)
  return block
}

function iconOf(block: HTMLElement): SVGSVGElement {
  const icons = block.querySelectorAll('svg')
  if (icons.length !== 1) throw new Error(`Expected one icon in a block, found ${icons.length}`)
  return icons[0]
}

// What an icon component draws inside its svg, whatever classes it is given.
function drawingOf(Icon: LucideIcon): string {
  const host = document.createElement('div')
  const { unmount } = render(<Icon />, { container: host })
  const drawing = host.querySelector('svg')?.innerHTML ?? ''
  unmount()
  if (drawing === '') throw new Error('The icon drew nothing')
  return drawing
}

// The palette's own answer for a block id: its name, its icon and its group.
function paletteOf(id: string): { name: string; Icon: LucideIcon; group: CategoryDefinition } {
  const plugin = getPluginById(id)
  if (!plugin) throw new Error(`'${id}' is not a palette block`)
  const group = PLUGIN_CATEGORIES.find((category) => category.id === plugin.category)
  if (!group) throw new Error(`'${plugin.category}' is not a palette group`)
  return { name: plugin.name, Icon: getIconComponent(plugin.iconName), group }
}

// The rows the palette definitions give for a list of block ids.
function paletteRows(blocks: readonly BlockRef[]): GroupRow[] {
  const ids = new Set(blocks.map((block) => block.id))
  return PLUGIN_CATEGORIES.map((category) => ({
    group: category.name,
    blocks: PLUGIN_DEFINITIONS.filter(
      (plugin) => plugin.category === category.id && ids.has(plugin.id),
    ).map((plugin) => plugin.name),
  })).filter((row) => row.blocks.length > 0)
}

// A header says open or closed, and a closed section draws no group.
function expectOpen(open: Record<SectionKey, boolean>): void {
  for (const key of SECTION_KEYS) {
    expect(header(key)).toHaveAttribute('aria-expanded', String(open[key]))
    expect(groupsIn(key).length > 0, `groups drawn in the ${key} section`).toBe(open[key])
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

describe('ProxyBlockLists', () => {
  describe('Fixtures', () => {
    it('expect the rows the palette definitions give for the catalog', () => {
      for (const key of SECTION_KEYS) {
        expect(paletteRows(CATALOG[key])).toEqual(CATALOG_ROWS[key])
        expect(CATALOG_ROWS[key].flatMap((row) => row.blocks)).toHaveLength(CATALOG[key].length)
      }
    })

    it('name unknown blocks by ids no palette definition holds', () => {
      for (const block of [QUEUE, CACHE, TOPIC]) {
        expect(getPluginById(block.id)).toBeUndefined()
      }
    })
  })

  describe('Sections', () => {
    it('heads the three sections with their titles, in order, as the only buttons', () => {
      render(<ProxyBlockLists blocks={SMALL} />)

      expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(TITLES)
    })

    it.each(SECTION_CASES)('keeps the "%s" header inside its own section', (_title, key) => {
      render(<ProxyBlockLists blocks={SMALL} />)

      expect(screen.getByTestId(SECTIONS[key].testId)).toContainElement(header(key))
      for (const other of SECTION_KEYS.filter((candidate) => candidate !== key)) {
        expect(screen.getByTestId(SECTIONS[other].testId)).not.toContainElement(header(key))
      }
    })

    it('opens the first two sections and keeps "Not applicable" closed at first', () => {
      render(<ProxyBlockLists blocks={SMALL} />)

      expectOpen(AT_FIRST)
      expect(screen.getByText('HTTP')).toBeInTheDocument()
      expect(screen.getByText('Shell Script')).toBeInTheDocument()
      expect(screen.queryByText('Ping')).not.toBeInTheDocument()
    })

    it.each(SECTION_CASES)('leaves out "%s" when it has no block', (title, key) => {
      render(<ProxyBlockLists blocks={{ ...SMALL, [key]: [] }} />)

      expect(screen.queryByRole('button', { name: title })).not.toBeInTheDocument()
      expect(screen.queryByTestId(SECTIONS[key].testId)).not.toBeInTheDocument()
      expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(
        TITLES.filter((other) => other !== title),
      )
    })

    it('draws nothing when no list holds a block', () => {
      const { container } = render(
        <ProxyBlockLists blocks={{ supported: [], unsupported: [], not_applicable: [] }} />,
      )

      expect(screen.queryAllByRole('button')).toHaveLength(0)
      expect(writtenTexts(container)).toEqual([])
    })
  })

  describe('Opening and closing', () => {
    it('closes an open section from its header and does not move the others', async () => {
      const user = userEvent.setup()
      render(<ProxyBlockLists blocks={SMALL} />)

      await user.click(header('supported'))

      expectOpen({ supported: false, unsupported: true, not_applicable: false })
      expect(screen.queryByText('HTTP')).not.toBeInTheDocument()
    })

    it('closes the second section from its header and does not move the others', async () => {
      const user = userEvent.setup()
      render(<ProxyBlockLists blocks={SMALL} />)

      await user.click(header('unsupported'))

      expectOpen({ supported: true, unsupported: false, not_applicable: false })
      expect(screen.queryByText('Shell Script')).not.toBeInTheDocument()
    })

    it('opens "Not applicable" from its header and does not move the others', async () => {
      const user = userEvent.setup()
      render(<ProxyBlockLists blocks={SMALL} />)

      await user.click(header('not_applicable'))

      expectOpen({ supported: true, unsupported: true, not_applicable: true })
      expect(rowsIn('not_applicable')).toEqual([
        { group: 'Network', blocks: ['Ping'] },
        { group: 'Data', blocks: ['CSV'] },
      ])
    })

    it('opens a section again with a second click on its header', async () => {
      const user = userEvent.setup()
      render(<ProxyBlockLists blocks={SMALL} />)

      await user.click(header('supported'))
      await user.click(header('supported'))

      expectOpen(AT_FIRST)
      expect(rowsIn('supported')).toEqual([
        { group: 'Network', blocks: ['HTTP'] },
        { group: 'Database', blocks: ['OpenSearch'] },
      ])
    })

    describe('Remembered for the browser session (SHELL-9)', () => {
      const AS_LEFT = { supported: false, unsupported: true, not_applicable: true }

      async function leaveThemAsLeft(): Promise<void> {
        const user = userEvent.setup()
        const { unmount } = render(<ProxyBlockLists blocks={SMALL} />)
        await user.click(header('supported'))
        await user.click(header('not_applicable'))
        expectOpen(AS_LEFT)
        unmount()
      }

      it('shows the sections as the user left them when the page is opened again', async () => {
        await leaveThemAsLeft()

        render(<ProxyBlockLists blocks={SMALL} />)

        expectOpen(AS_LEFT)
      })

      it('shows them as left after a page load in the same tab', async () => {
        await leaveThemAsLeft()
        vi.resetModules()
        const reloaded = await import('@/features/settings/components/network/proxy-block-lists')

        render(<reloaded.ProxyBlockLists blocks={SMALL} />)

        expectOpen(AS_LEFT)
      })

      it('starts from the first state in a new tab', async () => {
        await leaveThemAsLeft()
        sessionStorage.clear()
        vi.resetModules()
        const reloaded = await import('@/features/settings/components/network/proxy-block-lists')

        render(<reloaded.ProxyBlockLists blocks={SMALL} />)

        expectOpen(AT_FIRST)
      })

      it('keeps the choice in the tab, never in the browser', async () => {
        await leaveThemAsLeft()

        expect(sessionStorage.length).toBeGreaterThan(0)
        expect(localStorage.length).toBe(0)
      })
    })
  })

  describe('Palette groups', () => {
    it.each([
      ['in the order the backend lists them', CATALOG],
      ['in the opposite order', reversed(CATALOG)],
    ])(
      "draws the catalog in the palette's groups and order when the blocks arrive %s",
      async (_order, blocks) => {
        const user = userEvent.setup()
        render(<ProxyBlockLists blocks={blocks} />)
        await user.click(header('not_applicable'))

        for (const key of SECTION_KEYS) {
          expect(rowsIn(key)).toEqual(CATALOG_ROWS[key])
        }
      },
    )

    it("shows the palette's name for a block, not the name the backend sent", () => {
      render(<ProxyBlockLists blocks={only('supported', [HTTP, CSV])} />)

      expect(rowsIn('supported')).toEqual([
        { group: 'Network', blocks: ['HTTP'] },
        { group: 'Data', blocks: ['CSV'] },
      ])
      expect(screen.queryByText('HTTP Client')).not.toBeInTheDocument()
      expect(screen.queryByText('CSV Parser')).not.toBeInTheDocument()
    })

    it('files a block under its palette group whatever category the backend sent', () => {
      const misfiled = sent('http-client', 'HTTP Client', 'data')
      render(<ProxyBlockLists blocks={only('supported', [misfiled])} />)

      expect(rowsIn('supported')).toEqual([{ group: 'Network', blocks: ['HTTP'] }])
    })

    it('draws each block in the section whose list holds it', () => {
      render(
        <ProxyBlockLists
          blocks={{ supported: [PYTHON], unsupported: [HTTP], not_applicable: [] }}
        />,
      )

      expect(rowsIn('supported')).toEqual([{ group: 'System', blocks: ['Python'] }])
      expect(rowsIn('unsupported')).toEqual([{ group: 'Network', blocks: ['HTTP'] }])
    })

    it('leaves out a palette group with no block in that section', () => {
      render(
        <ProxyBlockLists
          blocks={{ supported: [HELM_STATUS, HTTP], unsupported: [PING], not_applicable: [] }}
        />,
      )

      expect(rowsIn('supported')).toEqual([
        { group: 'Network', blocks: ['HTTP'] },
        { group: 'Helm', blocks: ['Helm Status'] },
      ])
      expect(rowsIn('unsupported')).toEqual([{ group: 'Network', blocks: ['Ping'] }])
    })

    it('draws only the blocks the backend sent', () => {
      render(<ProxyBlockLists blocks={only('supported', [HTTP])} />)

      expect(getPluginById('netcat')?.name).toBe('Netcat')
      expect(screen.queryByText('Netcat')).not.toBeInTheDocument()
      expect(screen.getAllByTestId('proxy-block')).toHaveLength(1)
    })

    it("writes each group name in capitals in the group's palette color", async () => {
      const user = userEvent.setup()
      render(<ProxyBlockLists blocks={CATALOG} />)
      await user.click(header('not_applicable'))

      for (const key of SECTION_KEYS) {
        for (const block of CATALOG[key]) {
          const { group } = paletteOf(block.id)
          const name = groupName(groupNamed(key, group.name))
          expect(name).toHaveClass('uppercase', group.colorClass)
        }
      }
    })

    it("draws each block with the palette's icon for its id, in the group's color", async () => {
      const user = userEvent.setup()
      render(<ProxyBlockLists blocks={CATALOG} />)
      await user.click(header('not_applicable'))

      for (const key of SECTION_KEYS) {
        for (const block of CATALOG[key]) {
          const { name, Icon, group } = paletteOf(block.id)
          const icon = iconOf(blockNamed(groupNamed(key, group.name), name))
          expect(icon.innerHTML, `icon of ${block.id}`).toBe(drawingOf(Icon))
          expect(icon).toHaveClass(group.colorClass)
        }
      }
    })

    it('hides every block icon from assistive tech', async () => {
      const user = userEvent.setup()
      render(<ProxyBlockLists blocks={CATALOG} />)
      await user.click(header('not_applicable'))

      const blocks = screen.getAllByTestId('proxy-block')
      expect(blocks).toHaveLength(SENT_IN_CATALOG)
      for (const block of blocks) {
        expect(iconOf(block)).toHaveAttribute('aria-hidden', 'true')
      }
    })
  })

  describe('Blocks the frontend does not know', () => {
    it('shows the name the backend sent under the category the backend sent', () => {
      render(<ProxyBlockLists blocks={only('unsupported', [CACHE])} />)

      expect(rowsIn('unsupported')).toEqual([{ group: 'storage', blocks: ['Acme Cache'] }])
    })

    it('puts their groups after the palette groups, in the order received', () => {
      render(<ProxyBlockLists blocks={WITH_UNKNOWN} />)

      expect(rowsIn('supported').map((row) => row.group)).toEqual([
        'Network',
        'Helm',
        'messaging',
        'storage',
      ])
    })

    it('gathers the blocks of one sent category into one group, in the order received', () => {
      render(<ProxyBlockLists blocks={WITH_UNKNOWN} />)

      expect(rowsIn('supported')).toEqual([
        { group: 'Network', blocks: ['HTTP'] },
        { group: 'Helm', blocks: ['Helm Status'] },
        { group: 'messaging', blocks: ['Acme Queue', 'Acme Topic'] },
        { group: 'storage', blocks: ['Acme Cache'] },
      ])
    })

    it('writes the sent category in capitals in the muted text color', () => {
      render(<ProxyBlockLists blocks={WITH_UNKNOWN} />)

      for (const category of ['messaging', 'storage']) {
        const name = groupName(groupNamed('supported', category))
        expect(name).toHaveClass('uppercase', MUTED_TEXT)
        for (const paletteGroup of PLUGIN_CATEGORIES) {
          expect(name).not.toHaveClass(paletteGroup.colorClass)
        }
      }
    })

    it("draws the palette's default icon, hidden from assistive tech", () => {
      render(<ProxyBlockLists blocks={WITH_UNKNOWN} />)
      const defaultDrawing = drawingOf(getIconComponent(''))

      for (const block of [QUEUE, CACHE, TOPIC]) {
        const icon = iconOf(blockNamed(groupNamed('supported', block.category), block.name))
        expect(icon.innerHTML, `icon of ${block.id}`).toBe(defaultDrawing)
        expect(icon).toHaveAttribute('aria-hidden', 'true')
      }
    })

    it('keeps a section that holds only such blocks', () => {
      render(<ProxyBlockLists blocks={only('not_applicable', [QUEUE])} />)

      expect(header('not_applicable')).toHaveAttribute('aria-expanded', 'false')
    })
  })

  describe('No counts and no descriptions', () => {
    it('writes the section titles, the group names and the block names, and nothing else', () => {
      const { container } = render(<ProxyBlockLists blocks={SMALL} />)

      expect(writtenTexts(container)).toEqual([
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

    it('adds only group names and block names when "Not applicable" opens', async () => {
      const user = userEvent.setup()
      const { container } = render(<ProxyBlockLists blocks={SMALL} />)

      await user.click(header('not_applicable'))

      expect(writtenTexts(container).slice(-5)).toEqual([
        'Not applicable',
        'Network',
        'Ping',
        'Data',
        'CSV',
      ])
    })

    it('writes an unknown group as its category and its block names only', () => {
      const { container } = render(<ProxyBlockLists blocks={only('supported', [QUEUE, TOPIC])} />)

      expect(writtenTexts(container)).toEqual([
        'Blocks that use this proxy',
        'messaging',
        'Acme Queue',
        'Acme Topic',
      ])
    })
  })

  describe('A block name that does not fit', () => {
    // One block is drawn, under the name the palette gives it.
    function blockName(): HTMLElement {
      return screen.getByTestId('proxy-block-name')
    }

    function tooltip(): HTMLElement | null {
      return document.querySelector('[data-slot="tooltip-content"]')
    }

    it('shows the whole name in the shared tooltip', () => {
      const scrollWidth = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(180)
      const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(96)
      try {
        render(<ProxyBlockLists blocks={only('supported', [HTTP])} />)

        act(() => {
          fireEvent.focus(blockName())
        })

        expect(blockName()).not.toBeEmptyDOMElement()
        expect(tooltip()).toHaveTextContent(blockName().textContent ?? '')
      } finally {
        scrollWidth.mockRestore()
        clientWidth.mockRestore()
      }
    })

    it('shows no tooltip for a name that fits', () => {
      render(<ProxyBlockLists blocks={only('supported', [HTTP])} />)

      act(() => {
        fireEvent.focus(blockName())
      })

      expect(tooltip()).toBeNull()
    })

    it('keeps the name in the weight of the palette row', () => {
      render(<ProxyBlockLists blocks={only('supported', [HTTP])} />)

      const name = blockName()
      expect(name).toHaveClass('font-normal')
      expect(name).not.toHaveClass('font-medium')
      expect(name.querySelector('span')).toHaveClass('truncate', 'font-normal')
    })
  })
})
