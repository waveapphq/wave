/** GeneralTab driven through a `general` hook-result prop: every state of the General page (SETTINGS-14, SETTINGS-18, SETTINGS-19, SETTINGS-20, SECREV-6). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ComponentProps } from 'react'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { GeneralTab } from '@/features/settings/page/general-tab'

const sectionErrorSpy = vi.hoisted(() => vi.fn())

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/features/settings/components/section-error', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/settings/components/section-error')>()
  sectionErrorSpy.mockImplementation(actual.SectionError)
  return { ...actual, SectionError: sectionErrorSpy }
})

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, warning: vi.fn(), info: vi.fn() }),
}))

type General = ComponentProps<typeof GeneralTab>['general']
type Staged = General['staged']
type Masking = Staged['masking']

const MASKED: Masking = {
  runOutput: false,
  testVariables: false,
  sharedVariables: false,
  credentialInputs: false,
}

const CLEAN: Staged = { logLevel: 'INFO', timezone: 'local', masking: MASKED }

const READ_FAILURE = 'Admin API is not enabled on this server'

const LOGGING_SUBTITLE =
  "Verbosity of the WAVE server's own log. Block output in runs is not affected."
const TIME_ZONE_SUBTITLE = 'How timestamps are shown in this browser.'
const MASKING_SUBTITLE =
  'Secrets are masked everywhere by default. Reveal them system-wide per surface:'

const MASKING_ROWS = [
  {
    testKey: 'run-output',
    title: 'Reveal secrets in run output',
    help: 'Show secret values in run logs, console, and reports. Individual blocks can override this (Always reveal / Always mask).',
  },
  {
    testKey: 'test-variables',
    title: 'Reveal test variables',
    help: "Show a test's secret variable values in the workbench Variable Manager panel and its watchers.",
  },
  {
    testKey: 'shared-variables',
    title: 'Reveal global, regression, and suite variables',
    help: 'Show secret values in the global, regression, and suite variable editors.',
  },
  {
    testKey: 'credential-inputs',
    title: 'Unmask plugin credential input fields',
    help:
      'Show the stored value of a plugin credential input field (e.g. an SSH password or ' +
      'private key) in the block config, instead of masking it write-only.',
  },
] as const

function staged(change: Partial<Staged>): Staged {
  return { ...CLEAN, ...change }
}

function withFlags(flags: Partial<Masking>): Staged {
  return staged({ masking: { ...MASKED, ...flags } })
}

function makeGeneral(overrides: Partial<General> = {}): General {
  return {
    status: 'loaded',
    logLevel: 'INFO',
    staged: CLEAN,
    dirty: false,
    saving: false,
    stageLogLevel: vi.fn(),
    stageTimezone: vi.fn(),
    stageMasking: vi.fn(),
    cancel: vi.fn(),
    save: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

function renderTab(overrides: Partial<General> = {}) {
  const general = makeGeneral(overrides)
  return { ...render(<GeneralTab general={general} />), general }
}

// The smallest ancestor of the "Logging" heading that holds Save; nesting depth is not pinned.
function loggingHeader(): HTMLElement {
  let node = screen.getByRole('heading', { name: 'Logging' }).parentElement
  while (node && !within(node).queryByRole('button', { name: 'Save' })) {
    node = node.parentElement
  }
  if (!node) throw new Error('No Save button around the "Logging" heading')
  return node
}

function saveButton(): HTMLElement {
  return within(loggingHeader()).getByRole('button', { name: 'Save' })
}

function cancelButton(): HTMLElement {
  return within(loggingHeader()).getByRole('button', { name: 'Cancel' })
}

function logLevelSelect(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Log Level' })
}

function timeZoneSelect(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Time Zone' })
}

function skeletonsIn(testId: string): number {
  return screen.getByTestId(testId).querySelectorAll('.skeleton').length
}

// Skeleton blocks per row of the one busy placeholder group in a section; a row is a child of the group.
function placeholderRowsIn(testId: string): number[] {
  const groups = screen.getByTestId(testId).querySelectorAll('[aria-busy="true"]')
  if (groups.length !== 1) {
    throw new Error(`Expected one busy placeholder group in ${testId}, found ${groups.length}`)
  }
  return Array.from(groups[0].children, (row) => row.querySelectorAll('.skeleton').length)
}

function follows(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

function lastSectionErrorProps(): Record<string, unknown> | undefined {
  return sectionErrorSpy.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GeneralTab - first read pending', () => {
  const PENDING = { status: 'pending', logLevel: undefined } as const

  it('shows the "Logging" heading with its title only, with no Cancel or Save', () => {
    renderTab(PENDING)

    expect(screen.getByRole('heading', { name: 'Logging' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('shows a skeleton in place of the Log Level select', () => {
    renderTab(PENDING)

    expect(skeletonsIn('log-level-section')).toBeGreaterThan(0)
    expect(screen.queryByRole('combobox', { name: 'Log Level' })).not.toBeInTheDocument()
  })

  it("shows the browser's saved zone in the Time Zone select", () => {
    renderTab({ ...PENDING, staged: staged({ timezone: 'utc' }) })

    expect(timeZoneSelect()).toHaveTextContent('UTC')
  })

  it('disables the Time Zone select until the read answers', () => {
    renderTab(PENDING)

    expect(timeZoneSelect()).toBeDisabled()
  })

  it('shows skeleton rows in place of the masking switches', () => {
    renderTab(PENDING)

    expect(skeletonsIn('secret-masking-section')).toBeGreaterThan(0)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
  })

  it('draws the Log Level placeholder as one busy row: a label and a control, no help line', () => {
    renderTab(PENDING)

    expect(placeholderRowsIn('log-level-section')).toEqual([2])
  })

  it('draws one busy placeholder row per masking switch: a label, a help line and a control', () => {
    renderTab(PENDING)

    expect(placeholderRowsIn('secret-masking-section')).toEqual([3, 3, 3, 3])
  })

  it('shows no read failure', () => {
    renderTab(PENDING)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('GeneralTab - first read failed', () => {
  const FAILED = { status: 'failed', error: READ_FAILURE, logLevel: undefined } as const

  it('shows the API reason with Try Again in place of the page body', () => {
    renderTab(FAILED)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(READ_FAILURE)
    expect(within(alert).getByRole('button', { name: 'Try Again' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByTestId('masking-carveout-footnote')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('keeps the "Logging" heading alone, with no Cancel or Save', () => {
    renderTab(FAILED)

    const headings = screen.queryAllByRole('heading').map((heading) => heading.textContent?.trim())
    expect(headings).toEqual(['Logging'])
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('puts the read failure under the "Logging" heading, with the API reason and Try Again', async () => {
    const user = userEvent.setup()
    const { general } = renderTab(FAILED)

    const alert = screen.getByRole('alert')
    expect(follows(screen.getByRole('heading', { name: 'Logging' }), alert)).toBe(true)
    expect(within(alert).getByText(READ_FAILURE)).toBeInTheDocument()
    await user.click(within(alert).getByRole('button', { name: 'Try Again' }))

    expect(general.retry).toHaveBeenCalledTimes(1)
  })

  it('renders the failure through SectionError with the API reason alone', () => {
    renderTab(FAILED)

    expect(lastSectionErrorProps()).toMatchObject({ message: READ_FAILURE })
  })

  it('Try Again calls retry', async () => {
    const user = userEvent.setup()
    const { general } = renderTab(FAILED)

    await user.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(general.retry).toHaveBeenCalledTimes(1)
  })

  it('still offers Try Again when the failure carries no reason', async () => {
    const user = userEvent.setup()
    const { general } = renderTab({ status: 'failed', error: undefined, logLevel: undefined })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(lastSectionErrorProps()).toMatchObject({ message: '' })
    await user.click(screen.getByRole('button', { name: 'Try Again' }))

    expect(general.retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('shows the page again once the read succeeds', () => {
    const { rerender } = renderTab(FAILED)

    rerender(<GeneralTab general={makeGeneral()} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(logLevelSelect()).toBeInTheDocument()
    expect(screen.getByTestId('masking-run-output-toggle')).toBeInTheDocument()
  })
})

describe('GeneralTab - loaded, clean', () => {
  it('shows the three section headings in order', () => {
    renderTab()

    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent?.trim())
    expect(headings).toEqual(['Logging', 'Time Zone', 'Secret Masking'])
  })

  it('puts Cancel and Save on the "Logging" heading line, Cancel first', () => {
    renderTab()

    const header = loggingHeader()
    const cancel = within(header).getByRole('button', { name: 'Cancel' })
    const save = within(header).getByRole('button', { name: 'Save' })
    expect(follows(cancel, save)).toBe(true)
    expect(within(header).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(header).queryByRole('heading', { name: 'Time Zone' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1)
  })

  it('disables Cancel and Save', () => {
    renderTab()

    expect(cancelButton()).toBeDisabled()
    expect(saveButton()).toBeDisabled()
    expect(saveButton()).not.toHaveAttribute('aria-busy')
  })

  it('keeps the level names out of page translation and leaves the time zone names to it', () => {
    renderTab()

    expect(logLevelSelect()).toHaveAttribute('translate', 'no')
    expect(timeZoneSelect()).not.toHaveAttribute('translate')
  })

  it('shows the Logging subtitle under the heading line and above the Log Level row', () => {
    renderTab()

    const subtitle = screen.getByText(LOGGING_SUBTITLE)
    expect(loggingHeader()).not.toContainElement(subtitle)
    expect(follows(screen.getByRole('heading', { name: 'Logging' }), subtitle)).toBe(true)
    expect(follows(subtitle, logLevelSelect())).toBe(true)
  })

  it('shows the Time Zone subtitle under its heading and above the Time Zone row', () => {
    renderTab()

    const subtitle = screen.getByText(TIME_ZONE_SUBTITLE)
    expect(follows(screen.getByRole('heading', { name: 'Time Zone' }), subtitle)).toBe(true)
    expect(follows(subtitle, timeZoneSelect())).toBe(true)
    expect(follows(subtitle, screen.getByRole('heading', { name: 'Secret Masking' }))).toBe(true)
  })

  it('no longer shows the old one-line descriptions', () => {
    renderTab()

    expect(screen.queryByText('Control backend log verbosity')).not.toBeInTheDocument()
    expect(screen.queryByText('How the UI displays timestamps')).not.toBeInTheDocument()
  })

  it('says nothing about where the level came from', () => {
    renderTab()

    expect(screen.getByTestId('log-level-section')).not.toHaveTextContent(
      /WAVE_LOG_LEVEL|environment variable|config file|source|overrid/i,
    )
  })

  it('links the "Log Level" label to its select, with no help line', () => {
    renderTab()

    const select = logLevelSelect()
    expect(screen.getByText('Log Level', { selector: 'label' })).toHaveAttribute('for', select.id)
    expect(select).not.toHaveAccessibleDescription()
  })

  it('links the "Time Zone" label to its select, with no help line', () => {
    renderTab()

    const select = timeZoneSelect()
    expect(screen.getByText('Time Zone', { selector: 'label' })).toHaveAttribute('for', select.id)
    expect(select).not.toHaveAccessibleDescription()
  })

  it('shows the level in force in the Log Level select', () => {
    renderTab({ logLevel: 'WARN', staged: staged({ logLevel: 'WARN' }) })

    expect(logLevelSelect()).toHaveTextContent('WARN')
  })

  it.each([
    { zone: 'local', label: 'Browser local' },
    { zone: 'utc', label: 'UTC' },
  ] as const)('shows the saved zone $zone as $label in the Time Zone select', ({ zone, label }) => {
    renderTab({ staged: staged({ timezone: zone }) })

    expect(timeZoneSelect()).toHaveTextContent(label)
  })

  it('enables both selects', () => {
    renderTab()

    expect(logLevelSelect()).toBeEnabled()
    expect(timeZoneSelect()).toBeEnabled()
  })

  it('keeps the Secret Masking subtitle', () => {
    renderTab()

    expect(screen.getByText(MASKING_SUBTITLE)).toBeInTheDocument()
  })

  it('shows no skeleton and no read failure', () => {
    renderTab()

    expect(skeletonsIn('general-tab')).toBe(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('GeneralTab - staging', () => {
  it('choosing a level stages it through stageLogLevel', async () => {
    const user = userEvent.setup()
    const { general } = renderTab()

    await user.click(logLevelSelect())
    await user.click(screen.getByRole('option', { name: 'DEBUG' }))

    expect(general.stageLogLevel).toHaveBeenCalledTimes(1)
    expect(general.stageLogLevel).toHaveBeenCalledWith('DEBUG')
  })

  it('offers the five levels from least to most severe', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(logLevelSelect())

    const levels = screen.getAllByRole('option').map((option) => option.textContent?.trim())
    expect(levels).toEqual(['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'])
  })

  it('keeps the open level list out of page translation', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(logLevelSelect())

    expect(screen.getByRole('listbox')).toHaveAttribute('translate', 'no')
  })

  it('choosing a zone stages it through stageTimezone', async () => {
    const user = userEvent.setup()
    const { general } = renderTab()

    await user.click(timeZoneSelect())
    await user.click(screen.getByRole('option', { name: 'UTC' }))

    expect(general.stageTimezone).toHaveBeenCalledTimes(1)
    expect(general.stageTimezone).toHaveBeenCalledWith('utc')
  })

  it('choosing "Browser local" stages the local zone', async () => {
    const user = userEvent.setup()
    const { general } = renderTab({ staged: staged({ timezone: 'utc' }) })

    await user.click(timeZoneSelect())
    await user.click(screen.getByRole('option', { name: 'Browser local' }))

    expect(general.stageTimezone).toHaveBeenCalledWith('local')
  })

  it('saves nothing when a value is staged', async () => {
    const user = userEvent.setup()
    const { general } = renderTab()

    await user.click(logLevelSelect())
    await user.click(screen.getByRole('option', { name: 'ERROR' }))
    await user.click(screen.getByTestId('masking-run-output-toggle'))

    expect(general.save).not.toHaveBeenCalled()
    expect(general.cancel).not.toHaveBeenCalled()
  })
})

describe('GeneralTab - staged change', () => {
  it('enables Cancel and Save', () => {
    renderTab({ dirty: true, staged: staged({ logLevel: 'DEBUG' }) })

    expect(saveButton()).toBeEnabled()
    expect(cancelButton()).toBeEnabled()
  })

  it('shows the staged level in the Log Level select, not the level in force', () => {
    renderTab({ dirty: true, logLevel: 'INFO', staged: staged({ logLevel: 'DEBUG' }) })

    expect(logLevelSelect()).toHaveTextContent('DEBUG')
    expect(logLevelSelect()).not.toHaveTextContent('INFO')
  })

  it('shows the staged zone in the Time Zone select', () => {
    renderTab({ dirty: true, staged: staged({ timezone: 'utc' }) })

    expect(timeZoneSelect()).toHaveTextContent('UTC')
  })

  it('shows a staged-on switch checked with its "Revealing" cue', () => {
    renderTab({ dirty: true, staged: withFlags({ sharedVariables: true }) })

    expect(screen.getByTestId('masking-shared-variables-toggle')).toHaveAttribute(
      'data-state',
      'checked',
    )
    expect(screen.getByTestId('masking-shared-variables-revealing')).toHaveTextContent('Revealing')
  })

  it('drops the cue when an on flag is staged off', () => {
    const { rerender } = renderTab({ staged: withFlags({ runOutput: true }) })
    expect(screen.getByTestId('masking-run-output-revealing')).toBeInTheDocument()

    rerender(<GeneralTab general={makeGeneral({ dirty: true, staged: withFlags({}) })} />)

    expect(screen.queryByTestId('masking-run-output-revealing')).not.toBeInTheDocument()
    expect(screen.getByTestId('masking-run-output-toggle')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
  })

  it('Save calls save', async () => {
    const user = userEvent.setup()
    const { general } = renderTab({ dirty: true, staged: staged({ logLevel: 'DEBUG' }) })

    await user.click(saveButton())

    expect(general.save).toHaveBeenCalledTimes(1)
    expect(general.cancel).not.toHaveBeenCalled()
  })

  it('Cancel calls cancel', async () => {
    const user = userEvent.setup()
    const { general } = renderTab({ dirty: true, staged: staged({ logLevel: 'DEBUG' }) })

    await user.click(cancelButton())

    expect(general.cancel).toHaveBeenCalledTimes(1)
    expect(general.save).not.toHaveBeenCalled()
  })
})

describe('GeneralTab - saving', () => {
  const SAVING = { dirty: true, saving: true, staged: staged({ logLevel: 'DEBUG' }) }

  it('shows Save busy and disables Cancel and Save', () => {
    renderTab(SAVING)

    expect(saveButton()).toHaveAttribute('aria-busy', 'true')
    expect(saveButton()).toBeDisabled()
    expect(cancelButton()).toBeDisabled()
  })

  it('disables the Log Level and Time Zone selects', () => {
    renderTab(SAVING)

    expect(logLevelSelect()).toBeDisabled()
    expect(timeZoneSelect()).toBeDisabled()
  })

  it('keeps the staged values on screen', () => {
    renderTab(SAVING)

    expect(logLevelSelect()).toHaveTextContent('DEBUG')
  })

  it('does not call save again when the busy Save is clicked', async () => {
    const user = userEvent.setup()
    const { general } = renderTab(SAVING)

    await user.click(saveButton())

    expect(general.save).not.toHaveBeenCalled()
  })
})

describe('GeneralTab - after a Save or a Cancel', () => {
  it('fades both buttons again and shows the saved level once a Save succeeded', () => {
    const { rerender } = renderTab({
      dirty: true,
      saving: true,
      staged: staged({ logLevel: 'DEBUG' }),
    })

    rerender(
      <GeneralTab general={makeGeneral({ logLevel: 'DEBUG', staged: staged({ logLevel: 'DEBUG' }) })} />,
    )

    expect(saveButton()).toBeDisabled()
    expect(saveButton()).not.toHaveAttribute('aria-busy')
    expect(cancelButton()).toBeDisabled()
    expect(logLevelSelect()).toHaveTextContent('DEBUG')
    expect(logLevelSelect()).toBeEnabled()
  })

  it('keeps the staged values and both buttons enabled once a Save failed', () => {
    const failedSave = {
      dirty: true,
      staged: { logLevel: 'DEBUG', timezone: 'utc', masking: { ...MASKED, runOutput: true } },
    } as const
    const { rerender } = renderTab({ ...failedSave, saving: true })

    rerender(<GeneralTab general={makeGeneral(failedSave)} />)

    expect(saveButton()).toBeEnabled()
    expect(saveButton()).not.toHaveAttribute('aria-busy')
    expect(cancelButton()).toBeEnabled()
    expect(logLevelSelect()).toHaveTextContent('DEBUG')
    expect(timeZoneSelect()).toHaveTextContent('UTC')
    expect(screen.getByTestId('masking-run-output-toggle')).toHaveAttribute('data-state', 'checked')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the saved values and faded buttons again after Cancel', async () => {
    const { rerender } = renderTab({
      dirty: true,
      staged: { logLevel: 'FATAL', timezone: 'utc', masking: { ...MASKED, testVariables: true } },
    })

    // The select settles its shown value a tick after its value prop changes.
    await act(async () => {
      rerender(<GeneralTab general={makeGeneral()} />)
    })

    expect(saveButton()).toBeDisabled()
    expect(cancelButton()).toBeDisabled()
    expect(logLevelSelect()).toHaveTextContent('INFO')
    expect(timeZoneSelect()).toHaveTextContent('Browser local')
    expect(screen.getByTestId('masking-test-variables-toggle')).toHaveAttribute(
      'data-state',
      'unchecked',
    )
    expect(screen.queryByTestId('masking-test-variables-revealing')).not.toBeInTheDocument()
  })
})

describe('GeneralTab - no toast of its own', () => {
  it('shows no toast when staging, saving or canceling', async () => {
    const user = userEvent.setup()
    const { general } = renderTab({ dirty: true, staged: staged({ logLevel: 'DEBUG' }) })

    await user.click(logLevelSelect())
    await user.click(screen.getByRole('option', { name: 'ERROR' }))
    await user.click(timeZoneSelect())
    await user.click(screen.getByRole('option', { name: 'UTC' }))
    await user.click(screen.getByTestId('masking-run-output-toggle'))
    await user.click(saveButton())
    await user.click(cancelButton())

    expect(general.save).toHaveBeenCalledTimes(1)
    expect(general.cancel).toHaveBeenCalledTimes(1)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('GeneralTab - Secret Masking section', () => {
  it('renders the "Secret Masking" section heading', () => {
    renderTab()
    expect(screen.getByText('Secret Masking')).toBeInTheDocument()
  })

  it('renders the four per-surface reveal switches', () => {
    renderTab()
    expect(screen.getByTestId('masking-run-output-toggle')).toHaveAttribute('role', 'switch')
    expect(screen.getByTestId('masking-test-variables-toggle')).toHaveAttribute('role', 'switch')
    expect(screen.getByTestId('masking-shared-variables-toggle')).toHaveAttribute('role', 'switch')
    expect(screen.getByTestId('masking-credential-inputs-toggle')).toHaveAttribute('role', 'switch')
  })

  it('renders every switch off (masked) by default', () => {
    renderTab()
    expect(screen.getByTestId('masking-run-output-toggle')).toHaveAttribute('data-state', 'unchecked')
    expect(screen.getByTestId('masking-test-variables-toggle')).toHaveAttribute('data-state', 'unchecked')
    expect(screen.getByTestId('masking-shared-variables-toggle')).toHaveAttribute('data-state', 'unchecked')
    expect(screen.getByTestId('masking-credential-inputs-toggle')).toHaveAttribute('data-state', 'unchecked')
  })

  it('stages the credential-inputs surface on', async () => {
    const user = userEvent.setup()
    const { general } = renderTab()
    await user.click(screen.getByTestId('masking-credential-inputs-toggle'))
    expect(general.stageMasking).toHaveBeenCalledWith('credentialInputs', true)
  })

  it('reflects an on flag as a checked switch', () => {
    renderTab({ staged: withFlags({ runOutput: true }) })
    expect(screen.getByTestId('masking-run-output-toggle')).toHaveAttribute('data-state', 'checked')
  })

  it('calls stageMasking turning a surface on', async () => {
    const user = userEvent.setup()
    const { general } = renderTab()
    await user.click(screen.getByTestId('masking-run-output-toggle'))
    expect(general.stageMasking).toHaveBeenCalledWith('runOutput', true)
  })

  it('calls stageMasking turning a surface back off', async () => {
    const user = userEvent.setup()
    const { general } = renderTab({ staged: withFlags({ sharedVariables: true }) })
    await user.click(screen.getByTestId('masking-shared-variables-toggle'))
    expect(general.stageMasking).toHaveBeenCalledWith('sharedVariables', false)
  })

  it('shows an amber "Revealing" cue on a surface that is on', () => {
    renderTab({ staged: withFlags({ testVariables: true }) })
    expect(screen.getByTestId('masking-test-variables-revealing')).toBeInTheDocument()
  })

  it('shows no "Revealing" cue on a masked surface', () => {
    renderTab()
    expect(screen.queryByTestId('masking-run-output-revealing')).not.toBeInTheDocument()
    expect(screen.queryByTestId('masking-test-variables-revealing')).not.toBeInTheDocument()
    expect(screen.queryByTestId('masking-shared-variables-revealing')).not.toBeInTheDocument()
  })

  it('renders the export / encryption carve-out footnote', () => {
    renderTab()
    expect(screen.getByTestId('masking-carveout-footnote')).toBeInTheDocument()
  })
})

describe('GeneralTab - Secret Masking rows through the shared row group (NET-11)', () => {
  it('renders the four switches in order, each named after its row label', () => {
    renderTab()

    const section = screen.getByTestId('secret-masking-section')
    const names = within(section)
      .getAllByRole('switch')
      .map((s) => s.getAttribute('aria-label'))
    expect(names).toEqual(MASKING_ROWS.map((row) => row.title))
  })

  it.each(MASKING_ROWS)('links the $title help line to its switch', ({ title, help }) => {
    renderTab()

    expect(screen.getByRole('switch', { name: title })).toHaveAccessibleDescription(help)
  })

  it.each(MASKING_ROWS)('centers the $title switch vertically in its row', ({ testKey, title }) => {
    renderTab()

    const row = screen.getByTestId(`masking-${testKey}-row`)
    expect(row).toHaveClass('items-center')
    expect(row).not.toHaveClass('items-start')
    expect(within(row).getByText(title)).toBeInTheDocument()
    expect(within(row).getByTestId(`masking-${testKey}-toggle`)).toBeInTheDocument()
  })

  it('shows the "Revealing" adornment inside the row that is on', () => {
    renderTab({ staged: withFlags({ testVariables: true }) })

    const row = screen.getByTestId('masking-test-variables-row')
    expect(within(row).getByTestId('masking-test-variables-revealing')).toHaveTextContent(
      'Revealing',
    )
    expect(
      within(screen.getByTestId('masking-run-output-row')).queryByText('Revealing'),
    ).not.toBeInTheDocument()
  })

  it('renders the carve-out footnote text below the rows', () => {
    renderTab()

    const footnote = screen.getByTestId('masking-carveout-footnote')
    expect(footnote).toHaveTextContent(
      'Exports (per-export choice) and encryption at rest are governed separately and are unaffected.',
    )
    const lastRow = screen.getByTestId('masking-credential-inputs-row')
    expect(lastRow.compareDocumentPosition(footnote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('disables every switch while saving', () => {
    renderTab({ dirty: true, saving: true, staged: withFlags({ runOutput: true }) })

    for (const row of MASKING_ROWS) {
      expect(screen.getByRole('switch', { name: row.title })).toBeDisabled()
    }
  })

  it('keeps every switch enabled once loaded', () => {
    renderTab()

    for (const row of MASKING_ROWS) {
      expect(screen.getByRole('switch', { name: row.title })).toBeEnabled()
    }
  })
})
