/**
 * Command wrapper tests
 *
 * Covers the shared cmdk wrapper's `chosen` prop: the stored-choice signal that
 * `aria-selected` cannot carry, because cmdk overwrites `aria-selected` with its
 * own roving cursor after spreading caller props.
 *
 * `chosen` always renders both `data-state` and `aria-checked`, on every item in
 * every list. Neither is gated on what the surrounding CommandList declares, so
 * a single-select picker exposes its stored choice too.
 *
 * Component: frontend/src/components/ui/command.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'

// ============================================================================
// Fixtures
// ============================================================================

const ITEMS = ['alpha', 'bravo', 'charlie'] as const

/** Attribute names cmdk and the wrapper already write on every item today. */
const BASELINE_ITEM_ATTRIBUTES = [
  'aria-disabled',
  'aria-selected',
  'class',
  'cmdk-item',
  'data-disabled',
  'data-selected',
  'data-slot',
  'data-value',
  'id',
  'role',
]

/** Attribute names cmdk and the wrapper already write on a plain list today. */
const BASELINE_LIST_ATTRIBUTES = [
  'aria-label',
  'class',
  'cmdk-list',
  'data-slot',
  'id',
  'role',
  'tabindex',
]

type ListProps = React.ComponentProps<typeof CommandList>

function renderList(listProps: ListProps, chosenValue?: string) {
  return render(
    <Command shouldFilter={false}>
      <CommandInput placeholder="Search" />
      <CommandList {...listProps}>
        <CommandGroup>
          {ITEMS.map((v) => (
            <CommandItem
              key={v}
              value={v}
              chosen={chosenValue === undefined ? undefined : v === chosenValue}
            >
              {v}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function option(name: string) {
  return screen.getByRole('option', { name })
}

function attributeNames(el: Element) {
  return el.getAttributeNames().sort()
}

// ============================================================================
// Tests
// ============================================================================

describe('CommandItem chosen', () => {
  describe('data-state', () => {
    it('renders data-state="checked" for a chosen item', () => {
      renderList({}, 'bravo')
      expect(option('bravo')).toHaveAttribute('data-state', 'checked')
    })

    it('renders data-state="unchecked" for an unchosen item', () => {
      renderList({}, 'bravo')
      expect(option('alpha')).toHaveAttribute('data-state', 'unchecked')
      expect(option('charlie')).toHaveAttribute('data-state', 'unchecked')
    })

    it('renders no data-state at all when chosen is omitted', () => {
      renderList({})
      for (const v of ITEMS) {
        expect(option(v)).not.toHaveAttribute('data-state')
      }
    })

    it('renders data-state on a multi-selectable list too', () => {
      renderList({ 'aria-multiselectable': 'true' }, 'charlie')
      expect(option('charlie')).toHaveAttribute('data-state', 'checked')
      expect(option('alpha')).toHaveAttribute('data-state', 'unchecked')
    })
  })

  describe('aria-checked', () => {
    it('marks the chosen item checked and the others unchecked', () => {
      renderList({}, 'charlie')
      expect(option('charlie')).toHaveAttribute('aria-checked', 'true')
      expect(option('alpha')).toHaveAttribute('aria-checked', 'false')
      expect(option('bravo')).toHaveAttribute('aria-checked', 'false')
    })

    it('renders no aria-checked when chosen is omitted', () => {
      renderList({})
      for (const v of ITEMS) {
        expect(option(v)).not.toHaveAttribute('aria-checked')
      }
    })

    it('is not gated on what the surrounding list declares', () => {
      for (const listProps of [
        {},
        { 'aria-multiselectable': 'true' },
        { 'aria-multiselectable': true },
        { 'aria-multiselectable': 'false' },
        { 'aria-multiselectable': false },
      ] as ListProps[]) {
        const { unmount } = renderList(listProps, 'bravo')
        expect(option('bravo')).toHaveAttribute('aria-checked', 'true')
        expect(option('alpha')).toHaveAttribute('aria-checked', 'false')
        unmount()
      }
    })

    it('still forwards a caller aria-multiselectable to the rendered list', () => {
      renderList({ 'aria-multiselectable': 'true' }, 'charlie')
      expect(screen.getByRole('listbox')).toHaveAttribute(
        'aria-multiselectable',
        'true'
      )
    })

    it('exposes the chosen state in sibling lists independently', () => {
      render(
        <>
          <Command shouldFilter={false} label="multi">
            <CommandList aria-multiselectable="true">
              <CommandGroup>
                <CommandItem value="multi-row" chosen>
                  multi-row
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
          <Command shouldFilter={false} label="single">
            <CommandList>
              <CommandGroup>
                <CommandItem value="single-row" chosen>
                  single-row
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </>
      )

      expect(option('multi-row')).toHaveAttribute('aria-checked', 'true')
      expect(option('single-row')).toHaveAttribute('aria-checked', 'true')
      expect(option('single-row')).toHaveAttribute('data-state', 'checked')
    })
  })

  describe('without a CommandList ancestor', () => {
    it('renders the item and emits data-state and aria-checked', () => {
      render(
        <Command shouldFilter={false}>
          <CommandItem value="solo" chosen>
            solo
          </CommandItem>
        </Command>
      )

      const solo = option('solo')
      expect(solo).toBeInTheDocument()
      expect(solo).toHaveAttribute('data-state', 'checked')
      expect(solo).toHaveAttribute('aria-checked', 'true')
    })

    it('renders an unchosen item with no CommandList ancestor', () => {
      render(
        <Command shouldFilter={false}>
          <CommandItem value="solo" chosen={false}>
            solo
          </CommandItem>
        </Command>
      )

      expect(option('solo')).toHaveAttribute('data-state', 'unchecked')
      expect(option('solo')).toHaveAttribute('aria-checked', 'false')
    })
  })

  describe("survives cmdk's prop spread", () => {
    it('keeps our data-state and aria-checked while cmdk keeps id, role and aria-selected', () => {
      render(
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              <CommandItem
                value="spread"
                chosen
                id="caller-supplied-id"
                role="row"
                aria-selected={false}
              >
                spread
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      )

      const item = screen.getByRole('option', { name: 'spread' })

      // Ours: written after the spread, so they land in the DOM.
      expect(item).toHaveAttribute('data-state', 'checked')
      expect(item).toHaveAttribute('aria-checked', 'true')

      // cmdk's: written after the spread too, so caller values are discarded.
      expect(item).toHaveAttribute('role', 'option')
      expect(item.getAttribute('id')).not.toBe('caller-supplied-id')
      expect(item).toHaveAttribute('cmdk-item', '')
      expect(item).toHaveAttribute('aria-disabled', 'false')
      expect(item).toHaveAttribute('data-disabled', 'false')
      expect(item).toHaveAttribute('data-selected', item.getAttribute('aria-selected') ?? '')
    })

    it('lets aria-checked and aria-selected disagree, because they mean different things', async () => {
      const user = userEvent.setup()
      renderList({}, 'charlie')

      const cursorRows = () =>
        screen
          .getAllByRole('option')
          .filter((o) => o.getAttribute('aria-selected') === 'true')

      await waitFor(() => expect(cursorRows()).toHaveLength(1))

      // cmdk parks its cursor on the first row; the chosen row is the third.
      expect(cursorRows()[0]).toHaveAccessibleName('alpha')
      expect(cursorRows()[0]).toHaveAttribute('aria-checked', 'false')
      expect(option('charlie')).toHaveAttribute('aria-checked', 'true')
      expect(option('charlie')).toHaveAttribute('aria-selected', 'false')

      await user.click(screen.getByPlaceholderText('Search'))
      await user.keyboard('{ArrowDown}')

      // The cursor moved. The chosen row did not.
      expect(cursorRows()).toHaveLength(1)
      expect(cursorRows()[0]).toHaveAccessibleName('bravo')
      expect(cursorRows()[0]).toHaveAttribute('aria-checked', 'false')
      expect(option('charlie')).toHaveAttribute('aria-checked', 'true')
      expect(option('charlie')).toHaveAttribute('aria-selected', 'false')
      expect(option('charlie')).toHaveAttribute('data-state', 'checked')
    })

    it('publishes the cursor through aria-activedescendant, not through aria-checked', async () => {
      const user = userEvent.setup()
      renderList({}, 'charlie')

      const input = screen.getByPlaceholderText('Search')
      await user.click(input)
      await user.keyboard('{ArrowDown}')

      const cursor = screen
        .getAllByRole('option')
        .find((o) => o.getAttribute('aria-selected') === 'true')
      expect(input).toHaveAttribute('aria-activedescendant', cursor?.id)
      expect(cursor).toHaveAttribute('aria-checked', 'false')
    })
  })

  describe('rendering is unchanged when chosen is omitted', () => {
    it('writes exactly the attributes it wrote before the prop existed', () => {
      renderList({})
      expect(attributeNames(option('alpha'))).toEqual(BASELINE_ITEM_ATTRIBUTES)
    })

    it('writes exactly the list attributes it wrote before the prop existed', () => {
      renderList({})
      expect(attributeNames(screen.getByRole('listbox'))).toEqual(
        BASELINE_LIST_ATTRIBUTES
      )
    })

    it('adds no wrapper element around the list', () => {
      renderList({}, 'charlie')
      const list = screen.getByRole('listbox')
      expect(list.parentElement).toHaveAttribute('cmdk-root', '')
      expect(list.parentElement).toHaveAttribute('data-slot', 'command')
    })

    it('keeps every data-slot value', () => {
      const { container } = renderList({})
      const slots = Array.from(container.querySelectorAll('[data-slot]')).map(
        (el) => el.getAttribute('data-slot')
      )
      expect(slots).toEqual([
        'command',
        'command-input-wrapper',
        'command-input',
        'command-list',
        'command-group',
        'command-item',
        'command-item',
        'command-item',
      ])
    })

    it('keeps the cursor highlight class on the item', () => {
      renderList({})
      expect(option('alpha')).toHaveClass('data-[selected=true]:bg-accent')
    })

    it('still merges a caller className with the base item classes', () => {
      render(
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              <CommandItem value="styled" className="text-primary">
                styled
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      )

      const item = option('styled')
      expect(item).toHaveClass('text-primary')
      expect(item).toHaveClass('data-[selected=true]:bg-accent')
    })

    it('still fires onSelect when the item is clicked', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              <CommandItem value="clickable" onSelect={onSelect}>
                clickable
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      )

      await user.click(option('clickable'))
      expect(onSelect).toHaveBeenCalledWith('clickable')
    })

    it('still fires onSelect when chosen is supplied', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              <CommandItem value="clickable" chosen onSelect={onSelect}>
                clickable
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      )

      await user.click(option('clickable'))
      expect(onSelect).toHaveBeenCalledWith('clickable')
    })

    it('still marks a disabled item disabled', () => {
      render(
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              <CommandItem value="off" disabled chosen={false}>
                off
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      )

      const item = option('off')
      expect(item).toHaveAttribute('aria-disabled', 'true')
      expect(item).toHaveAttribute('data-disabled', 'true')
      expect(item).toHaveAttribute('aria-checked', 'false')
    })

    it('leaves item children untouched, so a caller-rendered marker still shows', () => {
      render(
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup>
              <CommandItem value="marked" chosen>
                <span data-testid="caller-marker">x</span>
                marked
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      )

      const item = screen.getByRole('option', { name: /marked/ })
      expect(within(item).getByTestId('caller-marker')).toBeInTheDocument()
    })
  })
})
