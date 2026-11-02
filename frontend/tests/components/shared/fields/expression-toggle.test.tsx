// FIELD-1: the one {x} toggle every field that takes an expression draws, in one size and one look.

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ExpressionToggle } from '@/components/shared/fields/expression-toggle'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { NullButton } from '@/components/shared/variable-bodies/body-parts'
import { PRESSED_LOOK_CLASS } from '@/lib/variable-format'

// The Block row's look: the small toggle at 32px square with no padding.
const LOOK_CLASSES = ['h-8', 'w-8', 'min-w-8', 'p-0', 'rounded-md', 'hover:bg-muted', 'hover:text-muted-foreground']
// Pressed reads as the pressed null button does, at rest and under the pointer: the one shared pressed look.
const PRESSED_CLASSES = PRESSED_LOOK_CLASS.split(' ')
const LOCKED_CLASSES = ['cursor-not-allowed', 'opacity-50']

function renderToggle(props: Partial<Parameters<typeof ExpressionToggle>[0]> = {}) {
  const onPressedChange = vi.fn()
  render(
    <ExpressionToggle
      pressed={false}
      onPressedChange={onPressedChange}
      label="url expression mode"
      data-testid="url-expr-toggle"
      {...props}
    />,
  )
  return { onPressedChange, toggle: screen.getByTestId('url-expr-toggle') }
}

describe('ExpressionToggle', () => {
  it('names itself by its label and marks itself as the shared toggle', () => {
    const { toggle } = renderToggle()
    expect(toggle).toHaveAccessibleName(/^url expression mode$/)
    expect(toggle).toHaveAttribute('data-slot', 'expression-toggle')
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle).toHaveAttribute('type', 'button')
  })

  it('reads unpressed while literal', () => {
    const { toggle } = renderToggle()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAttribute('data-state', 'off')
  })

  it('reads pressed and renders the pressed look while an expression', () => {
    const { toggle } = renderToggle({ pressed: true })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveAttribute('data-state', 'on')
    for (const name of PRESSED_CLASSES) expect(toggle).toHaveClass(name)
  })

  it('draws the pressed look of the null button, at rest and under the pointer, with no stronger hover tint', () => {
    const { toggle } = renderToggle({ pressed: true })
    render(<NullButton label="note" pressed onClick={vi.fn()} testId="param-null-note" />)
    const nullButton = screen.getByTestId('param-null-note')
    expect(toggle).toHaveClass(...PRESSED_CLASSES)
    expect(nullButton).toHaveClass(...PRESSED_CLASSES)
    expect(toggle.className).not.toMatch(/primary\/15/)
  })

  it('draws its pressed text in the app primary token, never the theme shorthand', () => {
    const textColors = PRESSED_CLASSES.filter((name) => /:text-/.test(name))
    expect(textColors).toEqual([
      'aria-pressed:text-[color:var(--color-primary)]',
      'aria-pressed:hover:text-[color:var(--color-primary)]',
      'data-[state=on]:text-[color:var(--color-primary)]',
      'data-[state=on]:hover:text-[color:var(--color-primary)]',
    ])
  })

  it('draws the Block row look, with no other size or color', () => {
    const { toggle } = renderToggle()
    for (const name of [...LOOK_CLASSES, ...PRESSED_CLASSES]) expect(toggle).toHaveClass(name)
    expect(toggle.className).not.toMatch(/(^|\s)(h-7|w-7|min-w-7|h-9|px-1\.5|text-muted-foreground)(\s|$)/)
    expect(toggle.className).not.toMatch(/indigo|bg-accent|text-accent-foreground/)
    expect(toggle).not.toHaveClass(...LOCKED_CLASSES)
    const icon = toggle.querySelector('svg')
    expect(icon).toHaveClass('h-4', 'w-4')
  })

  it('reports the next state on click', async () => {
    const user = userEvent.setup()
    const { onPressedChange, toggle } = renderToggle()
    await user.click(toggle)
    expect(onPressedChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('reports leaving expression mode on click while pressed', async () => {
    const user = userEvent.setup()
    const { onPressedChange, toggle } = renderToggle({ pressed: true })
    await user.click(toggle)
    expect(onPressedChange).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('is disabled with the locked look and ignores a click while disabled', async () => {
    const user = userEvent.setup()
    const { onPressedChange, toggle } = renderToggle({ disabled: true })
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveClass(...LOCKED_CLASSES)
    await user.click(toggle)
    expect(onPressedChange).not.toHaveBeenCalled()
  })

  it('keeps its pressed look when a tooltip trigger wraps it', () => {
    render(
      <ConditionalTooltip content="hint">
        <ExpressionToggle pressed onPressedChange={vi.fn()} label="key expression mode" data-testid="wrapped" />
      </ConditionalTooltip>,
    )
    expect(screen.getByTestId('wrapped')).toHaveAttribute('data-state', 'on')
  })
})
