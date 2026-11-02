/**
 * Tests for `PublishEditModeDialog` (REQ-3.1.2.2).
 *
 * The edit-mode publish dialog collects the publish metadata. It does NOT
 * publish directly: clicking Publish hands the collected payload to
 * `onRequestOutcome`, and the parent opens the three-option outcome dialog.
 *
 *   - The source library entry is LOCKED (no picker; shown as a context chip).
 *   - The Version field is the shared VersionDropdown in bump mode.
 *   - Changelog + Details are MANDATORY.
 *   - The bump target re-syncs to the lowest ALLOWED level once the
 *     allowed-bumps result resolves, and Publish is disabled for a disallowed
 *     target (no server-side rejection round-trip).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Hook mock so the dialog gets deterministic allowed/blocked maps without IO.
const useAllowedBumpsMock = vi.fn()
vi.mock('@/features/functions/hooks/use-allowed-bumps', () => ({
  useAllowedBumps: (...args: unknown[]) => useAllowedBumpsMock(...args),
}))

// Version-list mock so the dialog's fresh-on-open fetch makes no real IO.
const useFunctionVersionsMock = vi.fn()
vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: (...args: unknown[]) => useFunctionVersionsMock(...args),
}))

import { PublishEditModeDialog } from '@/features/functions/canvas/publish-edit-mode-dialog'
import { expectRequiredMark, labelOf } from '../../../utils/required-mark'

type Bumps = {
  allowed: Array<'patch' | 'minor' | 'major'>
  blocked: Record<string, string>
  isLoading: boolean
  failed: boolean
  retry: () => void
}

function defaultInstance() {
  return {
    testId: '00000000-0000-0000-0000-000000000001',
    nodeId: 'fn-edit-1',
    functionId: '00000000-0000-0000-0000-0000000000aa',
    functionName: 'Greet User',
    sourceVersion: '1.0.0',
    draft: {
      name: 'Greet User',
      description: 'Existing description',
      tags: ['demo'],
      inputs: [{ name: 'x', type: 'string', required: true }],
      outputs: [{ name: 'result', type: 'string' }],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
    },
    sourceMetadata: {
      description: 'Existing description',
      tags: ['demo'],
      details: 'Existing details',
    },
  }
}

function renderDialog(
  overrides: Partial<Parameters<typeof PublishEditModeDialog>[0]> = {},
) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    instance: defaultInstance(),
    onRequestOutcome: vi.fn(),
    ...overrides,
  }
  render(<PublishEditModeDialog {...props} />)
  return props
}

beforeEach(() => {
  useAllowedBumpsMock.mockReset()
  useAllowedBumpsMock.mockReturnValue({
    allowed: ['patch', 'minor', 'major'],
    blocked: {},
    isLoading: false,
    failed: false,
    retry: vi.fn(),
  })
  useFunctionVersionsMock.mockReset()
  useFunctionVersionsMock.mockReturnValue({
    versions: [],
    latest: '1.0.0',
    isLoading: false,
    failed: false,
    retry: vi.fn(),
  })
})


describe('PublishEditModeDialog - existing-version-aware suggestion', () => {
  it('suggests the next available version, skipping one published in another tab', () => {
    useAllowedBumpsMock.mockReturnValue({
      allowed: ['major'],
      blocked: { patch: 'blocked', minor: 'blocked' },
      isLoading: false,
      failed: false,
      retry: vi.fn(),
    })
    // Another tab already published 2.0.0; the naive major bump (1.0.0 -> 2.0.0)
    // must skip to 3.0.0 instead of colliding at publish.
    useFunctionVersionsMock.mockReturnValue({
      versions: [{ version: '1.0.0' }, { version: '2.0.0' }],
      latest: '2.0.0',
      isLoading: false,
      failed: false,
      retry: vi.fn(),
    })
    renderDialog()
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(within(trigger).getByText(/3\.0\.0/)).toBeInTheDocument()
  })
})


describe('PublishEditModeDialog - structure', () => {
  it('renders a locked source context chip (no picker)', () => {
    renderDialog()
    const chip = screen.getByTestId('publish-edit-mode-source-chip')
    expect(within(chip).getByText(/Greet User/)).toBeInTheDocument()
    expect(within(chip).getByText(/v1\.0\.0/)).toBeInTheDocument()
    expect(screen.queryByTestId('library-function-picker')).toBeNull()
  })

  it('renders the smart Version dropdown', () => {
    renderDialog()
    expect(screen.getByTestId('version-dropdown-trigger')).toBeInTheDocument()
  })

  it('pre-fills Description / Tags / Details from the source version metadata', () => {
    renderDialog()
    expect(
      (screen.getByTestId('publish-edit-mode-description-input') as HTMLTextAreaElement).value,
    ).toBe('Existing description')
    expect(screen.getByText('demo')).toBeInTheDocument()
    expect(
      (screen.getByTestId('publish-edit-mode-details-input') as HTMLTextAreaElement).value,
    ).toBe('Existing details')
  })

  it('renders Cancel + Publish footer (no extra buttons)', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /drop changes/i })).toBeNull()
  })
})


describe('PublishEditModeDialog - mandatory changelog + details', () => {
  it('disables Publish until Changelog is non-empty', async () => {
    const user = userEvent.setup()
    renderDialog()
    const publish = screen.getByRole('button', { name: /^publish$/i })
    expect(publish).toBeDisabled()
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'Patch description')
    expect(publish).not.toBeDisabled()
  })

  it('Publish has visually-disabled styling (opacity-50 + cursor-not-allowed) when changelog empty', () => {
    renderDialog()
    const publish = screen.getByRole('button', { name: /^publish$/i })
    expect(publish.className).toMatch(/opacity-50/)
    expect(publish.className).toMatch(/cursor-not-allowed/)
  })

  it('Changelog label carries a red asterisk', () => {
    renderDialog()
    const label = screen.getByTestId('publish-edit-mode-changelog-label')
    expect(within(label).getByText('*')).toBeInTheDocument()
  })

  it('marks the Changelog label with the shared RequiredMark', () => {
    renderDialog()
    expectRequiredMark(screen.getByTestId('publish-edit-mode-changelog-label'))
  })

  it('marks the Details label with the shared RequiredMark', () => {
    renderDialog()
    expectRequiredMark(labelOf(screen.getByTestId('publish-edit-mode-details-input')))
  })

  it('rejects whitespace-only changelog (Publish stays disabled)', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), '   ')
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled()
  })

  it('keeps Publish disabled when Details is cleared even with a changelog', async () => {
    const user = userEvent.setup()
    renderDialog()
    const details = screen.getByTestId('publish-edit-mode-details-input') as HTMLTextAreaElement
    await user.clear(details)
    expect(details).toHaveAttribute('aria-invalid', 'true')
    expect(details.className).toMatch(/border-destructive/)
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'Has changelog')
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled()
  })

  it('editing Description updates its controlled value', async () => {
    const user = userEvent.setup()
    renderDialog()
    const desc = screen.getByTestId('publish-edit-mode-description-input') as HTMLTextAreaElement
    await user.clear(desc)
    await user.type(desc, 'New desc')
    expect(desc.value).toBe('New desc')
  })
})


describe('PublishEditModeDialog - request outcome', () => {
  it('hands the collected payload to onRequestOutcome on Publish click (no direct publish)', async () => {
    const user = userEvent.setup()
    const onRequestOutcome = vi.fn()
    renderDialog({ onRequestOutcome })
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'Update wording')
    await user.click(screen.getByRole('button', { name: /^publish$/i }))
    expect(onRequestOutcome).toHaveBeenCalledTimes(1)
    const payload = onRequestOutcome.mock.calls[0][0]
    expect(payload).toMatchObject({ targetVersion: '1.0.1', changelog: 'Update wording' })
    expect(payload).toHaveProperty('description')
    expect(payload).toHaveProperty('tags')
    expect(payload).toHaveProperty('details')
  })
})


describe('PublishEditModeDialog - bumps integration', () => {
  it('passes the draft + sourceVersion to useAllowedBumps', () => {
    const inst = defaultInstance()
    renderDialog({ instance: inst })
    expect(useAllowedBumpsMock).toHaveBeenCalled()
    const args = useAllowedBumpsMock.mock.calls[0]
    expect(args[0]).toBe(inst.functionId)
    expect(args[1]).toBe('1.0.0')
    expect(args[2]).toMatchObject({ name: 'Greet User' })
  })

  it('forwards allowedBumps to the VersionDropdown (MAJOR-only trigger)', () => {
    useAllowedBumpsMock.mockReturnValue({
      allowed: ['major'],
      blocked: { patch: 'P', minor: 'M' },
      isLoading: false,
      failed: false,
      retry: vi.fn(),
    })
    renderDialog()
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(within(trigger).getByText(/major/i)).toBeInTheDocument()
  })

  it('falls back to the PATCH bump target when no bump level is allowed', () => {
    useAllowedBumpsMock.mockReturnValue({
      allowed: [],
      blocked: { patch: 'P', minor: 'M', major: 'X' },
      isLoading: false,
      failed: false,
      retry: vi.fn(),
    })
    renderDialog()
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(within(trigger).getByText(/1\.0\.1/)).toBeInTheDocument()
  })
})


describe('PublishEditModeDialog - bump-target re-sync + gating', () => {
  it('re-syncs the bump target to the lowest allowed level once bumps resolve', async () => {
    let bumps: Bumps = {
      allowed: [],
      blocked: { patch: 'blocked', minor: 'blocked' },
      isLoading: true,
      failed: false,
      retry: vi.fn(),
    }
    useAllowedBumpsMock.mockImplementation(() => bumps)
    const { rerender } = render(
      <PublishEditModeDialog
        isOpen
        onClose={() => {}}
        instance={defaultInstance()}
        onRequestOutcome={() => {}}
      />,
    )
    // While loading, the dialog shows the provisional PATCH target.
    expect(screen.getByTestId('version-dropdown-trigger')).toHaveTextContent('1.0.1')

    bumps = {
      allowed: ['major'],
      blocked: { patch: 'blocked', minor: 'blocked' },
      isLoading: false,
      failed: false,
      retry: vi.fn(),
    }
    rerender(
      <PublishEditModeDialog
        isOpen
        onClose={() => {}}
        instance={defaultInstance()}
        onRequestOutcome={() => {}}
      />,
    )
    await waitFor(() => {
      expect(screen.getByTestId('version-dropdown-trigger')).toHaveTextContent('2.0.0')
    })
  })

  it('disables Publish when no bump level is allowed (no server round-trip)', async () => {
    useAllowedBumpsMock.mockReturnValue({
      allowed: [],
      blocked: { patch: 'b', minor: 'b', major: 'b' },
      isLoading: false,
      failed: false,
      retry: vi.fn(),
    })
    const user = userEvent.setup()
    renderDialog()
    await user.type(screen.getByTestId('publish-edit-mode-changelog-input'), 'has changelog')
    expect(screen.getByRole('button', { name: /^publish$/i })).toBeDisabled()
  })

  it('does not yank a user-picked target when bumps refresh', async () => {
    let bumps: Bumps = {
      allowed: ['patch', 'minor', 'major'],
      blocked: {},
      isLoading: false,
      failed: false,
      retry: vi.fn(),
    }
    useAllowedBumpsMock.mockImplementation(() => bumps)
    const user = userEvent.setup()
    const { rerender } = render(
      <PublishEditModeDialog
        isOpen
        onClose={() => {}}
        instance={defaultInstance()}
        onRequestOutcome={() => {}}
      />,
    )
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    await user.click(screen.getByRole('menuitemradio', { name: /^major/i }))
    expect(screen.getByTestId('version-dropdown-trigger')).toHaveTextContent('2.0.0')

    // A refresh that still allows major must NOT snap the pick back to PATCH.
    bumps = { allowed: ['patch', 'minor', 'major'], blocked: {}, isLoading: false, failed: false, retry: vi.fn() }
    rerender(
      <PublishEditModeDialog
        isOpen
        onClose={() => {}}
        instance={defaultInstance()}
        onRequestOutcome={() => {}}
      />,
    )
    expect(screen.getByTestId('version-dropdown-trigger')).toHaveTextContent('2.0.0')
  })
})


describe('PublishEditModeDialog - cancel', () => {
  it('Cancel closes the dialog without requesting an outcome', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(props.onClose).toHaveBeenCalled()
    expect(props.onRequestOutcome).not.toHaveBeenCalled()
  })

  it('Escape (onOpenChange false) closes the dialog', async () => {
    const user = userEvent.setup()
    const props = renderDialog()
    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalled()
  })
})


describe('PublishEditModeDialog - metadata-absent fallbacks', () => {
  it('falls back to empty/default fields when sourceMetadata is absent', () => {
    const inst = { ...defaultInstance(), sourceMetadata: undefined }
    render(
      <PublishEditModeDialog
        isOpen
        onClose={() => {}}
        instance={inst as never}
        onRequestOutcome={() => {}}
      />,
    )
    expect(
      (screen.getByTestId('publish-edit-mode-description-input') as HTMLTextAreaElement).value,
    ).toBe('')
    expect(
      (screen.getByTestId('publish-edit-mode-details-input') as HTMLTextAreaElement).value,
    ).toBe('No specific usage or parameter details')
    expect(screen.queryByText('demo')).toBeNull()
  })

  it('falls back per-field when sourceMetadata fields are individually undefined', () => {
    const inst = {
      ...defaultInstance(),
      sourceMetadata: { description: undefined, tags: undefined, details: undefined },
    }
    render(
      <PublishEditModeDialog
        isOpen
        onClose={() => {}}
        instance={inst as never}
        onRequestOutcome={() => {}}
      />,
    )
    expect(
      (screen.getByTestId('publish-edit-mode-description-input') as HTMLTextAreaElement).value,
    ).toBe('')
    expect(
      (screen.getByTestId('publish-edit-mode-details-input') as HTMLTextAreaElement).value,
    ).toBe('No specific usage or parameter details')
  })
})


describe('PublishEditModeDialog - effect open-guards', () => {
  it('does not reset fields while closed, then syncs them when opened', async () => {
    const { rerender } = render(
      <PublishEditModeDialog
        isOpen={false}
        onClose={() => {}}
        instance={defaultInstance()}
        onRequestOutcome={() => {}}
      />,
    )
    expect(screen.queryByTestId('publish-edit-mode-details-input')).toBeNull()
    rerender(
      <PublishEditModeDialog
        isOpen
        onClose={() => {}}
        instance={defaultInstance()}
        onRequestOutcome={() => {}}
      />,
    )
    const details = (await screen.findByTestId(
      'publish-edit-mode-details-input',
    )) as HTMLTextAreaElement
    expect(details.value).toBe('Existing details')
    expect(
      (screen.getByTestId('publish-edit-mode-description-input') as HTMLTextAreaElement).value,
    ).toBe('Existing description')
  })
})


describe('PublishEditModeDialog - a read that failed is never a smaller answer', () => {
  it('shows no failure banner while every read answered', () => {
    renderDialog()
    expect(screen.queryByTestId('publish-edit-mode-read-error')).toBeNull()
  })

  it('names the failed version list and shuts publishing', () => {
    const retry = vi.fn()
    useFunctionVersionsMock.mockReturnValue({
      versions: [],
      latest: '',
      isLoading: false,
      failed: true,
      retry,
    })
    renderDialog()

    const banner = screen.getByTestId('publish-edit-mode-read-error')
    expect(banner).toHaveTextContent(
      'Could not load version list, so this Function cannot be published yet.',
    )
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  })

  it('names every failed read at once', () => {
    useFunctionVersionsMock.mockReturnValue({
      versions: [],
      latest: '',
      isLoading: false,
      failed: true,
      retry: vi.fn(),
    })
    useAllowedBumpsMock.mockReturnValue({
      allowed: [],
      blocked: {},
      isLoading: false,
      failed: true,
      retry: vi.fn(),
    })
    renderDialog({ sourceMetadataRead: { failed: true, retry: vi.fn() } })

    expect(screen.getByTestId('publish-edit-mode-read-error')).toHaveTextContent(
      'Could not load version list, allowed version bumps and source version details, so this Function cannot be published yet.',
    )
  })

  it('names the parent source-metadata read when only that one failed', () => {
    renderDialog({ sourceMetadataRead: { failed: true, retry: vi.fn() } })

    expect(screen.getByTestId('publish-edit-mode-read-error')).toHaveTextContent(
      'Could not load source version details, so this Function cannot be published yet.',
    )
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled()
  })

  it('Try Again runs every failed read again', async () => {
    const user = userEvent.setup()
    const retryVersions = vi.fn()
    const retryBumps = vi.fn()
    const retrySourceMetadata = vi.fn()
    useFunctionVersionsMock.mockReturnValue({
      versions: [],
      latest: '',
      isLoading: false,
      failed: true,
      retry: retryVersions,
    })
    useAllowedBumpsMock.mockReturnValue({
      allowed: [],
      blocked: {},
      isLoading: false,
      failed: true,
      retry: retryBumps,
    })
    renderDialog({ sourceMetadataRead: { failed: true, retry: retrySourceMetadata } })

    await user.click(screen.getByTestId('publish-edit-mode-read-retry'))

    expect(retryVersions).toHaveBeenCalledTimes(1)
    expect(retryBumps).toHaveBeenCalledTimes(1)
    expect(retrySourceMetadata).toHaveBeenCalledTimes(1)
  })

  it('keeps publishing open when the parent read answered', () => {
    renderDialog({ sourceMetadataRead: { failed: false, retry: vi.fn() } })

    expect(screen.queryByTestId('publish-edit-mode-read-error')).toBeNull()
  })
})
