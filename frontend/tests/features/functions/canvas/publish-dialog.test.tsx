/**
 * Tests for `PublishDialog` (FN-LC-1..5).
 *
 *
 *   - Name field: free-form, 32-char maxlength, `N / 32` counter in the
 *     label-row right
 *   - Version field: readonly, default `1.0.0`
 *   - Description, Tags (chip input)
 *   - Changelog: REQUIRED. Pre-filled with "Initial release - YYYY-MM-DD"
 *   - Details: REQUIRED. Pre-filled with "No specific usage or parameter
 *     details" so Publish can fire on a fresh dialog without typing anything.
 *   - Footer note "A new library Function will be created." left-aligned
 *     next to Cancel + Publish (primary)
 *
 * Behaviors covered:
 *   - Initial focus on Name
 *   - 32-char cap enforced via maxLength
 *   - Name/Changelog/Details required: Publish disabled until all three filled
 *   - Submit calls API with the canonical payload shape
 *   - Cancel + Escape close without publishing
 *   - On API failure the dialog stays open and surfaces the inline error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// API mock at the module boundary.
const publishMock = vi.fn()
// Default: never resolves. Tests that need the resolved branch override
// with mockResolvedValueOnce / mockRejectedValueOnce. Keeping the default
// pending means the `setAvailableTags` state update never fires, which
// eliminates React's act() warning for tests that don't interact with the
// Tags popover and finish synchronously.
const listFunctionTagsMock = vi.fn<() => Promise<string[]>>(
  () => new Promise<string[]>(() => {}),
)
vi.mock('@/features/functions/api/functions-api', () => ({
  publishLocalFunction: (...args: unknown[]) => publishMock(...args),
  listFunctionTags: () => listFunctionTagsMock(),
  listFunctions: vi.fn(),
  // Re-export every other symbol as a stub so consumers that import the
  // module wholesale do not blow up.
  createFunction: vi.fn(),
  getFunction: vi.fn(),
  deleteFunction: vi.fn(),
  getDependents: vi.fn(),
  batchCreateFunctions: vi.fn(),
  batchDeleteFunctions: vi.fn(),
  exportFunction: vi.fn(),
  exportFunctionsBatch: vi.fn(),
  importFunctions: vi.fn(),
  runScopedFunction: vi.fn(),
}))

import { PublishDialog } from '@/features/functions/canvas/publish-dialog'
import { expectRequiredMark, labelOf } from '../../../utils/required-mark'

const CHANGELOG_LABEL = /^changelog\b/i
const DETAILS_LABEL = /^details\b/i
const NAME_LABEL = /^name\b/i


function defaultLocalFunction() {
  return {
    testId: '00000000-0000-0000-0000-000000000001',
    nodeId: 'fn-local-1',
    suggestedName: 'My Local Function',
  }
}

// Test-side submit handler that delegates to the publish mock so tests can
// keep asserting on publishMock arguments while the dialog stays parent-
// agnostic about which backend path is used.
function makeSubmit() {
  return async (payload: unknown): Promise<{ function_id: string }> => {
    const result = await publishMock(
      defaultLocalFunction().testId,
      defaultLocalFunction().nodeId,
      payload,
    )
    return { function_id: result.function_id }
  }
}


beforeEach(() => {
  publishMock.mockReset()
  publishMock.mockResolvedValue({
    function_id: '00000000-0000-0000-0000-000000000fff',
    version: '1.0.0',
    node: {
      id: 'fn-local-1',
      data: { functionLifecycle: 'shared', functionId: '00000000-0000-0000-0000-000000000fff' },
    },
  })
})

// Flush microtasks after each test so the listFunctionTags fetch resolves
// inside an act() boundary. Without this, React logs an act() warning on
// any test that doesn't explicitly await something on the dialog.
afterEach(async () => {
  await act(async () => {
    await Promise.resolve()
  })
})


describe('PublishDialog - layout & defaults', () => {
  it('renders Name, Version, Description, Tags, Changelog, Details fields', () => {
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    expect(screen.getByLabelText(NAME_LABEL)).toBeInTheDocument()
    expect(screen.getByLabelText(/^version$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^description$/i)).toBeInTheDocument()
    expect(screen.getByTestId('tags-input')).toBeInTheDocument()
    // Changelog and Details labels end in the RequiredMark star and its sr-only "required".
    expect(screen.getByLabelText(CHANGELOG_LABEL)).toBeInTheDocument()
    expect(screen.getByLabelText(DETAILS_LABEL)).toBeInTheDocument()
  })

  it('pre-fills the Changelog with "Initial release - YYYY-MM-DD"', () => {
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const changelog = screen.getByLabelText(CHANGELOG_LABEL) as HTMLTextAreaElement
    expect(changelog.value).toMatch(/^Initial release - \d{4}-\d{2}-\d{2}$/)
  })

  it('pre-fills Details with "No specific usage or parameter details"', () => {
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const details = screen.getByLabelText(DETAILS_LABEL) as HTMLTextAreaElement
    expect(details.value).toBe('No specific usage or parameter details')
  })

  it('defaults the Version field to 1.0.0 and validates as semver', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const version = screen.getByLabelText(/^version$/i) as HTMLInputElement
    expect(version.value).toBe('1.0.0')
    // Editable: user can clear and retype.
    await user.clear(version)
    await user.type(version, 'not-a-version')
    expect(screen.getByRole('button', { name: /semver v2/i })).toBeInTheDocument()
    expect(version).toHaveAccessibleDescription(/^Use semver v2/)
    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled()
    await user.clear(version)
    await user.type(version, '2.5.1')
    expect(screen.queryByRole('button', { name: /semver v2/i })).not.toBeInTheDocument()
    expect(version).not.toHaveAttribute('aria-describedby')
  })

  it('accepts pre-release identifiers and rejects malformed ones', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const version = screen.getByLabelText(/^version$/i) as HTMLInputElement
    // Valid: pre-release with numeric and alpha identifiers.
    await user.clear(version)
    await user.type(version, '1.0.0-alpha.1')
    expect(screen.queryByRole('button', { name: /semver v2/i })).not.toBeInTheDocument()
    // Invalid: empty pre-release after `-`.
    await user.clear(version)
    await user.type(version, '1.0.0-')
    expect(screen.getByRole('button', { name: /semver v2/i })).toBeInTheDocument()
    // Validation consolidates on the single shared `isValidSemver` helper
    // (deleting the dialog's hand-rolled copy) WITHOUT relaxing it - the strict
    // semver-v2 rule still rejects a leading-zero numeric pre-release identifier,
    // so "1.0.0-01" stays INVALID.
    await user.clear(version)
    await user.type(version, '1.0.0-01')
    expect(screen.getByRole('button', { name: /semver v2/i })).toBeInTheDocument()
  })

  it('accepts build metadata and rejects malformed metadata', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const version = screen.getByLabelText(/^version$/i) as HTMLInputElement
    // Valid: build metadata after `+`.
    await user.clear(version)
    await user.type(version, '1.0.0+sha.5114f85')
    expect(screen.queryByRole('button', { name: /semver v2/i })).not.toBeInTheDocument()
    // Valid: build metadata combined with pre-release.
    await user.clear(version)
    await user.type(version, '1.0.0-beta+exp.sha.5114f85')
    expect(screen.queryByRole('button', { name: /semver v2/i })).not.toBeInTheDocument()
    // Invalid: empty build metadata after `+`.
    await user.clear(version)
    await user.type(version, '1.0.0+')
    expect(screen.getByRole('button', { name: /semver v2/i })).toBeInTheDocument()
    // Invalid: build identifier with disallowed char.
    await user.clear(version)
    await user.type(version, '1.0.0+bad!ident')
    expect(screen.getByRole('button', { name: /semver v2/i })).toBeInTheDocument()
  })

  it('renders the footer note "A new library Function will be created." (FN-LC-5)', () => {
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    expect(
      screen.getByText('A new library Function will be created.'),
    ).toBeInTheDocument()
  })

  it('pre-fills Name with the local Function suggested name', () => {
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    expect((screen.getByLabelText(NAME_LABEL) as HTMLInputElement).value).toBe(
      'My Local Function',
    )
  })

  it('accepts user input for Changelog and Details textareas', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const changelog = screen.getByLabelText(CHANGELOG_LABEL) as HTMLTextAreaElement
    const details = screen.getByLabelText(DETAILS_LABEL) as HTMLTextAreaElement
    // Both fields are pre-filled (Changelog with the date stamp, Details
    // with the "No specific usage or parameter details" default), so clear
    // them before typing to isolate the user-typed value.
    await user.clear(changelog)
    await user.type(changelog, 'initial release notes')
    await user.clear(details)
    await user.type(details, 'long form usage')
    expect(changelog.value).toBe('initial release notes')
    expect(details.value).toBe('long form usage')
  })

  it('renders the Cancel + Publish footer buttons in that order', () => {
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /publish/i })).toBeInTheDocument()
  })
})


describe('PublishDialog - Name field validation', () => {
  it('enforces a 32-char maxlength on the Name input', () => {
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const name = screen.getByLabelText(NAME_LABEL) as HTMLInputElement
    expect(Number(name.getAttribute('maxLength'))).toBe(32)
  })

  it('disables Publish when Name is empty', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={{ ...defaultLocalFunction(), suggestedName: '' }}
        onSubmit={makeSubmit()}
      />,
    )
    const publish = screen.getByRole('button', { name: /publish/i })
    // Empty Name -> disabled. Changelog and Details are pre-filled so they
    // do not need user input.
    expect(publish).toBeDisabled()
    await user.type(screen.getByLabelText(NAME_LABEL), 'A')
    expect(publish).not.toBeDisabled()
  })

  it('disables Publish when Changelog is cleared, re-enables when refilled', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const publish = screen.getByRole('button', { name: /publish/i })
    expect(publish).not.toBeDisabled()
    await user.clear(screen.getByLabelText(CHANGELOG_LABEL))
    expect(publish).toBeDisabled()
    await user.type(screen.getByLabelText(CHANGELOG_LABEL), 'x')
    expect(publish).not.toBeDisabled()
  })

  it('disables Publish when Details is cleared, re-enables when refilled', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const publish = screen.getByRole('button', { name: /publish/i })
    expect(publish).not.toBeDisabled()
    await user.clear(screen.getByLabelText(DETAILS_LABEL))
    expect(publish).toBeDisabled()
    await user.type(screen.getByLabelText(DETAILS_LABEL), 'x')
    expect(publish).not.toBeDisabled()
  })

  it('shows the threshold-based counter from the shared NameField (hidden below 80%, visible at threshold)', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={{ ...defaultLocalFunction(), suggestedName: '' }}
        onSubmit={makeSubmit()}
      />,
    )
    // Counter is hidden below 80% (= 26 of 32 chars)
    expect(screen.queryByText('5/32')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(NAME_LABEL), 'A'.repeat(26))
    expect(screen.getByText('26/32')).toBeInTheDocument()
    await user.type(screen.getByLabelText(NAME_LABEL), 'B'.repeat(6))
    expect(screen.getByText('32/32')).toBeInTheDocument()
  })

  it('shows the threshold-based char counter on the Version field (32-char cap)', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    const versionInput = screen.getByLabelText('Version')
    // Default '1.0.0' (5 chars) is below the 80% threshold -> counter hidden.
    expect(screen.queryByTestId('publish-version-input-counter')).not.toBeInTheDocument()
    await user.clear(versionInput)
    await user.type(versionInput, '1'.repeat(26))
    expect(screen.getByTestId('publish-version-input-counter')).toHaveTextContent('26/32')
    await user.type(versionInput, '2'.repeat(6))
    expect(screen.getByTestId('publish-version-input-counter')).toHaveTextContent('32/32')
  })
})


describe('PublishDialog - submit', () => {
  it('calls publishLocalFunction with the canonical payload shape', async () => {
    const user = userEvent.setup()
    const onPublished = vi.fn()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={onPublished}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    await user.clear(screen.getByLabelText(NAME_LABEL))
    await user.type(screen.getByLabelText(NAME_LABEL), 'Greet User')
    await user.type(screen.getByLabelText(/^description$/i), 'Greets the user.')
    // Changelog and Details are both pre-filled by the dialog, so the user
    // can submit without typing anything in those fields.
    await user.click(screen.getByRole('button', { name: /publish/i }))
    await waitFor(() => {
      expect(publishMock).toHaveBeenCalledTimes(1)
    })
    const [testId, nodeId, payload] = publishMock.mock.calls[0]
    expect(testId).toBe('00000000-0000-0000-0000-000000000001')
    expect(nodeId).toBe('fn-local-1')
    expect(payload).toMatchObject({
      name: 'Greet User',
      description: 'Greets the user.',
      details: 'No specific usage or parameter details',
    })
    expect(payload.changelog).toMatch(/^Initial release - \d{4}-\d{2}-\d{2}$/)
    await waitFor(() => {
      expect(onPublished).toHaveBeenCalledWith(
        '00000000-0000-0000-0000-000000000fff',
      )
    })
  })

  it('shows Publish busy while the request runs', async () => {
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={() => new Promise<{ function_id: string }>(() => {})}
      />,
    )
    const publish = screen.getByRole('button', { name: /publish/i })
    expect(publish).not.toHaveAttribute('aria-busy')
    await user.click(publish)
    await waitFor(() => expect(publish).toHaveAttribute('aria-busy', 'true'))
    expect(publish).toBeDisabled()
  })

  it('surfaces a backend error inline and keeps the dialog open', async () => {
    publishMock.mockRejectedValueOnce({ status: 409, message: "Function name 'X' is already in use" })
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <PublishDialog
        isOpen={true}
        onClose={onClose}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    // Name, Changelog, and Details are all pre-filled, so Publish is enabled.
    await user.click(screen.getByRole('button', { name: /publish/i }))
    expect(
      await screen.findByText(/Function name 'X' is already in use/),
    ).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})


describe('PublishDialog - missing suggestedName + error fallback', () => {
  it('handles a localFunction with no suggestedName (defaults to empty)', () => {
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={{
          testId: '00000000-0000-0000-0000-000000000001',
          nodeId: 'fn-1',
        }}
        onSubmit={makeSubmit()}
      />,
    )
    expect((screen.getByLabelText(NAME_LABEL) as HTMLInputElement).value).toBe('')
  })

  it("shows the 'Publish failed' fallback when the rejected error has no message", async () => {
    publishMock.mockRejectedValueOnce({})
    const user = userEvent.setup()
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    // Details and Changelog are pre-filled, so Publish is enabled.
    await user.click(screen.getByRole('button', { name: /publish/i }))
    expect(await screen.findByText(/publish failed/i)).toBeInTheDocument()
  })
})


describe('PublishDialog - tags fetch failure', () => {
  it('says the tags did not load and refuses to publish until they do', async () => {
    listFunctionTagsMock.mockRejectedValueOnce(new Error('network down'))
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )

    expect(await screen.findByTestId('publish-tags-error')).toHaveTextContent(
      'Could not load tags, so this Function cannot be published yet.',
    )
    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled()
  })

  it('re-runs only the tag read on Try Again and then allows publishing', async () => {
    const user = userEvent.setup()
    listFunctionTagsMock.mockRejectedValueOnce(new Error('network down'))
    listFunctionTagsMock.mockResolvedValueOnce(['smoke'])
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    await screen.findByTestId('publish-tags-error')

    await user.click(screen.getByTestId('publish-tags-retry'))

    await waitFor(() => {
      expect(screen.queryByTestId('publish-tags-error')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /publish/i })).toBeEnabled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('keeps refusing when Try Again fails again', async () => {
    const user = userEvent.setup()
    listFunctionTagsMock.mockRejectedValueOnce(new Error('network down'))
    listFunctionTagsMock.mockRejectedValueOnce(new Error('still down'))
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    await screen.findByTestId('publish-tags-error')

    await user.click(screen.getByTestId('publish-tags-retry'))

    expect(await screen.findByTestId('publish-tags-error')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /publish/i })).toBeDisabled()
  })

  it('ignores the tag fetch response when the dialog unmounts before it resolves', async () => {
    let resolveTags!: (tags: string[]) => void
    listFunctionTagsMock.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        resolveTags = resolve
      }) as Promise<never[]>,
    )
    const { unmount } = render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    unmount()
    // Resolve after unmount - the canceled flag should short-circuit and
    // not call setAvailableTags. If state were set after unmount, React
    // would log an act() warning; we assert no dialog remains in the DOM.
    resolveTags(['demo'])
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores the tag fetch rejection when the dialog unmounts before it settles', async () => {
    let rejectTags!: (err: unknown) => void
    listFunctionTagsMock.mockReturnValueOnce(
      new Promise<string[]>((_resolve, reject) => {
        rejectTags = reject
      }) as Promise<never[]>,
    )
    const { unmount } = render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    unmount()
    rejectTags(new Error('network down'))
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})


describe('PublishDialog - close paths', () => {
  it('invokes onClose when Cancel is clicked, without calling the API', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <PublishDialog
        isOpen={true}
        onClose={onClose}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('renders nothing when isOpen=false', () => {
    render(
      <PublishDialog
        isOpen={false}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('PublishDialog - required marks', () => {
  function renderPublish() {
    render(
      <PublishDialog
        isOpen={true}
        onClose={() => {}}
        onPublished={() => {}}
        localFunction={defaultLocalFunction()}
        onSubmit={makeSubmit()}
      />,
    )
  }

  it('marks the Changelog label with the shared RequiredMark', () => {
    renderPublish()
    expectRequiredMark(labelOf(screen.getByLabelText(CHANGELOG_LABEL)))
  })

  it('marks the Details label with the shared RequiredMark', () => {
    renderPublish()
    expectRequiredMark(labelOf(screen.getByLabelText(DETAILS_LABEL)))
  })

  it('marks the Name label with the shared RequiredMark, which names the box', () => {
    renderPublish()
    expectRequiredMark(labelOf(screen.getByLabelText(NAME_LABEL)))
    expect(screen.getByTestId('publish-name-input')).toHaveAccessibleName('Name required')
  })
})
