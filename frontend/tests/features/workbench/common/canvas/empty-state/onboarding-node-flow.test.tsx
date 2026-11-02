/**
 * OnboardingNodeFlow - inner Function copy adaptation.
 *
 * Contract:
 *   - Outside a Function (drillPath empty): "Drag a plugin from the palette
 *     to add your first step".
 *   - Inside a Function (drillPath non-empty): "Drag a plugin to define
 *     what this Function does."
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

interface StoreShape {
  drillPath: Array<{ nodeId: string; label: string }>
}

const mockStore: StoreShape = { drillPath: [] }

vi.mock('@/features/workbench/stores/workflow-store', () => ({
  useWorkflowStore: (selector?: (s: StoreShape) => unknown) =>
    selector ? selector(mockStore) : mockStore,
}))

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top' },
}))

import { OnboardingNodeFlow } from '@/features/workbench/common/canvas/empty-state/onboarding-node-flow'

describe('OnboardingNodeFlow - copy adapts to drill state', () => {
  it('renders the "first step" hint when drillPath is empty', () => {
    mockStore.drillPath = []
    render(<OnboardingNodeFlow />)
    expect(screen.getByTestId('onboarding-hint').textContent ?? '').toMatch(/add your first step/)
  })

  it('renders the in-Function hint when drillPath is non-empty', () => {
    mockStore.drillPath = [{ nodeId: 'fn-1', label: 'Function_1' }]
    render(<OnboardingNodeFlow />)
    expect(screen.getByTestId('onboarding-hint').textContent ?? '').toMatch(/define[\s\S]*what this Function does/)
  })
})
