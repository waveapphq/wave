/**
 * UnsavedChangesNavigationGuard (NET-1): leaving a page with unsaved changes
 * asks Cancel, Discard or Save; a clean page, or a move within the same page,
 * leaves at once. While the page asks its own confirmation (`confirming`), the
 * prompt hides and the navigation stays held; once the confirmation is closed
 * and no save runs, a clean page leaves.
 *
 * Component: frontend/src/components/shared/unsaved-changes-navigation-guard.tsx
 */

import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter, Link, RouterProvider, useLocation } from 'react-router-dom'

import { UnsavedChangesNavigationGuard } from '@/components/shared/unsaved-changes-navigation-guard'

// Finishes the save the page started: true succeeds, false fails.
const pendingSave: { finish?: (ok: boolean) => void } = {}

// Answers the confirmation the page opened for the requested save.
const pendingConfirmation: {
  confirm?: () => void
  confirmAlreadySaved?: () => void
  dismiss?: () => void
} = {}

interface PageProps {
  startDirty: boolean
  onSave: () => void
  onDiscard: () => void
  /** The page asks its own confirmation before it saves, as MCP Server does. */
  confirmsSave?: boolean
}

/** A page with staged edits, shaped like the Settings page hooks. */
function Page({ startDirty, onSave, onDiscard, confirmsSave = false }: Readonly<PageProps>) {
  const [dirty, setDirty] = useState(startDirty)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const location = useLocation()

  const startSave = () => {
    setSaving(true)
    pendingSave.finish = (ok) => {
      setSaving(false)
      if (ok) setDirty(false)
    }
  }

  const save = () => {
    onSave()
    if (!confirmsSave) {
      startSave()
      return
    }
    setConfirming(true)
    pendingConfirmation.confirm = () => {
      setConfirming(false)
      startSave()
    }
    pendingConfirmation.confirmAlreadySaved = () => {
      setConfirming(false)
      setDirty(false)
    }
    pendingConfirmation.dismiss = () => setConfirming(false)
  }

  const discard = () => {
    onDiscard()
    setDirty(false)
  }

  return (
    <>
      <p data-testid="where">{`${location.pathname}${location.search}`}</p>
      <Link to="/elsewhere">Elsewhere</Link>
      <Link to="/page?tab=2">Same page</Link>
      {confirmsSave && (
        <button type="button" onClick={save}>
          Save the page
        </button>
      )}
      <UnsavedChangesNavigationGuard
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={discard}
        confirming={confirmsSave ? confirming : undefined}
      />
    </>
  )
}

type MemoryRouter = ReturnType<typeof createMemoryRouter>

function renderPage({ startDirty = true, history = ['/page'], confirmsSave = false } = {}) {
  const onSave = vi.fn()
  const onDiscard = vi.fn()
  const router = createMemoryRouter(
    [
      {
        path: '/page',
        element: (
          <Page
            startDirty={startDirty}
            onSave={onSave}
            onDiscard={onDiscard}
            confirmsSave={confirmsSave}
          />
        ),
      },
      { path: '/elsewhere', element: <p data-testid="where">/elsewhere</p> },
      { path: '/before', element: <p data-testid="where">/before</p> },
    ],
    { initialEntries: history, initialIndex: history.length - 1 },
  )
  render(<RouterProvider router={router} />)
  return { router, onSave, onDiscard }
}

function where(): string | null {
  return screen.getByTestId('where').textContent
}

function leavePrompt(): HTMLElement {
  return screen.getByRole('dialog', { name: 'Unsaved changes' })
}

/** True while the router holds the navigation the guard blocked. */
function navigationHeld(router: MemoryRouter): boolean {
  return [...router.state.blockers.values()].some((blocker) => blocker.state === 'blocked')
}

/** Confirm, then the confirmation closes itself: `confirming` is false again while the save runs. */
function confirmThenClose(): void {
  act(() => {
    pendingConfirmation.confirm?.()
    pendingConfirmation.dismiss?.()
  })
}

function expectLeavePromptButtons(state: 'enabled' | 'disabled'): void {
  const prompt = leavePrompt()
  for (const name of ['Cancel', 'Discard', 'Save']) {
    const button = within(prompt).getByRole('button', { name })
    if (state === 'enabled') expect(button).toBeEnabled()
    else expect(button).toBeDisabled()
  }
}

describe('UnsavedChangesNavigationGuard', () => {
  it('leaves a clean page at once', async () => {
    const user = userEvent.setup()
    renderPage({ startDirty: false })

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))

    expect(where()).toBe('/elsewhere')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks Cancel, Discard or Save before leaving a page with unsaved changes', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))

    const prompt = leavePrompt()
    expect(within(prompt).getByText(/^You have unsaved changes\. What would you like to do\?$/)).toBeInTheDocument()
    expect(within(prompt).getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(within(prompt).getByRole('button', { name: 'Discard' })).toBeEnabled()
    expect(within(prompt).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(where()).toBe('/page')
  })

  it('asks before going back in history too', async () => {
    const { router } = renderPage({ history: ['/before', '/page'] })

    await act(async () => {
      await router.navigate(-1)
    })

    expect(leavePrompt()).toBeInTheDocument()
    expect(where()).toBe('/page')
  })

  it('stays on the page with its changes on Cancel', async () => {
    const user = userEvent.setup()
    const { onSave, onDiscard } = renderPage()

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await user.click(within(leavePrompt()).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(where()).toBe('/page')
    expect(onSave).not.toHaveBeenCalled()
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('asks again on the next try after Cancel', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await user.click(within(leavePrompt()).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))

    expect(leavePrompt()).toBeInTheDocument()
    expect(where()).toBe('/page')
  })

  it('drops the changes and leaves on Discard', async () => {
    const user = userEvent.setup()
    const { onSave, onDiscard } = renderPage()

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await user.click(within(leavePrompt()).getByRole('button', { name: 'Discard' }))

    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
    expect(where()).toBe('/elsewhere')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves once on Discard, with no router error', async () => {
    const consoleError = vi.spyOn(console, 'error')
    try {
      const user = userEvent.setup()
      renderPage()

      await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
      await user.click(within(leavePrompt()).getByRole('button', { name: 'Discard' }))

      expect(where()).toBe('/elsewhere')
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('saves, waits for the save, and leaves once it succeeds', async () => {
    const user = userEvent.setup()
    const { onSave, onDiscard } = renderPage()

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await user.click(within(leavePrompt()).getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()
    expect(where()).toBe('/page')
    expect(within(leavePrompt()).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(leavePrompt()).getByRole('button', { name: 'Discard' })).toBeDisabled()
    expect(within(leavePrompt()).getByRole('button', { name: 'Cancel' })).toBeDisabled()

    act(() => pendingSave.finish?.(true))

    expect(where()).toBe('/elsewhere')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays on the page with its changes when the save fails', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await user.click(within(leavePrompt()).getByRole('button', { name: 'Save' }))
    act(() => pendingSave.finish?.(false))

    expect(where()).toBe('/page')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not ask when only the query of the same page changes', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('link', { name: 'Same page' }))

    expect(where()).toBe('/page?tab=2')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  describe('a page that confirms its own save (confirming)', () => {
    async function requestSaveFromPrompt() {
      const user = userEvent.setup()
      const rendered = renderPage({ confirmsSave: true })
      await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
      await user.click(within(leavePrompt()).getByRole('button', { name: 'Save' }))
      return { user, ...rendered }
    }

    it('asks Cancel, Discard or Save as before while nothing is being confirmed', async () => {
      const user = userEvent.setup()
      const { router } = renderPage({ confirmsSave: true })

      await user.click(screen.getByRole('link', { name: 'Elsewhere' }))

      const prompt = leavePrompt()
      expect(within(prompt).getByRole('button', { name: 'Cancel' })).toBeEnabled()
      expect(within(prompt).getByRole('button', { name: 'Discard' })).toBeEnabled()
      expect(within(prompt).getByRole('button', { name: 'Save' })).toBeEnabled()
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')
    })

    it('hides the prompt and keeps the navigation held while the page confirms the save', async () => {
      const { router, onSave, onDiscard } = await requestSaveFromPrompt()

      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onDiscard).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByTestId('leave-unsaved-dialog')).not.toBeInTheDocument()
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')
    })

    it('keeps the navigation held, with the busy prompt, while the confirmed save runs', async () => {
      const { router, onSave } = await requestSaveFromPrompt()

      act(() => pendingConfirmation.confirm?.())

      expect(navigationHeld(router)).toBe(true)
      expectLeavePromptButtons('disabled')
      expect(where()).toBe('/page')
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('keeps holding, with the busy prompt, when the confirmation closes itself after Confirm', async () => {
      const { router, onSave, onDiscard } = await requestSaveFromPrompt()

      confirmThenClose()

      expect(navigationHeld(router)).toBe(true)
      expectLeavePromptButtons('disabled')
      expect(where()).toBe('/page')
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('leaves when the save ends clean after the confirmation closed itself', async () => {
      const { router, onDiscard } = await requestSaveFromPrompt()

      confirmThenClose()
      act(() => pendingSave.finish?.(true))

      expect(where()).toBe('/elsewhere')
      expect(navigationHeld(router)).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('drops the navigation and stays when the save ends dirty after the confirmation closed itself', async () => {
      const { router, onDiscard } = await requestSaveFromPrompt()

      confirmThenClose()
      expect(navigationHeld(router)).toBe(true)
      act(() => pendingSave.finish?.(false))

      expect(where()).toBe('/page')
      expect(navigationHeld(router)).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('leaves once the confirmed save succeeds', async () => {
      const { router, onDiscard } = await requestSaveFromPrompt()

      act(() => pendingConfirmation.confirm?.())
      act(() => pendingSave.finish?.(true))

      expect(where()).toBe('/elsewhere')
      expect(navigationHeld(router)).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('leaves when the confirmation closes with the page already clean', async () => {
      const { router } = await requestSaveFromPrompt()

      act(() => pendingConfirmation.confirmAlreadySaved?.())

      expect(where()).toBe('/elsewhere')
      expect(navigationHeld(router)).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('stays on the page with its changes when the confirmed save fails', async () => {
      const { router } = await requestSaveFromPrompt()
      expect(navigationHeld(router)).toBe(true)

      act(() => pendingConfirmation.confirm?.())
      act(() => pendingSave.finish?.(false))

      expect(where()).toBe('/page')
      expect(navigationHeld(router)).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('stays on the page with its changes when the confirmation is dismissed', async () => {
      const { router, onDiscard } = await requestSaveFromPrompt()
      expect(navigationHeld(router)).toBe(true)

      act(() => pendingConfirmation.dismiss?.())

      expect(where()).toBe('/page')
      expect(navigationHeld(router)).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('asks again on the next try after a dismissed confirmation', async () => {
      const { user, router } = await requestSaveFromPrompt()
      expect(navigationHeld(router)).toBe(true)

      act(() => pendingConfirmation.dismiss?.())
      await user.click(screen.getByRole('link', { name: 'Elsewhere' }))

      expect(leavePrompt()).toBeInTheDocument()
      expect(where()).toBe('/page')
    })

    it('holds a history move the same way while the page confirms the save', async () => {
      const user = userEvent.setup()
      const { router } = renderPage({ confirmsSave: true, history: ['/before', '/page'] })

      await act(async () => {
        await router.navigate(-1)
      })
      await user.click(within(leavePrompt()).getByRole('button', { name: 'Save' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')
    })
  })

  describe('a confirmation already open when the user tries to leave', () => {
    async function leaveWithConfirmationOpen() {
      const user = userEvent.setup()
      const rendered = renderPage({ confirmsSave: true })
      await user.click(screen.getByRole('button', { name: 'Save the page' }))
      await user.click(screen.getByRole('link', { name: 'Elsewhere' }))
      return { user, ...rendered }
    }

    it('waits behind the confirmation: no prompt, navigation held', async () => {
      const { router, onSave, onDiscard } = await leaveWithConfirmationOpen()

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.queryByTestId('leave-unsaved-dialog')).not.toBeInTheDocument()
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('asks once the confirmation is dismissed and the page is still dirty', async () => {
      const { router, onSave, onDiscard } = await leaveWithConfirmationOpen()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      act(() => pendingConfirmation.dismiss?.())

      expectLeavePromptButtons('enabled')
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('Cancel in that prompt stays on the page with its changes', async () => {
      const { user, router, onSave, onDiscard } = await leaveWithConfirmationOpen()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      act(() => pendingConfirmation.dismiss?.())
      await user.click(within(leavePrompt()).getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(navigationHeld(router)).toBe(false)
      expect(where()).toBe('/page')
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('Discard in that prompt drops the changes and leaves', async () => {
      const consoleError = vi.spyOn(console, 'error')
      try {
        const { user, onSave, onDiscard } = await leaveWithConfirmationOpen()
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

        act(() => pendingConfirmation.dismiss?.())
        await user.click(within(leavePrompt()).getByRole('button', { name: 'Discard' }))

        expect(onDiscard).toHaveBeenCalledTimes(1)
        expect(onSave).toHaveBeenCalledTimes(1)
        expect(where()).toBe('/elsewhere')
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(consoleError).not.toHaveBeenCalled()
      } finally {
        consoleError.mockRestore()
      }
    })

    it('Save in that prompt asks the page to save and waits behind its confirmation again', async () => {
      const { user, router, onSave, onDiscard } = await leaveWithConfirmationOpen()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      act(() => pendingConfirmation.dismiss?.())
      await user.click(within(leavePrompt()).getByRole('button', { name: 'Save' }))

      expect(onSave).toHaveBeenCalledTimes(2)
      expect(onDiscard).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')

      confirmThenClose()
      act(() => pendingSave.finish?.(true))

      expect(where()).toBe('/elsewhere')
    })

    it('leaves when the confirmation closes with the page already clean', async () => {
      const { router, onDiscard } = await leaveWithConfirmationOpen()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(navigationHeld(router)).toBe(true)

      act(() => pendingConfirmation.confirmAlreadySaved?.())

      expect(where()).toBe('/elsewhere')
      expect(navigationHeld(router)).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('shows the busy prompt while the save started from the confirmation runs', async () => {
      const { router, onSave } = await leaveWithConfirmationOpen()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      confirmThenClose()

      expectLeavePromptButtons('disabled')
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('leaves once that save ends clean', async () => {
      const { router, onSave, onDiscard } = await leaveWithConfirmationOpen()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      confirmThenClose()
      act(() => pendingSave.finish?.(true))

      expect(where()).toBe('/elsewhere')
      expect(navigationHeld(router)).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('asks when that save ends dirty', async () => {
      const { router, onSave, onDiscard } = await leaveWithConfirmationOpen()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      confirmThenClose()
      act(() => pendingSave.finish?.(false))

      expectLeavePromptButtons('enabled')
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(onDiscard).not.toHaveBeenCalled()
    })

    it('waits behind the confirmation on a history move too, then asks when it is dismissed', async () => {
      const user = userEvent.setup()
      const { router } = renderPage({ confirmsSave: true, history: ['/before', '/page'] })
      await user.click(screen.getByRole('button', { name: 'Save the page' }))

      await act(async () => {
        await router.navigate(-1)
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')

      act(() => pendingConfirmation.dismiss?.())

      expectLeavePromptButtons('enabled')
      expect(navigationHeld(router)).toBe(true)
      expect(where()).toBe('/page')
    })

    it('leaves a clean page at once even while a confirmation is open', async () => {
      const user = userEvent.setup()
      renderPage({ confirmsSave: true, startDirty: false })
      await user.click(screen.getByRole('button', { name: 'Save the page' }))

      await user.click(screen.getByRole('link', { name: 'Elsewhere' }))

      expect(where()).toBe('/elsewhere')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
