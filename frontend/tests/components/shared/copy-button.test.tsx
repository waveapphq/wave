/**
 * Shared copy-to-clipboard icon button used by the file and folder rows.
 *
 * Module: frontend/src/components/shared/copy-button.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { CopyButton, type CopyButtonProps } from '@/components/shared/copy-button'
import { clipboardMock } from '../../setup'

const COPY_RESET_MS = 2000

type Overrides = Partial<Omit<CopyButtonProps, 'label' | 'ariaLabel'>>

function renderButton(props: Overrides = {}) {
  render(<CopyButton value="testdata://fixtures/users.csv" label="users.csv" {...props} />)
  return screen.getByRole('button', { name: 'Copy path of users.csv' })
}

function animatedClassTokens(root: HTMLElement): string[] {
  const tokens: string[] = []
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const token of Array.from(element.classList)) {
      if (token.startsWith('animate-') && token !== 'animate-none') {
        tokens.push(token)
      }
    }
  }
  return tokens
}

async function clickCopy(button: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(button)
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('CopyButton - chrome', () => {
  it('renders a ghost icon button labeled for the file it copies', () => {
    const button = renderButton()

    expect(button).toHaveClass('btn-ghost')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('names the button after the label it is given', () => {
    render(<CopyButton value="artifact://reports/out.json" label="out.json" />)

    expect(screen.getByRole('button', { name: 'Copy path of out.json' })).toBeInTheDocument()
  })

  it('shows the copy icon before any click', () => {
    const button = renderButton()

    expect(button.querySelector('.lucide-copy')).toBeInTheDocument()
    expect(button.querySelector('.lucide-check')).not.toBeInTheDocument()
  })

  it('keeps the live region empty before any click', () => {
    renderButton()

    expect(screen.queryByText('Path copied')).not.toBeInTheDocument()
  })
})

describe('CopyButton - copying', () => {
  it('writes the value to the clipboard', async () => {
    const button = renderButton()

    await clickCopy(button)

    expect(clipboardMock.writeText).toHaveBeenCalledWith('testdata://fixtures/users.csv')
  })

  it('copies the value, not the label', async () => {
    render(<CopyButton value="artifact://reports/out.json" label="out.json" />)

    await clickCopy(screen.getByRole('button', { name: 'Copy path of out.json' }))

    expect(clipboardMock.writeText).toHaveBeenCalledWith('artifact://reports/out.json')
  })

  it('announces "Path copied" to a screen reader', async () => {
    const button = renderButton()

    await clickCopy(button)

    expect(screen.getByText('Path copied')).toBeInTheDocument()
  })

  it('swaps the copy icon for a check', async () => {
    const button = renderButton()

    await clickCopy(button)

    expect(button.querySelector('.lucide-check')).toBeInTheDocument()
    expect(button.querySelector('.lucide-copy')).not.toBeInTheDocument()
  })
})

describe('CopyButton - the cue clears itself', () => {
  it('keeps the check for two seconds', async () => {
    const button = renderButton()
    vi.useFakeTimers()

    await clickCopy(button)
    await act(async () => {
      vi.advanceTimersByTime(COPY_RESET_MS - 1)
    })

    expect(button.querySelector('.lucide-check')).toBeInTheDocument()
  })

  it('returns to the copy icon after two seconds', async () => {
    const button = renderButton()
    vi.useFakeTimers()

    await clickCopy(button)
    await act(async () => {
      vi.advanceTimersByTime(COPY_RESET_MS)
    })

    expect(button.querySelector('.lucide-copy')).toBeInTheDocument()
    expect(button.querySelector('.lucide-check')).not.toBeInTheDocument()
  })

  it('clears the announcement after two seconds', async () => {
    const button = renderButton()
    vi.useFakeTimers()

    await clickCopy(button)
    await act(async () => {
      vi.advanceTimersByTime(COPY_RESET_MS)
    })

    expect(screen.queryByText('Path copied')).not.toBeInTheDocument()
  })
})

describe('CopyButton - a failed copy stays silent', () => {
  it('does not throw when the clipboard rejects', async () => {
    clipboardMock.writeText.mockRejectedValueOnce(new Error('denied'))
    const button = renderButton()

    await expect(clickCopy(button)).resolves.toBeUndefined()
  })

  it('shows no check icon when the clipboard rejects', async () => {
    clipboardMock.writeText.mockRejectedValueOnce(new Error('denied'))
    const button = renderButton()

    await clickCopy(button)

    expect(button.querySelector('.lucide-check')).not.toBeInTheDocument()
    expect(button.querySelector('.lucide-copy')).toBeInTheDocument()
  })

  it('announces nothing when the clipboard rejects', async () => {
    clipboardMock.writeText.mockRejectedValueOnce(new Error('denied'))
    const button = renderButton()

    await clickCopy(button)

    expect(screen.queryByText('Path copied')).not.toBeInTheDocument()
  })
})

describe('CopyButton - reduced motion', () => {
  it('animates nothing when the viewer asks for reduced motion', async () => {
    const original = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      })),
    })

    try {
      const button = renderButton()
      await clickCopy(button)

      expect(button.querySelector('.lucide-check')).toBeInTheDocument()
      expect(animatedClassTokens(button)).toEqual([])
    } finally {
      Object.defineProperty(window, 'matchMedia', { writable: true, value: original })
    }
  })
})

describe('CopyButton - caller chrome', () => {
  it('takes the whole button name from the caller for a value that is not a path', () => {
    render(<CopyButton value="boom" ariaLabel="Copy failure details" />)

    expect(screen.getByRole('button', { name: 'Copy failure details' })).toBeInTheDocument()
  })

  it('stamps the copy-path test id when the caller names none', () => {
    renderButton()

    expect(screen.getByTestId('copy-path-button')).toBeInTheDocument()
  })

  it('stamps the test id the caller names on the button', () => {
    renderButton({ testId: 'page-blocked-copy' })

    expect(screen.getByTestId('page-blocked-copy')).toBeInTheDocument()
  })

  it('stamps the test id the caller names on the check icon', async () => {
    const button = renderButton({ copiedTestId: 'page-blocked-copy-success' })

    await clickCopy(button)

    expect(screen.getByTestId('page-blocked-copy-success')).toBeInTheDocument()
  })

  it('announces the wording the caller asks for', async () => {
    const button = renderButton({ announcement: 'Failure details copied to clipboard' })

    await clickCopy(button)

    expect(screen.getByText('Failure details copied to clipboard')).toBeInTheDocument()
  })

  it('shrinks the icon on a small button', () => {
    const button = renderButton({ size: 'sm' })

    expect(button.querySelector('.lucide-copy')).toHaveClass('h-3.5')
  })

  it('hangs a tooltip on the button when the caller gives one', () => {
    const button = renderButton({ tooltip: 'Copy' })

    expect(button).toHaveAttribute('data-state', 'closed')
  })

  it('leaves the button unwrapped when no tooltip is given', () => {
    const button = renderButton()

    expect(button).not.toHaveAttribute('data-state')
  })
})

describe('CopyButton - visible text', () => {
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'

  function renderTextButton() {
    render(<CopyButton value={PEM} text="Copy" />)
    return screen.getByRole('button', { name: 'Copy' })
  }

  it('shows the text beside the copy icon', () => {
    const button = renderTextButton()

    expect(button).toHaveTextContent(/^Copy$/)
    expect(button.querySelector('.lucide-copy')).toBeInTheDocument()
  })

  it('names the button by the text alone, with no "Copy path of" prefix', () => {
    renderTextButton()

    expect(screen.queryByRole('button', { name: /Copy path of/ })).not.toBeInTheDocument()
  })

  it('writes the value to the clipboard, not the text', async () => {
    const button = renderTextButton()

    await clickCopy(button)

    expect(clipboardMock.writeText).toHaveBeenCalledWith(PEM)
  })

  it('swaps the icon for a check, keeps the text and keeps its name', async () => {
    const button = renderTextButton()

    await clickCopy(button)

    expect(button.querySelector('.lucide-check')).toBeInTheDocument()
    expect(button).toHaveTextContent('Copy')
    expect(screen.getByRole('button', { name: 'Copy' })).toBe(button)
  })
})

describe('CopyButton - a caller that owns the cue', () => {
  it('reports a successful copy to the caller', async () => {
    const onCopied = vi.fn()
    const button = renderButton({ onCopied })

    await clickCopy(button)

    expect(onCopied).toHaveBeenCalledTimes(1)
  })

  it('reports nothing when the clipboard rejects', async () => {
    clipboardMock.writeText.mockRejectedValueOnce(new Error('denied'))
    const onCopied = vi.fn()
    const button = renderButton({ onCopied })

    await clickCopy(button)

    expect(onCopied).not.toHaveBeenCalled()
  })

  it('shows no check while the caller holds the cue off', async () => {
    const button = renderButton({ copied: false })

    await clickCopy(button)

    expect(button.querySelector('.lucide-check')).not.toBeInTheDocument()
    expect(button.querySelector('.lucide-copy')).toBeInTheDocument()
  })
})
