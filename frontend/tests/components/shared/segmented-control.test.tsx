/**
 * Shared aria-pressed tab strip used by the artifact drill section and the
 * file reference picker. A disabled group disables every segment; an id and
 * an aria-describedby land on the fieldset.
 *
 * Module: frontend/src/components/shared/segmented-control.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl } from '@/components/shared/segmented-control'

const VIEW_OPTIONS = [
  { value: 'tree', label: 'Tree' },
  { value: 'flat', label: 'Flat' },
]

const TAB_OPTIONS = [
  { value: 'testdata', label: 'Test Data', testId: 'picker-tab-testdata' },
  { value: 'artifacts', label: 'Artifacts', testId: 'picker-tab-artifacts' },
]

describe('SegmentedControl - structure', () => {
  it('renders one button per option', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    const group = screen.getByRole('group', { name: 'Files view' })
    expect(within(group).getAllByRole('button')).toHaveLength(2)
  })

  it('labels the group with the aria-label it is given', () => {
    render(
      <SegmentedControl
        options={TAB_OPTIONS}
        value="testdata"
        onChange={vi.fn()}
        aria-label="File source"
      />
    )

    expect(screen.getByRole('group', { name: 'File source' })).toBeInTheDocument()
  })

  it('names the group by the visible caption its aria-labelledby points at', () => {
    render(
      <>
        <span id="value-caption">Default value</span>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value="tree"
          onChange={vi.fn()}
          aria-label="Edit value"
          aria-labelledby="value-caption"
        />
      </>
    )

    expect(screen.getByRole('group', { name: 'Default value' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Edit value' })).not.toBeInTheDocument()
  })

  it('shows each option label', () => {
    render(
      <SegmentedControl
        options={TAB_OPTIONS}
        value="testdata"
        onChange={vi.fn()}
        aria-label="File source"
      />
    )

    expect(screen.getByRole('button', { name: 'Test Data' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Artifacts' })).toBeInTheDocument()
  })

  it('keeps the options in the order they are given', () => {
    render(
      <SegmentedControl
        options={TAB_OPTIONS}
        value="testdata"
        onChange={vi.fn()}
        aria-label="File source"
      />
    )

    const group = screen.getByRole('group', { name: 'File source' })
    const labels = within(group)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(labels).toEqual(['Test Data', 'Artifacts'])
  })

  it('renders every button as a plain button, never a submit', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button')
    }
  })

  it('applies the per-option testId when one is given', () => {
    render(
      <SegmentedControl
        options={TAB_OPTIONS}
        value="testdata"
        onChange={vi.fn()}
        aria-label="File source"
      />
    )

    expect(screen.getByTestId('picker-tab-testdata')).toHaveTextContent('Test Data')
    expect(screen.getByTestId('picker-tab-artifacts')).toHaveTextContent('Artifacts')
  })
})

describe('SegmentedControl - pressed state', () => {
  it('presses the active option and releases the others', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    expect(screen.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Flat' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('follows the value it is given', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="flat"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    expect(screen.getByRole('button', { name: 'Flat' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('presses nothing when the value matches no option', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="grid"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false')
    }
  })
})

describe('SegmentedControl - choosing', () => {
  it('reports the value of the option that was clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={onChange}
        aria-label="Files view"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Flat' }))

    expect(onChange).toHaveBeenCalledWith('flat')
  })

  it('reports the active option again when it is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={onChange}
        aria-label="Files view"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Tree' }))

    expect(onChange).toHaveBeenCalledWith('tree')
  })

  it('does not change the pressed state on its own', async () => {
    const user = userEvent.setup()
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    await user.click(screen.getByRole('button', { name: 'Flat' }))

    expect(screen.getByRole('button', { name: 'Tree' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('SegmentedControl - value variant', () => {
  it('gives the strip the mono value-editor look', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Edit value"
        variant="value"
      />
    )

    expect(screen.getByRole('group', { name: 'Edit value' })).toHaveClass('font-mono')
  })

  it('splits the width evenly and accents the pressed half', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Edit value"
        variant="value"
      />
    )

    const pressed = screen.getByRole('button', { name: 'Tree' })
    expect(pressed).toHaveClass('flex-1')
    expect(pressed).toHaveClass('bg-indigo-600')
    expect(screen.getByRole('button', { name: 'Flat' })).toHaveClass('text-muted-foreground')
  })

  it('draws a divider between the halves, not before the first one', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Edit value"
        variant="value"
      />
    )

    expect(screen.getByRole('button', { name: 'Tree' })).not.toHaveClass('border-l')
    expect(screen.getByRole('button', { name: 'Flat' })).toHaveClass('border-l')
  })
})

describe('SegmentedControl - keyboard focus ring', () => {
  it('draws the ring of every part inside the part, where the group cannot cut it off', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    expect(screen.getByRole('group', { name: 'Files view' })).toHaveClass('overflow-hidden')
    const parts = screen.getAllByRole('button')
    expect(parts).toHaveLength(2)
    for (const part of parts) {
      expect(part).toHaveClass('focus-visible:-outline-offset-4')
      expect(part).not.toHaveClass('focus-visible:outline-none')
    }
  })

  it('draws the ring of the pressed part in its text color, which shows on the primary fill', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    const pressed = screen.getByRole('button', { name: 'Tree' })
    expect(pressed).toHaveClass('bg-primary', 'text-white', 'focus-visible:outline-current')
  })

  it('leaves the ring of an unpressed part in the focus color', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    const unpressed = screen.getByRole('button', { name: 'Flat' })
    expect(unpressed.className).not.toMatch(/focus-visible:outline-(?!offset)/)
    expect(unpressed.className).not.toMatch(/focus-visible:ring/)
  })

  it('gives an unpressed part a hover state and the pressed part none', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    expect(screen.getByRole('button', { name: 'Flat' })).toHaveClass(
      'enabled:hover:bg-muted',
      'enabled:hover:text-foreground'
    )
    expect(screen.getByRole('button', { name: 'Tree' })).not.toHaveClass('enabled:hover:bg-muted')
  })

  it('moves the pressed ring with the value', () => {
    const control = (value: string) => (
      <SegmentedControl
        options={VIEW_OPTIONS}
        value={value}
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )
    const { rerender } = render(control('tree'))

    rerender(control('flat'))

    expect(screen.getByRole('button', { name: 'Flat' })).toHaveClass('focus-visible:outline-current')
    expect(screen.getByRole('button', { name: 'Tree' })).not.toHaveClass(
      'focus-visible:outline-current'
    )
  })

  it('reaches both parts with Tab, pressed or not', async () => {
    const user = userEvent.setup()
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
      />
    )

    await user.tab()
    expect(screen.getByRole('button', { name: 'Tree' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Flat' })).toHaveFocus()
  })

  it('draws the ring of the pressed half of the value strip in its text color', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Edit value"
        variant="value"
      />
    )

    const pressed = screen.getByRole('button', { name: 'Tree' })
    expect(pressed).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-inset')
    expect(pressed).toHaveClass('text-white', 'focus-visible:ring-current')
    expect(pressed).not.toHaveClass('focus-visible:ring-indigo-500')
  })

  it('keeps the indigo ring on the unpressed half of the value strip', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Edit value"
        variant="value"
      />
    )

    const unpressed = screen.getByRole('button', { name: 'Flat' })
    expect(unpressed).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-inset',
      'focus-visible:ring-indigo-500'
    )
    expect(unpressed).not.toHaveClass('focus-visible:ring-current')
  })
})

describe('SegmentedControl - disabled', () => {
  it('disables every segment when the group is disabled', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
        disabled
      />
    )

    const segments = within(screen.getByRole('group', { name: 'Files view' })).getAllByRole(
      'button'
    )
    expect(segments).toHaveLength(2)
    for (const segment of segments) {
      expect(segment).toBeDisabled()
    }
  })

  it('reports nothing when a segment of a disabled group is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={onChange}
        aria-label="Files view"
        disabled
      />
    )

    await user.click(screen.getByRole('button', { name: 'Flat' }))
    await user.click(screen.getByRole('button', { name: 'Tree' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('enables every segment again once the group is no longer disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const control = (disabled: boolean) => (
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={onChange}
        aria-label="Files view"
        disabled={disabled}
      />
    )
    const { rerender } = render(control(true))
    expect(screen.getByRole('button', { name: 'Flat' })).toBeDisabled()

    rerender(control(false))

    for (const segment of screen.getAllByRole('button')) {
      expect(segment).toBeEnabled()
    }
    await user.click(screen.getByRole('button', { name: 'Flat' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('flat')
  })
})

describe('SegmentedControl - id and description', () => {
  it('puts the id on the fieldset', () => {
    render(
      <SegmentedControl
        options={VIEW_OPTIONS}
        value="tree"
        onChange={vi.fn()}
        aria-label="Files view"
        id="files-view"
      />
    )

    const group = screen.getByRole('group', { name: 'Files view' })
    expect(group.tagName).toBe('FIELDSET')
    expect(group).toHaveAttribute('id', 'files-view')
  })

  it('puts aria-describedby on the fieldset', () => {
    render(
      <>
        <p id="files-view-help">How the files are listed.</p>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value="tree"
          onChange={vi.fn()}
          aria-label="Files view"
          aria-describedby="files-view-help"
        />
      </>
    )

    const group = screen.getByRole('group', { name: 'Files view' })
    expect(group.tagName).toBe('FIELDSET')
    expect(group).toHaveAttribute('aria-describedby', 'files-view-help')
    expect(group).toHaveAccessibleDescription('How the files are listed.')
  })

  it('puts the id and the description on that fieldset alone, and on no group given none', () => {
    render(
      <>
        <p id="files-view-help">How the files are listed.</p>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value="tree"
          onChange={vi.fn()}
          aria-label="Files view"
          id="files-view"
          aria-describedby="files-view-help"
        />
        <SegmentedControl
          options={TAB_OPTIONS}
          value="testdata"
          onChange={vi.fn()}
          aria-label="File source"
        />
      </>
    )

    const described = screen.getByRole('group', { name: 'Files view' })
    const withId = document.querySelectorAll('#files-view')
    const withDescription = document.querySelectorAll('[aria-describedby="files-view-help"]')
    expect(withId).toHaveLength(1)
    expect(withId[0]).toBe(described)
    expect(withDescription).toHaveLength(1)
    expect(withDescription[0]).toBe(described)
    const plain = screen.getByRole('group', { name: 'File source' })
    expect(plain).not.toHaveAttribute('id')
    expect(plain).not.toHaveAttribute('aria-describedby')
  })
})
