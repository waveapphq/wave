/**
 * InteractionsHintPopover Component
 *
 * REQ-4.2.5 Keyboard shortcuts for common operations
 * REQ-5.2.1.31 Full keyboard navigation
 *
 * Floating popover displaying keyboard shortcut reference grouped by category:
 * Insertion (3), Blocks (2), Editing (6), Selection (5), Navigation (2),
 * History (2) = 20 shortcuts total.
 * Platform-aware modifier labels (Ctrl on Linux/Windows, ⌘ on macOS).
 * Quick Add stays literally Ctrl+Space on macOS too (Cmd+Space is Spotlight).
 * Vertical list layout: label left-aligned, key badge(s) right-aligned.
 * Sections divided by horizontal rules with uppercase headers.
 */

import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { formatShortcut, getModifierLabel } from '@/lib/platform'

interface InteractionsHintPopoverProps {
  open: boolean
}

interface ShortcutEntry {
  label: string
  keys: string[]
}

interface ShortcutSection {
  title: string
  shortcuts: ShortcutEntry[]
}

function getSections(): ShortcutSection[] {
  const mod = getModifierLabel()

  return [
    {
      title: 'INSERTION',
      shortcuts: [
        { label: 'Quick Insert', keys: ['Ctrl+Space'] },
        { label: 'Add where the flow is', keys: ['Enter'] },
        { label: 'Add at center', keys: [formatShortcut('Enter')] },
      ],
    },
    {
      title: 'BLOCKS',
      shortcuts: [
        { label: 'Configure', keys: ['Enter'] },
        { label: 'Open Function', keys: [formatShortcut('Enter')] },
      ],
    },
    {
      title: 'EDITING',
      shortcuts: [
        { label: 'Copy', keys: [formatShortcut('C')] },
        { label: 'Cut', keys: [formatShortcut('X')] },
        { label: 'Paste', keys: [formatShortcut('V')] },
        { label: 'Duplicate', keys: [formatShortcut('D')] },
        { label: 'Delete', keys: ['Del'] },
        { label: 'Unlink', keys: ['Backspace'] },
      ],
    },
    {
      title: 'SELECTION',
      shortcuts: [
        { label: 'Select', keys: ['Click'] },
        { label: 'Multi-select', keys: [`${mod}+Click`] },
        { label: 'Box Select', keys: ['Shift+Drag'] },
        { label: 'Chain Select', keys: ['Shift+Click'] },
        { label: 'Select All', keys: [formatShortcut('A')] },
      ],
    },
    {
      title: 'NAVIGATION',
      shortcuts: [
        { label: 'Zoom', keys: ['Scroll'] },
        { label: 'Pan', keys: ['Drag'] },
      ],
    },
    {
      title: 'HISTORY',
      shortcuts: [
        { label: 'Undo', keys: [formatShortcut('Z')] },
        { label: 'Redo', keys: [formatShortcut('Shift+Z')] },
      ],
    },
  ]
}

export function InteractionsHintPopover({ open }: Readonly<InteractionsHintPopoverProps>) {
  if (!open) return null

  const sections = getSections()

  return (
    <div
      data-testid="interactions-hint-popover"
      className="flex flex-col gap-2 p-3 text-xs text-muted-foreground"
    >
      {sections.map((section, sectionIndex) => (
        <div key={section.title}>
          {sectionIndex > 0 && <Separator decorative={false} className="mb-2" />}
          <div className="mb-1 text-[10px] font-semibold tracking-wider text-foreground/50">
            {section.title}
          </div>
          <div className="flex flex-col gap-1">
            {section.shortcuts.map((shortcut) => (
              <div
                key={shortcut.label}
                data-testid="shortcut-entry"
                className="flex items-center justify-between gap-4"
              >
                <span data-testid="shortcut-label" className="text-foreground/70">
                  {shortcut.label}
                </span>
                <span className="flex items-center gap-0.5">
                  {shortcut.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
