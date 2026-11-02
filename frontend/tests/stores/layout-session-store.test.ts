/**
 * Layout session store: the layout choices a user makes, kept for the browser
 * session. A page load in the same tab reads them back; a new tab starts without them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLayoutSessionStore } from '@/stores/layout-session-store'

const STORAGE_KEY = 'wave-layout-session'

async function afterAPageLoad() {
  vi.resetModules()
  const reloaded = await import('@/stores/layout-session-store')
  return reloaded.useLayoutSessionStore
}

describe('useLayoutSessionStore', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useLayoutSessionStore.setState(useLayoutSessionStore.getInitialState(), true)
  })

  it('holds no choice at first', () => {
    expect(useLayoutSessionStore.getState().values).toEqual({})
  })

  it('keeps a choice under its key and leaves the other keys alone', () => {
    useLayoutSessionStore.getState().setValue('a.open', false)
    useLayoutSessionStore.getState().setValue('b.width', 320)
    useLayoutSessionStore.getState().setValue('a.open', true)

    expect(useLayoutSessionStore.getState().values).toEqual({ 'a.open': true, 'b.width': 320 })
  })

  it('writes the choices to the tab, not to the browser', () => {
    useLayoutSessionStore.getState().setValue('a.open', false)

    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}').state.values).toEqual({
      'a.open': false,
    })
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('reads the choices back after a page load in the same tab', async () => {
    useLayoutSessionStore.getState().setValue('a.open', false)

    const reloaded = await afterAPageLoad()

    expect(reloaded.getState().values).toEqual({ 'a.open': false })
  })

  it('starts without them in a new tab', async () => {
    useLayoutSessionStore.getState().setValue('a.open', false)
    sessionStorage.clear()

    const reloaded = await afterAPageLoad()

    expect(reloaded.getState().values).toEqual({})
  })

  it.each(['"not a record"', 'null', '[true]'])(
    'starts without them when the tab holds %s in their place',
    async (stored) => {
      sessionStorage.setItem(STORAGE_KEY, `{"state":{"values":${stored}},"version":0}`)

      const reloaded = await afterAPageLoad()

      expect(reloaded.getState().values).toEqual({})
    },
  )
})
