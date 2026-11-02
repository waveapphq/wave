/**
 * RestoreItemList Component Tests
 *
 * REQ-5.2.1.42: the named entries of a backup preview row and of a restore
 * result line (BACKUP-3) - one line per entry with its status icon, name and reason;
 * an entry that cannot be restored leads its reason with what happens to it.
 *
 * Module: frontend/src/features/settings/components/backup-restore-tab/restore-item-list.tsx
 */

import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { RestoreItemList } from '@/features/settings/components/backup-restore-tab/restore-item-list'
import type { RestoreStage } from '@/features/settings/components/backup-restore-tab/status-icons'
import type { BackupItem } from '@/features/settings/api/backup'

// ============================================================================
// Fixtures
// ============================================================================

const ITEMS: BackupItem[] = [
  { name: 'nightly-smoke', status: 'conflict', reason: 'Name already in use' },
  { name: 'bad.json', status: 'fatal', reason: 'Cannot be read' },
  { name: 'Login Flow v2', status: 'skipped', reason: 'Already in this WAVE' },
  {
    name: 'checkout',
    status: 'fatal',
    reason: 'Uses Function "Login" v2, which is not in the backup or in this WAVE',
  },
]

const STATUS_TOKENS = [
  ['fatal', 'text-destructive'],
  ['conflict', 'text-warning'],
  ['skipped', 'text-muted-foreground'],
] as const

const LONG_REASON = `Could not be written: ${'word '.repeat(35)}end`

const LONG_NAME = `${'nightly_checkout_regression_'.repeat(5)}member.yml`

const MISSING_VERSION = 'Uses Function "F1-Func" 1.2.0, which is not in this WAVE'

/** The words a fatal line leads with, by where the list is drawn. */
const FATAL_OUTCOMES: Record<RestoreStage, string> = {
  preview: 'Cannot be restored',
  result: 'Not restored',
}

/** The text after the name of a line. */
function reasonText(item: BackupItem, stage: RestoreStage): string {
  return item.status === 'fatal' ? `${FATAL_OUTCOMES[stage]}. ${item.reason}` : item.reason
}

function manyItems(count: number): BackupItem[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `test-${index + 1}`,
    status: 'conflict' as const,
    reason: 'Name already in use',
  }))
}

// ============================================================================
// Test Utilities
// ============================================================================

function renderList(items: readonly BackupItem[] = ITEMS, stage: RestoreStage = 'preview') {
  render(<RestoreItemList items={items} stage={stage} />)
  return {
    list: screen.getByTestId('restore-item-list'),
    lines: screen.getAllByTestId('restore-item'),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('RestoreItemList', () => {
  it('draws one line per item in the order given', () => {
    const { lines } = renderList()

    expect(lines).toHaveLength(ITEMS.length)
    ITEMS.forEach((item, index) => {
      expect(within(lines[index]).getByText(item.name)).toBeInTheDocument()
    })
    expect(lines.map((line) => line.getAttribute('data-status'))).toEqual(
      ITEMS.map((item) => item.status)
    )
  })

  it('shows the name and the reason word for word', () => {
    const { lines } = renderList()

    ITEMS.forEach((item, index) => {
      const line = lines[index]
      const reason = reasonText(item, 'preview')
      expect(within(line).getByText(item.name)).toBeInTheDocument()
      expect(within(line).getByText(reason)).toBeInTheDocument()
      const otherText = (line.textContent ?? '').replace(item.name, '').replace(reason, '')
      expect(otherText.trim()).toBe('')
    })
  })

  it('leads a fatal line of the preview with "Cannot be restored"', () => {
    const { lines } = renderList(
      [{ name: 'F1-User', status: 'fatal', reason: MISSING_VERSION }],
      'preview'
    )

    const shown = `Cannot be restored. ${MISSING_VERSION}`
    expect(within(lines[0]).getByText(shown).childNodes).toHaveLength(1)
    expect(lines[0].textContent).toBe(`F1-User${shown}`)
  })

  it('leads a fatal line of the result with "Not restored"', () => {
    const { lines } = renderList(
      [{ name: 'F1-User', status: 'fatal', reason: MISSING_VERSION }],
      'result'
    )

    const shown = `Not restored. ${MISSING_VERSION}`
    expect(within(lines[0]).getByText(shown).childNodes).toHaveLength(1)
    expect(lines[0].textContent).toBe(`F1-User${shown}`)
  })

  it('shows a conflict line of the preview with its reason alone', () => {
    const { lines } = renderList(
      [{ name: 'nightly-smoke', status: 'conflict', reason: 'Name already in use' }],
      'preview'
    )

    expect(within(lines[0]).getByText('Name already in use')).toBeInTheDocument()
    expect(lines[0].textContent).toBe('nightly-smokeName already in use')
  })

  it('shows a skipped line of the result with its reason alone', () => {
    const { lines } = renderList(
      [{ name: 'Login Flow v2', status: 'skipped', reason: 'Already in this WAVE' }],
      'result'
    )

    expect(within(lines[0]).getByText('Already in this WAVE')).toBeInTheDocument()
    expect(lines[0].textContent).toBe('Login Flow v2Already in this WAVE')
  })

  it('draws the icon of each status', () => {
    const { lines } = renderList()

    for (const [status, token] of STATUS_TOKENS) {
      const line = lines.find((candidate) => candidate.getAttribute('data-status') === status)
      expect(line).toBeDefined()
      const icons = (line as HTMLElement).querySelectorAll('[data-status]')
      expect(icons).toHaveLength(1)
      expect(icons[0]).toHaveAttribute('data-status', status)
      expect(icons[0]).toHaveClass(token)
    }
  })

  it('scrolls inside its border after six lines', () => {
    const { list } = renderList(manyItems(7))

    expect(within(list).getAllByTestId('restore-item')).toHaveLength(7)
    expect(list).toHaveClass('max-h-[168px]', 'overflow-y-auto')
  })

  it('shows a long reason whole', () => {
    expect(LONG_REASON).toHaveLength(200)
    const { lines } = renderList(
      [{ name: 'checkout', status: 'fatal', reason: LONG_REASON }],
      'result'
    )

    expect(lines).toHaveLength(1)
    expect(within(lines[0]).getByText(`Not restored. ${LONG_REASON}`)).toBeInTheDocument()
  })

  it('shows a long name whole, with no tooltip and no other text', () => {
    expect(LONG_NAME).toHaveLength(150)
    const { lines } = renderList([{ name: LONG_NAME, status: 'fatal', reason: 'Cannot be read' }])

    const reason = 'Cannot be restored. Cannot be read'
    expect(lines).toHaveLength(1)
    expect(within(lines[0]).getByText(LONG_NAME)).toBeInTheDocument()
    expect(within(lines[0]).getByText(reason)).toBeInTheDocument()
    expect(lines[0].textContent).toBe(`${LONG_NAME}${reason}`)
    expect(lines[0]).not.toHaveAttribute('title')
    expect(lines[0].querySelector('[title]')).not.toBeInTheDocument()
  })

  it('keeps each name out of page translation, and leaves the reason to it', () => {
    const { lines } = renderList()

    ITEMS.forEach((item, index) => {
      const line = within(lines[index])
      expect(line.getByText(item.name)).toHaveAttribute('translate', 'no')
      expect(line.getByText(reasonText(item, 'preview'))).not.toHaveAttribute('translate')
    })
  })

  it('is a list that the keyboard can reach', () => {
    const { list, lines } = renderList()

    expect(screen.getByRole('list')).toBe(list)
    expect(list).toHaveAttribute('tabindex', '0')
    const listItems = within(list).getAllByRole('listitem')
    expect(listItems).toHaveLength(lines.length)
    listItems.forEach((listItem, index) => {
      expect(listItem).toBe(lines[index])
    })
  })

  it('takes its name from the element it is given', () => {
    render(
      <>
        <span id="part-name-tests">tests</span>
        <RestoreItemList items={ITEMS} stage="preview" labelId="part-name-tests" />
      </>
    )

    const list = screen.getByTestId('restore-item-list')
    expect(list).toHaveAttribute('aria-labelledby', 'part-name-tests')
    expect(screen.getByRole('list', { name: 'tests' })).toBe(list)
  })
})
