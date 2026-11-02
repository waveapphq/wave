/**
 * Sheet layers: where a floating sheet mounts, and the form freeze it inherits.
 *
 * A layer keeps the sheets opened beneath it inside the surface that owns it
 * (the route content that blocks as one, a modal dialog's focus containment),
 * while each sheet stays its own window beside the others in that layer.
 */

import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { DraggableSheet } from '@/components/shared/draggable-sheet'
import { FreezableFieldset, SheetLayer } from '@/components/shared/sheet-layer'

function Sheet({
  testId,
  children,
}: Readonly<{ testId: string; children?: React.ReactNode }>) {
  return (
    <DraggableSheet
      open
      onClose={() => {}}
      ariaLabel={testId}
      header={<span>{testId}</span>}
      data-testid={testId}
    >
      <button data-testid={`${testId}-field`}>field</button>
      {children}
    </DraggableSheet>
  )
}

function OpenLater() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button data-testid="open-later" onClick={() => setOpen(true)}>
        open
      </button>
      {open && <Sheet testId="later-sheet" />}
    </>
  )
}

describe('SheetLayer', () => {
  it('mounts a sheet opened beneath it inside the layer, not inside its opener', () => {
    render(
      <div data-testid="surface">
        <SheetLayer>
          <div data-testid="opener">
            <Sheet testId="layered-sheet" />
          </div>
        </SheetLayer>
      </div>,
    )
    const sheet = screen.getByTestId('layered-sheet')
    expect(screen.getByTestId('surface')).toContainElement(sheet)
    expect(screen.getByTestId('opener')).not.toContainElement(sheet)
    expect(sheet.parentElement).toHaveAttribute('data-sheet-layer')
  })

  it('mounts a sheet opened after the layer rendered in the same layer', () => {
    render(
      <div data-testid="surface">
        <SheetLayer>
          <OpenLater />
        </SheetLayer>
      </div>,
    )
    fireEvent.click(screen.getByTestId('open-later'))
    const sheet = screen.getByTestId('later-sheet')
    expect(screen.getByTestId('surface')).toContainElement(sheet)
    expect(sheet.parentElement).toHaveAttribute('data-sheet-layer')
  })

  it('places a sheet opened from inside a layered sheet beside it in the same layer', () => {
    render(
      <SheetLayer>
        <Sheet testId="outer-sheet">
          <Sheet testId="inner-sheet" />
        </Sheet>
      </SheetLayer>,
    )
    const outer = screen.getByTestId('outer-sheet')
    const inner = screen.getByTestId('inner-sheet')
    expect(outer).not.toContainElement(inner)
    expect(inner.parentElement).toBe(outer.parentElement)
  })

  it('keeps its sheets in place across re-renders of the surface', () => {
    function Surface({ label }: Readonly<{ label: string }>) {
      return (
        <div data-testid="surface" data-label={label}>
          <SheetLayer>
            <Sheet testId="steady-sheet" />
          </SheetLayer>
        </div>
      )
    }
    const view = render(<Surface label="a" />)
    const sheet = screen.getByTestId('steady-sheet')
    const layer = sheet.parentElement
    view.rerender(<Surface label="b" />)
    expect(screen.getByTestId('steady-sheet')).toBe(sheet)
    expect(sheet.parentElement).toBe(layer)
  })

  it('takes the layer and its sheets away with the surface', () => {
    const view = render(
      <SheetLayer>
        <Sheet testId="gone-sheet" />
      </SheetLayer>,
    )
    view.unmount()
    expect(screen.queryByTestId('gone-sheet')).not.toBeInTheDocument()
    expect(document.querySelector('[data-sheet-layer]')).toBeNull()
  })
})

describe('FreezableFieldset', () => {
  function Form({ disabled }: Readonly<{ disabled: boolean }>) {
    return (
      <FreezableFieldset disabled={disabled}>
        <button data-testid="form-field">form field</button>
        <Sheet testId="frozen-sheet">
          <Sheet testId="deeper-sheet" />
        </Sheet>
      </FreezableFieldset>
    )
  }

  it('freezes its own controls', () => {
    render(<Form disabled />)
    expect(screen.getByTestId('form-field')).toBeDisabled()
  })

  it('freezes the controls of every sheet opened from inside it', () => {
    render(<Form disabled />)
    expect(screen.getByTestId('frozen-sheet-field')).toBeDisabled()
    expect(screen.getByTestId('deeper-sheet-field')).toBeDisabled()
  })

  it('thaws those sheets in place when the form is editable again', () => {
    const view = render(<Form disabled />)
    const sheet = screen.getByTestId('frozen-sheet')
    view.rerender(<Form disabled={false} />)
    expect(screen.getByTestId('frozen-sheet')).toBe(sheet)
    expect(screen.getByTestId('form-field')).toBeEnabled()
    expect(screen.getByTestId('frozen-sheet-field')).toBeEnabled()
    expect(screen.getByTestId('deeper-sheet-field')).toBeEnabled()
  })

  it('leaves a sheet opened outside any such form untouched', () => {
    render(<Sheet testId="free-sheet" />)
    expect(screen.getByTestId('free-sheet').parentElement).toBe(document.body)
    expect(screen.getByTestId('free-sheet-field')).toBeEnabled()
  })
})
