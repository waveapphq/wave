/**
 * Suite Variables Table Tests
 *
 * Tests for the shared VariableReadonlyTable as used by suite detail sidebar.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VariableReadonlyTable } from '@/components/shared/variable-editor/variable-readonly-table'
import type { VariableType } from '@/lib/variable-types'

interface TestVariable {
  type: VariableType
  value: string
  secret: boolean
}

describe('VariableReadonlyTable (suite variables)', () => {
  it('renders empty state when no variables', () => {
    render(<VariableReadonlyTable variables={{}} />)

    expect(screen.getByTestId('variable-readonly-table')).toBeInTheDocument()
    expect(screen.getByText('No variables defined')).toBeInTheDocument()
  })

  it('renders variable entries with name and type badge', () => {
    const variables: Record<string, TestVariable> = {
      base_url: { type: 'string', value: 'http://localhost', secret: false },
      timeout: { type: 'integer', value: '30', secret: false },
    }

    render(<VariableReadonlyTable variables={variables} />)

    expect(screen.getByText('base_url')).toBeInTheDocument()
    expect(screen.getByText('string')).toBeInTheDocument()
    expect(screen.getByText('timeout')).toBeInTheDocument()
    expect(screen.getByText('integer')).toBeInTheDocument()
  })

  it('displays formatted values with color coding', () => {
    const variables: Record<string, TestVariable> = {
      url: { type: 'string', value: 'http://localhost', secret: false },
      count: { type: 'integer', value: '30', secret: false },
    }

    render(<VariableReadonlyTable variables={variables} />)

    // String values render raw (no wrapping quotes)
    expect(screen.getByText('http://localhost')).toBeInTheDocument()
    // Integer values rendered as-is
    expect(screen.getByText('30')).toBeInTheDocument()
  })

  it('shows masked value for secret variables', () => {
    const variables: Record<string, TestVariable> = {
      api_key: { type: 'string', value: 'secret-value', secret: true },
    }

    render(<VariableReadonlyTable variables={variables} />)

    expect(screen.getByText('********')).toBeInTheDocument()
    expect(screen.queryByText('secret-value')).not.toBeInTheDocument()
  })

  it('shows lock icon for secret variables', () => {
    const variables: Record<string, TestVariable> = {
      api_key: { type: 'string', value: 'secret', secret: true },
      public_var: { type: 'string', value: 'visible', secret: false },
    }

    const { container } = render(<VariableReadonlyTable variables={variables} />)

    // Lock icon should be rendered for secret variable (svg with Lock class)
    const lockIcons = container.querySelectorAll('.lucide-lock')
    expect(lockIcons).toHaveLength(1)
  })

  it('renders correct number of rows', () => {
    const variables: Record<string, TestVariable> = {
      var1: { type: 'string', value: 'a', secret: false },
      var2: { type: 'boolean', value: 'true', secret: false },
      var3: { type: 'float', value: '3.14', secret: false },
    }

    render(<VariableReadonlyTable variables={variables} />)

    expect(screen.getAllByTestId('variable-row')).toHaveLength(3)
  })

  it('displays type badges for all variable types', () => {
    const variables: Record<string, TestVariable> = {
      s: { type: 'string', value: 'hello', secret: false },
      i: { type: 'integer', value: '42', secret: false },
      f: { type: 'float', value: '3.14', secret: false },
      b: { type: 'boolean', value: 'true', secret: false },
    }

    render(<VariableReadonlyTable variables={variables} />)

    expect(screen.getByText('string')).toBeInTheDocument()
    expect(screen.getByText('integer')).toBeInTheDocument()
    expect(screen.getByText('float')).toBeInTheDocument()
    expect(screen.getByText('boolean')).toBeInTheDocument()
  })
})
