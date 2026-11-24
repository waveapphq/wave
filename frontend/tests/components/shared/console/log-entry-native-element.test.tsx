/** Console log entries are <article> elements with their names. */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LogEntry } from '@/components/shared/console/log-entry'
import type { DisplaySettings, LogEntry as LogEntryType } from '@/types/console'

const entry: LogEntryType = {
  id: 'log-1',
  timestamp: '2025-01-22T18:30:45.123Z',
  level: 'INFO',
  message: 'Request sent',
  source: 'HTTP Client',
  sequence: 1,
}

const settings: DisplaySettings = {
  showTimestamps: true,
  showLevel: true,
  showSource: true,
  sourceWidth: 20,
  showSystemLogs: true,
  fontSize: 12,
}

describe('LogEntry native element', () => {
  it('renders the entry as an article element with the article role and its name', () => {
    render(<LogEntry entry={entry} displaySettings={settings} aria-posinset={3} aria-setsize={7} />)

    const article = screen.getByRole('article', { name: 'INFO: Request sent' })
    expect(article.tagName).toBe('ARTICLE')
    expect(article).toBe(screen.getByTestId('log-entry-log-1'))
  })

  it('drops the explicit role attribute and keeps every other attribute and class', () => {
    render(<LogEntry entry={entry} displaySettings={settings} aria-posinset={3} aria-setsize={7} />)

    const article = screen.getByTestId('log-entry-log-1')
    expect(article).not.toHaveAttribute('role')
    expect(article).toHaveAttribute('aria-label', 'INFO: Request sent')
    expect(article).toHaveAttribute('aria-posinset', '3')
    expect(article).toHaveAttribute('aria-setsize', '7')
    expect(article).toHaveAttribute('data-copy-text')
    expect(article).toHaveClass('font-mono', 'px-2', 'flex', 'items-start')
  })

  it('renders one article per entry for every level', () => {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const
    render(
      <>
        {levels.map((level, index) => (
          <LogEntry
            key={level}
            entry={{ ...entry, id: `log-${level}`, level, sequence: index + 1 }}
            displaySettings={settings}
          />
        ))}
      </>,
    )

    const articles = screen.getAllByRole('article')
    expect(articles).toHaveLength(levels.length)
    for (const article of articles) expect(article.tagName).toBe('ARTICLE')
  })
})
