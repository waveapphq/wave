/**
 * ReadOnlyFact Component Tests
 *
 * REQ-5.2.1.42 / REQ-4.7.13: shared lock-marked read-only fact (WSRV-2, WSRV-10):
 * label, lock icon, mono value and an optional copy button. The columns layout
 * hands the three parts to a parent grid; the inline layout is the default.
 *
 * Component: frontend/src/features/settings/components/read-only-fact.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import { copyText } from '@/lib/clipboard'
import { ReadOnlyFact } from '@/features/settings/components/read-only-fact'

vi.mock('@/lib/clipboard', () => ({
  copyText: vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true),
}))

const DATA_FOLDER = '/srv/wave/data'
const PROXY_URL = 'http://proxy.corp.example:3128'

beforeEach(() => {
  vi.mocked(copyText).mockClear()
})

describe('ReadOnlyFact', () => {
  it('renders the label and the value', () => {
    render(<ReadOnlyFact label="Data folder" value={DATA_FOLDER} />)

    expect(screen.getByText('Data folder')).toBeInTheDocument()
    expect(screen.getByText(DATA_FOLDER)).toBeInTheDocument()
  })

  it('renders the value in mono text', () => {
    render(<ReadOnlyFact label="Data folder" value={DATA_FOLDER} />)

    expect(screen.getByText(DATA_FOLDER)).toHaveClass('font-mono')
  })

  it('keeps the value out of page translation', () => {
    render(<ReadOnlyFact label="Data folder" value={DATA_FOLDER} />)

    expect(screen.getByText(DATA_FOLDER)).toHaveAttribute('translate', 'no')
  })

  it('shows a lock icon hidden from assistive tech', () => {
    const { container } = render(<ReadOnlyFact label="Port" value="8000" />)

    const lock = container.querySelector('svg.lucide-lock')
    expect(lock).toBeInTheDocument()
    expect(lock).toHaveAttribute('aria-hidden', 'true')
  })

  it('passes its data-testid through', () => {
    render(<ReadOnlyFact label="Port" value="8000" data-testid="port-fact" />)

    expect(screen.getByTestId('port-fact')).toHaveTextContent('Port')
    expect(screen.getByTestId('port-fact')).toHaveTextContent('8000')
  })

  describe('Copy button', () => {
    it('renders no copy button by default', () => {
      render(<ReadOnlyFact label="Port" value="8000" />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('renders no copy button when copyable is false', () => {
      render(<ReadOnlyFact label="Port" value="8000" copyable={false} />)

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('renders a copy button named after the label when copyable', () => {
      render(<ReadOnlyFact label="Data folder" value={DATA_FOLDER} copyable />)

      expect(screen.getByRole('button', { name: 'Copy Data folder' })).toBeInTheDocument()
    })

    it('copies the value when the copy button is clicked', async () => {
      render(<ReadOnlyFact label="Data folder" value={DATA_FOLDER} copyable />)

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy Data folder' }))
      })

      expect(copyText).toHaveBeenCalledTimes(1)
      expect(copyText).toHaveBeenCalledWith(DATA_FOLDER)
    })
  })

  describe('Columns layout', () => {
    it('hands the label, the lock and the value to the parent as three parts, in that order', () => {
      const { container } = render(
        <ReadOnlyFact
          label="HTTPS_PROXY"
          value={PROXY_URL}
          layout="columns"
          data-testid="https-proxy-fact"
        />,
      )

      const parts = Array.from(screen.getByTestId('https-proxy-fact').children)
      expect(parts).toHaveLength(3)
      expect(parts[0].textContent).toBe('HTTPS_PROXY')
      expect(parts[1]).toContainElement(container.querySelector<SVGElement>('svg.lucide-lock'))
      expect(parts[2].textContent).toBe(PROXY_URL)
    })

    it('keeps the lock hidden from assistive tech and the value mono and untranslated', () => {
      const { container } = render(
        <ReadOnlyFact
          label="HTTPS_PROXY"
          value={PROXY_URL}
          layout="columns"
          data-testid="https-proxy-fact"
        />,
      )

      expect(Array.from(screen.getByTestId('https-proxy-fact').children)).toHaveLength(3)
      expect(container.querySelector('svg.lucide-lock')).toHaveAttribute('aria-hidden', 'true')
      expect(screen.getByText(PROXY_URL)).toHaveClass('font-mono')
      expect(screen.getByText(PROXY_URL)).toHaveAttribute('translate', 'no')
    })

    it('lays its parts out inline by default and leaves the lining up to the parent in columns', () => {
      const { container } = render(
        <>
          <ReadOnlyFact label="Port" value="8000" />
          <ReadOnlyFact label="Port" value="8000" layout="inline" />
          <ReadOnlyFact label="Port" value="8000" layout="columns" />
        </>,
      )

      const [byDefault, inline, columns] = Array.from(container.children)
      expect(byDefault).toHaveClass('flex', 'items-center')
      expect(inline.outerHTML).toBe(byDefault.outerHTML)
      expect(columns).not.toHaveClass('flex')
    })
  })
})
