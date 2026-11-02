/**
 * Tests for EnumPickerInput - the searchable (and optionally grouped) enum
 * control, the second rendering path of the shared enum parameter.
 *
 * The control is a trigger button that looks like the plain select trigger and
 * opens a popover holding cmdk with `shouldFilter={false}`, so filtering is a
 * plain case-insensitive substring test and the declared `enumValues` order is
 * never re-ranked. Sublabels ride on the same row as the label (K8SREAD-4); group headings partition the list (K8SREAD-5).
 *
 * The chosen option is marked with the same check icon the plain select path
 * paints, so the two paths read as one control. The marker rides the
 * item's children and a data-state of our own: cmdk writes its own
 * aria-selected and data-selected AFTER spreading our props, so neither can
 * carry the stored value.
 *
 * Prop surface is EnumInput's four props exactly. There is no `locked` prop:
 * the plain path does not thread `locked` into the enum control either.
 *
 * REQ-3.1.3.14: element configuration parameter table
 */

import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { EnumPickerInput } from '@/features/workbench/common/element-config/parameters/enum-picker-input'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'
import { inputs as k8sDeleteInputs } from '@/features/workbench/lib/node-parameters/plugins/k8s-delete'
import { inputs as k8sEventsInputs } from '@/features/workbench/lib/node-parameters/plugins/k8s-events'
import { inputs as k8sGetInputs } from '@/features/workbench/lib/node-parameters/plugins/k8s-get'

type EnumGroup = { heading: string; values: string[] }
type PickerParameter = Parameter & { enumGroups?: EnumGroup[]; enumSearchable?: boolean }
type User = ReturnType<typeof userEvent.setup>

const NAME = 'kind'

const KIND_VALUES = [
  'cronjob',
  'deployment',
  'job',
  'pod',
  'statefulset',
  'endpoints',
  'ingress',
  'service',
  'configmap',
  'secret',
  'serviceaccount',
]

const KIND_LABELS: Record<string, string> = {
  cronjob: 'CronJob',
  deployment: 'Deployment',
  job: 'Job',
  pod: 'Pod',
  statefulset: 'StatefulSet',
  endpoints: 'Endpoints',
  ingress: 'Ingress',
  service: 'Service',
  configmap: 'ConfigMap',
  secret: 'Secret',
  serviceaccount: 'ServiceAccount',
}

// 'job' and 'secret' carry no kubectl short name and must render plain.
const KIND_SUBLABELS: Record<string, string> = {
  cronjob: 'cj',
  deployment: 'deploy',
  pod: 'po',
  statefulset: 'sts',
  endpoints: 'ep',
  ingress: 'ing',
  service: 'svc',
  configmap: 'cm',
  serviceaccount: 'sa',
}

const KIND_GROUPS: EnumGroup[] = [
  { heading: 'Workloads', values: ['cronjob', 'deployment', 'job', 'pod', 'statefulset'] },
  { heading: 'Networking', values: ['endpoints', 'ingress', 'service'] },
  { heading: 'Config', values: ['configmap', 'secret', 'serviceaccount'] },
]

const ITEM_TESTID = /^enum-picker-item-kind-/
const GROUP_TESTID = /^enum-picker-group-kind-/
const CHECK_TESTID = `enum-picker-check-${NAME}`

function makeParameter(overrides: Partial<PickerParameter> = {}): PickerParameter {
  return {
    name: NAME,
    label: 'Kind',
    type: 'string',
    required: false,
    enumValues: KIND_VALUES,
    enumLabels: KIND_LABELS,
    enumSublabels: KIND_SUBLABELS,
    enumGroups: KIND_GROUPS,
    enumSearchable: true,
    ...overrides,
  }
}

function renderPicker(
  overrides: Partial<PickerParameter> = {},
  props: { effectiveValue?: unknown; showRequiredError?: boolean } = {},
) {
  const onChange = vi.fn()
  render(
    <EnumPickerInput
      parameter={makeParameter(overrides)}
      effectiveValue={props.effectiveValue}
      onChange={onChange}
      showRequiredError={props.showRequiredError ?? false}
    />,
  )
  return { onChange }
}

function ControlledPicker({ parameter }: Readonly<{ parameter: PickerParameter }>) {
  const [value, setValue] = useState<unknown>(undefined)
  return (
    <EnumPickerInput
      parameter={parameter}
      effectiveValue={value}
      onChange={setValue}
      showRequiredError={false}
    />
  )
}

// Two role="combobox" elements exist while the popover is open (the trigger and
// cmdk's own input), so every query here goes through a testid or a name.
const trigger = () => screen.getByTestId(`enum-picker-trigger-${NAME}`)
const searchBox = () => screen.getByTestId(`enum-picker-search-${NAME}`)
const list = () => screen.getByTestId(`enum-picker-list-${NAME}`)
const popover = () => screen.queryByTestId(`enum-picker-content-${NAME}`)

function suffix(el: Element, prefix: string): string {
  return (el.getAttribute('data-testid') ?? '').replace(prefix, '')
}

function visibleValues(): string[] {
  return within(list())
    .queryAllByTestId(ITEM_TESTID)
    .map((el) => suffix(el, `enum-picker-item-${NAME}-`))
}

// cmdk mirrors each item's `value` prop onto data-value; with no explicit value
// it derives one from the row's rendered text instead.
function itemDataValues(): (string | null)[] {
  return within(list())
    .queryAllByTestId(ITEM_TESTID)
    .map((el) => el.getAttribute('data-value'))
}

function visibleHeadings(): string[] {
  return screen.queryAllByTestId(GROUP_TESTID).map((el) => suffix(el, `enum-picker-group-${NAME}-`))
}

function groupValues(heading: string): string[] {
  return within(screen.getByTestId(`enum-picker-group-${NAME}-${heading}`))
    .queryAllByTestId(ITEM_TESTID)
    .map((el) => suffix(el, `enum-picker-item-${NAME}-`))
}

// aria-selected on a cmdk item is the roving highlight, not the stored value:
// cmdk writes it after spreading our props, so it cannot be overridden.
function highlightedValue(): string | null {
  const el = list().querySelector(`[data-testid^="enum-picker-item-${NAME}-"][aria-selected="true"]`)
  return el ? suffix(el, `enum-picker-item-${NAME}-`) : null
}

// The chosen option is marked on the item's children and on a data-state we
// set ourselves, both of which survive cmdk's prop spread.
function markedValues(): string[] {
  return screen.queryAllByTestId(CHECK_TESTID).map((marker) => {
    const item = marker.closest(`[data-testid^="enum-picker-item-${NAME}-"]`)
    return item ? suffix(item, `enum-picker-item-${NAME}-`) : 'marker outside any option'
  })
}

function itemsInState(state: string): string[] {
  return within(list())
    .queryAllByTestId(ITEM_TESTID)
    .filter((el) => el.getAttribute('data-state') === state)
    .map((el) => suffix(el, `enum-picker-item-${NAME}-`))
}

async function openPicker(user: User) {
  await user.click(trigger())
}

// ============================================================================
// Closed state
// ============================================================================

describe('EnumPickerInput - closed state', () => {
  it('shows the selected option label, never its wire value and never a text box', () => {
    renderPicker({}, { effectiveValue: 'statefulset' })

    expect(trigger()).toHaveTextContent('StatefulSet')
    expect(trigger().textContent).not.toContain('statefulset')
    expect(trigger().textContent).not.toContain('sts')
    expect(trigger().tagName).toBe('BUTTON')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(popover()).not.toBeInTheDocument()
  })

  it('falls back to the wire value when the schema declares no enumLabels', () => {
    renderPicker({ enumLabels: undefined }, { effectiveValue: 'statefulset' })

    expect(trigger()).toHaveTextContent('statefulset')
  })

  it('shows the Select… placeholder when no value is set', () => {
    renderPicker()

    expect(trigger()).toHaveTextContent('Select…')
  })

  it('outlines the trigger when the required error is showing', () => {
    renderPicker({}, { showRequiredError: true })

    expect(trigger()).toHaveClass('border-destructive')
  })

  it('leaves the trigger un-outlined when there is no required error', () => {
    renderPicker()

    expect(trigger()).not.toHaveClass('border-destructive')
  })
})

// ============================================================================
// Opening
// ============================================================================

describe('EnumPickerInput - opening', () => {
  it('opens the popover and reveals the search box on click', async () => {
    const user = userEvent.setup()
    renderPicker()

    await openPicker(user)

    expect(popover()).toBeInTheDocument()
    expect(searchBox()).toBeInTheDocument()
    expect(searchBox()).toHaveAttribute('placeholder', 'Search…')
    expect(searchBox()).toHaveAttribute('aria-label', 'Search Kind')
  })

  it('lists every option in the declared enumValues order on open', async () => {
    const user = userEvent.setup()
    renderPicker()

    await openPicker(user)

    expect(visibleValues()).toEqual(KIND_VALUES)
    expect(screen.queryByTestId(`enum-picker-empty-${NAME}`)).not.toBeInTheDocument()
  })

  it('carries the wire value on every item, so a label can never become the stored value', async () => {
    const user = userEvent.setup()
    renderPicker()

    await openPicker(user)

    expect(itemDataValues()).toEqual(KIND_VALUES)
  })

  it('carries the wire value on an item whose label and sublabel differ from it', async () => {
    const user = userEvent.setup()
    renderPicker({
      enumValues: ['StatefulSet'],
      enumLabels: { StatefulSet: 'Stateful Set' },
      enumSublabels: { StatefulSet: 'sts' },
      enumGroups: undefined,
    })

    await openPicker(user)

    expect(itemDataValues()).toEqual(['StatefulSet'])
  })
})

// ============================================================================
// Filtering
// ============================================================================

describe('EnumPickerInput - filtering', () => {
  it('filters on a plain substring and keeps the declared order (shouldFilter is false)', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.type(searchBox(), 'se')

    // Fuzzy ranking would float the prefix matches 'secret' and 'service' to
    // the top; the declared order must survive instead.
    expect(visibleValues()).toEqual(['statefulset', 'service', 'secret', 'serviceaccount'])
  })

  it('matches case-insensitively', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.type(searchBox(), 'POD')

    expect(visibleValues()).toEqual(['pod'])
  })

  it('matches the sublabel as well as the label', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.type(searchBox(), 'cj')

    expect(visibleValues()).toEqual(['cronjob'])
  })

  it('shows everything again when the query is cleared', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.type(searchBox(), 'pod')
    expect(visibleValues()).toEqual(['pod'])

    await user.clear(searchBox())

    expect(visibleValues()).toEqual(KIND_VALUES)
  })

  it('filters on the label alone when the schema declares no enumSublabels', async () => {
    const user = userEvent.setup()
    renderPicker({ enumSublabels: undefined })
    await openPicker(user)

    await user.type(searchBox(), 'se')

    expect(visibleValues()).toEqual(['statefulset', 'service', 'secret', 'serviceaccount'])
  })

  it('renders the empty state and nothing else when nothing matches', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.type(searchBox(), 'zzzznothing')

    expect(screen.getByTestId(`enum-picker-empty-${NAME}`)).toHaveTextContent('No matching options')
    expect(visibleValues()).toEqual([])
    expect(visibleHeadings()).toEqual([])
  })
})

// ============================================================================
// Grouping (K8SREAD-5)
// ============================================================================

describe('EnumPickerInput - grouping', () => {
  it('renders the headings in declared order, each above its own items', async () => {
    const user = userEvent.setup()
    renderPicker()

    await openPicker(user)

    expect(visibleHeadings()).toEqual(['Workloads', 'Networking', 'Config'])
    for (const group of KIND_GROUPS) {
      const groupEl = screen.getByTestId(`enum-picker-group-${NAME}-${group.heading}`)
      const heading = within(groupEl).getByText(group.heading)
      const firstItem = within(groupEl).getAllByTestId(ITEM_TESTID)[0]
      expect(heading.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(0)
    }
  })

  it('puts every option under its own heading and no other', async () => {
    const user = userEvent.setup()
    renderPicker()

    await openPicker(user)

    expect(groupValues('Workloads')).toEqual(['cronjob', 'deployment', 'job', 'pod', 'statefulset'])
    expect(groupValues('Networking')).toEqual(['endpoints', 'ingress', 'service'])
    expect(groupValues('Config')).toEqual(['configmap', 'secret', 'serviceaccount'])
  })

  it('drops a group with no match and keeps the one that still has a match', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.type(searchBox(), 'sts')

    expect(visibleHeadings()).toEqual(['Workloads'])
    expect(groupValues('Workloads')).toEqual(['statefulset'])
    expect(screen.queryByTestId(`enum-picker-group-${NAME}-Networking`)).not.toBeInTheDocument()
    expect(screen.queryByTestId(`enum-picker-group-${NAME}-Config`)).not.toBeInTheDocument()
  })

  it('keeps every heading whose group still has a match, in declared order', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    await user.type(searchBox(), 'se')

    expect(visibleHeadings()).toEqual(['Workloads', 'Networking', 'Config'])
    expect(groupValues('Workloads')).toEqual(['statefulset'])
    expect(groupValues('Networking')).toEqual(['service'])
    expect(groupValues('Config')).toEqual(['secret', 'serviceaccount'])
  })
})

// ============================================================================
// Ungrouped usage
// ============================================================================

describe('EnumPickerInput - ungrouped usage', () => {
  it('renders a flat list with no heading element at all', async () => {
    const user = userEvent.setup()
    renderPicker({ enumGroups: undefined })

    await openPicker(user)

    expect(visibleValues()).toEqual(KIND_VALUES)
    expect(visibleHeadings()).toEqual([])
    expect(document.body.querySelectorAll('[cmdk-group-heading]')).toHaveLength(0)
  })

  it('filters a flat list in the declared order', async () => {
    const user = userEvent.setup()
    renderPicker({ enumGroups: undefined })
    await openPicker(user)

    await user.type(searchBox(), 'se')

    expect(visibleValues()).toEqual(['statefulset', 'service', 'secret', 'serviceaccount'])
    expect(document.body.querySelectorAll('[cmdk-group-heading]')).toHaveLength(0)
  })

  it('renders the same empty state as the grouped list when nothing matches', async () => {
    const user = userEvent.setup()
    renderPicker({ enumGroups: undefined })
    await openPicker(user)

    await user.type(searchBox(), 'zzzznothing')

    expect(screen.getByTestId(`enum-picker-empty-${NAME}`)).toHaveTextContent('No matching options')
    expect(visibleValues()).toEqual([])
    expect(visibleHeadings()).toEqual([])
  })
})

// ============================================================================
// Sublabels (K8SREAD-4)
// ============================================================================

describe('EnumPickerInput - sublabels', () => {
  it('renders the sublabel as muted secondary text on the same row as the label', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    const item = screen.getByTestId(`enum-picker-item-${NAME}-statefulset`)
    const label = within(item).getByText('StatefulSet')
    const sublabel = within(item).getByText('sts')

    expect(sublabel).toHaveClass('text-[10px]')
    expect(sublabel).toHaveClass('text-muted-foreground')
    expect(label.parentElement).toBe(sublabel.parentElement)
    expect(label.parentElement).toHaveClass('flex')
    expect(label.parentElement).toHaveClass('items-baseline')
    expect(label.parentElement).toHaveClass('gap-2')
  })

  it('renders an option with no sublabel plain, with no empty element', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    const item = screen.getByTestId(`enum-picker-item-${NAME}-job`)

    expect(item.textContent).toBe('Job')
    expect(item.querySelectorAll('span')).toHaveLength(1)
    expect(item.querySelector('span')).toHaveAttribute('translate', 'no')
    expect(item.querySelector('.text-muted-foreground')).toBeNull()
  })

  it('renders every option plain when the schema declares no enumSublabels', async () => {
    const user = userEvent.setup()
    renderPicker({ enumSublabels: undefined })
    await openPicker(user)

    const item = screen.getByTestId(`enum-picker-item-${NAME}-statefulset`)

    expect(item.textContent).toBe('StatefulSet')
    expect(item.querySelectorAll('span')).toHaveLength(1)
    expect(item.querySelector('span')).toHaveAttribute('translate', 'no')
  })
})

// ============================================================================
// Selected marker
// ============================================================================

describe('EnumPickerInput - selected marker', () => {
  it('marks the chosen option with the check icon the plain select path paints', async () => {
    const user = userEvent.setup()
    renderPicker({}, { effectiveValue: 'statefulset' })
    await openPicker(user)

    const item = screen.getByTestId(`enum-picker-item-${NAME}-statefulset`)
    const marker = within(item).getByTestId(CHECK_TESTID)

    expect(marker).toHaveClass('lucide-check')
    expect(marker).toHaveClass('h-4', 'w-4')
    // Without a text- class of its own the row rule paints every child svg
    // muted, and the plain select's check never is.
    expect(marker).toHaveClass('text-current')
  })

  it('marks exactly one option and flags that row checked', async () => {
    const user = userEvent.setup()
    renderPicker({}, { effectiveValue: 'statefulset' })
    await openPicker(user)

    expect(markedValues()).toEqual(['statefulset'])
    expect(itemsInState('checked')).toEqual(['statefulset'])
    expect(itemsInState('unchecked')).toEqual(KIND_VALUES.filter((v) => v !== 'statefulset'))
  })

  it('marks nothing when no value is set', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    expect(markedValues()).toEqual([])
    expect(itemsInState('checked')).toEqual([])
    expect(itemsInState('unchecked')).toEqual(KIND_VALUES)
  })

  it('marks nothing when the stored value is not one of the options', async () => {
    const user = userEvent.setup()
    renderPicker({}, { effectiveValue: 'daemonset' })
    await openPicker(user)

    expect(markedValues()).toEqual([])
    expect(itemsInState('checked')).toEqual([])
  })

  it('marks the chosen option in an ungrouped list too', async () => {
    const user = userEvent.setup()
    renderPicker({ enumGroups: undefined }, { effectiveValue: 'pod' })
    await openPicker(user)

    expect(markedValues()).toEqual(['pod'])
    expect(itemsInState('checked')).toEqual(['pod'])
  })

  it('marks nothing in an ungrouped list when no value is set', async () => {
    const user = userEvent.setup()
    renderPicker({ enumGroups: undefined })
    await openPicker(user)

    expect(markedValues()).toEqual([])
    expect(itemsInState('checked')).toEqual([])
    expect(itemsInState('unchecked')).toEqual(KIND_VALUES)
  })

  it('keeps the marker on the stored value while the keyboard highlight moves', async () => {
    const user = userEvent.setup()
    renderPicker({}, { effectiveValue: 'pod' })
    await openPicker(user)

    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' })
    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' })

    const highlighted = highlightedValue()
    expect(highlighted).not.toBeNull()
    expect(highlighted).not.toBe('pod')
    expect(markedValues()).toEqual(['pod'])
    expect(itemsInState('checked')).toEqual(['pod'])

    const highlightedItem = screen.getByTestId(`enum-picker-item-${NAME}-${highlighted}`)
    expect(within(highlightedItem).queryByTestId(CHECK_TESTID)).not.toBeInTheDocument()
    expect(screen.getByTestId(`enum-picker-item-${NAME}-pod`)).toHaveAttribute(
      'aria-selected',
      'false',
    )
  })

  it('keeps the marker on the chosen option while the list is filtered', async () => {
    const user = userEvent.setup()
    renderPicker({}, { effectiveValue: 'statefulset' })
    await openPicker(user)

    await user.type(searchBox(), 'se')

    expect(visibleValues()).toEqual(['statefulset', 'service', 'secret', 'serviceaccount'])
    expect(markedValues()).toEqual(['statefulset'])
    expect(itemsInState('checked')).toEqual(['statefulset'])
  })

  it('moves the marker onto the option just chosen', async () => {
    const user = userEvent.setup()
    render(<ControlledPicker parameter={makeParameter()} />)
    await openPicker(user)
    expect(markedValues()).toEqual([])

    await user.click(screen.getByTestId(`enum-picker-item-${NAME}-pod`))
    await openPicker(user)

    expect(markedValues()).toEqual(['pod'])
    expect(itemsInState('checked')).toEqual(['pod'])
  })
})

// ============================================================================
// Selection
// ============================================================================

describe('EnumPickerInput - selection', () => {
  it('fires the change handler with the wire value, never the label', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()
    await openPicker(user)

    await user.click(screen.getByTestId(`enum-picker-item-${NAME}-statefulset`))

    expect(onChange.mock.calls).toEqual([['statefulset']])
  })

  it('passes a mixed-case wire value through verbatim', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({
      enumValues: ['StatefulSet'],
      enumLabels: { StatefulSet: 'Stateful Set' },
      enumSublabels: undefined,
      enumGroups: undefined,
    })
    await openPicker(user)

    expect(itemDataValues()).toEqual(['StatefulSet'])
    await user.click(screen.getByTestId(`enum-picker-item-${NAME}-StatefulSet`))

    expect(onChange.mock.calls).toEqual([['StatefulSet']])
  })

  it('closes the popover and shows the new label on the trigger', async () => {
    const user = userEvent.setup()
    render(<ControlledPicker parameter={makeParameter()} />)
    await openPicker(user)

    await user.click(screen.getByTestId(`enum-picker-item-${NAME}-pod`))

    expect(popover()).not.toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveTextContent('Pod')
  })

  it('selects a filtered option by the wire value behind its label', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()
    await openPicker(user)

    await user.type(searchBox(), 'sts')
    await user.click(screen.getByTestId(`enum-picker-item-${NAME}-statefulset`))

    expect(onChange.mock.calls).toEqual([['statefulset']])
  })
})

// ============================================================================
// Keyboard
// ============================================================================

describe('EnumPickerInput - keyboard', () => {
  it('puts focus in the search box on open', async () => {
    const user = userEvent.setup()
    renderPicker()

    await openPicker(user)

    expect(searchBox()).toHaveFocus()
  })

  it('moves the highlight with ArrowDown and ArrowUp', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)

    expect(highlightedValue()).toBe('cronjob')

    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' })
    expect(highlightedValue()).toBe('deployment')

    fireEvent.keyDown(searchBox(), { key: 'ArrowUp' })
    expect(highlightedValue()).toBe('cronjob')
  })

  it('selects the highlighted option with Enter and closes', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker()
    await openPicker(user)

    fireEvent.keyDown(searchBox(), { key: 'ArrowDown' })
    fireEvent.keyDown(searchBox(), { key: 'Enter' })

    expect(onChange.mock.calls).toEqual([['deployment']])
    expect(popover()).not.toBeInTheDocument()
  })
})

// ============================================================================
// Escape
// ============================================================================

describe('EnumPickerInput - Escape', () => {
  it('closes the popover only, changing nothing', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({}, { effectiveValue: 'pod' })
    await openPicker(user)

    await user.keyboard('{Escape}')

    expect(popover()).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger()).toBeInTheDocument()
    expect(trigger()).toHaveTextContent('Pod')
  })

  it('drops the typed query so reopening starts from the full list', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)
    await user.type(searchBox(), 'sts')
    expect(visibleValues()).toEqual(['statefulset'])

    await user.keyboard('{Escape}')
    await openPicker(user)

    expect(searchBox()).toHaveValue('')
    expect(visibleValues()).toEqual(KIND_VALUES)
  })
})

// ============================================================================
// ARIA
// ============================================================================

describe('EnumPickerInput - ARIA', () => {
  it('hand-rolls the trigger role, popup type and expanded state', async () => {
    const user = userEvent.setup()
    renderPicker()

    expect(trigger()).toHaveAttribute('type', 'button')
    expect(trigger()).toHaveAttribute('role', 'combobox')
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')

    await openPicker(user)

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox', { name: 'Kind' })).toBe(trigger())
  })

  it('names the trigger with the parameter label', () => {
    renderPicker()

    expect(screen.getByRole('combobox', { name: 'Kind' })).toBeInTheDocument()
  })

  it('falls back to the parameter name when the schema gives no label', () => {
    renderPicker({ label: undefined })

    expect(screen.getByRole('combobox', { name: NAME })).toBeInTheDocument()
    expect(screen.getByTestId(`enum-picker-trigger-${NAME}`)).toBeInTheDocument()
  })

  it('returns focus to the trigger when the popover closes', async () => {
    const user = userEvent.setup()
    renderPicker()
    await openPicker(user)
    expect(searchBox()).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(trigger()).toHaveFocus()
  })
})

// ============================================================================
// Typed values (REQ-3.1.2.11)
// ============================================================================

describe('EnumPickerInput - typed values', () => {
  const INTEGER_CHOICES: Partial<PickerParameter> = {
    type: 'integer',
    enumValues: [10, 20, 30],
    enumLabels: undefined,
    enumSublabels: undefined,
    enumGroups: undefined,
  }
  const FLOAT_CHOICES: Partial<PickerParameter> = { ...INTEGER_CHOICES, type: 'float', enumValues: [0.5, 1.5] }

  it('shows the stored number on the trigger', () => {
    renderPicker(INTEGER_CHOICES, { effectiveValue: 20 })
    expect(trigger()).toHaveTextContent(/^20$/)
  })

  it('marks the stored number as chosen', async () => {
    const user = userEvent.setup()
    renderPicker(INTEGER_CHOICES, { effectiveValue: 20 })
    await openPicker(user)
    expect(markedValues()).toEqual(['20'])
    expect(itemsInState('checked')).toEqual(['20'])
  })

  it('filters numbers by their text', async () => {
    const user = userEvent.setup()
    renderPicker(INTEGER_CHOICES)
    await openPicker(user)
    await user.type(searchBox(), '3')
    expect(visibleValues()).toEqual(['30'])
  })

  it('fires the picked integer as a number, never as its text', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker(INTEGER_CHOICES, { effectiveValue: 10 })
    await openPicker(user)
    await user.click(screen.getByTestId(`enum-picker-item-${NAME}-30`))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(30)
  })

  it('fires the picked float as a number', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker(FLOAT_CHOICES, { effectiveValue: 0.5 })
    await openPicker(user)
    await user.click(screen.getByTestId(`enum-picker-item-${NAME}-1.5`))
    expect(onChange).toHaveBeenCalledWith(1.5)
  })

  it('keeps a text choice as text', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({}, { effectiveValue: 'pod' })
    await openPicker(user)
    await user.click(screen.getByTestId(`enum-picker-item-${NAME}-job`))
    expect(onChange).toHaveBeenCalledWith('job')
  })
})

// ============================================================================
// K8s kind pickers start on the written default (FIELD-8)
// ============================================================================

describe('EnumPickerInput - the K8s kind pickers start on Pod', () => {
  const KIND_PICKERS: Array<[string, Parameter[], string]> = [
    ['K8s Get', k8sGetInputs, 'kind'],
    ['K8s Events', k8sEventsInputs, 'object_kind'],
    ['K8s Delete', k8sDeleteInputs, 'kind'],
  ]

  function kindPicker(inputs: Parameter[], name: string): Parameter {
    const picker = inputs.find((input) => input.name === name && input.enumSearchable === true)
    expect(picker, `${name} is a searchable kind picker`).toBeDefined()
    return picker as Parameter
  }

  it.each(KIND_PICKERS)('declares Pod as the default of the %s kind picker', (_block, inputs, name) => {
    expect(kindPicker(inputs, name).defaultValue).toBe('Pod')
  })

  it.each(KIND_PICKERS)('shows and marks Pod on the %s kind picker holding its written default', async (_block, inputs, name) => {
    const user = userEvent.setup()
    const parameter = kindPicker(inputs, name)
    render(
      <EnumPickerInput
        parameter={parameter}
        effectiveValue={parameter.defaultValue}
        onChange={vi.fn()}
        showRequiredError={false}
      />,
    )
    const pickerTrigger = screen.getByTestId(`enum-picker-trigger-${name}`)
    expect(pickerTrigger).toHaveTextContent(/^Pod$/)
    await user.click(pickerTrigger)
    const pod = screen.getByTestId(`enum-picker-item-${name}-Pod`)
    expect(within(pod).getByTestId(`enum-picker-check-${name}`)).toBeInTheDocument()
  })
})
