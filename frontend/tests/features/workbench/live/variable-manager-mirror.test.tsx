/**
 * LiveVariableManager mirror read-only: while mirroring a
 * holder's draft the Variable Manager is read-only even though the drill scope
 * is editable (useReadOnlyCanvas false). Complements readonly-enforcement.test
 * (which covers the drilled-Shared scope=true branch).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('@/features/workbench/common/canvas/use-readonly-canvas', () => ({
  useReadOnlyCanvas: () => false,
}))

let capturedContentProps: Record<string, unknown> = {}
vi.mock('@/features/workbench/common/variables/variable-manager-content/content', () => ({
  VariableManagerContent: (props: Record<string, unknown>) => {
    capturedContentProps = props
    return <div data-testid="variable-manager-content-mock" />
  },
}))
vi.mock('@/features/workbench/common/variables/variable-manager-panel', () => ({
  VariableManagerPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import { LiveVariableManager } from '@/features/workbench/live/variable-manager'

const onVariableCurrentEdit = vi.fn()

function renderVM(readOnly: boolean) {
  const props = {
    collapsed: false,
    onCollapsedChange: vi.fn(),
    readOnly,
    onVariableCurrentEdit,
  } as unknown as Parameters<typeof LiveVariableManager>[0]
  render(<LiveVariableManager {...props} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  capturedContentProps = {}
})

describe('LiveVariableManager - mirror read-only', () => {
  it('forces read-only content while mirroring even when the scope is editable', () => {
    renderVM(true)
    expect(capturedContentProps.readOnly).toBe(true)
  })

  it('leaves content editable when neither mirroring nor a read-only scope', () => {
    renderVM(false)
    expect(capturedContentProps.readOnly).toBe(false)
  })

  it('withholds the Current edit handler while mirroring', () => {
    renderVM(true)
    expect(capturedContentProps.onVariableCurrentEdit).toBeUndefined()
  })

  it('passes the Current edit handler when not mirroring', () => {
    renderVM(false)
    expect(capturedContentProps.onVariableCurrentEdit).toBe(onVariableCurrentEdit)
  })
})
