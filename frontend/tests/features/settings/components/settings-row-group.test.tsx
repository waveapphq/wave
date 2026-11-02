/**
 * SettingsRowGroup Component Tests
 *
 * REQ-5.2.1.42: shared settings row group (NET-11): a bordered group of
 * rows, each with a label, an optional help line linked to its control, an
 * optional adornment beside the label and the control centered vertically.
 * A row can also be muted (MCP-7), top-aligned, carry a message line linked to
 * its control and hold content under the control. The group has a full-width
 * row and a first-read skeleton.
 *
 * Component: frontend/src/features/settings/components/settings-row-group.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SegmentedControl } from '@/components/shared/segmented-control'
import { Switch } from '@/components/ui/switch'
import { SettingsRowGroup } from '@/features/settings/components/settings-row-group'

const LOCK_LABEL = 'Lock trusted hosts'
const LOCK_HELP =
  'No block can add hosts. New and existing SSH blocks using "Accept New" act as "Strict".'
const ACTION_LABEL = 'Default block action'
const ACTION_HELP =
  'New blocks are configured in this mode by default. Existing blocks keep their current setting.'

const PORT_LABEL = 'Port'
const PORT_HELP = 'The port the MCP endpoint listens on.'
const PORT_MESSAGE = 'Port must be between 1024 and 65535'
const API_PORT_LABEL = 'API port'
const API_PORT_MESSAGE = 'Port 3000 is used by WAVE itself'
const USERNAME_LABEL = 'Username'
const PASSWORD_LABEL = 'Password'
const PASSWORD_HELP = 'Stored sealed; shown write-only like other credentials.'
const VIEW_LABEL = 'Files view'
const VIEW_OPTIONS = [
  { value: 'tree', label: 'Tree' },
  { value: 'flat', label: 'Flat' },
]
const HOST_VALUES = 'HTTPS_PROXY http://proxy.corp.example:3128'
const SKELETON_ROWS: readonly string[] = ['lock', 'default-action']

/** The elements a control's aria-describedby points at, in the order listed. */
function describers(control: HTMLElement): HTMLElement[] {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id))
    .filter((element): element is HTMLElement => element !== null)
}

function describerTexts(control: HTMLElement): string[] {
  return describers(control).map((element) => element.textContent ?? '')
}

/** The smallest ancestor of the control that also holds the row label: the line that aligns the two. */
function lineOf(control: HTMLElement, label: string): HTMLElement {
  let node = control.parentElement
  while (node && !within(node).queryByText(label, { selector: 'label' })) {
    node = node.parentElement
  }
  if (!node) throw new Error(`No line holds the "${label}" label`)
  return node
}

function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

function textbox(label: string): HTMLElement {
  return screen.getByRole('textbox', { name: label })
}

function liveRegionsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[aria-live]'))
}

/** The live region that holds a message; a screen reader speaks what changes inside it. */
function liveRegionOf(message: string): HTMLElement {
  const region = screen.getByText(message).closest<HTMLElement>('[aria-live]')
  if (!region) throw new Error(`"${message}" is in no live region`)
  return region
}

/** Records every change a screen reader would hear in the region. */
function watchChanges(region: HTMLElement): MutationObserver {
  const observer = new MutationObserver(() => {})
  observer.observe(region, { attributes: true, characterData: true, childList: true, subtree: true })
  return observer
}

/** The placeholder bars of one skeleton row, in document order. */
function barsOf(row: Element): Element[] {
  return Array.from(row.querySelectorAll('.skeleton'))
}

describe('SettingsRowGroup', () => {
  describe('Group', () => {
    it('passes its data-testid through to the group element', () => {
      render(
        <SettingsRowGroup data-testid="policy-group">
          <SettingsRowGroup.Row label={LOCK_LABEL} control={<Switch aria-label={LOCK_LABEL} />} />
        </SettingsRowGroup>,
      )

      expect(screen.getByTestId('policy-group')).toBeInTheDocument()
    })

    it('renders its rows in the order given', () => {
      render(
        <SettingsRowGroup data-testid="policy-group">
          <SettingsRowGroup.Row label={LOCK_LABEL} control={<Switch aria-label={LOCK_LABEL} />} />
          <SettingsRowGroup.Row
            label={ACTION_LABEL}
            control={<Switch aria-label={ACTION_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      const switches = within(screen.getByTestId('policy-group')).getAllByRole('switch')
      expect(switches.map((s) => s.getAttribute('aria-label'))).toEqual([LOCK_LABEL, ACTION_LABEL])
    })
  })

  describe('Row', () => {
    it('renders the label and the control', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={LOCK_LABEL} control={<Switch aria-label={LOCK_LABEL} />} />
        </SettingsRowGroup>,
      )

      expect(screen.getByText(LOCK_LABEL)).toBeInTheDocument()
      expect(screen.getByRole('switch', { name: LOCK_LABEL })).toBeInTheDocument()
    })

    it('passes its data-testid through to the row element', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="lock-row"
            label={LOCK_LABEL}
            control={<Switch aria-label={LOCK_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      const row = screen.getByTestId('lock-row')
      expect(within(row).getByText(LOCK_LABEL)).toBeInTheDocument()
      expect(within(row).getByRole('switch', { name: LOCK_LABEL })).toBeInTheDocument()
    })

    it('places the label before the control', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={LOCK_LABEL} control={<Switch aria-label={LOCK_LABEL} />} />
        </SettingsRowGroup>,
      )

      const label = screen.getByText(LOCK_LABEL)
      const control = screen.getByRole('switch', { name: LOCK_LABEL })
      expect(label.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('renders the help line', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={LOCK_LABEL}
            help={LOCK_HELP}
            control={<Switch aria-label={LOCK_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      expect(screen.getByText(LOCK_HELP)).toBeInTheDocument()
    })

    it('links the help line to the control with aria-describedby', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={LOCK_LABEL}
            help={LOCK_HELP}
            control={<Switch aria-label={LOCK_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      const control = screen.getByRole('switch', { name: LOCK_LABEL })
      const helpId = control.getAttribute('aria-describedby')
      expect(helpId).toBeTruthy()
      expect(document.getElementById(helpId as string)).toHaveTextContent(LOCK_HELP)
      expect(control).toHaveAccessibleDescription(LOCK_HELP)
    })

    it('links each row help line to its own control', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={LOCK_LABEL}
            help={LOCK_HELP}
            control={<Switch aria-label={LOCK_LABEL} />}
          />
          <SettingsRowGroup.Row
            label={ACTION_LABEL}
            help={ACTION_HELP}
            control={<Switch aria-label={ACTION_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      const lock = screen.getByRole('switch', { name: LOCK_LABEL })
      const action = screen.getByRole('switch', { name: ACTION_LABEL })
      expect(lock).toHaveAccessibleDescription(LOCK_HELP)
      expect(action).toHaveAccessibleDescription(ACTION_HELP)
      expect(lock.getAttribute('aria-describedby')).not.toBe(action.getAttribute('aria-describedby'))
    })

    it('leaves the control without a description when the row has no help line', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={LOCK_LABEL} control={<Switch aria-label={LOCK_LABEL} />} />
        </SettingsRowGroup>,
      )

      const control = screen.getByRole('switch', { name: LOCK_LABEL })
      expect(control).not.toHaveAttribute('aria-describedby')
      expect(control).not.toHaveAccessibleDescription()
    })

    it('renders the adornment inside the row when given', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="lock-row"
            label={LOCK_LABEL}
            adornment={<span data-testid="lock-adornment">Revealing</span>}
            control={<Switch aria-label={LOCK_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      const row = screen.getByTestId('lock-row')
      expect(within(row).getByTestId('lock-adornment')).toHaveTextContent('Revealing')
    })

    it('renders no adornment when none is given', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="lock-row"
            label={LOCK_LABEL}
            control={<Switch aria-label={LOCK_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      expect(screen.getByTestId('lock-row')).toHaveTextContent(new RegExp(`^${LOCK_LABEL}$`))
    })

    it('points the row label at its control', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={LOCK_LABEL} control={<Switch aria-label={LOCK_LABEL} />} />
        </SettingsRowGroup>,
      )

      const label = screen.getByText(LOCK_LABEL)
      const control = screen.getByRole('switch', { name: LOCK_LABEL })
      expect(label.tagName).toBe('LABEL')
      expect(control.id).not.toBe('')
      expect(label).toHaveAttribute('for', control.id)
    })

    it('toggles the control when its label is clicked', async () => {
      const user = userEvent.setup()
      const onCheckedChange = vi.fn()
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={LOCK_LABEL}
            control={<Switch aria-label={LOCK_LABEL} onCheckedChange={onCheckedChange} />}
          />
        </SettingsRowGroup>,
      )

      await user.click(screen.getByText(LOCK_LABEL))

      expect(onCheckedChange).toHaveBeenCalledWith(true)
    })

    it('keeps an id the control already has', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={LOCK_LABEL}
            control={<Switch id="lock-switch" aria-label={LOCK_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      expect(screen.getByRole('switch', { name: LOCK_LABEL })).toHaveAttribute('id', 'lock-switch')
      expect(screen.getByText(LOCK_LABEL)).toHaveAttribute('for', 'lock-switch')
    })

    it('keeps a description the control already has and adds the help line after it', () => {
      render(
        <>
          <p id="outside-note">Applies to every block.</p>
          <SettingsRowGroup>
            <SettingsRowGroup.Row
              label={LOCK_LABEL}
              help={LOCK_HELP}
              control={<Switch aria-label={LOCK_LABEL} aria-describedby="outside-note" />}
            />
            <SettingsRowGroup.Row
              label={ACTION_LABEL}
              control={<Switch aria-label={ACTION_LABEL} aria-describedby="outside-note" />}
            />
          </SettingsRowGroup>
        </>,
      )

      expect(screen.getByRole('switch', { name: LOCK_LABEL })).toHaveAccessibleDescription(
        `Applies to every block. ${LOCK_HELP}`,
      )
      expect(screen.getByRole('switch', { name: ACTION_LABEL })).toHaveAttribute(
        'aria-describedby',
        'outside-note',
      )
    })

    it('renders a plain-text control as given, with a label that points nowhere', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row data-testid="lock-row" label={LOCK_LABEL} help={LOCK_HELP} control="Fixed" />
        </SettingsRowGroup>,
      )

      expect(screen.getByTestId('lock-row')).toHaveTextContent('Fixed')
      expect(screen.getByText(LOCK_LABEL)).not.toHaveAttribute('for')
    })

    it('keeps the control interactive', async () => {
      const user = userEvent.setup()
      const onCheckedChange = vi.fn()
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={LOCK_LABEL}
            help={LOCK_HELP}
            control={<Switch aria-label={LOCK_LABEL} onCheckedChange={onCheckedChange} />}
          />
        </SettingsRowGroup>,
      )

      await user.click(screen.getByRole('switch', { name: LOCK_LABEL }))

      expect(onCheckedChange).toHaveBeenCalledWith(true)
    })
  })

  describe('Control alignment (NET-11)', () => {
    it('centers the control vertically on a row with a help line', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="lock-row"
            label={LOCK_LABEL}
            help={LOCK_HELP}
            control={<Switch aria-label={LOCK_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      const row = screen.getByTestId('lock-row')
      expect(row).toHaveClass('items-center')
      expect(row).not.toHaveClass('items-start')
    })

    it('centers the control vertically on a row without a help line', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="lock-row"
            label={LOCK_LABEL}
            control={<Switch aria-label={LOCK_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      expect(screen.getByTestId('lock-row')).toHaveClass('items-center')
    })
  })

  describe('Footer', () => {
    it('renders its note', () => {
      render(
        <>
          <SettingsRowGroup>
            <SettingsRowGroup.Row label={LOCK_LABEL} control={<Switch aria-label={LOCK_LABEL} />} />
          </SettingsRowGroup>
          <SettingsRowGroup.Footer>Exports are governed separately.</SettingsRowGroup.Footer>
        </>,
      )

      expect(screen.getByText('Exports are governed separately.')).toBeInTheDocument()
    })

    it('passes its data-testid through to the footer element', () => {
      render(
        <>
          <SettingsRowGroup>
            <SettingsRowGroup.Row label={LOCK_LABEL} control={<Switch aria-label={LOCK_LABEL} />} />
          </SettingsRowGroup>
          <SettingsRowGroup.Footer data-testid="group-footnote">
            Exports are governed separately.
          </SettingsRowGroup.Footer>
        </>,
      )

      expect(screen.getByTestId('group-footnote')).toHaveTextContent(
        'Exports are governed separately.',
      )
    })
  })

  describe('Muted row (MCP-7)', () => {
    it('fades a muted row and shows the not-allowed cursor over it', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="username-row"
            label={USERNAME_LABEL}
            muted
            control={<input disabled />}
          />
        </SettingsRowGroup>,
      )

      expect(screen.getByTestId('username-row')).toHaveClass('opacity-50', 'cursor-not-allowed')
    })

    it('fades only the rows that are muted', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row data-testid="port-row" label={PORT_LABEL} control={<input />} />
          <SettingsRowGroup.Row
            data-testid="api-port-row"
            label={API_PORT_LABEL}
            muted={false}
            control={<input />}
          />
          <SettingsRowGroup.Row
            data-testid="username-row"
            label={USERNAME_LABEL}
            muted
            control={<input disabled />}
          />
        </SettingsRowGroup>,
      )

      expect(screen.getByTestId('username-row')).toHaveClass('opacity-50', 'cursor-not-allowed')
      for (const testId of ['port-row', 'api-port-row']) {
        expect(screen.getByTestId(testId)).not.toHaveClass('opacity-50')
        expect(screen.getByTestId(testId)).not.toHaveClass('cursor-not-allowed')
      }
    })

    it('lifts the fade when the row stops being muted', () => {
      const row = (muted: boolean) => (
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="username-row"
            label={USERNAME_LABEL}
            muted={muted}
            control={<input />}
          />
        </SettingsRowGroup>
      )
      const { rerender } = render(row(true))
      expect(screen.getByTestId('username-row')).toHaveClass('opacity-50', 'cursor-not-allowed')

      rerender(row(false))

      expect(screen.getByTestId('username-row')).not.toHaveClass('opacity-50')
      expect(screen.getByTestId('username-row')).not.toHaveClass('cursor-not-allowed')
    })
  })

  describe('Top alignment', () => {
    it('lines the label up with the top of the control when asked to', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PASSWORD_LABEL}
            help={PASSWORD_HELP}
            align="top"
            control={<input />}
          />
        </SettingsRowGroup>,
      )

      const line = lineOf(textbox(PASSWORD_LABEL), PASSWORD_LABEL)
      expect(line).toHaveClass('items-start')
      expect(line).not.toHaveClass('items-center')
    })

    it('top-aligns only the row asked to', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PORT_LABEL}
            help={PORT_HELP}
            align="center"
            control={<input />}
          />
          <SettingsRowGroup.Row
            label={PASSWORD_LABEL}
            help={PASSWORD_HELP}
            align="top"
            control={<input />}
          />
        </SettingsRowGroup>,
      )

      const centered = lineOf(textbox(PORT_LABEL), PORT_LABEL)
      expect(centered).toHaveClass('items-center')
      expect(centered).not.toHaveClass('items-start')
      expect(lineOf(textbox(PASSWORD_LABEL), PASSWORD_LABEL)).toHaveClass('items-start')
    })
  })

  describe('Message line', () => {
    it('shows the message inside the row, after the control', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="port-row"
            label={PORT_LABEL}
            help={PORT_HELP}
            message={PORT_MESSAGE}
            control={<input />}
          />
        </SettingsRowGroup>,
      )

      const message = within(screen.getByTestId('port-row')).getByText(PORT_MESSAGE)
      expect(follows(textbox(PORT_LABEL), message)).toBe(true)
    })

    it('links the message to the control through aria-describedby', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={PORT_LABEL} message={PORT_MESSAGE} control={<input />} />
        </SettingsRowGroup>,
      )

      expect(describerTexts(textbox(PORT_LABEL))).toEqual([PORT_MESSAGE])
      expect(textbox(PORT_LABEL)).toHaveAccessibleDescription(PORT_MESSAGE)
    })

    it('marks the control invalid', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={PORT_LABEL} message={PORT_MESSAGE} control={<input />} />
        </SettingsRowGroup>,
      )

      expect(textbox(PORT_LABEL)).toHaveAttribute('aria-invalid', 'true')
    })

    it('keeps the help line in the description next to the message', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PORT_LABEL}
            help={PORT_HELP}
            message={PORT_MESSAGE}
            control={<input />}
          />
        </SettingsRowGroup>,
      )

      const texts = describerTexts(textbox(PORT_LABEL))
      expect(texts).toHaveLength(2)
      expect(texts).toEqual(expect.arrayContaining([PORT_HELP, PORT_MESSAGE]))
    })

    it('keeps a description the control already has next to the help line and the message', () => {
      render(
        <>
          <p id="outside-note">Applies to every block.</p>
          <SettingsRowGroup>
            <SettingsRowGroup.Row
              label={PORT_LABEL}
              help={PORT_HELP}
              message={PORT_MESSAGE}
              control={<input aria-describedby="outside-note" />}
            />
          </SettingsRowGroup>
        </>,
      )

      const texts = describerTexts(textbox(PORT_LABEL))
      expect(texts).toHaveLength(3)
      expect(texts).toEqual(
        expect.arrayContaining(['Applies to every block.', PORT_HELP, PORT_MESSAGE]),
      )
    })

    it('marks only the control of the row that has a message', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={PORT_LABEL} message={PORT_MESSAGE} control={<input />} />
          <SettingsRowGroup.Row label={USERNAME_LABEL} control={<input />} />
        </SettingsRowGroup>,
      )

      expect(textbox(PORT_LABEL)).toHaveAttribute('aria-invalid', 'true')
      expect(textbox(USERNAME_LABEL)).not.toHaveAttribute('aria-invalid')
      expect(textbox(USERNAME_LABEL)).not.toHaveAttribute('aria-describedby')
    })

    it('links each row message to its own control', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={PORT_LABEL} message={PORT_MESSAGE} control={<input />} />
          <SettingsRowGroup.Row
            label={API_PORT_LABEL}
            message={API_PORT_MESSAGE}
            control={<input />}
          />
        </SettingsRowGroup>,
      )

      expect(describerTexts(textbox(PORT_LABEL))).toEqual([PORT_MESSAGE])
      expect(describerTexts(textbox(API_PORT_LABEL))).toEqual([API_PORT_MESSAGE])
    })

    it('clears the invalid mark and the link when the message goes away', () => {
      const row = (message: string | undefined) => (
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PORT_LABEL}
            help={PORT_HELP}
            message={message}
            control={<input />}
          />
        </SettingsRowGroup>
      )
      const { rerender } = render(row(PORT_MESSAGE))
      expect(textbox(PORT_LABEL)).toHaveAttribute('aria-invalid', 'true')

      rerender(row(undefined))

      expect(screen.queryByText(PORT_MESSAGE)).not.toBeInTheDocument()
      expect(textbox(PORT_LABEL)).not.toHaveAttribute('aria-invalid')
      expect(describerTexts(textbox(PORT_LABEL))).toEqual([PORT_HELP])
    })

    it('does not announce the message as an alert', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={PORT_LABEL} message={PORT_MESSAGE} control={<input />} />
        </SettingsRowGroup>,
      )

      expect(screen.getByText(PORT_MESSAGE)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('announces a message that appears: it lands in a polite region the row already had', () => {
      const row = (message: string | undefined) => (
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="port-row"
            label={PORT_LABEL}
            message={message}
            control={<input />}
          />
        </SettingsRowGroup>
      )
      const { rerender } = render(row(undefined))
      const regionsBefore = liveRegionsIn(screen.getByTestId('port-row'))
      expect(regionsBefore).toHaveLength(1)
      expect(regionsBefore[0].textContent).toBe('')

      rerender(row(PORT_MESSAGE))

      const region = liveRegionOf(PORT_MESSAGE)
      expect(region).toHaveAttribute('aria-live', 'polite')
      expect(region).toBe(regionsBefore[0])
      expect(liveRegionsIn(screen.getByTestId('port-row'))).toHaveLength(1)
    })

    it('announces nothing again while the value changes and the message stays the same', () => {
      const row = (value: string) => (
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PORT_LABEL}
            help={PORT_HELP}
            message={PORT_MESSAGE}
            control={<input value={value} onChange={vi.fn()} />}
          />
        </SettingsRowGroup>
      )
      const { rerender } = render(row('7'))
      const changes = watchChanges(liveRegionOf(PORT_MESSAGE))

      rerender(row('70'))
      rerender(row('700'))

      expect(textbox(PORT_LABEL)).toHaveValue('700')
      expect(changes.takeRecords()).toEqual([])
      changes.disconnect()
    })

    it('announces the new text when the message changes', () => {
      const row = (message: string) => (
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={PORT_LABEL} message={message} control={<input />} />
        </SettingsRowGroup>
      )
      const { rerender } = render(row(PORT_MESSAGE))
      const region = liveRegionOf(PORT_MESSAGE)
      const changes = watchChanges(region)

      rerender(row(API_PORT_MESSAGE))

      expect(changes.takeRecords().length).toBeGreaterThan(0)
      expect(liveRegionOf(API_PORT_MESSAGE)).toBe(region)
      expect(region.textContent).toBe(API_PORT_MESSAGE)
      changes.disconnect()
    })

    it('keeps the announced message attached to its field', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PORT_LABEL}
            help={PORT_HELP}
            message={PORT_MESSAGE}
            control={<input />}
          />
        </SettingsRowGroup>,
      )

      const region = liveRegionOf(PORT_MESSAGE)
      const attached = describers(textbox(PORT_LABEL)).filter((element) => region.contains(element))
      expect(attached.map((element) => element.textContent)).toEqual([PORT_MESSAGE])
      expect(region).not.toContainElement(screen.getByText(PORT_HELP))
    })

    it('keeps the region out of the layout while it is empty and across the row once it holds a message', () => {
      const row = (message: string | undefined) => (
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="port-row"
            label={PORT_LABEL}
            message={message}
            control={<input />}
          />
        </SettingsRowGroup>
      )
      const { rerender } = render(row(undefined))
      const [region] = liveRegionsIn(screen.getByTestId('port-row'))
      expect(region).toHaveClass('sr-only')
      expect(region).not.toHaveClass('w-full')

      rerender(row(PORT_MESSAGE))

      expect(region).toHaveClass('w-full')
      expect(region).not.toHaveClass('sr-only')
    })

    it('gives each row its own region', () => {
      render(
        <SettingsRowGroup data-testid="endpoint-group">
          <SettingsRowGroup.Row label={PORT_LABEL} message={PORT_MESSAGE} control={<input />} />
          <SettingsRowGroup.Row
            label={API_PORT_LABEL}
            message={API_PORT_MESSAGE}
            control={<input />}
          />
          <SettingsRowGroup.Row label={USERNAME_LABEL} control={<input />} />
        </SettingsRowGroup>,
      )

      expect(liveRegionsIn(screen.getByTestId('endpoint-group'))).toHaveLength(3)
      expect(liveRegionOf(PORT_MESSAGE)).not.toBe(liveRegionOf(API_PORT_MESSAGE))
      expect(liveRegionOf(PORT_MESSAGE).textContent).toBe(PORT_MESSAGE)
    })

    it('puts the message test id on the element the control points at', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PORT_LABEL}
            message={PORT_MESSAGE}
            messageTestId="port-error"
            control={<input />}
          />
        </SettingsRowGroup>,
      )

      const message = screen.getByTestId('port-error')
      expect(message.textContent).toBe(PORT_MESSAGE)
      expect(describers(textbox(PORT_LABEL))).toContain(message)
    })

    it('gives the message no test id unless one is given', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={PORT_LABEL} message={PORT_MESSAGE} control={<input />} />
        </SettingsRowGroup>,
      )

      const described = describers(textbox(PORT_LABEL))
      expect(described).toHaveLength(1)
      expect(described[0].textContent).toBe(PORT_MESSAGE)
      expect(described[0]).not.toHaveAttribute('data-testid')
    })

    it('links the message to a segmented control through its group', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={VIEW_LABEL}
            message={PORT_MESSAGE}
            control={
              <SegmentedControl
                options={VIEW_OPTIONS}
                value="tree"
                onChange={vi.fn()}
                aria-label={VIEW_LABEL}
              />
            }
          />
        </SettingsRowGroup>,
      )

      expect(describerTexts(screen.getByRole('group', { name: VIEW_LABEL }))).toEqual([
        PORT_MESSAGE,
      ])
    })

    it('leaves an invalid mark the control already carries on a row with no message', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row label={PORT_LABEL} control={<input aria-invalid="true" />} />
        </SettingsRowGroup>,
      )

      expect(textbox(PORT_LABEL)).toHaveAttribute('aria-invalid', 'true')
    })

    it('keeps the control centered against the label and help line on a row with a message (NET-11)', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PORT_LABEL}
            help={PORT_HELP}
            message={PORT_MESSAGE}
            control={<input />}
          />
        </SettingsRowGroup>,
      )

      const line = lineOf(textbox(PORT_LABEL), PORT_LABEL)
      expect(line).toHaveClass('items-center')
      expect(line).not.toHaveClass('items-start')
    })

    it('keeps the control in place, with its focus, when the message comes and goes', async () => {
      const user = userEvent.setup()
      const row = (message: string | undefined) => (
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PORT_LABEL}
            help={PORT_HELP}
            message={message}
            control={<input />}
          />
        </SettingsRowGroup>
      )
      const { rerender } = render(row(undefined))
      const input = textbox(PORT_LABEL)
      await user.click(input)
      expect(input).toHaveFocus()

      rerender(row(PORT_MESSAGE))
      expect(textbox(PORT_LABEL)).toBe(input)
      expect(input).toHaveFocus()

      rerender(row(undefined))
      expect(textbox(PORT_LABEL)).toBe(input)
      expect(input).toHaveFocus()
    })
  })

  describe('Content under the control', () => {
    it('renders the content inside the row, after the control', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="password-row"
            label={PASSWORD_LABEL}
            help={PASSWORD_HELP}
            control={<input />}
            below={<div data-testid="strength-score">Weak</div>}
          />
        </SettingsRowGroup>,
      )

      const content = within(screen.getByTestId('password-row')).getByTestId('strength-score')
      expect(content).toHaveTextContent('Weak')
      expect(follows(textbox(PASSWORD_LABEL), content)).toBe(true)
    })

    it('keeps the content apart from the label and the help line', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PASSWORD_LABEL}
            help={PASSWORD_HELP}
            control={<input />}
            below={<div data-testid="strength-score">Weak</div>}
          />
        </SettingsRowGroup>,
      )

      const content = screen.getByTestId('strength-score')
      const label = screen.getByText(PASSWORD_LABEL, { selector: 'label' })
      expect(label.parentElement).not.toContainElement(content)
      expect(screen.getByText(PASSWORD_HELP).parentElement).not.toContainElement(content)
    })

    it('keeps the label and the help line wired to the control', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PASSWORD_LABEL}
            help={PASSWORD_HELP}
            control={<input />}
            below={<div data-testid="strength-score">Weak</div>}
          />
        </SettingsRowGroup>,
      )

      expect(screen.getByTestId('strength-score')).toBeInTheDocument()
      expect(describerTexts(textbox(PASSWORD_LABEL))).toEqual([PASSWORD_HELP])
      expect(textbox(PASSWORD_LABEL)).not.toHaveAttribute('aria-invalid')
    })

    it('places the message above the content', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={PORT_LABEL}
            message={PORT_MESSAGE}
            control={<input />}
            below={<div data-testid="address-list">registry.corp.example</div>}
          />
        </SettingsRowGroup>,
      )

      expect(follows(screen.getByText(PORT_MESSAGE), screen.getByTestId('address-list'))).toBe(
        true,
      )
    })

    it('keeps a row with a message and content as one child of the group, with no divider inside it', () => {
      render(
        <SettingsRowGroup data-testid="endpoint-group">
          <SettingsRowGroup.Row label={USERNAME_LABEL} control={<input />} />
          <SettingsRowGroup.Row
            data-testid="port-row"
            label={PORT_LABEL}
            help={PORT_HELP}
            message={PORT_MESSAGE}
            control={<input />}
            below={<div data-testid="address-list">registry.corp.example</div>}
          />
        </SettingsRowGroup>,
      )

      const group = screen.getByTestId('endpoint-group')
      const row = screen.getByTestId('port-row')
      expect(Array.from(group.children)).toHaveLength(2)
      expect(row.parentElement).toBe(group)
      expect(within(row).getByText(PORT_MESSAGE)).toBeInTheDocument()
      expect(within(row).getByTestId('address-list')).toBeInTheDocument()
    })

    it("draws the content across the row, outside the control's column", () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="mode-row"
            label={VIEW_LABEL}
            control={<input />}
            below={<div data-testid="address-list">registry.corp.example</div>}
          />
        </SettingsRowGroup>,
      )

      const row = screen.getByTestId('mode-row')
      const content = screen.getByTestId('address-list')
      let shared = textbox(VIEW_LABEL).parentElement
      while (shared && !shared.contains(content)) {
        shared = shared.parentElement
      }
      expect(shared).toBe(row)
      const holder = Array.from(row.children).find((child) => child.contains(content))
      expect(holder).toHaveClass('w-full')
    })

    it('keeps the content in place, with its focus, when the message comes and goes', async () => {
      const user = userEvent.setup()
      const row = (message: string | undefined) => (
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            label={VIEW_LABEL}
            message={message}
            control={<input />}
            below={<input aria-label="Entry 1 address" />}
          />
        </SettingsRowGroup>
      )
      const { rerender } = render(row(undefined))
      const entry = textbox('Entry 1 address')
      await user.click(entry)
      expect(entry).toHaveFocus()

      rerender(row(PORT_MESSAGE))
      expect(textbox('Entry 1 address')).toBe(entry)
      expect(entry).toHaveFocus()

      rerender(row(undefined))
      expect(textbox('Entry 1 address')).toBe(entry)
      expect(entry).toHaveFocus()
    })
  })

  describe('Row test id with every option', () => {
    it('keeps its data-testid on the one element that holds the whole row', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.Row
            data-testid="password-row"
            label={PASSWORD_LABEL}
            help={PASSWORD_HELP}
            muted
            align="top"
            message={PORT_MESSAGE}
            control={<input disabled />}
            below={<div data-testid="strength-score">Weak</div>}
          />
        </SettingsRowGroup>,
      )

      expect(screen.getAllByTestId('password-row')).toHaveLength(1)
      expect(screen.getByTestId('password-row')).toHaveClass('opacity-50', 'cursor-not-allowed')
      const row = within(screen.getByTestId('password-row'))
      expect(row.getByText(PASSWORD_LABEL, { selector: 'label' })).toBeInTheDocument()
      expect(row.getByText(PASSWORD_HELP)).toBeInTheDocument()
      expect(row.getByRole('textbox', { name: PASSWORD_LABEL })).toBeInTheDocument()
      expect(row.getByText(PORT_MESSAGE)).toBeInTheDocument()
      expect(row.getByTestId('strength-score')).toBeInTheDocument()
    })
  })

  describe('Message', () => {
    it('shows the message under the id it is given, in a polite region', () => {
      render(<SettingsRowGroup.Message id="entry-2-message" message={PORT_MESSAGE} />)

      const message = screen.getByText(PORT_MESSAGE)
      expect(message).toHaveAttribute('id', 'entry-2-message')
      expect(liveRegionOf(PORT_MESSAGE)).toHaveAttribute('aria-live', 'polite')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('keeps its region, empty and out of the layout, while there is no message', () => {
      const { container } = render(<SettingsRowGroup.Message id="entry-2-message" />)

      const regions = liveRegionsIn(container)
      expect(regions).toHaveLength(1)
      expect(regions[0]).toHaveClass('sr-only')
      expect(regions[0].textContent).toBe('')
      expect(document.getElementById('entry-2-message')).toBeNull()
    })

    it('puts the class it is given on the region only while it holds a message', () => {
      const line = (message: string | undefined) => (
        <SettingsRowGroup.Message id="entry-2-message" message={message} className="col-start-2" />
      )
      const { container, rerender } = render(line(undefined))
      const [region] = liveRegionsIn(container)
      expect(region).not.toHaveClass('col-start-2')

      rerender(line(PORT_MESSAGE))

      expect(liveRegionOf(PORT_MESSAGE)).toBe(region)
      expect(region).toHaveClass('col-start-2')
      expect(region).not.toHaveClass('sr-only')
    })

    it('puts its test id on the message, not on the region', () => {
      render(
        <SettingsRowGroup.Message
          id="entry-2-message"
          message={PORT_MESSAGE}
          data-testid="entry-2-problem"
        />,
      )

      expect(screen.getByTestId('entry-2-problem')).toBe(screen.getByText(PORT_MESSAGE))
      expect(liveRegionOf(PORT_MESSAGE)).not.toHaveAttribute('data-testid')
    })
  })

  describe('FullWidthRow', () => {
    it('renders its content inside the group', () => {
      render(
        <SettingsRowGroup data-testid="proxy-group">
          <SettingsRowGroup.FullWidthRow>
            <p>{HOST_VALUES}</p>
          </SettingsRowGroup.FullWidthRow>
        </SettingsRowGroup>,
      )

      expect(within(screen.getByTestId('proxy-group')).getByText(HOST_VALUES)).toBeInTheDocument()
    })

    it('passes its data-testid through to the row element', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.FullWidthRow data-testid="host-values-row">
            <p>{HOST_VALUES}</p>
          </SettingsRowGroup.FullWidthRow>
        </SettingsRowGroup>,
      )

      expect(within(screen.getByTestId('host-values-row')).getByText(HOST_VALUES)).toBeInTheDocument()
    })

    it('renders the content alone, with no label', () => {
      render(
        <SettingsRowGroup>
          <SettingsRowGroup.FullWidthRow data-testid="host-values-row">
            <p>{HOST_VALUES}</p>
          </SettingsRowGroup.FullWidthRow>
        </SettingsRowGroup>,
      )

      const row = screen.getByTestId('host-values-row')
      expect(row.querySelector('label')).toBeNull()
      expect(row.textContent).toBe(HOST_VALUES)
    })

    it('sits among the other rows in the order given, one child of the group each', () => {
      render(
        <SettingsRowGroup data-testid="proxy-group">
          <SettingsRowGroup.Row
            data-testid="port-row"
            label={PORT_LABEL}
            control={<Switch aria-label={PORT_LABEL} />}
          />
          <SettingsRowGroup.FullWidthRow data-testid="host-values-row">
            <p>{HOST_VALUES}</p>
          </SettingsRowGroup.FullWidthRow>
          <SettingsRowGroup.Row
            data-testid="username-row"
            label={USERNAME_LABEL}
            control={<Switch aria-label={USERNAME_LABEL} />}
          />
        </SettingsRowGroup>,
      )

      const rows = Array.from(screen.getByTestId('proxy-group').children)
      expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
        'port-row',
        'host-values-row',
        'username-row',
      ])
    })
  })

  describe('Skeleton', () => {
    it('marks the placeholder busy and passes its data-testid through', () => {
      render(
        <SettingsRowGroup.Skeleton
          data-testid="policy-skeleton"
          rows={SKELETON_ROWS}
          help
          controlClassName="h-9 w-52"
        />,
      )

      expect(screen.getByTestId('policy-skeleton')).toHaveAttribute('aria-busy', 'true')
    })

    it('carries no test id unless one is given', () => {
      const { container } = render(
        <SettingsRowGroup.Skeleton rows={SKELETON_ROWS} help controlClassName="h-9 w-52" />,
      )

      expect(container.children).toHaveLength(1)
      expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true')
      expect(container.firstElementChild).not.toHaveAttribute('data-testid')
    })

    it('renders one placeholder row per entry', () => {
      render(
        <SettingsRowGroup.Skeleton
          data-testid="policy-skeleton"
          rows={SKELETON_ROWS}
          help
          controlClassName="h-9 w-52"
        />,
      )

      expect(Array.from(screen.getByTestId('policy-skeleton').children)).toHaveLength(2)
    })

    it('draws a label bar and a control bar per row when help is off', () => {
      render(
        <SettingsRowGroup.Skeleton
          data-testid="log-level-skeleton"
          rows={['log-level']}
          help={false}
          controlClassName="h-9 w-32"
        />,
      )

      const rows = Array.from(screen.getByTestId('log-level-skeleton').children)
      expect(rows.map((row) => barsOf(row).length)).toEqual([2])
    })

    it('adds a help bar per row when help is on', () => {
      render(
        <SettingsRowGroup.Skeleton
          data-testid="policy-skeleton"
          rows={SKELETON_ROWS}
          help
          controlClassName="h-9 w-52"
        />,
      )

      const rows = Array.from(screen.getByTestId('policy-skeleton').children)
      expect(rows.map((row) => barsOf(row).length)).toEqual([3, 3])
    })

    it('sizes the control bar of every row with controlClassName', () => {
      render(
        <SettingsRowGroup.Skeleton
          data-testid="policy-skeleton"
          rows={SKELETON_ROWS}
          help
          controlClassName="h-9 w-52"
        />,
      )

      const rows = Array.from(screen.getByTestId('policy-skeleton').children)
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        const bars = barsOf(row)
        expect(bars[bars.length - 1]).toHaveClass('h-9', 'w-52')
        expect(bars[0]).not.toHaveClass('w-52')
      }
    })

    it('keeps the label and help bars together, apart from the control bar', () => {
      render(
        <SettingsRowGroup.Skeleton
          data-testid="policy-skeleton"
          rows={SKELETON_ROWS}
          help
          controlClassName="h-9 w-52"
        />,
      )

      const rows = Array.from(screen.getByTestId('policy-skeleton').children)
      expect(rows).toHaveLength(2)
      for (const row of rows) {
        const [labelBar, helpBar, controlBar] = barsOf(row)
        expect(helpBar.parentElement).toBe(labelBar.parentElement)
        expect(labelBar.parentElement).not.toBe(row)
        expect(controlBar.parentElement).toBe(row)
      }
    })

    it('shows no label, control or text while the read is pending', () => {
      render(
        <SettingsRowGroup.Skeleton
          data-testid="policy-skeleton"
          rows={SKELETON_ROWS}
          help
          controlClassName="h-9 w-52"
        />,
      )

      const skeleton = screen.getByTestId('policy-skeleton')
      expect(skeleton.textContent).toBe('')
      expect(skeleton.querySelector('label, input, button')).toBeNull()
    })
  })
})
