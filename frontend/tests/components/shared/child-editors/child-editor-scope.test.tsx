/**
 * Child editor scope: the parent-scoped registry the floating editors opened
 * beneath a parent report into.
 *
 * Each open child reports its label, whether it has changes and whether it can
 * be saved; the parent reads the open children in the order they opened, and
 * writes every changed child's draft into its own draft, most recently opened
 * first, before it saves. A child outside any parent reports nowhere.
 */

import { useState, type ReactNode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import {
  ChildEditorsProvider,
  useChildEditor,
  useChildEditorScope,
  type ChildEditorScope,
} from '@/components/shared/child-editors/child-editor-scope'

interface ChildProps {
  label: string
  hasChanges?: boolean
  cannotBeSaved?: boolean
  apply?: () => void
}

function Child({ label, hasChanges = false, cannotBeSaved = false, apply = () => {} }: Readonly<ChildProps>) {
  useChildEditor({ label, hasChanges, cannotBeSaved, apply })
  return <span data-testid={`child-${label}`}>{label}</span>
}

let lastScope: ChildEditorScope | null = null

function Parent({ children }: Readonly<{ children: ReactNode }>) {
  const scope = useChildEditorScope()
  lastScope = scope
  return (
    <ChildEditorsProvider scope={scope}>
      <output data-testid="summary">
        {JSON.stringify({ children: scope.children, hasChanges: scope.hasChanges })}
      </output>
      {children}
    </ChildEditorsProvider>
  )
}

function summary() {
  return JSON.parse(screen.getByTestId('summary').textContent ?? '{}') as {
    children: { label: string; hasChanges: boolean; cannotBeSaved: boolean }[]
    hasChanges: boolean
  }
}

describe('useChildEditorScope', () => {
  it('reports no children and no changes before any child opens', () => {
    render(<Parent>{null}</Parent>)

    expect(summary()).toEqual({ children: [], hasChanges: false })
  })

  it('lists the open children in the order they opened', () => {
    function Opener() {
      const [second, setSecond] = useState(false)
      return (
        <>
          <Child label="Headers" />
          <button data-testid="open-second" onClick={() => setSecond(true)}>
            open
          </button>
          {second && <Child label="Body" hasChanges cannotBeSaved />}
        </>
      )
    }
    render(
      <Parent>
        <Opener />
      </Parent>,
    )

    fireEvent.click(screen.getByTestId('open-second'))

    expect(summary()).toEqual({
      children: [
        { label: 'Headers', hasChanges: false, cannotBeSaved: false },
        { label: 'Body', hasChanges: true, cannotBeSaved: true },
      ],
      hasChanges: true,
    })
  })

  it('follows a child as its status changes', () => {
    const { rerender } = render(
      <Parent>
        <Child label="Body" />
      </Parent>,
    )
    expect(summary().hasChanges).toBe(false)

    rerender(
      <Parent>
        <Child label="Body text" hasChanges />
      </Parent>,
    )

    expect(summary()).toEqual({
      children: [{ label: 'Body text', hasChanges: true, cannotBeSaved: false }],
      hasChanges: true,
    })
  })

  it('drops a child once it closes', () => {
    const { rerender } = render(
      <Parent>
        <Child label="Body" hasChanges />
      </Parent>,
    )

    rerender(<Parent>{null}</Parent>)

    expect(summary()).toEqual({ children: [], hasChanges: false })
  })

  it('writes every changed child into the parent, most recently opened first', () => {
    const order: string[] = []
    render(
      <Parent>
        <Child label="Parts" hasChanges apply={() => order.push('Parts')} />
        <Child label="Headers" apply={() => order.push('Headers')} />
        <Child label="Source" hasChanges apply={() => order.push('Source')} />
      </Parent>,
    )

    act(() => lastScope?.applyAll())

    expect(order).toEqual(['Source', 'Parts'])
  })

  it('lets an older child write what a newer child wrote into it', () => {
    function Nested() {
      const [source, setSource] = useState('saved.csv')
      const [pickerOpen, setPickerOpen] = useState(true)
      const [written, setWritten] = useState('')
      return (
        <>
          <Child label="Parts" hasChanges apply={() => setWritten(source)} />
          {pickerOpen && (
            <Child
              label="Part 1"
              hasChanges
              apply={() => {
                setSource('picked.csv')
                setPickerOpen(false)
              }}
            />
          )}
          <output data-testid="written">{written}</output>
        </>
      )
    }
    render(
      <Parent>
        <Nested />
      </Parent>,
    )

    act(() => lastScope?.applyAll())

    expect(screen.getByTestId('written')).toHaveTextContent('picked.csv')
  })

  it('skips a child that closed while a newer child was writing', () => {
    const olderApply = vi.fn()
    function Closing() {
      const [olderOpen, setOlderOpen] = useState(true)
      return (
        <>
          {olderOpen && <Child label="Older" hasChanges apply={olderApply} />}
          <Child label="Newer" hasChanges apply={() => setOlderOpen(false)} />
        </>
      )
    }
    render(
      <Parent>
        <Closing />
      </Parent>,
    )

    act(() => lastScope?.applyAll())

    expect(olderApply).not.toHaveBeenCalled()
    expect(screen.queryByTestId('child-Older')).not.toBeInTheDocument()
  })

  it('writes without flushing when asked to replay only', () => {
    const renders: string[] = []
    function Replayed() {
      const [value, setValue] = useState('saved')
      renders.push(value)
      return <Child label="Body" hasChanges apply={() => setValue('draft')} />
    }
    render(
      <Parent>
        <Replayed />
      </Parent>,
    )
    renders.length = 0

    act(() => {
      lastScope?.applyAll({ flush: false })
      expect(renders).toEqual([])
    })
  })
})

describe('useChildEditorScope - one row at a time', () => {
  it('lists the open editors of the named rows only', () => {
    render(
      <Parent>
        <Child label="Destination" hasChanges />
        <Child label="Source" />
      </Parent>,
    )

    expect(lastScope?.registry.rowEditors(['Destination'])).toEqual([
      expect.objectContaining({ label: 'Destination', hasChanges: true, cannotBeSaved: false }),
    ])
    expect(lastScope?.registry.unsavedRows(['Source'])).toBe(false)
  })

  it('writes the changed editors of the named rows only', () => {
    const written: string[] = []
    render(
      <Parent>
        <Child label="Destination" hasChanges apply={() => written.push('Destination changed')} />
        <Child label="Destination" apply={() => written.push('Destination unchanged')} />
        <Child label="Source" hasChanges apply={() => written.push('Source')} />
      </Parent>,
    )

    act(() => lastScope?.registry.saveRows(['Destination']))

    expect(written).toEqual(['Destination changed'])
  })
})

describe('useChildEditor', () => {
  function Closable({ open }: Readonly<{ open: boolean }>) {
    useChildEditor(open ? { label: 'Profiles', hasChanges: true, cannotBeSaved: false, apply: () => {} } : null)
    return null
  }

  it('reports nothing for an editor that is closed while mounted', () => {
    render(
      <Parent>
        <Closable open={false} />
      </Parent>,
    )
    expect(summary()).toEqual({ children: [], hasChanges: false })
  })

  it('drops an editor once it reports itself closed', () => {
    const { rerender } = render(
      <Parent>
        <Closable open />
      </Parent>,
    )
    expect(summary().hasChanges).toBe(true)

    rerender(
      <Parent>
        <Closable open={false} />
      </Parent>,
    )

    expect(summary()).toEqual({ children: [], hasChanges: false })
  })

  it('reports nowhere outside a parent', () => {
    expect(() => render(<Child label="Loose" hasChanges />)).not.toThrow()
    expect(screen.getByTestId('child-Loose')).toBeInTheDocument()
  })
})
