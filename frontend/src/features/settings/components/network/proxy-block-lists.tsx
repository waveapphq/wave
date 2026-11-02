/**
 * The Proxy Blocks sections (REQ-4.7.14, NET-10): which blocks use the proxy, which do not
 * and which it does not apply to, each a collapsible card of the palette's groups.
 */

import { useId } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TruncatedName } from '@/components/shared/truncated-name'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { BlockRef, ProxyBlocks } from '@/features/settings/api/proxy'
import { getIconComponent } from '@/features/workbench/lib/icon-registry'
import {
  PLUGIN_CATEGORIES,
  getPluginById,
  getPluginsByCategory,
} from '@/features/workbench/lib/plugin-definitions'
import { useSessionLayoutState } from '@/hooks/use-session-layout-state'
import { cn } from '@/lib/utils'

export interface ProxyBlockListsProps {
  blocks: ProxyBlocks
}

interface ListedBlock {
  id: string
  name: string
  iconName: string
}

interface BlockGroup {
  key: string
  name: string
  colorClass: string
  blocks: ListedBlock[]
}

interface SectionConfig {
  list: keyof ProxyBlocks
  title: string
  testId: string
  defaultOpen: boolean
}

const SECTIONS: readonly SectionConfig[] = [
  {
    list: 'supported',
    title: 'Blocks that use this proxy',
    testId: 'proxy-blocks-supported',
    defaultOpen: true,
  },
  {
    list: 'unsupported',
    title: 'Blocks that do not use this proxy',
    testId: 'proxy-blocks-unsupported',
    defaultOpen: true,
  },
  {
    list: 'not_applicable',
    title: 'Not applicable',
    testId: 'proxy-blocks-not-applicable',
    defaultOpen: false,
  },
]

const UNKNOWN_GROUP_COLOR = 'text-muted-foreground'
// An empty icon name gets the palette's default icon.
const UNKNOWN_BLOCK_ICON = ''

/** The palette's groups and blocks, in the palette's order, for the blocks the list names. */
function paletteGroups(blocks: readonly BlockRef[]): BlockGroup[] {
  const ids = new Set(blocks.map((block) => block.id))
  return PLUGIN_CATEGORIES.map((category) => ({
    key: `palette:${category.id}`,
    name: category.name,
    colorClass: category.colorClass,
    blocks: getPluginsByCategory(category.id).filter((plugin) => ids.has(plugin.id)),
  })).filter((group) => group.blocks.length > 0)
}

/** Blocks the palette does not know, grouped by the category the backend sent, in the order received. */
function unknownGroups(blocks: readonly BlockRef[]): BlockGroup[] {
  const groups = new Map<string, BlockGroup>()
  for (const block of blocks) {
    if (getPluginById(block.id)) continue
    const group = groups.get(block.category) ?? {
      key: `sent:${block.category}`,
      name: block.category,
      colorClass: UNKNOWN_GROUP_COLOR,
      blocks: [],
    }
    group.blocks.push({ id: block.id, name: block.name, iconName: UNKNOWN_BLOCK_ICON })
    groups.set(block.category, group)
  }
  return [...groups.values()]
}

function BlockGroupRow({ group }: Readonly<{ group: BlockGroup }>) {
  const nameId = useId()
  return (
    <div
      data-testid="proxy-block-group"
      className="grid grid-cols-[8.25rem_minmax(0,1fr)] items-start px-3 py-2"
    >
      <span
        id={nameId}
        data-testid="proxy-block-group-name"
        className={cn(
          'min-w-0 break-words py-2.5 pr-2 text-xs font-medium uppercase tracking-wider',
          group.colorClass,
        )}
      >
        {group.name}
      </span>
      <ul aria-labelledby={nameId} className="grid grid-cols-4 gap-x-1 gap-y-0.5">
        {group.blocks.map((block) => {
          const Icon = getIconComponent(block.iconName)
          return (
            <li
              key={block.id}
              data-testid="proxy-block"
              className="flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm"
            >
              <Icon className={cn('h-5 w-5 shrink-0', group.colorClass)} aria-hidden="true" />
              <TruncatedName
                value={block.name}
                testId="proxy-block-name"
                className="font-normal"
                textClassName="font-normal"
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface BlockSectionProps {
  section: SectionConfig
  blocks: readonly BlockRef[]
}

function BlockSection({ section, blocks }: Readonly<BlockSectionProps>) {
  const [open, setOpen] = useSessionLayoutState(
    `settings.proxy-blocks.${section.list}`,
    section.defaultOpen,
  )
  const Chevron = open ? ChevronDown : ChevronRight
  const groups = [...paletteGroups(blocks), ...unknownGroups(blocks)]
  return (
    <Collapsible
      data-testid={section.testId}
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-md border border-border"
    >
      <h3>
        {/* The card clips what leaves it, so the focus outline is drawn inside the header. */}
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 border-border bg-card p-3 text-left text-sm font-semibold transition-colors hover:bg-muted focus-visible:-outline-offset-2 data-[state=open]:border-b">
          {section.title}
          <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent className="divide-y divide-border">
        {groups.map((group) => (
          <BlockGroupRow key={group.key} group={group} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ProxyBlockLists({ blocks }: Readonly<ProxyBlockListsProps>) {
  return (
    <div className="space-y-4">
      {SECTIONS.filter((section) => blocks[section.list].length > 0).map((section) => (
        <BlockSection key={section.list} section={section} blocks={blocks[section.list]} />
      ))}
    </div>
  )
}
