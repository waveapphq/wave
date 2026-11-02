/**
 * ProxyAddressList Component Tests
 *
 * REQ-4.7.14 / REQ-5.2.1.42 (NET-10): the Proxy address list - rows of an Exact /
 * Regex choice, an address and a remove control, "Add" under the last row with a
 * 100-row limit, every change reported as the whole list, and a row's check
 * message under its address field.
 *
 * Component: frontend/src/features/settings/components/network/proxy-address-list.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import type { ProxyEntry } from '@/features/settings/api/proxy'
import { ProxyAddressList } from '@/features/settings/components/network/proxy-address-list'

const REGISTRY: ProxyEntry = { kind: 'exact', address: 'https://registry.corp.example' }
const SEARCH: ProxyEntry = { kind: 'exact', address: 'http://10.20.0.15:9200' }
const CLUSTER: ProxyEntry = { kind: 'regex', address: String.raw`\.cluster\.local(:\d+)?$` }
const NEW_ROW: ProxyEntry = { kind: 'exact', address: '' }

const TRAILING_SLASH = 'Remove everything after the host and port'
const SAME_ADDRESS = 'The same address as entry 1'

function threeEntries(): ProxyEntry[] {
  return [REGISTRY, SEARCH, CLUSTER]
}

function manyEntries(count: number): ProxyEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: 'exact' as const,
    address: `https://host-${index + 1}.corp.example`,
  }))
}

interface ListOptions {
  entries?: ProxyEntry[]
  disabled?: boolean
  problems?: Record<number, string>
}

function renderList({ entries = threeEntries(), disabled, problems }: ListOptions = {}) {
  const onChange = vi.fn<(entries: ProxyEntry[]) => void>()
  render(
    <ProxyAddressList
      entries={entries}
      onChange={onChange}
      disabled={disabled}
      problems={problems}
    />,
  )
  return { onChange, entries }
}

function typeGroup(row: number): HTMLElement {
  return screen.getByRole('group', { name: `Entry ${row} type` })
}

function segment(row: number, label: 'Exact' | 'Regex'): HTMLElement {
  return within(typeGroup(row)).getByRole('button', { name: label })
}

function addressInput(row: number): HTMLElement {
  return screen.getByRole('textbox', { name: `Entry ${row} address` })
}

function removeButton(row: number): HTMLElement {
  return screen.getByRole('button', { name: `Remove entry ${row}` })
}

function addButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Add entry' })
}

// A role query reads every control of a long list; the text finds the same button at once.
function addButtonOfLongList(): HTMLElement {
  const button = screen.getByText('Add').closest('button')
  if (button === null) throw new Error('"Add" is not a button')
  return button
}

// The texts of the elements a control's aria-describedby points at.
function descriptionsOf(control: HTMLElement): string[] {
  const ids = (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
  return ids.map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
}

/** The live region that holds a message; a screen reader speaks what changes inside it. */
function liveRegionOf(message: string): HTMLElement {
  const region = screen.getByText(message).closest<HTMLElement>('[aria-live]')
  if (!region) throw new Error(`"${message}" is in no live region`)
  return region
}

function expectInOrder(nodes: readonly Node[]): void {
  for (let index = 1; index < nodes.length; index++) {
    const position = nodes[index - 1].compareDocumentPosition(nodes[index])
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
}

function StatefulList({ initial }: Readonly<{ initial: ProxyEntry[] }>) {
  const [entries, setEntries] = useState(initial)
  return <ProxyAddressList entries={entries} onChange={setEntries} />
}

describe('ProxyAddressList', () => {
  describe('Rows', () => {
    it('shows one row per entry, numbered from 1', () => {
      renderList()

      for (const row of [1, 2, 3]) {
        expect(typeGroup(row)).toBeInTheDocument()
        expect(addressInput(row)).toBeInTheDocument()
        expect(removeButton(row)).toBeInTheDocument()
      }
      expect(screen.getAllByRole('textbox')).toHaveLength(3)
      expect(screen.queryByRole('group', { name: 'Entry 4 type' })).not.toBeInTheDocument()
    })

    it('shows each address in its row', () => {
      renderList()

      expect(addressInput(1)).toHaveValue(REGISTRY.address)
      expect(addressInput(2)).toHaveValue(SEARCH.address)
      expect(addressInput(3)).toHaveValue(CLUSTER.address)
    })

    it('gives each row a two-segment control, Exact then Regex', () => {
      renderList()

      for (const row of [1, 2, 3]) {
        const segments = within(typeGroup(row)).getAllByRole('button')
        expect(segments.map((button) => button.textContent)).toEqual(['Exact', 'Regex'])
      }
    })

    it('presses Exact on an Exact row', () => {
      renderList()

      expect(segment(1, 'Exact')).toHaveAttribute('aria-pressed', 'true')
      expect(segment(1, 'Regex')).toHaveAttribute('aria-pressed', 'false')
    })

    it('presses Regex on a Regex row', () => {
      renderList()

      expect(segment(3, 'Regex')).toHaveAttribute('aria-pressed', 'true')
      expect(segment(3, 'Exact')).toHaveAttribute('aria-pressed', 'false')
    })

    it('puts the type choice, the address and the remove control of a row in that order', () => {
      renderList()

      expectInOrder([
        typeGroup(1),
        addressInput(1),
        removeButton(1),
        typeGroup(2),
        addressInput(2),
        removeButton(2),
      ])
    })

    it('puts "Add" under the last row', () => {
      renderList()

      expectInOrder([removeButton(3), addButton()])
    })

    it('shows only "Add" for an empty list', () => {
      renderList({ entries: [] })

      expect(addButton()).toBeEnabled()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.queryByRole('group')).not.toBeInTheDocument()
      expect(screen.getAllByRole('button')).toHaveLength(1)
    })
  })

  describe('Add', () => {
    it('reports the whole list with an Exact row with an empty address appended', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList()

      await user.click(addButton())

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([REGISTRY, SEARCH, CLUSTER, NEW_ROW])
    })

    it('reports the first row of an empty list', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList({ entries: [] })

      await user.click(addButton())

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([NEW_ROW])
    })

    it('is enabled at 99 rows', () => {
      renderList({ entries: manyEntries(99) })

      expect(addButtonOfLongList()).toBeEnabled()
    })

    it('is disabled at 100 rows', () => {
      renderList({ entries: manyEntries(100) })

      expect(addButtonOfLongList()).toBeDisabled()
    })

    it('reports the hundredth row from 99 rows', () => {
      const entries = manyEntries(99)
      const { onChange } = renderList({ entries })

      fireEvent.click(addButtonOfLongList())

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([...entries, NEW_ROW])
    })
  })

  describe('Kind', () => {
    it('pressing Regex on an Exact row reports the list with that row as Regex', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList()

      await user.click(segment(1, 'Regex'))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([{ ...REGISTRY, kind: 'regex' }, SEARCH, CLUSTER])
    })

    it('pressing Exact on a Regex row reports the list with that row as Exact', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList()

      await user.click(segment(3, 'Exact'))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([REGISTRY, SEARCH, { ...CLUSTER, kind: 'exact' }])
    })

    it('changes the kind of the pressed row only', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList()

      await user.click(segment(2, 'Regex'))

      expect(onChange).toHaveBeenCalledWith([REGISTRY, { ...SEARCH, kind: 'regex' }, CLUSTER])
    })
  })

  describe('Address', () => {
    it('typing in a row reports the list with that address', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList()

      await user.type(addressInput(2), '0')

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([
        REGISTRY,
        { ...SEARCH, address: `${SEARCH.address}0` },
        CLUSTER,
      ])
    })

    it('emptying a row reports the list with an empty address in that row', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList()

      await user.clear(addressInput(1))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([{ ...REGISTRY, address: '' }, SEARCH, CLUSTER])
    })

    it('keeps the kind of the row whose address changes', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList()

      await user.type(addressInput(3), 'x')

      expect(onChange).toHaveBeenCalledWith([
        REGISTRY,
        SEARCH,
        { kind: 'regex', address: `${CLUSTER.address}x` },
      ])
    })

    it('reports what was typed as it is, with no trimming', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList({ entries: [NEW_ROW] })

      await user.type(addressInput(1), ' ')

      expect(onChange).toHaveBeenCalledWith([{ kind: 'exact', address: ' ' }])
    })
  })

  describe('Remove', () => {
    it.each([
      { row: 1, left: [SEARCH, CLUSTER] },
      { row: 2, left: [REGISTRY, CLUSTER] },
      { row: 3, left: [REGISTRY, SEARCH] },
    ])('removing row $row reports the list without it', async ({ row, left }) => {
      const user = userEvent.setup()
      const { onChange } = renderList()

      await user.click(removeButton(row))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith(left)
    })

    it('removing the only row reports an empty list', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList({ entries: [REGISTRY] })

      await user.click(removeButton(1))

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([])
    })
  })

  describe('The list it was given', () => {
    it('is never changed in place', async () => {
      const user = userEvent.setup()
      const { entries } = renderList()

      await user.click(addButton())
      await user.click(segment(1, 'Regex'))
      await user.type(addressInput(2), '0')
      await user.click(removeButton(3))

      expect(entries).toEqual([REGISTRY, SEARCH, CLUSTER])
      expect(REGISTRY).toEqual({ kind: 'exact', address: 'https://registry.corp.example' })
      expect(SEARCH).toEqual({ kind: 'exact', address: 'http://10.20.0.15:9200' })
    })
  })

  describe('Disabled', () => {
    it('leaves every control enabled by default', () => {
      renderList()

      for (const row of [1, 2, 3]) {
        expect(segment(row, 'Exact')).toBeEnabled()
        expect(segment(row, 'Regex')).toBeEnabled()
        expect(addressInput(row)).toBeEnabled()
        expect(removeButton(row)).toBeEnabled()
      }
      expect(addButton()).toBeEnabled()
    })

    it('disables every control of every row and "Add"', () => {
      renderList({ disabled: true })

      for (const row of [1, 2, 3]) {
        expect(segment(row, 'Exact')).toBeDisabled()
        expect(segment(row, 'Regex')).toBeDisabled()
        expect(addressInput(row)).toBeDisabled()
        expect(removeButton(row)).toBeDisabled()
      }
      expect(addButton()).toBeDisabled()
    })

    it('disables "Add" of an empty list', () => {
      renderList({ entries: [], disabled: true })

      expect(addButton()).toBeDisabled()
    })

    it('still shows each row as it is', () => {
      renderList({ disabled: true })

      expect(addressInput(1)).toHaveValue(REGISTRY.address)
      expect(segment(3, 'Regex')).toHaveAttribute('aria-pressed', 'true')
    })

    it('reports nothing when its controls are pressed', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList({ disabled: true })

      await user.click(addButton())
      await user.click(segment(1, 'Regex'))
      await user.click(removeButton(2))

      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('Problems', () => {
    it('marks the address of the row named in problems as not valid', () => {
      renderList({ problems: { 2: TRAILING_SLASH } })

      expect(addressInput(2)).toHaveAttribute('aria-invalid', 'true')
    })

    it('points the address of that row at its message', () => {
      renderList({ problems: { 2: TRAILING_SLASH } })

      expect(descriptionsOf(addressInput(2))).toContain(TRAILING_SLASH)
    })

    it('shows the message under the address field of its row', () => {
      renderList({ problems: { 2: TRAILING_SLASH } })

      expect(screen.getAllByText(TRAILING_SLASH)).toHaveLength(1)
      expectInOrder([addressInput(2), screen.getByText(TRAILING_SLASH), typeGroup(3)])
    })

    it('leaves the other rows with no message and not marked', () => {
      renderList({ problems: { 2: TRAILING_SLASH } })

      for (const row of [1, 3]) {
        expect(addressInput(row)).not.toHaveAttribute('aria-invalid', 'true')
        expect(addressInput(row)).not.toHaveAttribute('aria-describedby')
      }
    })

    it('counts entry numbers from 1', () => {
      renderList({ problems: { 1: TRAILING_SLASH } })

      expect(addressInput(1)).toHaveAttribute('aria-invalid', 'true')
      expect(descriptionsOf(addressInput(1))).toContain(TRAILING_SLASH)
      expect(addressInput(2)).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('shows each row its own message', () => {
      renderList({ problems: { 2: TRAILING_SLASH, 3: SAME_ADDRESS } })

      expect(descriptionsOf(addressInput(2))).toContain(TRAILING_SLASH)
      expect(descriptionsOf(addressInput(2))).not.toContain(SAME_ADDRESS)
      expect(descriptionsOf(addressInput(3))).toContain(SAME_ADDRESS)
      expect(descriptionsOf(addressInput(3))).not.toContain(TRAILING_SLASH)
      expect(addressInput(1)).not.toHaveAttribute('aria-describedby')
      expectInOrder([
        addressInput(2),
        screen.getByText(TRAILING_SLASH),
        addressInput(3),
        screen.getByText(SAME_ADDRESS),
        addButton(),
      ])
    })

    it('shows the message of the last row above "Add"', () => {
      renderList({ problems: { 3: SAME_ADDRESS } })

      expectInOrder([addressInput(3), screen.getByText(SAME_ADDRESS), addButton()])
    })

    it('does not announce a message as an alert', () => {
      renderList({ problems: { 2: TRAILING_SLASH } })

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('announces a row message when it appears: it lands in a polite region the row already had', () => {
      const list = (problems: Record<number, string>) => (
        <ProxyAddressList entries={threeEntries()} onChange={vi.fn()} problems={problems} />
      )
      const { container, rerender } = render(list({}))
      const regionsBefore = Array.from(container.querySelectorAll('[aria-live]'))
      expect(regionsBefore).toHaveLength(3)
      expect(regionsBefore.map((region) => region.textContent)).toEqual(['', '', ''])

      rerender(list({ 2: TRAILING_SLASH }))

      const region = liveRegionOf(TRAILING_SLASH)
      expect(region).toHaveAttribute('aria-live', 'polite')
      expect(region).toBe(regionsBefore[1])
      expect(descriptionsOf(addressInput(2))).toEqual([TRAILING_SLASH])
    })

    it('announces nothing again while the address is typed and its message stays the same', () => {
      const list = (address: string) => (
        <ProxyAddressList
          entries={[REGISTRY, { ...SEARCH, address }, CLUSTER]}
          onChange={vi.fn()}
          problems={{ 2: TRAILING_SLASH }}
        />
      )
      const { rerender } = render(list('http://10.20.0.15:9200/'))
      const observer = new MutationObserver(() => {})
      observer.observe(liveRegionOf(TRAILING_SLASH), {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      })

      rerender(list('http://10.20.0.15:9200/a'))
      rerender(list('http://10.20.0.15:9200/ab'))

      expect(addressInput(2)).toHaveValue('http://10.20.0.15:9200/ab')
      expect(observer.takeRecords()).toEqual([])
      observer.disconnect()
    })

    it('keeps an empty region out of the grid and puts a message under the address column', () => {
      renderList({ problems: { 2: TRAILING_SLASH } })

      expect(liveRegionOf(TRAILING_SLASH)).toHaveClass('col-start-2')
      const empty = Array.from(document.querySelectorAll('[aria-live]')).filter(
        (region) => region.textContent === '',
      )
      expect(empty).toHaveLength(2)
      for (const region of empty) {
        expect(region).toHaveClass('sr-only')
        expect(region).not.toHaveClass('col-start-2')
      }
    })

    it.each([
      { name: 'no problems prop', problems: undefined },
      { name: 'an empty problems map', problems: {} },
    ])('marks no row with $name', ({ problems }) => {
      renderList({ problems })

      for (const row of [1, 2, 3]) {
        expect(addressInput(row)).not.toHaveAttribute('aria-invalid', 'true')
        expect(addressInput(row)).not.toHaveAttribute('aria-describedby')
      }
    })

    it('keeps the row controls usable while a message shows', async () => {
      const user = userEvent.setup()
      const { onChange } = renderList({ problems: { 2: TRAILING_SLASH } })

      await user.type(addressInput(2), '0')

      expect(onChange).toHaveBeenCalledWith([
        REGISTRY,
        { ...SEARCH, address: `${SEARCH.address}0` },
        CLUSTER,
      ])
    })
  })

  describe('Focus', () => {
    it('keeps focus in a row address while another row is removed', () => {
      render(<StatefulList initial={threeEntries()} />)
      const first = addressInput(1)
      act(() => first.focus())

      // fireEvent leaves focus where it is, unlike a pointer click.
      fireEvent.click(removeButton(2))

      expect(screen.getAllByRole('textbox')).toHaveLength(2)
      expect(addressInput(1)).toBe(first)
      expect(first).toHaveFocus()
      expect(first).toHaveValue(REGISTRY.address)
      expect(addressInput(2)).toHaveValue(CLUSTER.address)
    })

    it('keeps focus in a row address while it is typed in', async () => {
      const user = userEvent.setup()
      render(<StatefulList initial={[NEW_ROW, SEARCH]} />)

      await user.type(addressInput(1), 'https://a.example')

      expect(addressInput(1)).toHaveValue('https://a.example')
      expect(addressInput(1)).toHaveFocus()
      expect(addressInput(2)).toHaveValue(SEARCH.address)
    })

    it('shows the row "Add" appends, ready to be typed in', async () => {
      const user = userEvent.setup()
      render(<StatefulList initial={[REGISTRY]} />)

      await user.click(addButton())
      await user.type(addressInput(2), 'http://b.example:8080')

      expect(segment(2, 'Exact')).toHaveAttribute('aria-pressed', 'true')
      expect(addressInput(2)).toHaveValue('http://b.example:8080')
      expect(addressInput(1)).toHaveValue(REGISTRY.address)
    })
  })
})
