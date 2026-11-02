/** The Profiles button of the Function Block window footer on both lifecycles (FN-LC-9, FN-LC-10, FN-LC-11, CANVAS-214). */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'

vi.mock(
  '@/features/workbench/common/element-config/dialogs/profile-binding-modal',
  () => ({
    ProfileBindingModal: (props: { isOpen: boolean }) =>
      props.isOpen ? <div data-testid="mock-profile-binding-modal" /> : null,
  }),
)

vi.mock('@/features/functions/hooks/use-function-versions', () => ({
  useFunctionVersions: (functionId: string) => ({
    versions: functionId
      ? [{ version: '1.0.0', published_at: '2026-01-01', changelog: '', details: '', description: '', tags: [] }]
      : [],
    latest: functionId ? '1.0.0' : '',
    isLoading: false,
    failed: false,
    retry: () => {},
  }),
}))

import { ConfigSheetHost } from '@/features/workbench/common/canvas/workflow-canvas/canvas'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'

interface StoredProfileBinding {
  profileId: string
  profileName: string
  profileType: string
  alias: string
  fields: Array<{ name: string; type: string }>
}

function binding(profileId: string): StoredProfileBinding {
  return { profileId, profileName: `Profile ${profileId}`, profileType: 'ssh', alias: profileId, fields: [] }
}

function localBlock(profileBindings: StoredProfileBinding[] = []) {
  return {
    id: 'fn-node-1',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'My Function',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'local',
      localDefinition: {
        name: 'My Function',
        description: '',
        inputs: [],
        outputs: [],
        variables: [],
        workflow: { nodes: [], edges: [] },
      },
      config: { values: {}, outputBindings: {}, profileBindings },
    },
  }
}

function publishedBlock(profileBindings: StoredProfileBinding[] = []) {
  return {
    id: 'fn-node-2',
    type: 'workflowNode',
    position: { x: 0, y: 0 },
    data: {
      label: 'Published Function',
      elementType: 'function',
      nodeType: 'function',
      functionLifecycle: 'shared',
      functionId: '00000000-0000-0000-0000-000000000001',
      functionVersion: '1.0.0',
      resolvedInputs: [],
      resolvedOutputs: [],
      config: { values: {}, outputBindings: {}, profileBindings },
    },
  }
}

/** Opens the Block's window the way the canvas does for an open sheet. */
function openWindow(node: { id: string }) {
  useWorkflowStore.setState({
    nodes: [node] as never,
    edges: [],
    variables: [],
    drillPath: [],
    openConfigNodeIds: [node.id],
  })
  render(
    <ReactFlowProvider>
      <ConfigSheetHost nodeId={node.id} cascadeIndex={0} />
    </ReactFlowProvider>,
  )
}

const profilesButton = () => screen.getByRole('button', { name: /^profiles$/i })

beforeEach(() => {
  useWorkflowStore.getState().reset()
})

describe('Function Block window - Profiles button, Local Function', () => {
  it('renders the footer on the shared Block window', () => {
    openWindow(localBlock())
    expect(screen.getByTestId('element-config-sheet')).toContainElement(profilesButton())
  })

  it('renders one Profiles button in the footer', () => {
    openWindow(localBlock())
    expect(screen.getAllByRole('button', { name: /^profiles$/i })).toHaveLength(1)
  })

  it('does not render Changelog or Details', () => {
    openWindow(localBlock())
    expect(screen.queryByRole('button', { name: /changelog/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /details/i })).not.toBeInTheDocument()
  })
})

describe('Function Block window - Profiles button, Shared Function', () => {
  it('renders Changelog, Details and Profiles in the footer', () => {
    openWindow(publishedBlock())
    expect(profilesButton()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /changelog/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /details/i })).toBeInTheDocument()
  })
})

describe('Function Block window - Profiles button opens the Profiles sheet', () => {
  it('opens the profile sheet on click', async () => {
    const user = userEvent.setup()
    openWindow(localBlock())
    expect(screen.queryByTestId('mock-profile-binding-modal')).not.toBeInTheDocument()
    await user.click(profilesButton())
    expect(screen.getByTestId('mock-profile-binding-modal')).toBeInTheDocument()
  })
})

describe('Function Block window - Profiles count badge', () => {
  it('shows no count badge when the Block has no profile bindings', () => {
    openWindow(localBlock())
    expect(profilesButton().querySelector('[data-testid="profiles-count-badge"]')).toBeNull()
  })

  it('shows the number of profile bindings the Local Function Block holds', () => {
    openWindow(localBlock([binding('a'), binding('b')]))
    expect(profilesButton().querySelector('[data-testid="profiles-count-badge"]')).toHaveTextContent(/^2$/)
  })

  it('shows the number of profile bindings the Shared Function Block holds', () => {
    openWindow(publishedBlock([binding('a')]))
    expect(profilesButton().querySelector('[data-testid="profiles-count-badge"]')).toHaveTextContent(/^1$/)
  })
})
