/**
 * PythonHelpPopover - the F1 help popover over the Python body (PYRUN-13).
 *
 * Contract under test: the keyboard list in order, the collapsed tips toggle,
 * the four tip subsections, the X close control, the labeled dialog role, and
 * focus moving in on open and back to the editor on close.
 */

import { useRef, useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { PythonHelpPopover } from '@/features/workbench/common/variables/variable-inspect-modal/python-help-popover'

interface KeyboardRow {
  readonly keys: readonly string[]
  readonly label: string
}

/** PYRUN-13 keyboard list, in its stated order. */
const KEYBOARD_ROWS: readonly KeyboardRow[] = [
  { keys: ['Ctrl', 'Space'], label: 'Autocomplete' },
  { keys: ['Shift', 'Enter'], label: 'Run' },
  { keys: ['Ctrl', 'Enter'], label: 'Save' },
  { keys: ['Esc'], label: 'Close' },
  { keys: ['F2'], label: 'Rename symbol' },
  { keys: ['Ctrl', '/'], label: 'Toggle comment' },
  { keys: ['Ctrl', 'F'], label: 'Find and replace' },
  { keys: ['Ctrl', 'G'], label: 'Go to line' },
  { keys: ['Tab', 'Shift', 'Tab'], label: 'Indent / outdent' },
  { keys: ['Ctrl', 'Z', 'Ctrl', 'Y'], label: 'Undo / redo' },
]

interface Tip {
  readonly text: string
  readonly example: string | null
}

interface TipSection {
  readonly heading: string
  readonly tips: readonly Tip[]
}

/** PYRUN-13 tips, verbatim. */
const TIP_SECTIONS: readonly TipSection[] = [
  {
    heading: 'Inputs',
    tips: [
      { text: 'Input Variables are globals', example: 'limit = float(threshold)' },
      {
        text: 'A table iterates as row dicts',
        example: 'for row in readings: row["temp_c"]',
      },
      { text: 'Floats arrive as Decimal', example: 'float(price) * 2' },
    ],
  },
  {
    heading: 'Outputs',
    tips: [
      {
        text: 'Assign a name to fill a Variable Export',
        example: 'summary = {"mean": mean_temp}',
      },
      {
        text: 'A list of dicts fills a table export',
        example: 'rows = [{"id": 1, "ok": True}]',
      },
      { text: 'Exports are read even when the script raises', example: null },
    ],
  },
  {
    heading: 'Logging and failure',
    tips: [
      {
        text: 'logging goes to the run console, print to Stdout',
        example: 'logging.info("done %d", count)',
      },
      {
        text: 'An exception or a failed assert fails the block with its traceback',
        example: 'assert ok, "no rows"',
      },
      { text: 'sys.exit ends with that exit code', example: 'sys.exit(2)' },
    ],
  },
  {
    heading: 'Files and modules',
    tips: [
      {
        text: 'Modules in the Working Directory import by name',
        example: 'import helpers',
      },
      {
        text: 'Test Data and Artifacts folders come from the environment',
        example: 'os.environ["WAVE_TESTDATA_DIR"]',
      },
    ],
  },
]

const ALL_TIPS: readonly Tip[] = TIP_SECTIONS.flatMap((section) => section.tips)

/** The sheet host: a script editor, the F1 chip that anchors the popover. */
function HelpHarness({ onClosed }: { readonly onClosed?: () => void }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  return (
    <div>
      <textarea ref={editorRef} aria-label="Script" data-testid="script-editor" />
      <button
        type="button"
        ref={setAnchor}
        data-testid="help-chip"
        onClick={() => setOpen(true)}
      >
        F1 Help
      </button>
      <PythonHelpPopover
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        onClosed={() => {
          onClosed?.()
          editorRef.current?.focus()
        }}
      />
    </div>
  )
}

async function openHelp(
  user: ReturnType<typeof userEvent.setup>,
  onClosed?: () => void,
): Promise<HTMLElement> {
  render(<HelpHarness onClosed={onClosed} />)
  await user.click(screen.getByTestId('help-chip'))
  return await screen.findByRole('dialog', { name: 'Keyboard' })
}

function keyRows(dialog: HTMLElement): KeyboardRow[] {
  return within(dialog)
    .getAllByTestId('python-help-key-row')
    .map((row) => ({
      keys: [...row.querySelectorAll('kbd')].map((chip) =>
        (chip.textContent ?? '').trim(),
      ),
      label: (
        row.querySelector('[data-testid="python-help-key-label"]')?.textContent ?? ''
      ).trim(),
    }))
}

function normalize(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim()
}

function expectInOrder(root: HTMLElement, fragments: readonly string[]): void {
  const text = normalize(root.textContent ?? '')
  let cursor = -1
  for (const fragment of fragments) {
    const at = text.indexOf(normalize(fragment), cursor + 1)
    expect(at, `"${fragment}" should follow the entry before it`).toBeGreaterThan(cursor)
    cursor = at
  }
}

function tipsToggle(dialog: HTMLElement, name: 'Show tips' | 'Hide tips'): HTMLElement {
  return within(dialog).getByRole('button', { name })
}

describe('PythonHelpPopover - dialog shell (PYRUN-13)', () => {
  it('stays closed until the host opens it', () => {
    render(<HelpHarness />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
  })

  it('opens as a dialog labeled by its Keyboard heading', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    expect(dialog).toHaveAttribute('data-testid', 'python-help-popover')
    const headingId = dialog.getAttribute('aria-labelledby')
    expect(headingId).toBeTruthy()
    const heading = document.getElementById(headingId as string)
    expect(heading).not.toBeNull()
    expect(normalize(heading?.textContent ?? '')).toBe('Keyboard')
  })

  it('moves focus into the popover when it opens', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
  })
})

describe('PythonHelpPopover - fitting the window (PYRUN-13)', () => {
  it('holds itself to the room above the chip, so its header stays on screen', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    expect(dialog.className).toContain(
      'max-h-[var(--radix-popover-content-available-height)]',
    )
    expect(dialog.className).toMatch(/(^|\s)overflow-y-auto(\s|$)/)
  })

  it('gives the tips region a height of its own, so the tips past it scroll', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    await user.click(tipsToggle(dialog, 'Show tips'))

    const viewport = dialog.querySelector('[data-radix-scroll-area-viewport]')
    expect(viewport).not.toBeNull()
    const region = (viewport as HTMLElement).parentElement as HTMLElement
    // A cap alone leaves the h-full viewport free to grow to the tips, so the
    // region clips them instead of scrolling them.
    expect(region.className).toMatch(/(^|\s)h-64(\s|$)/)
    expect(region.className).not.toMatch(/max-h-/)
  })
})

describe('PythonHelpPopover - keyboard list (PYRUN-13)', () => {
  it('lists every shortcut in order with its keys and its label', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    expect(keyRows(dialog)).toEqual(KEYBOARD_ROWS)
  })

  it('keeps the rows in the order PYRUN-13 states', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    expectInOrder(
      dialog,
      KEYBOARD_ROWS.map((row) => row.label),
    )
  })
})

describe('PythonHelpPopover - tips (PYRUN-13)', () => {
  it('collapses the tips behind a Show tips link', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    expect(tipsToggle(dialog, 'Show tips')).toBeInTheDocument()
    for (const section of TIP_SECTIONS) {
      expect(within(dialog).queryByText(section.heading)).not.toBeInTheDocument()
    }
    for (const tip of ALL_TIPS) {
      expect(within(dialog).queryByText(tip.text)).not.toBeInTheDocument()
    }
  })

  it('reads Hide tips while the tips are open', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    await user.click(tipsToggle(dialog, 'Show tips'))

    expect(tipsToggle(dialog, 'Hide tips')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Show tips' })).not.toBeInTheDocument()
  })


  it('collapses again on the second click', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    await user.click(tipsToggle(dialog, 'Show tips'))
    await user.click(tipsToggle(dialog, 'Hide tips'))

    expect(tipsToggle(dialog, 'Show tips')).toBeInTheDocument()
    expect(within(dialog).queryByText('Inputs')).not.toBeInTheDocument()
  })

  it('shows the four subsections once the tips are open', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    await user.click(tipsToggle(dialog, 'Show tips'))

    for (const section of TIP_SECTIONS) {
      expect(within(dialog).getByText(section.heading)).toBeInTheDocument()
    }
    expectInOrder(
      dialog,
      TIP_SECTIONS.map((section) => section.heading),
    )
  })

  it('states every tip sentence exactly', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    await user.click(tipsToggle(dialog, 'Show tips'))

    for (const tip of ALL_TIPS) {
      expect(within(dialog).getByText(tip.text)).toBeInTheDocument()
    }
  })

  it('renders every mono example in a code element', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    await user.click(tipsToggle(dialog, 'Show tips'))

    for (const tip of ALL_TIPS) {
      if (tip.example === null) continue
      const example = within(dialog).getByText(tip.example)
      expect(example.tagName).toBe('CODE')
    }
  })

  it('gives the exports-on-raise tip no example', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    await user.click(tipsToggle(dialog, 'Show tips'))

    const examples = [...dialog.querySelectorAll('code')].map((code) =>
      normalize(code.textContent ?? ''),
    )
    expect(examples).toEqual(
      ALL_TIPS.filter((tip) => tip.example !== null).map((tip) => tip.example),
    )
  })

  it('keeps every sentence with its own subsection, in order', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)

    await user.click(tipsToggle(dialog, 'Show tips'))

    expectInOrder(
      dialog,
      TIP_SECTIONS.flatMap((section) => [
        section.heading,
        ...section.tips.flatMap((tip) =>
          tip.example === null ? [tip.text] : [tip.text, tip.example],
        ),
      ]),
    )
  })
})

describe('PythonHelpPopover - closing (PYRUN-13)', () => {
  it('closes from the X control and hands focus back to the editor', async () => {
    const user = userEvent.setup()
    const onClosed = vi.fn()
    const dialog = await openHelp(user, onClosed)

    await user.click(within(dialog).getByRole('button', { name: 'Close help' }))

    await waitFor(() => {
      expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
    })
    expect(onClosed).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId('script-editor')).toHaveFocus()
    })
  })

  it('closes on Escape and hands focus back to the editor', async () => {
    const user = userEvent.setup()
    const onClosed = vi.fn()
    await openHelp(user, onClosed)

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
    })
    expect(onClosed).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByTestId('script-editor')).toHaveFocus()
    })
  })

  it('reopens with the tips collapsed again', async () => {
    const user = userEvent.setup()
    const dialog = await openHelp(user)
    await user.click(tipsToggle(dialog, 'Show tips'))

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByTestId('python-help-popover')).not.toBeInTheDocument()
    })
    await user.click(screen.getByTestId('help-chip'))

    const reopened = await screen.findByRole('dialog', { name: 'Keyboard' })
    expect(tipsToggle(reopened, 'Show tips')).toBeInTheDocument()
  })
})

/** Class tokens that animate unconditionally (a `data-[state=...]:` variant is
 *  the app's reduced-motion CSS rule to neutralize, not the component's). */
function unconditionalMotionTokens(root: HTMLElement): string[] {
  const tokens: string[] = []
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const token of Array.from(element.classList)) {
      if (
        (token.startsWith('animate-') || token.startsWith('transition-')) &&
        token !== 'animate-none' &&
        token !== 'transition-none'
      ) {
        tokens.push(token)
      }
    }
  }
  return tokens
}

function withReducedMotion(run: () => Promise<void>): Promise<void> {
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
  return run().finally(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: original })
  })
}

describe('PythonHelpPopover - reduced motion', () => {
  it('animates nothing when the viewer asks for reduced motion', async () => {
    await withReducedMotion(async () => {
      const user = userEvent.setup()
      const dialog = await openHelp(user)

      expect(unconditionalMotionTokens(dialog)).toEqual([])
      expect(within(dialog).getByRole('button', { name: 'Show tips' })).toBeInTheDocument()
    })
  })
})
