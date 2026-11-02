/** useFunctionViewLeave: only Close drops a View's edit-mode draft, so only Close raises the notice (VIEW-10). */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'

import {
  useFunctionViewLeave,
  type FunctionViewLeave,
} from '@/features/workbench/live/use-function-view-leave'
import { useWorkflowStore, type NodeType } from '@/features/workbench/stores/workflow-store'

const VIEW_URL = '/workbench?viewFunction=fn-outer&version=1.0.0'
const DETAIL_URL = '/functions/fn-outer'
const ROOT_ID = 'view-shared-root'

function sharedRoot(): NodeType {
  return {
    id: ROOT_ID,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'Outer',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: 'fn-outer',
      functionVersion: '1.0.0',
    },
  } as NodeType
}

function enterEditMode(): void {
  const store = useWorkflowStore.getState()
  store.applyEditModeEntered(
    ROOT_ID,
    {
      ...store.nodes[0].data,
      editMode: true,
      upstreamLink: { functionId: 'fn-outer', sourceVersion: '1.0.0' },
    },
    false,
  )
}

function openView(editMode: boolean): void {
  const store = useWorkflowStore.getState()
  store.reset()
  store.enterFunctionView({ functionId: 'fn-outer', version: '1.0.0', editable: false, name: 'Outer' })
  store.setNodes([sharedRoot()], { skipDirty: true })
  // The loaded root is the saved baseline, as the View boot leaves it.
  store.markSaved()
  if (editMode) enterEditMode()
}

let leave: FunctionViewLeave
const onCanvasClosed = vi.fn()
const clearDraft = vi.fn()

function Harness() {
  leave = useFunctionViewLeave({ onCanvasClosed, clearDraft })
  return null
}

function renderLeave() {
  const router = createMemoryRouter([{ path: '*', element: <Harness /> }], {
    initialEntries: [VIEW_URL],
  })
  render(<RouterProvider router={router} />)
  return router
}

type TestRouter = ReturnType<typeof renderLeave>

function locationOf(router: TestRouter): string {
  return `${router.state.location.pathname}${router.state.location.search}`
}

async function goTo(router: TestRouter, to: string): Promise<void> {
  await act(async () => {
    await router.navigate(to)
  })
}

async function acknowledge(): Promise<void> {
  await act(async () => {
    leave.acknowledge()
  })
}

function viewOpen(): boolean {
  return useWorkflowStore.getState().functionViewMode !== null
}

beforeEach(() => {
  onCanvasClosed.mockClear()
  clearDraft.mockClear()
})

describe('useFunctionViewLeave - leaving the page', () => {
  it('lets a read-only View go with no notice', async () => {
    openView(false)
    const router = renderLeave()

    await goTo(router, DETAIL_URL)

    expect(locationOf(router)).toBe(DETAIL_URL)
    expect(leave.noticeOpen).toBe(false)
    expect(clearDraft).not.toHaveBeenCalled()
  })

  // A page change keeps the draft; the switch dialog guards it when something else opens.
  it.each([
    ['the Functions page', '/functions'],
    ['the Tests page', '/tests'],
    ['the Function detail page', DETAIL_URL],
  ])('lets an edit-mode View go to %s with no notice and keeps the draft', async (_page, to) => {
    openView(true)
    const router = renderLeave()

    await goTo(router, to)

    expect(locationOf(router)).toBe(to)
    expect(leave.noticeOpen).toBe(false)
    expect(viewOpen()).toBe(true)
    expect(useWorkflowStore.getState().hasEditModeNodes()).toBe(true)
    expect(useWorkflowStore.getState().isDirty).toBe(true)
    expect(onCanvasClosed).not.toHaveBeenCalled()
    expect(clearDraft).not.toHaveBeenCalled()
  })

  it('does not treat a version change inside the View as leaving it', async () => {
    openView(true)
    const router = renderLeave()

    await goTo(router, '/workbench?viewFunction=fn-outer&version=1.1.0')

    expect(locationOf(router)).toBe('/workbench?viewFunction=fn-outer&version=1.1.0')
    expect(leave.noticeOpen).toBe(false)
  })

  it('never holds an in-Test edit-mode Function', async () => {
    openView(true)
    useWorkflowStore.getState().exitFunctionView()
    const router = renderLeave()

    await goTo(router, '/tests')

    expect(locationOf(router)).toBe('/tests')
    expect(leave.noticeOpen).toBe(false)
    expect(useWorkflowStore.getState().hasEditModeNodes()).toBe(true)
  })
})

describe('useFunctionViewLeave - Close', () => {
  it('closes a read-only View back to /workbench at once', async () => {
    openView(false)
    const router = renderLeave()

    await act(async () => {
      leave.close()
    })

    expect(leave.noticeOpen).toBe(false)
    expect(viewOpen()).toBe(false)
    expect(locationOf(router)).toBe('/workbench')
    expect(onCanvasClosed).toHaveBeenCalledTimes(1)
    expect(clearDraft).toHaveBeenCalledTimes(1)
  })

  it('shows the notice first for an edit-mode View, then closes on OK', async () => {
    openView(true)
    const router = renderLeave()

    await act(async () => {
      leave.close()
    })

    expect(leave.noticeOpen).toBe(true)
    expect(viewOpen()).toBe(true)
    expect(locationOf(router)).toBe(VIEW_URL)

    await acknowledge()

    expect(leave.noticeOpen).toBe(false)
    expect(viewOpen()).toBe(false)
    expect(locationOf(router)).toBe('/workbench')
    expect(clearDraft).toHaveBeenCalledTimes(1)
  })

  it('keeps the View and its draft when the notice is dismissed instead of OK', async () => {
    openView(true)
    const router = renderLeave()

    await act(async () => {
      leave.close()
    })
    await act(async () => {
      leave.cancel()
    })

    expect(leave.noticeOpen).toBe(false)
    expect(viewOpen()).toBe(true)
    expect(useWorkflowStore.getState().hasEditModeNodes()).toBe(true)
    expect(useWorkflowStore.getState().isDirty).toBe(true)
    expect(locationOf(router)).toBe(VIEW_URL)
    expect(onCanvasClosed).not.toHaveBeenCalled()
    expect(clearDraft).not.toHaveBeenCalled()

    await acknowledge()

    expect(viewOpen()).toBe(true)
    expect(locationOf(router)).toBe(VIEW_URL)
  })

  it('changes nothing when OK arrives with no exit waiting', async () => {
    openView(false)
    const router = renderLeave()

    await acknowledge()

    expect(viewOpen()).toBe(true)
    expect(locationOf(router)).toBe(VIEW_URL)
    expect(clearDraft).not.toHaveBeenCalled()
  })
})
