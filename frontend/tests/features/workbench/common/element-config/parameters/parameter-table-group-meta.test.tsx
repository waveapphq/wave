/**
 * ParameterTable - group metadata rendering (SSH-2, SSH-3).
 *
 * Groups render as contained cards: the header keeps the
 * group-header-<name> testid and click-to-toggle, and shows the group
 * name only; an expanded card renders the group description (when one exists) as a
 * compact footer note inside the card. Plugins without group meta keep the
 * collapsed name-only cards.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ParameterTable } from '@/features/workbench/common/element-config/parameters/parameter-table'
import type { Parameter } from '@/features/workbench/common/element-config/parameters/parameter-table-types'

const groupedParameters: Parameter[] = [
  {
    name: 'host',
    label: 'Host',
    type: 'string',
    required: true,
    description: 'Target host name or IP',
    group: 'Connection',
  },
  {
    name: 'username',
    label: 'Username',
    type: 'string',
    required: true,
    description: 'Login user',
    group: 'Connection',
  },
  {
    name: 'passphrase',
    label: 'Passphrase',
    type: 'string',
    required: false,
    description: 'Private key passphrase',
    group: 'Advanced',
  },
]

const GROUP_META = {
  Connection: {
    name: 'Connection',
    description: 'Target host and credentials',
    defaultExpanded: true,
  },
  Advanced: {
    name: 'Advanced',
    description: 'Host-key policy, timeouts, and session tuning',
  },
}

function renderTable(overrides: Record<string, unknown> = {}) {
  return render(
    <ParameterTable
      mode="input"
      parameters={groupedParameters}
      values={{}}
      onChange={() => {}}
      availableVariables={[]}
      {...overrides}
    />,
  )
}

describe('group meta - default expansion', () => {
  it('renders a defaultExpanded group expanded on mount', () => {
    renderTable({ groupMeta: GROUP_META })

    expect(screen.getByTestId('param-row-host')).toBeInTheDocument()
    expect(screen.getByTestId('param-row-username')).toBeInTheDocument()
  })

  it('renders a group without defaultExpanded collapsed on mount', () => {
    renderTable({ groupMeta: GROUP_META })

    expect(screen.queryByTestId('param-row-passphrase')).not.toBeInTheDocument()
  })

  it('keeps a defaultExpanded group collapsible via its header', () => {
    renderTable({ groupMeta: GROUP_META })

    fireEvent.click(screen.getByTestId('group-header-Connection'))

    expect(screen.queryByTestId('param-row-host')).not.toBeInTheDocument()
  })

  it('keeps a collapsed group expandable via its header', () => {
    renderTable({ groupMeta: GROUP_META })

    fireEvent.click(screen.getByTestId('group-header-Advanced'))

    expect(screen.getByTestId('param-row-passphrase')).toBeInTheDocument()
  })
})

describe('group meta - descriptions render as in-card footer notes', () => {
  it('renders the description of an expanded group as a footer note inside the card', () => {
    renderTable({ groupMeta: GROUP_META })

    expect(screen.getByTestId('group-footer-Connection')).toHaveTextContent(
      'Target host and credentials',
    )
  })

  it('renders no description anywhere for a collapsed group', () => {
    renderTable({ groupMeta: GROUP_META })

    expect(screen.queryByTestId('group-footer-Advanced')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Host-key policy, timeouts, and session tuning'),
    ).not.toBeInTheDocument()
  })

  it('renders the footer note after expanding a collapsed group', () => {
    renderTable({ groupMeta: GROUP_META })

    fireEvent.click(screen.getByTestId('group-header-Advanced'))

    expect(screen.getByTestId('group-footer-Advanced')).toHaveTextContent(
      'Host-key policy, timeouts, and session tuning',
    )
  })

  it('renders no footer for an expanded group without a description', () => {
    renderTable({
      groupMeta: {
        Connection: { name: 'Connection', defaultExpanded: true },
        Advanced: { name: 'Advanced' },
      },
    })

    expect(screen.queryByTestId('group-footer-Connection')).not.toBeInTheDocument()
  })

  it('still renders the group name in the card header', () => {
    renderTable({ groupMeta: GROUP_META })

    expect(screen.getByText('Connection')).toBeInTheDocument()
    expect(screen.getByText('Advanced')).toBeInTheDocument()
  })
})

describe('group meta - absent (today\'s behavior preserved)', () => {
  it('renders groups collapsed on mount without meta', () => {
    renderTable()

    expect(screen.queryByTestId('param-row-host')).not.toBeInTheDocument()
    expect(screen.queryByTestId('param-row-passphrase')).not.toBeInTheDocument()
  })

  it('renders name-only headers without meta', () => {
    renderTable()

    expect(screen.getByText('Connection')).toBeInTheDocument()
    expect(
      screen.queryByText('Target host and credentials'),
    ).not.toBeInTheDocument()
  })

  it('still toggles groups open by clicking the header without meta', () => {
    renderTable()

    fireEvent.click(screen.getByTestId('group-header-Connection'))

    expect(screen.getByTestId('param-row-host')).toBeInTheDocument()
  })
})

describe('output mode - (i) info affordance (SSH-5)', () => {
  it('renders the (i) description for an output param that has one', () => {
    render(
      <ParameterTable
        mode="output"
        parameters={[
          {
            name: 'session_id',
            label: 'Session ID',
            type: 'string',
            required: false,
            description: 'Handle for Execute / Close / Parent Session',
          },
        ]}
        values={{}}
        onChange={() => {}}
        availableVariables={[]}
      />,
    )

    // SHELL-7a: the description comes from the one shared tooltip rather
    // than a per-site hover panel, so it is revealed rather than always in DOM.
    fireEvent.focus(screen.getByTestId('output-row-session_id').querySelector('.cursor-help') as HTMLElement)
    expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
      'Handle for Execute / Close / Parent Session',
    )
  })

  it('renders no (i) cell content for an output param without a description', () => {
    render(
      <ParameterTable
        mode="output"
        parameters={[
          { name: 'hop_count', label: 'Hop Count', type: 'integer', required: false },
        ]}
        values={{}}
        onChange={() => {}}
        availableVariables={[]}
      />,
    )

    const row = screen.getByTestId('output-row-hop_count')
    const infoCell = row.querySelector('td')

    expect(infoCell).not.toBeNull()
    expect(infoCell!.textContent).toBe('')
    expect(infoCell!.querySelector('svg')).toBeNull()
  })
})
