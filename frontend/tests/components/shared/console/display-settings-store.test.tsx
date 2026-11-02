/**
 * Console display-settings store (RUNM-10).
 *
 * Display settings are a remembered per-browser preference shared by every
 * console surface - the live workbench console, the Execution History console,
 * and the report log panel. One persisted store replaces the four duplicated
 * default blocks and the three per-surface copies.
 *
 * Module under test:
 * frontend/src/components/shared/console/display-settings-store.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const STORAGE_KEY = 'wave-console-display-settings'

const DEFAULTS = {
  showTimestamps: true,
  showLevel: true,
  showSource: true,
  sourceWidth: 20,
  showSystemLogs: true,
  fontSize: 12,
}

async function loadStore() {
  const module = await import('../../../../src/components/shared/console/display-settings-store')
  return module.useDisplaySettingsStore
}

beforeEach(() => {
  localStorage.clear()
})

describe('display-settings store - defaults', () => {
  it('starts with every column shown at the default width and size', async () => {
    const useDisplaySettingsStore = await loadStore()

    expect(useDisplaySettingsStore.getState().settings).toEqual(DEFAULTS)
  })

  it('exports the canonical default beside the store', async () => {
    const { DEFAULT_DISPLAY_SETTINGS } = await import(
      '../../../../src/components/shared/console/display-settings-store'
    )

    expect(DEFAULT_DISPLAY_SETTINGS).toEqual(DEFAULTS)
  })

  it('seeds itself from the canonical default', async () => {
    const useDisplaySettingsStore = await loadStore()
    const { DEFAULT_DISPLAY_SETTINGS } = await import(
      '../../../../src/components/shared/console/display-settings-store'
    )

    expect(useDisplaySettingsStore.getState().settings).toEqual(DEFAULT_DISPLAY_SETTINGS)
  })
})

describe('display-settings store - updates', () => {
  it('updates a single setting and preserves the rest', async () => {
    const useDisplaySettingsStore = await loadStore()

    useDisplaySettingsStore.getState().updateSettings({ showTimestamps: false })

    const { settings } = useDisplaySettingsStore.getState()
    expect(settings.showTimestamps).toBe(false)
    expect(settings.showLevel).toBe(true)
    expect(settings.showSource).toBe(true)
    expect(settings.showSystemLogs).toBe(true)
  })

  it('updates several settings at once', async () => {
    const useDisplaySettingsStore = await loadStore()

    useDisplaySettingsStore.getState().updateSettings({
      showTimestamps: false,
      showLevel: false,
      showSource: false,
      showSystemLogs: false,
    })

    expect(useDisplaySettingsStore.getState().settings).toEqual({
      ...DEFAULTS,
      showTimestamps: false,
      showLevel: false,
      showSource: false,
      showSystemLogs: false,
    })
  })

  it('carries the source column width', async () => {
    const useDisplaySettingsStore = await loadStore()

    useDisplaySettingsStore.getState().updateSettings({ sourceWidth: 34 })

    expect(useDisplaySettingsStore.getState().settings.sourceWidth).toBe(34)
  })

  it('carries the text size', async () => {
    const useDisplaySettingsStore = await loadStore()

    useDisplaySettingsStore.getState().updateSettings({ fontSize: 16 })

    expect(useDisplaySettingsStore.getState().settings.fontSize).toBe(16)
  })

  it('flips a setting back on', async () => {
    const useDisplaySettingsStore = await loadStore()

    useDisplaySettingsStore.getState().updateSettings({ showSystemLogs: false })
    useDisplaySettingsStore.getState().updateSettings({ showSystemLogs: true })

    expect(useDisplaySettingsStore.getState().settings.showSystemLogs).toBe(true)
  })
})

describe('display-settings store - per-browser persistence', () => {
  it('writes the choice to local storage under a wave-prefixed key', async () => {
    const useDisplaySettingsStore = await loadStore()

    useDisplaySettingsStore.getState().updateSettings({ showSource: false, fontSize: 15 })

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state.settings).toMatchObject({
      showSource: false,
      fontSize: 15,
    })
  })

  it('rehydrates a stored choice on a fresh load', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { settings: { ...DEFAULTS, showTimestamps: false, fontSize: 17 } },
        version: 1,
      }),
    )

    const useDisplaySettingsStore = await loadStore()

    const { settings } = useDisplaySettingsStore.getState()
    expect(settings.showTimestamps).toBe(false)
    expect(settings.fontSize).toBe(17)
  })

  it('falls back to the defaults when nothing is stored', async () => {
    const useDisplaySettingsStore = await loadStore()

    expect(useDisplaySettingsStore.getState().settings).toEqual(DEFAULTS)
  })

  it('survives a partial stored payload by keeping the missing defaults', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: { showLevel: false } }, version: 1 }),
    )

    const useDisplaySettingsStore = await loadStore()

    const { settings } = useDisplaySettingsStore.getState()
    expect(settings.showLevel).toBe(false)
    expect(settings.sourceWidth).toBe(20)
    expect(settings.fontSize).toBe(12)
  })
})

describe('display-settings store - consumed by the shared console control', () => {
  it('the settings popover renders the stored values when given no props', async () => {
    const useDisplaySettingsStore = await loadStore()
    const { ConsoleSettings } = await import(
      '../../../../src/components/shared/console/console-settings'
    )
    useDisplaySettingsStore.getState().updateSettings({ fontSize: 16, showLevel: false })
    const user = userEvent.setup()

    render(<ConsoleSettings />)
    await user.click(screen.getByRole('button', { name: 'Console settings' }))

    expect(screen.getByTestId('font-size-display')).toHaveTextContent('16')
    expect(screen.getByRole('switch', { name: 'Show Level' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('a toggle in the settings popover writes to the store', async () => {
    const useDisplaySettingsStore = await loadStore()
    const { ConsoleSettings } = await import(
      '../../../../src/components/shared/console/console-settings'
    )
    const user = userEvent.setup()

    render(<ConsoleSettings />)
    await user.click(screen.getByRole('button', { name: 'Console settings' }))
    await user.click(screen.getByRole('switch', { name: 'Show Timestamps' }))

    expect(useDisplaySettingsStore.getState().settings.showTimestamps).toBe(false)
  })

  it('an explicit settings prop still wins for a surface that owns its own copy', async () => {
    const useDisplaySettingsStore = await loadStore()
    const { ConsoleSettings } = await import(
      '../../../../src/components/shared/console/console-settings'
    )
    useDisplaySettingsStore.getState().updateSettings({ fontSize: 16 })
    const onSettingsChange = vi.fn()
    const user = userEvent.setup()

    render(
      <ConsoleSettings
        settings={{ ...DEFAULTS, fontSize: 10 }}
        onSettingsChange={onSettingsChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Console settings' }))

    expect(screen.getByTestId('font-size-display')).toHaveTextContent('10')
  })

  it('the console panel header defaults its display settings to the store', async () => {
    const useDisplaySettingsStore = await loadStore()
    const { ConsolePanelHeader } = await import(
      '../../../../src/components/shared/console/console-panel-header'
    )
    useDisplaySettingsStore.getState().updateSettings({ fontSize: 14 })
    const user = userEvent.setup()

    render(
      <ConsolePanelHeader
        sessionId="s1"
        errorCount={0}
        minLevel="INFO"
        onMinLevelChange={vi.fn()}
        errorFilterActive={false}
        onErrorFilterChange={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Console settings' }))

    expect(screen.getByTestId('font-size-display')).toHaveTextContent('14')
  })
})
