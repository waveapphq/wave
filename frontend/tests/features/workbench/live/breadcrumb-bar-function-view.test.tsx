/** LiveBreadcrumbBar in the library View (REQ-3.1.1.4, FN-BC-3, FN-BC-4, VIEW-2, VIEW-10). */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'

vi.mock('@/features/workbench/hooks/use-workbench-run', () => ({
  useWorkbenchRun: () => ({ executionId: null, sessionTestName: null, parentExecutionId: null }),
}))
vi.mock('@/features/suites/api/crud', () => ({ fetchSuiteDetail: vi.fn() }))
vi.mock('@/features/regressions/api/crud', () => ({ fetchRegressionDetail: vi.fn() }))
vi.mock('@/features/executions/api/executions', () => ({ fetchExecution: vi.fn() }))

import { LiveBreadcrumbBar } from '@/features/workbench/live/breadcrumb-bar'
import { FunctionViewLeaveNotice } from '@/features/workbench/live/edit-mode-notice'
import { useFunctionViewLeave } from '@/features/workbench/live/use-function-view-leave'
import { useWorkflowStore, type NodeType } from '@/features/workbench/stores/workflow-store'
import type { SharedFunctionBody } from '@/features/functions/canvas/shared-function-body'

const VIEW_URL = '/workbench?viewFunction=fn-outer&version=1.0.0'
const ROOT_ID = 'view-shared-root'

function plugin(id: string, label: string): NodeType {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: { label, elementType: 'log', nodeType: 'plugin' },
  } as NodeType
}

function sharedFunction(id: string, label: string, functionId: string): NodeType {
  return {
    id,
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label,
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId,
      functionVersion: '1.0.0',
    },
  } as NodeType
}

function body(nodes: NodeType[]): SharedFunctionBody {
  return { workflow: { nodes, edges: [] }, inputs: [], outputs: [], variables: [] }
}

const OUTER_BODY = body([plugin('outer-log', 'Outer Log'), sharedFunction('inner-call', 'Inner', 'fn-inner')])
const INNER_BODY = body([
  plugin('inner-log', 'Inner Log'),
  sharedFunction('innermost-call', 'Innermost', 'fn-innermost'),
])
const INNERMOST_BODY = body([plugin('innermost-log', 'Innermost Log')])

function openViewAtRoot(editMode: boolean): void {
  const store = useWorkflowStore.getState()
  store.reset()
  store.enterFunctionView({ functionId: 'fn-outer', version: '1.0.0', editable: false, name: 'Outer' })
  store.setNodes([sharedFunction(ROOT_ID, 'Outer', 'fn-outer')], { skipDirty: true })
  store.pushSharedDrill(ROOT_ID, OUTER_BODY)
  if (editMode) {
    const root = useWorkflowStore.getState().nodes[0]
    store.applyEditModeEntered(
      ROOT_ID,
      {
        ...root.data,
        editMode: true,
        upstreamLink: { functionId: 'fn-outer', sourceVersion: '1.0.0' },
        draft: OUTER_BODY,
      },
      false,
    )
  }
}

function openViewDrilledIntoInner(editMode: boolean): void {
  openViewAtRoot(editMode)
  useWorkflowStore.getState().pushSharedDrill('inner-call', INNER_BODY)
}

function openViewDrilledIntoInnermost(): void {
  openViewDrilledIntoInner(false)
  useWorkflowStore.getState().pushSharedDrill('innermost-call', INNERMOST_BODY)
}

function LocationProbe() {
  const { pathname, search } = useLocation()
  return <output data-testid="location">{`${pathname}${search}`}</output>
}

const clearDraft = vi.fn()

function ViewHarness() {
  const leave = useFunctionViewLeave({ onCanvasClosed: vi.fn(), clearDraft })
  return (
    <>
      <LiveBreadcrumbBar status="idle" />
      <FunctionViewLeaveNotice open={leave.noticeOpen} onAcknowledge={leave.acknowledge} onCancel={leave.cancel} />
      <LocationProbe />
    </>
  )
}

function renderBar() {
  const router = createMemoryRouter([{ path: '*', element: <ViewHarness /> }], {
    initialEntries: [VIEW_URL],
  })
  return render(<RouterProvider router={router} />)
}

function drillIds(): string[] {
  return useWorkflowStore.getState().drillPath.map((entry) => entry.nodeId)
}

function activeNodeIds(): string[] {
  return useWorkflowStore.getState().getActiveNodes().map((node) => node.id)
}

function rootInEditMode(): boolean {
  const data = useWorkflowStore.getState().nodes[0].data as Record<string, unknown>
  return data.editMode === true
}

function breadcrumbText(): string | null {
  return screen.getByTestId('breadcrumb-path').textContent
}

function locationText(): string | null {
  return screen.getByTestId('location').textContent
}

function expectOuterBodyInView(editMode: boolean): void {
  expect(drillIds()).toEqual([ROOT_ID])
  expect(activeNodeIds()).toEqual(['outer-log', 'inner-call'])
  expect(breadcrumbText()).toBe('Outer')
  expect(locationText()).toBe(VIEW_URL)
  expect(rootInEditMode()).toBe(editMode)
}

describe.each([
  ['read-only', false],
  ['edit mode', true],
])('LiveBreadcrumbBar - library View drilled into an inner Function (%s)', (_mode, editMode) => {
  it('starts drilled into the inner Function under the View root', () => {
    openViewDrilledIntoInner(editMode)
    renderBar()

    expect(drillIds()).toEqual([ROOT_ID, 'inner-call'])
    expect(activeNodeIds()).toEqual(['inner-log', 'innermost-call'])
    expect(breadcrumbText()).toBe('Outer/Inner')
  })

  it('clicking the root Function segment shows the outer body and keeps the View address', async () => {
    const user = userEvent.setup()
    openViewDrilledIntoInner(editMode)
    renderBar()

    await user.click(screen.getByText('Outer'))

    expectOuterBodyInView(editMode)
  })

  it('the back arrow pops one level and stays in the View', async () => {
    const user = userEvent.setup()
    openViewDrilledIntoInner(editMode)
    renderBar()

    await user.click(screen.getByTestId('breadcrumb-back-arrow'))

    expectOuterBodyInView(editMode)
  })
})

describe('LiveBreadcrumbBar - library View three levels deep', () => {
  it('the back arrow from the innermost Function lands on the middle one', async () => {
    const user = userEvent.setup()
    openViewDrilledIntoInnermost()
    renderBar()
    expect(breadcrumbText()).toBe('Outer/Inner/Innermost')

    await user.click(screen.getByTestId('breadcrumb-back-arrow'))

    expect(drillIds()).toEqual([ROOT_ID, 'inner-call'])
    expect(activeNodeIds()).toEqual(['inner-log', 'innermost-call'])
    expect(breadcrumbText()).toBe('Outer/Inner')
    expect(locationText()).toBe(VIEW_URL)
  })

  it('clicking the middle segment from the innermost Function lands on the middle one', async () => {
    const user = userEvent.setup()
    openViewDrilledIntoInnermost()
    renderBar()

    await user.click(screen.getByText('Inner'))

    expect(drillIds()).toEqual([ROOT_ID, 'inner-call'])
    expect(breadcrumbText()).toBe('Outer/Inner')
    expect(locationText()).toBe(VIEW_URL)
  })

  it('clicking the root segment from the innermost Function lands on the View root', async () => {
    const user = userEvent.setup()
    openViewDrilledIntoInnermost()
    renderBar()

    await user.click(screen.getByText('Outer'))

    expectOuterBodyInView(false)
  })
})

describe('LiveBreadcrumbBar - library View at its own root', () => {
  it('the back arrow returns to the Function detail page with no notice when read-only', async () => {
    const user = userEvent.setup()
    openViewAtRoot(false)
    renderBar()

    await user.click(screen.getByTestId('breadcrumb-back-arrow'))

    expect(screen.queryByTestId('function-view-leave-notice')).not.toBeInTheDocument()
    expect(drillIds()).toEqual([ROOT_ID])
    expect(locationText()).toBe('/functions/fn-outer')
  })

  it('the back arrow in edit mode returns to the detail page with no notice and keeps the draft', async () => {
    const user = userEvent.setup()
    clearDraft.mockClear()
    openViewAtRoot(true)
    renderBar()

    await user.click(screen.getByTestId('breadcrumb-back-arrow'))

    expect(screen.queryByTestId('function-view-leave-notice')).not.toBeInTheDocument()
    expect(locationText()).toBe('/functions/fn-outer')
    expect(useWorkflowStore.getState().functionViewMode).not.toBeNull()
    expect(rootInEditMode()).toBe(true)
    expect(clearDraft).not.toHaveBeenCalled()
  })
})
