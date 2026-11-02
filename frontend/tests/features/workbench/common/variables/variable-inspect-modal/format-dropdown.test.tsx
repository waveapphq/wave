/**
 * Tests for FormatDropdown - the inspect modal's footer Format selector for
 * literal string watchers (VMGR-65..68). It sits in the same
 * left-zone slot the View dropdown uses (a literal string has no View
 * dropdown), mirroring ViewDropdown's shared Select wrapper.
 *
 * Contract under test:
 *   - TEXT label trigger (no icon-only glyph), aria-label "Format",
 *     data-testid "format-dropdown"
 *   - Auto shows the detected format suffix (`Auto (JSON)`) or plain `Auto`;
 *     explicit picks show their own label
 *   - menu lists Auto / Plain / JSON / XML / YAML with a check on the selected
 *     entry (no Template: it is a value kind, not a format)
 *   - onValueChange fires with the picked TextFormat; disabled disables the trigger
 *
 * The upward-opening menu (side="top") is asserted in Playwright,
 * mirroring the ViewDropdown precedent.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 * REQ-3.4.1.6: SQL database operations (SQL-10: Format locked to SQL)
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { FormatDropdown } from '@/features/workbench/common/variables/variable-inspect-modal/format-dropdown'
import type { TextFormat, ResolvedFormat } from '@/lib/codemirror/format-editor'

interface RenderOptions {
  value?: TextFormat
  detectedFormat?: ResolvedFormat
  onValueChange?: (value: TextFormat) => void
  disabled?: boolean
  allowedFormats?: TextFormat[]
}

function renderDropdown({
  value = 'auto',
  detectedFormat = 'plain',
  onValueChange = vi.fn(),
  disabled,
  allowedFormats,
}: RenderOptions = {}) {
  render(
    <FormatDropdown
      value={value}
      detectedFormat={detectedFormat}
      onValueChange={onValueChange}
      disabled={disabled}
      allowedFormats={allowedFormats}
    />,
  )
  return { onValueChange }
}

function trigger(): HTMLElement {
  return screen.getByTestId('format-dropdown')
}

describe('FormatDropdown - trigger', () => {
  it('renders the trigger with the format-dropdown testid', () => {
    renderDropdown()
    expect(trigger()).toBeInTheDocument()
  })

  it('labels the trigger "Format" for screen readers', () => {
    renderDropdown()
    expect(trigger()).toHaveAttribute('aria-label', 'Format')
  })

  it('shows plain "Auto" when Auto is selected and the detected format is plain', () => {
    renderDropdown({ value: 'auto', detectedFormat: 'plain' })
    expect(trigger()).toHaveTextContent('Auto')
    expect(trigger()).not.toHaveTextContent('Auto (')
  })

  it.each([
    ['json', 'Auto (JSON)'],
    ['yaml', 'Auto (YAML)'],
    ['xml', 'Auto (XML)'],
  ] as const)(
    'shows the detected format suffix "%s" when Auto is selected',
    (detected, label) => {
      renderDropdown({ value: 'auto', detectedFormat: detected })
      expect(trigger()).toHaveTextContent(label)
    },
  )

  it.each([
    ['json', 'JSON'],
    ['yaml', 'YAML'],
    ['xml', 'XML'],
    ['plain', 'Plain'],
  ] as const)('shows the explicit "%s" label when picked', (value, label) => {
    renderDropdown({ value })
    expect(trigger()).toHaveTextContent(label)
  })

  it('disables the trigger when disabled', () => {
    renderDropdown({ disabled: true })
    expect(trigger()).toBeDisabled()
  })
})

describe('FormatDropdown - menu items', () => {
  it('lists Auto / Plain / JSON / XML / YAML with the detected Auto suffix', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'auto', detectedFormat: 'json' })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Auto (JSON)',
      'Plain',
      'JSON',
      'XML',
      'YAML',
    ])
  })

  it('does NOT list a Template option (Template is a value kind, not a format)', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'auto', detectedFormat: 'json' })

    await user.click(trigger())
    await screen.findAllByRole('option')
    expect(
      screen.queryByRole('option', { name: 'Template' }),
    ).not.toBeInTheDocument()
  })

  it('shows the plain "Auto" menu label when the detected format is plain', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'auto', detectedFormat: 'plain' })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Auto',
      'Plain',
      'JSON',
      'XML',
      'YAML',
    ])
  })

  it('marks the selected format with the check (aria-selected)', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'json' })

    await user.click(trigger())
    const json = await screen.findByRole('option', { name: 'JSON' })
    const yaml = screen.getByRole('option', { name: 'YAML' })
    expect(json).toHaveAttribute('aria-selected', 'true')
    expect(yaml).not.toHaveAttribute('aria-selected', 'true')
  })
})

describe('FormatDropdown - selection', () => {
  it('fires onValueChange with "yaml" when YAML is picked', async () => {
    const user = userEvent.setup()
    const { onValueChange } = renderDropdown({ value: 'auto' })

    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'YAML' }))

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith('yaml')
  })

  it('fires onValueChange with "auto" when the Auto entry is picked', async () => {
    const user = userEvent.setup()
    const { onValueChange } = renderDropdown({ value: 'json', detectedFormat: 'json' })

    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'Auto (JSON)' }))

    expect(onValueChange).toHaveBeenCalledWith('auto')
  })
})

// ============================================================================
// allowedFormats restricts the menu to a parameter's permitted DATA formats
// (a multi-format Body param), but Auto (the detect mode) is always offered.
// Absent allowedFormats -> the full menu. A SINGLE allowedFormats LOCKS the
// picker (see the locked block below), so these cases use two or more formats.
// ============================================================================

describe('FormatDropdown - allowedFormats', () => {
  it('restricts the explicit data formats but always offers Auto', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'json', allowedFormats: ['json', 'yaml'] })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Auto', 'JSON', 'YAML'])
  })

  it('offers Auto when value=auto even if allowedFormats omits it', async () => {
    // A controlled Select whose value (auto) is filtered out of
    // its own items never settles, freezing the xml/json parser content editors.
    const user = userEvent.setup()
    renderDropdown({ value: 'auto', detectedFormat: 'xml', allowedFormats: ['json', 'xml'] })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Auto (XML)', 'JSON', 'XML'])
  })

  it('keeps the Auto + permitted entries when allowedFormats includes auto', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'auto', detectedFormat: 'json', allowedFormats: ['auto', 'json', 'yaml'] })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Auto (JSON)', 'JSON', 'YAML'])
  })

  it('omits XML and YAML when they are not permitted', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'json', allowedFormats: ['json', 'plain'] })

    await user.click(trigger())
    await screen.findAllByRole('option')
    expect(screen.queryByRole('option', { name: 'XML' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'YAML' })).not.toBeInTheDocument()
  })

  it('lists the full menu when allowedFormats is omitted', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'auto', detectedFormat: 'plain' })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Auto',
      'Plain',
      'JSON',
      'XML',
      'YAML',
    ])
  })
})

// ============================================================================
// A SINGLE allowedFormats LOCKS the picker - it renders disabled, pinned
// to that format, with NO Auto (a strict json_content / xml_content / url field
// must never misdetect). The parent pins `value` to the locked format.
// ============================================================================

describe('FormatDropdown - locked single allowedFormats', () => {
  it('disables the trigger when exactly one format is allowed', () => {
    renderDropdown({ value: 'json', allowedFormats: ['json'] })
    expect(trigger()).toBeDisabled()
  })

  it('pins a locked json picker to the JSON label, never Auto', () => {
    renderDropdown({ value: 'json', allowedFormats: ['json'] })
    expect(trigger()).toHaveTextContent('JSON')
    expect(trigger()).not.toHaveTextContent('Auto')
  })

  it('locks a single plain allowedFormats to a disabled Plain trigger', () => {
    renderDropdown({ value: 'plain', allowedFormats: ['plain'] })
    expect(trigger()).toBeDisabled()
    expect(trigger()).toHaveTextContent('Plain')
  })

  it('self-locks on a single allowedFormats even when the disabled prop is not passed', () => {
    renderDropdown({ value: 'xml', allowedFormats: ['xml'] })
    expect(trigger()).toBeDisabled()
    expect(trigger()).toHaveTextContent('XML')
  })
})

// ============================================================================
// PYRUN-13: python is a LOCKED-ONLY format. A single `['python']` allowedFormats
// pins the trigger to the label `Python`; python is never an entry of the menu,
// not even when allowedFormats permits it. The Python-mode "Edit value" sheet
// renders no Format dropdown at all - that host rule is asserted on the sheet.
// ============================================================================

describe('FormatDropdown - python (PYRUN-13)', () => {
  it('locks a single python allowedFormats to a disabled Python trigger', () => {
    renderDropdown({ value: 'python', allowedFormats: ['python'] })
    expect(trigger()).toBeDisabled()
    expect(trigger()).toHaveTextContent('Python')
  })

  it('never shows Auto on a locked python trigger', () => {
    renderDropdown({ value: 'python', detectedFormat: 'python', allowedFormats: ['python'] })
    expect(trigger()).toHaveTextContent('Python')
    expect(trigger()).not.toHaveTextContent('Auto')
  })

  it('does not offer Python in the full menu', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'auto', detectedFormat: 'plain' })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Auto',
      'Plain',
      'JSON',
      'XML',
      'YAML',
    ])
    expect(screen.queryByRole('option', { name: 'Python' })).not.toBeInTheDocument()
  })

  it('does not offer Python even when allowedFormats permits it beside another format', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'plain', allowedFormats: ['plain', 'python'] })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Auto', 'Plain'])
  })
})

describe('FormatDropdown - sql (SQL-10)', () => {
  it('locks a single sql allowedFormats to a disabled SQL trigger', () => {
    renderDropdown({ value: 'sql', detectedFormat: 'sql', allowedFormats: ['sql'] })
    expect(trigger()).toBeDisabled()
    expect(trigger()).toHaveTextContent(/^SQL$/)
  })

  it('never shows Auto on a locked sql trigger', () => {
    renderDropdown({ value: 'sql', detectedFormat: 'plain', allowedFormats: ['sql'] })
    expect(trigger()).toHaveTextContent(/^SQL$/)
    expect(trigger()).not.toHaveTextContent('Auto')
  })

  it('does not offer SQL in the full menu', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'auto', detectedFormat: 'plain' })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      'Auto',
      'Plain',
      'JSON',
      'XML',
      'YAML',
    ])
    expect(screen.queryByRole('option', { name: 'SQL' })).not.toBeInTheDocument()
  })

  it('does not offer SQL even when allowedFormats permits it beside another format', async () => {
    const user = userEvent.setup()
    renderDropdown({ value: 'plain', allowedFormats: ['plain', 'sql'] })

    await user.click(trigger())
    const options = await screen.findAllByRole('option')
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Auto', 'Plain'])
  })
})
