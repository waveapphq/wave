/**
 * Tests for `VersionDropdown` (REQ-3.1.2.2).
 *
 * Shared component for the version dropdown trigger + menu. Two modes:
 *
 *   - mode="pick": non-edit config modal version selector. Lists available
 *     library versions with publish dates; latest carries a "latest" chip.
 *     For missing-version state, the trigger gets a red border + ring, the
 *     pinned version is rendered with strikethrough + destructive "Missing"
 *     chip, and the dropdown shows ONLY available versions (not the missing
 *     pinned one).
 *
 *   - mode="bump": edit-mode publish dialog version selector. Shows a smart
 *     auto-bump target with color-coded chip (green PATCH / amber MINOR /
 *     red MAJOR). Bump options blocked by the current draft are disabled
 *     with `(i)` info icons; hovering `(i)` opens a tooltip explaining what
 *     blocks the target. Trigger gets a red outline + ring when the ONLY
 *     valid target is MAJOR. A Custom field accepts arbitrary semver and
 *     validates inline.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  VersionDropdown,
  validateCustomVersion,
} from '@/features/functions/canvas/version-dropdown'


// ---------------------------------------------------------------------------
// mode="pick" - non-edit-mode config modal
// ---------------------------------------------------------------------------


describe('VersionDropdown - mode="pick"', () => {
  const baseProps = {
    mode: 'pick' as const,
    selected: '1.0.0',
    available: [
      { version: '2.0.0', published_at: '2026-03-01T00:00:00Z' },
      { version: '1.0.0', published_at: '2026-01-01T00:00:00Z' },
    ],
    latest: '2.0.0',
    onChange: vi.fn(),
  }

  it('renders the selected version in the trigger', () => {
    render(<VersionDropdown {...baseProps} />)
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(within(trigger).getByText(/1\.0\.0/)).toBeInTheDocument()
  })

  it('lists every available version when opened', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...baseProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    expect(screen.getByRole('menuitemradio', { name: /2\.0\.0/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /1\.0\.0/ })).toBeInTheDocument()
  })

  it('marks the latest version with a "latest" chip in the menu', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...baseProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const latestOption = screen.getByRole('menuitemradio', { name: /2\.0\.0/ })
    expect(within(latestOption).getByText(/latest/i)).toBeInTheDocument()
  })

  it('shows the publish date on each option', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...baseProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    // Date is rendered in some user-readable form; the exact format is the
    // implementation's choice, but the year/month must appear on every row.
    const dates = screen.getAllByText(/2026/)
    expect(dates.length).toBeGreaterThan(0)
  })

  it('calls onChange when an option is selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<VersionDropdown {...baseProps} onChange={onChange} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    await user.click(screen.getByRole('menuitemradio', { name: /2\.0\.0/ }))
    expect(onChange).toHaveBeenCalledWith('2.0.0')
  })

  it('renders an option with a blank publish date when none is provided', async () => {
    const user = userEvent.setup()
    render(
      <VersionDropdown
        {...baseProps}
        available={[{ version: '3.0.0' }, { version: '1.0.0', published_at: '2026-01-01T00:00:00Z' }]}
        latest="3.0.0"
      />,
    )
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const undatedOption = screen.getByRole('menuitemradio', { name: /3\.0\.0/ })
    // Undated row still renders; only one row carries a 2026 publish date.
    expect(undatedOption).toBeInTheDocument()
    expect(screen.getAllByText(/2026/)).toHaveLength(1)
  })
})


describe('VersionDropdown - mode="pick" missing-version visuals', () => {
  const missingProps = {
    mode: 'pick' as const,
    selected: '1.4.2',
    available: [
      { version: '2.0.0', published_at: '2026-03-01T00:00:00Z' },
      { version: '1.5.0', published_at: '2026-02-01T00:00:00Z' },
    ],
    latest: '2.0.0',
    missingVersion: true,
    onChange: vi.fn(),
  }

  it('renders the trigger with a red border ring (destructive state)', () => {
    render(<VersionDropdown {...missingProps} />)
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(trigger.className).toMatch(/border-red-(500|600)/)
    expect(trigger.className).toMatch(/ring-red-/)
  })

  it('shows the pinned-but-missing version with strikethrough', () => {
    render(<VersionDropdown {...missingProps} />)
    const trigger = screen.getByTestId('version-dropdown-trigger')
    const versionText = within(trigger).getByText(/1\.4\.2/)
    // Tailwind `line-through` or equivalent must be applied.
    expect(versionText.className).toMatch(/line-through/)
  })

  it('shows a "Missing" destructive chip next to the missing version', () => {
    render(<VersionDropdown {...missingProps} />)
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(within(trigger).getByText(/missing/i)).toBeInTheDocument()
  })

  it('dropdown lists ONLY available versions (not the missing pinned one)', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...missingProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    // Available versions are present.
    expect(screen.getByRole('menuitemradio', { name: /2\.0\.0/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /1\.5\.0/ })).toBeInTheDocument()
    // The pinned-but-missing version is NOT an option (already shown in trigger).
    expect(screen.queryByRole('menuitemradio', { name: /1\.4\.2/ })).toBeNull()
  })
})


describe('VersionDropdown - mode="pick" version overflow handling', () => {
  const baseProps = {
    mode: 'pick' as const,
    selected: '1.0.0',
    available: [
      { version: '2.0.0', published_at: '2026-03-01T00:00:00Z' },
      { version: '1.0.0', published_at: '2026-01-01T00:00:00Z' },
    ],
    latest: '2.0.0',
    onChange: vi.fn(),
  }

  it('truncates the selected v{version} span in the trigger (min-w-0 + truncate)', () => {
    render(<VersionDropdown {...baseProps} />)
    const trigger = screen.getByTestId('version-dropdown-trigger')
    const versionSpan = within(trigger).getByText('v1.0.0')
    expect(versionSpan.className).toMatch(/truncate/)
    expect(versionSpan.className).toMatch(/min-w-0/)
  })

  it('truncates the v{version} span on each pick row (min-w-0 + truncate)', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...baseProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const option = screen.getByRole('menuitemradio', { name: /2\.0\.0/ })
    const versionSpan = within(option).getByText('v2.0.0')
    expect(versionSpan.className).toMatch(/truncate/)
    expect(versionSpan.className).toMatch(/min-w-0/)
  })

  // The pick dropdown lives in the config modal's right column; a left-aligned
  // menu grows past the dialog's right edge for a long version. Right-aligning
  // it keeps the menu inside the dialog.
  it('right-aligns the pick menu so it stays inside the dialog', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...baseProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const menu = screen.getByTestId('version-dropdown-menu')
    expect(menu.className).toContain('right-0')
    expect(menu.className).not.toContain('left-0')
  })
})


describe('VersionDropdown - custom version length cap', () => {
  // 33-char major bump that would pass every other check (valid semver, newer
  // than latest, allowed level). Only the length cap may reject it.
  const OVER_LENGTH = '10.0.0-' + 'a'.repeat(26)
  const allowAll = {
    allowed: ['patch', 'minor', 'major'] as Array<'patch' | 'minor' | 'major'>,
    blocked: {},
  }

  it('validateCustomVersion rejects an over-length version with the cap message', () => {
    expect(OVER_LENGTH.length).toBe(33)
    const result = validateCustomVersion('1.0.0', OVER_LENGTH, allowAll, [], '1.0.0')
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/exceeds the maximum length of 32 characters/)
  })

  it('hard-caps the custom input at the max version length (cannot type past 32)', async () => {
    const user = userEvent.setup()
    render(
      <VersionDropdown
        mode="bump"
        source="1.0.0"
        selected="1.1.0"
        allowedBumps={allowAll}
        existingVersions={[]}
        latest="1.0.0"
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const input = screen.getByTestId('version-dropdown-custom-input') as HTMLInputElement
    expect(input.maxLength).toBe(32)
    await user.type(input, OVER_LENGTH)
    expect(input.value.length).toBe(32)
  })
})


// ---------------------------------------------------------------------------
// mode="bump" - edit-mode publish dialog
// ---------------------------------------------------------------------------


describe('VersionDropdown - mode="bump" allowed bumps', () => {
  const bumpProps = {
    mode: 'bump' as const,
    source: '1.0.0',
    selected: '1.1.0',
    allowedBumps: {
      allowed: ['patch', 'minor', 'major'] as Array<'patch' | 'minor' | 'major'>,
      blocked: {},
    },
    existingVersions: [],
    latest: '1.0.0',
    onChange: vi.fn(),
  }

  it('renders the auto-derived bump target on the trigger', () => {
    render(<VersionDropdown {...bumpProps} />)
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(within(trigger).getByText(/1\.1\.0/)).toBeInTheDocument()
  })

  it('renders the bump chip (PATCH/MINOR/MAJOR) on the trigger', () => {
    render(<VersionDropdown {...bumpProps} />)
    const trigger = screen.getByTestId('version-dropdown-trigger')
    // Selected target 1.1.0 from source 1.0.0 is MINOR.
    expect(within(trigger).getByText(/minor/i)).toBeInTheDocument()
  })

  it('lists patch, minor, major options when all are allowed', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...bumpProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    expect(screen.getByRole('menuitemradio', { name: /patch/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /minor/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: /major/i })).toBeInTheDocument()
  })

  it('calls onChange with the auto-bumped semver when a level is selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<VersionDropdown {...bumpProps} onChange={onChange} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    await user.click(screen.getByRole('menuitemradio', { name: /^major/i }))
    // Major bump from 1.0.0 -> 2.0.0.
    expect(onChange).toHaveBeenCalledWith('2.0.0')
  })
})


describe('VersionDropdown - mode="bump" blocked bumps', () => {
  const restrictiveProps = {
    mode: 'bump' as const,
    source: '1.0.0',
    selected: '2.0.0',
    allowedBumps: {
      allowed: ['major'] as Array<'patch' | 'minor' | 'major'>,
      blocked: {
        patch: 'PATCH cannot include input or output changes',
        minor: 'MINOR cannot add a REQUIRED input',
      },
    },
    existingVersions: [],
    latest: '1.0.0',
    onChange: vi.fn(),
  }

  it('disables blocked options in the dropdown', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...restrictiveProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const patchOpt = screen.getByRole('menuitemradio', { name: /patch/i })
    const minorOpt = screen.getByRole('menuitemradio', { name: /minor/i })
    expect(patchOpt).toHaveAttribute('aria-disabled', 'true')
    expect(minorOpt).toHaveAttribute('aria-disabled', 'true')
  })

  it('renders an info icon next to each blocked option', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...restrictiveProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const patchOpt = screen.getByRole('menuitemradio', { name: /patch/i })
    expect(within(patchOpt).getByTestId('blocked-info-icon')).toBeInTheDocument()
  })

  // The (i) gets its own help cursor (not the disabled not-allowed cursor),
  // is hoverable, and the blocking reason rides the shared ConditionalTooltip
  // instead of the hand-rolled native `title`.
  it('gives the blocked (i) icon its own help cursor', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...restrictiveProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const patchOpt = screen.getByRole('menuitemradio', { name: /patch/i })
    const info = within(patchOpt).getByTestId('blocked-info-icon')
    expect(info.className).toMatch(/cursor-help/)
  })

  it('keeps the blocked (i) icon hoverable, not aria-hidden', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...restrictiveProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const patchOpt = screen.getByRole('menuitemradio', { name: /patch/i })
    const info = within(patchOpt).getByTestId('blocked-info-icon')
    expect(info).not.toHaveAttribute('aria-hidden', 'true')
  })

  it('surfaces the blocking reason via the fast tooltip, not a native option title', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...restrictiveProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const patchOpt = screen.getByRole('menuitemradio', { name: /patch/i })
    expect(within(patchOpt).getByTestId('blocked-info-icon')).toBeInTheDocument()
    // The hand-rolled `title` is gone (it suppressed the help cursor + was slow).
    expect(patchOpt).not.toHaveAttribute('title')
  })

  it('renders a red outline + ring on the trigger when only MAJOR is allowed', () => {
    render(<VersionDropdown {...restrictiveProps} />)
    const trigger = screen.getByTestId('version-dropdown-trigger')
    // The trigger gains a red outline + faint red ring when the only
    // valid target is MAJOR.
    expect(trigger.className).toMatch(/border-red-(500|600)/)
    expect(trigger.className).toMatch(/ring-red-/)
  })

  it('does not call onChange when a blocked option is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<VersionDropdown {...restrictiveProps} onChange={onChange} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    // aria-disabled does not block the DOM click, but the handler guards on
    // the allowed set and bails before invoking onChange.
    await user.click(screen.getByRole('menuitemradio', { name: /patch/i }))
    expect(onChange).not.toHaveBeenCalled()
  })
})


describe('VersionDropdown - mode="bump" non-incrementing selected', () => {
  it('omits the bump chip on the trigger when selected is not greater than source', () => {
    render(
      <VersionDropdown
        mode="bump"
        source="1.0.0"
        selected="1.0.0"
        allowedBumps={{
          allowed: ['patch', 'minor', 'major'],
          blocked: {},
        }}
        existingVersions={[]}
        latest="1.0.0"
        onChange={vi.fn()}
      />,
    )
    const trigger = screen.getByTestId('version-dropdown-trigger')
    // selected === source classifies to null, so no PATCH/MINOR/MAJOR chip.
    expect(within(trigger).getByText('1.0.0')).toBeInTheDocument()
    expect(within(trigger).queryByTestId('bump-chip-patch')).toBeNull()
    expect(within(trigger).queryByTestId('bump-chip-minor')).toBeNull()
    expect(within(trigger).queryByTestId('bump-chip-major')).toBeNull()
  })
})


describe('VersionDropdown - mode="bump" custom version input', () => {
  const customProps = {
    mode: 'bump' as const,
    source: '1.0.0',
    selected: '1.0.1',
    allowedBumps: {
      allowed: ['patch', 'minor', 'major'] as Array<'patch' | 'minor' | 'major'>,
      blocked: {},
    },
    existingVersions: [],
    latest: '1.0.0',
    onChange: vi.fn(),
  }

  it('exposes a Custom text field inside the dropdown', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...customProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    expect(
      screen.getByTestId('version-dropdown-custom-input'),
    ).toBeInTheDocument()
  })

  it('applies a valid semver from the Custom field on the check button', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<VersionDropdown {...customProps} onChange={onChange} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    await user.type(screen.getByTestId('version-dropdown-custom-input'), '1.4.3-beta.1')
    // Custom version commits only when the explicit apply (check) button is clicked.
    await user.click(screen.getByTestId('version-dropdown-custom-apply'))
    expect(onChange).toHaveBeenCalledWith('1.4.3-beta.1')
  })

  it('disables the apply button until the custom value is valid', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...customProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const apply = screen.getByTestId('version-dropdown-custom-apply')
    expect(apply).toBeDisabled()
    await user.type(screen.getByTestId('version-dropdown-custom-input'), '2.0.0')
    expect(apply).toBeEnabled()
  })

  it('closes the menu after applying a custom version', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...customProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    await user.type(screen.getByTestId('version-dropdown-custom-input'), '2.0.0')
    await user.click(screen.getByTestId('version-dropdown-custom-apply'))
    expect(screen.queryByTestId('version-dropdown-custom-input')).toBeNull()
  })

  it('surfaces inline error when typed version violates the bump matrix', async () => {
    const user = userEvent.setup()
    render(
      <VersionDropdown
        {...customProps}
        allowedBumps={{
          allowed: ['major'] as Array<'patch' | 'minor' | 'major'>,
          blocked: {
            patch: 'PATCH blocks I/O changes',
            minor: 'MINOR cannot remove tags',
          },
        }}
      />,
    )
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const input = screen.getByTestId('version-dropdown-custom-input')
    // 1.0.1 is a PATCH bump - blocked.
    await user.type(input, '1.0.1')
    expect(
      await screen.findByTestId('version-dropdown-custom-error'),
    ).toBeInTheDocument()
  })

  it('surfaces inline error when typed value is not a valid semver', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...customProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const input = screen.getByTestId('version-dropdown-custom-input')
    await user.type(input, 'not-a-version')
    expect(
      await screen.findByTestId('version-dropdown-custom-error'),
    ).toBeInTheDocument()
  })
})


// ---------------------------------------------------------------------------
// Locked / disabled state (locked when in edit mode)
// ---------------------------------------------------------------------------


describe('VersionDropdown - locked state', () => {
  it('does not open the menu when `disabled` is true', async () => {
    const user = userEvent.setup()
    render(
      <VersionDropdown
        mode="pick"
        selected="1.0.0"
        available={[{ version: '1.0.0', published_at: '2026-01-01' }]}
        latest="1.0.0"
        disabled
        onChange={vi.fn()}
      />,
    )
    const trigger = screen.getByTestId('version-dropdown-trigger')
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('menuitemradio')).toBeNull()
  })
})


describe('VersionDropdown - mode="bump" custom semver input', () => {
  const baseProps = {
    mode: 'bump' as const,
    source: '1.0.0',
    selected: '1.1.0',
    allowedBumps: {
      allowed: ['patch', 'minor', 'major'] as Array<'patch' | 'minor' | 'major'>,
      blocked: {} as Record<string, string>,
    },
    existingVersions: [] as string[],
    latest: '1.0.0',
    onChange: vi.fn(),
  }

  async function openAndType(props: typeof baseProps, value: string) {
    const user = userEvent.setup()
    render(<VersionDropdown {...props} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const input = screen.getByTestId('version-dropdown-custom-input')
    await user.clear(input)
    if (value) await user.type(input, value)
    return { user, input }
  }

  it('rejects a non-semver custom value', async () => {
    await openAndType(baseProps, 'abc')
    expect(screen.getByText('Not a valid semver')).toBeInTheDocument()
  })

  it('rejects a custom value that is not newer than the latest (no backports)', async () => {
    await openAndType(baseProps, '0.9.0')
    expect(
      screen.getByText('Must be newer than the latest version 1.0.0'),
    ).toBeInTheDocument()
  })

  it('rejects a value not greater than the source when no latest is set yet', async () => {
    await openAndType({ ...baseProps, latest: '' }, '0.9.0')
    expect(
      screen.getByText('Target must be greater than the source version'),
    ).toBeInTheDocument()
  })

  it('blocks a valid level that is not allowed, surfacing the blocked reason', async () => {
    const onChange = vi.fn()
    await openAndType(
      {
        ...baseProps,
        allowedBumps: { allowed: ['major'], blocked: { minor: 'MINOR blocked: schema change' } },
        onChange,
      },
      '1.5.0',
    )
    expect(screen.getByText('MINOR blocked: schema change')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('falls back to a generic blocked message when no reason is provided', async () => {
    await openAndType(
      { ...baseProps, allowedBumps: { allowed: ['major'], blocked: {} } },
      '1.0.1',
    )
    expect(screen.getByText(/PATCH is blocked/i)).toBeInTheDocument()
  })

  it('emits onChange for a valid allowed minor custom version after apply', async () => {
    const onChange = vi.fn()
    const { user } = await openAndType({ ...baseProps, onChange }, '1.2.0')
    await user.click(screen.getByTestId('version-dropdown-custom-apply'))
    expect(onChange).toHaveBeenCalledWith('1.2.0')
  })

  it('emits onChange for a valid allowed major custom version after apply', async () => {
    const onChange = vi.fn()
    const { user } = await openAndType({ ...baseProps, onChange }, '2.0.0')
    await user.click(screen.getByTestId('version-dropdown-custom-apply'))
    expect(onChange).toHaveBeenCalledWith('2.0.0')
  })

  it('clears the error when the custom value is emptied', async () => {
    const { user, input } = await openAndType(baseProps, 'abc')
    expect(screen.getByText('Not a valid semver')).toBeInTheDocument()
    await user.clear(input)
    expect(screen.queryByText('Not a valid semver')).toBeNull()
  })
})


// ---------------------------------------------------------------------------
// Existing-version awareness (skip taken targets, latest footer, dup reject, offset)
// ---------------------------------------------------------------------------


describe('VersionDropdown - mode="bump" existing-version awareness', () => {
  const existingProps = {
    mode: 'bump' as const,
    source: '1.0.0',
    selected: '3.0.0',
    allowedBumps: {
      allowed: ['patch', 'minor', 'major'] as Array<'patch' | 'minor' | 'major'>,
      blocked: {},
    },
    existingVersions: ['1.0.0', '2.0.0'],
    latest: '2.0.0',
    onChange: vi.fn(),
  }

  it('shows the latest version as a [LATEST] -> v header at the top of the menu', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...existingProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const latest = screen.getByTestId('version-dropdown-latest')
    expect(latest).toHaveTextContent('latest')
    expect(latest).toHaveTextContent('-> 2.0.0')
    // It is the first row in the menu (top), with a separator below it.
    const menu = screen.getByTestId('version-dropdown-menu')
    expect(menu.firstElementChild).toHaveAttribute('data-testid', 'version-dropdown-latest')
    expect(latest.className).toContain('border-b')
  })

  it('suggests the next AVAILABLE major, skipping the taken 2.0.0 (1.0.0 -> 3.0.0)', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...existingProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    expect(screen.getByRole('menuitemradio', { name: /major/i })).toHaveTextContent('3.0.0')
  })

  it('emits the skipped target on select (major -> 3.0.0, never the taken 2.0.0)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<VersionDropdown {...existingProps} onChange={onChange} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    await user.click(screen.getByRole('menuitemradio', { name: /^major/i }))
    expect(onChange).toHaveBeenCalledWith('3.0.0')
  })

  it('rejects a custom version that already exists', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...existingProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    await user.type(screen.getByTestId('version-dropdown-custom-input'), '2.0.0')
    expect(await screen.findByTestId('version-dropdown-custom-error')).toHaveTextContent(
      'Version 2.0.0 already exists',
    )
  })

  it('rejects a custom pre-release of the existing latest release', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...existingProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    await user.type(screen.getByTestId('version-dropdown-custom-input'), '2.0.0-dev1')
    expect(await screen.findByTestId('version-dropdown-custom-error')).toHaveTextContent(
      'Must be newer than the latest version 2.0.0',
    )
  })

  it('patch/minor bump options advance the SOURCE major line, not the global latest', async () => {
    // Per-major no-backports (VIEW-9): opening v1.0.0 while v2.0.0 exists suggests the
    // 1.x line (patch 1.0.1 / minor 1.1.0), not the 2.x line.
    const user = userEvent.setup()
    render(<VersionDropdown {...existingProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    expect(screen.getByRole('menuitemradio', { name: /patch/i })).toHaveTextContent('1.0.1')
    expect(screen.getByRole('menuitemradio', { name: /minor/i })).toHaveTextContent('1.1.0')
  })

  it('anchors the menu under the trigger (left-aligned, not offset to the right)', async () => {
    const user = userEvent.setup()
    render(<VersionDropdown {...existingProps} />)
    await user.click(screen.getByTestId('version-dropdown-trigger'))
    const menu = screen.getByTestId('version-dropdown-menu')
    expect(menu.className).toContain('left-0')
    expect(menu.className).not.toContain('right-0')
  })
})
