// REQ-3.1.3.11, REQ-3.1.3.20: the inline null text, the whole-body line, the null chip (VMGR-93, VMGR-94) and the one null button (FIELD-5).

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  BodyEmptyLine,
  ENTRY_CONTROL_CLASS,
  ENTRY_SOURCE_BOX_CLASS,
  EntryBox,
  FixedTypeCell,
  NullButton,
  NullChip,
  NullText,
} from '@/components/shared/variable-bodies/body-parts'
import { NULL_LOOK_CLASS, PRESSED_LOOK_CLASS } from '@/lib/variable-format'

// Any class that makes the line take the body's full height; the real geometry is Playwright's.
const FILL_CLASSES = new Set(['h-full', 'min-h-full', 'size-full', 'flex-1', 'grow'])

function nullLookClasses(): string[] {
  expect(NULL_LOOK_CLASS).toEqual(expect.any(String))
  return NULL_LOOK_CLASS.split(/\s+/).filter(Boolean)
}

function renderChip(label = 'Item 0', testId = 'array-item-0') {
  const onEnterValue = vi.fn()
  render(<NullChip label={label} onEnterValue={onEnterValue} testId={testId} />)
  return { onEnterValue, chip: screen.getByRole('button', { name: `${label} (null)` }) }
}

describe('NullText', () => {
  it('renders the text null with the one null look', () => {
    render(<NullText />)
    const text = screen.getByText('null')
    expect(text).toHaveTextContent(/^null$/)
    expect(text).toHaveClass(...nullLookClasses())
  })

  it('is a plain span with no role', () => {
    render(<NullText />)
    const text = screen.getByText('null')
    expect(text.tagName).toBe('SPAN')
    expect(text).not.toHaveAttribute('role')
  })
})

describe('BodyEmptyLine', () => {
  it('renders the inline null text for the label null', () => {
    const { container: alone, unmount } = render(<NullText />)
    const nullTextMarkup = alone.innerHTML
    unmount()

    render(<BodyEmptyLine label="null" />)
    const line = screen.getByText('null')
    expect(line.outerHTML).toBe(nullTextMarkup)
    expect(line).toHaveClass(...nullLookClasses())
  })

  it.each(['no items', 'no entries', 'no rows'])('keeps the plain text %s', (label) => {
    render(<BodyEmptyLine label={label} />)
    const line = screen.getByText(label)
    expect(line).toHaveTextContent(new RegExp(`^${label}$`))
    expect(line).not.toHaveAttribute('role')
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })

  it.each(['null', 'no items'])('fills the body and centers %s both ways (VMGR-94)', (label) => {
    const { container } = render(<BodyEmptyLine label={label} />)
    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveClass('flex', 'items-center', 'justify-center')
    expect([...root.classList].some((name) => FILL_CLASSES.has(name))).toBe(true)
    expect(root).toContainElement(screen.getByText(label))
  })
})

describe('NullChip', () => {
  it.each([
    ['Row 0 id', 'Row 0 id (null)'],
    ['Item 2', 'Item 2 (null)'],
    ['host', 'host (null)'],
    ['retry_count', 'retry_count (null)'],
  ])('names the chip for %s as "%s"', (label, name) => {
    renderChip(label)
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  })

  it('is a real button reading null with the one null look', () => {
    const { chip } = renderChip()
    expect(chip.tagName).toBe('BUTTON')
    expect(chip).toHaveAttribute('type', 'button')
    expect(chip).toHaveTextContent(/^null$/)
    expect(chip).toHaveClass(...nullLookClasses())
  })

  it('puts the testId on data-testid', () => {
    const { chip } = renderChip('Item 0', 'map-value-host')
    expect(chip).toHaveAttribute('data-testid', 'map-value-host')
  })

  it('calls onEnterValue once on click', async () => {
    const user = userEvent.setup()
    const { chip, onEnterValue } = renderChip()
    await user.click(chip)
    expect(onEnterValue).toHaveBeenCalledTimes(1)
  })

  it('is keyboard focusable', async () => {
    const user = userEvent.setup()
    const { chip } = renderChip()
    await user.tab()
    expect(chip).toHaveFocus()
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('calls onEnterValue once on %s', async (_key, keys) => {
    const user = userEvent.setup()
    const { onEnterValue } = renderChip()
    await user.tab()
    await user.keyboard(keys)
    expect(onEnterValue).toHaveBeenCalledTimes(1)
  })

  it('shows the hint "Click to enter a value"', async () => {
    const user = userEvent.setup()
    renderChip()
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Click to enter a value$/)
  })
})

describe('NullChip - web interface guidelines', () => {
  it('gives hover feedback like the Edit button it stands in for', () => {
    const { chip } = renderChip()
    expect([...chip.classList].some((name) => name.startsWith('hover:bg-'))).toBe(true)
  })

  it.each(['', '   '])('reads its visible text null when the field has no name yet (%j)', (label) => {
    render(<NullChip label={label} onEnterValue={vi.fn()} />)
    const chip = screen.getByRole('button', { name: 'null' })
    expect(chip).not.toHaveAttribute('aria-label')
  })
})

describe('NullButton (FIELD-5)', () => {
  function renderNullButton(pressed = false, label = 'note', testId = 'param-null-note') {
    const onClick = vi.fn()
    render(<NullButton label={label} pressed={pressed} onClick={onClick} testId={testId} />)
    return { onClick, button: screen.getByRole('button', { name: `Set ${label} to null` }) }
  }

  function ToggleHost() {
    const [pressed, setPressed] = useState(false)
    return (
      <NullButton
        label="note"
        pressed={pressed}
        onClick={() => setPressed((current) => !current)}
        testId="param-null-note"
      />
    )
  }

  it.each(['note', 'Row 0 id', 'Item 2', 'headers.X-Id'])('reads "Set %s to null"', (label) => {
    renderNullButton(false, label)
    expect(screen.getByRole('button', { name: `Set ${label} to null` })).toBeInTheDocument()
  })

  it('is a real button of type button', () => {
    const { button } = renderNullButton()
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })

  it.each([
    [false, 'false'],
    [true, 'true'],
  ])('reports pressed=%s through aria-pressed', (pressed, expected) => {
    const { button } = renderNullButton(pressed)
    expect(button).toHaveAttribute('aria-pressed', expected)
  })

  it('puts the testId on data-testid', () => {
    const { button } = renderNullButton(false, 'Row 0 id', 'table-cell-0-0-null')
    expect(button).toHaveAttribute('data-testid', 'table-cell-0-0-null')
  })

  it('calls onClick once on click', async () => {
    const user = userEvent.setup()
    const { button, onClick } = renderNullButton()
    await user.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('calls onClick once on %s', async (_key, keys) => {
    const user = userEvent.setup()
    const { onClick } = renderNullButton()
    await user.tab()
    await user.keyboard(keys)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows the hint "Set to null"', async () => {
    const user = userEvent.setup()
    renderNullButton()
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Set to null$/)
  })

  it('toggles between pressed and not pressed in its host', async () => {
    const user = userEvent.setup()
    render(<ToggleHost />)
    const button = screen.getByTestId('param-null-note')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await user.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    await user.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it.each([false, true])('carries the one pressed look every {x} shares, set by aria-pressed (pressed=%s)', (pressed) => {
    const { button } = renderNullButton(pressed)
    expect(button).toHaveClass('text-muted-foreground', 'hover:text-foreground', ...PRESSED_LOOK_CLASS.split(' '))
    expect(button).toHaveAttribute('aria-pressed', String(pressed))
  })
})

describe('NullChip - in a row box', () => {
  it('takes the box control look from its host and keeps the null look and hover', () => {
    render(<NullChip label="port" onEnterValue={vi.fn()} className={ENTRY_CONTROL_CLASS} />)
    const chip = screen.getByRole('button', { name: 'port (null)' })
    expect(chip).toHaveClass('h-full', 'border-0', 'bg-transparent', ...nullLookClasses())
    expect(chip).not.toHaveClass('rounded-sm', 'bg-background')
    expect([...chip.classList].some((name) => name.startsWith('hover:bg-'))).toBe(true)
  })
})

// The one row box of the list, map and table editors: 32px, the ∅ inside at its right end (FIELD-1, FIELD-13).
describe('EntryBox', () => {
  const box = (control: HTMLElement) => control.closest('[data-slot="input-group"]') as HTMLElement

  it('draws one 32px box around its control', () => {
    render(
      <EntryBox>
        <input aria-label="Entry 0 key" className={ENTRY_CONTROL_CLASS} />
      </EntryBox>,
    )
    const control = screen.getByRole('textbox', { name: 'Entry 0 key' })
    expect(box(control)).toHaveClass('h-8', 'rounded-md', 'border')
    expect(box(control).querySelector('[data-slot="input-group-addon"]')).toBeNull()
  })

  it('puts the ∅ inside the box at its right end, after the control', () => {
    const onClick = vi.fn()
    render(
      <EntryBox nullButton={{ label: 'host', pressed: false, onClick, testId: 'host-null' }}>
        <input aria-label="host value" />
      </EntryBox>,
    )
    const control = screen.getByRole('textbox', { name: 'host value' })
    const nullButton = screen.getByTestId('host-null')
    expect(box(nullButton)).toBe(box(control))
    expect(nullButton.closest('[data-slot="input-group-addon"]')).toHaveAttribute('data-align', 'inline-end')
    expect(nullButton).toHaveAccessibleName('Set host to null')
    expect(nullButton).toHaveAttribute('aria-pressed', 'false')
  })

  it('presses the ∅ for a null entry and calls its click', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <EntryBox nullButton={{ label: 'port', pressed: true, onClick, testId: 'port-null' }}>
        <NullChip label="port" onEnterValue={vi.fn()} className={ENTRY_CONTROL_CLASS} />
      </EntryBox>,
    )
    const nullButton = screen.getByTestId('port-null')
    expect(nullButton).toHaveAttribute('aria-pressed', 'true')
    expect(box(nullButton)).toBe(box(screen.getByRole('button', { name: 'port (null)' })))
    await user.click(nullButton)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('puts an adornment before the ∅ in the same end slot', () => {
    render(
      <EntryBox
        adornment={<span aria-label="Unsecured credential" />}
        nullButton={{ label: 'Authorization', pressed: false, onClick: vi.fn(), testId: 'auth-null' }}
      >
        <input aria-label="Authorization value" />
      </EntryBox>,
    )
    const adornment = screen.getByLabelText('Unsecured credential')
    const nullButton = screen.getByTestId('auth-null')
    const slot = nullButton.closest('[data-slot="input-group-addon"]')
    expect(adornment.closest('[data-slot="input-group-addon"]')).toBe(slot)
    expect(adornment.compareDocumentPosition(nullButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws an adornment alone when the entry takes no ∅', () => {
    render(
      <EntryBox adornment={<span aria-label="Unsecured credential" />}>
        <input aria-label="Authorization value" />
      </EntryBox>,
    )
    expect(screen.getByLabelText('Unsecured credential').closest('[data-slot="input-group-addon"]')).toHaveAttribute(
      'data-align',
      'inline-end',
    )
    expect(screen.queryByRole('button', { name: /to null$/ })).not.toBeInTheDocument()
  })

  it('flags the whole box when its control is invalid, and rings it on the control focus, not the ∅', () => {
    render(
      <EntryBox nullButton={{ label: 'n', pressed: false, onClick: vi.fn() }}>
        <input aria-label="n value" aria-invalid="true" />
      </EntryBox>,
    )
    const classes = [...box(screen.getByRole('textbox', { name: 'n value' })).classList]
    expect(classes).toEqual(
      expect.arrayContaining([
        'has-[[aria-invalid=true]]:border-destructive',
        'has-[:focus-visible:not([aria-pressed])]:ring-1',
      ]),
    )
  })
})

describe('ENTRY_SOURCE_BOX_CLASS', () => {
  it('tunes the {x} box to the 32px row: 4px around a 22px line inside its border', () => {
    expect(ENTRY_SOURCE_BOX_CLASS.split(/\s+/)).toEqual(
      expect.arrayContaining(['min-w-0', '[&_.cm-content]:!py-1', '[&_.cm-scroller]:!leading-[22px]']),
    )
  })
})

describe('FixedTypeCell - the header of a fixed type', () => {
  it('centers the Type label on the unseen pill, level with the other header labels', () => {
    render(<FixedTypeCell type="string" part="header" />)
    expect(screen.getByText('Type')).toHaveClass('self-center')
  })
})
