/**
 * ValidationErrorDialog renders path-aware rows when an error carries a
 * `functionPath` trail.
 *
 * The dialog drives Save/Run/Debug/Load modes, and a
 * row whose error has a `functionPath` renders the enclosing-Function
 * segments + leaf + message.
 * A top-level error (no `functionPath`) renders a single leaf segment.
 *
 * The trail field is `functionPath` (NOT `path`): `ValidationError.path` is
 * already the dotted-string locator the canonical pipeline emits, so the
 * root-to-leaf trail rides on a dedicated field mirroring the backend's
 * `function_path` key.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import {
  ValidationErrorDialog,
  mapFunctionPath,
} from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import type { ValidationError } from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'

const nestedError: ValidationError = {
  path: 'nodes[0].data.config.values.message',
  functionPath: [{ label: 'Outer_Fn' }, { label: 'Inner_Fn' }],
  node_id: 'log-1',
  node_label: 'Log_1',
  code: 'REQUIRED_PARAM_MISSING',
  message: "Required parameter 'message' is missing",
  severity: 'error',
}

const topLevelError: ValidationError = {
  path: 'nodes[1].data.config.values.url',
  node_id: 'http-1',
  node_label: 'HTTP_1',
  code: 'REQUIRED_PARAM_MISSING',
  message: "Required parameter 'url' is missing",
  severity: 'error',
}

describe('ValidationErrorDialog - path-aware rows', () => {
  it('renders each enclosing-Function segment as a button', () => {
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        mode="save"
        errors={[nestedError]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Outer_Fn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inner_Fn' })).toBeInTheDocument()
  })

  it('renders the failing leaf and its message', () => {
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        mode="save"
        errors={[nestedError]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Log_1' })).toBeInTheDocument()
    expect(
      screen.getByText("Required parameter 'message' is missing"),
    ).toBeInTheDocument()
  })

  it('renders a top-level error as a single leaf segment with no enclosing path', () => {
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        mode="save"
        errors={[topLevelError]}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'HTTP_1' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Outer_Fn' })).not.toBeInTheDocument()
  })

  it('invokes onNavigateToIssue when a path row segment is activated', async () => {
    const onNavigateToIssue = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        mode="save"
        errors={[nestedError]}
        onClose={vi.fn()}
        onNavigateToIssue={onNavigateToIssue}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Inner_Fn' }))
    expect(onNavigateToIssue).toHaveBeenCalled()
  })

  it('invokes onNavigateToIssue when the leaf is activated', async () => {
    const onNavigateToIssue = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        mode="save"
        errors={[nestedError]}
        onClose={vi.fn()}
        onNavigateToIssue={onNavigateToIssue}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Log_1' }))
    expect(onNavigateToIssue).toHaveBeenCalled()
  })

  it('does not crash when a row is activated without an onNavigateToIssue handler', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    render(
      <ValidationErrorDialog
        isOpen
        fatal={false}
        mode="save"
        errors={[nestedError]}
        onClose={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Log_1' }))
    expect(screen.getByRole('button', { name: 'Log_1' })).toBeInTheDocument()
  })
})

describe('mapFunctionPath', () => {
  it('returns undefined for a non-array (top-level issue)', () => {
    expect(mapFunctionPath(undefined)).toBeUndefined()
  })

  it('maps backend segments to { label, nodeId }', () => {
    expect(
      mapFunctionPath([{ node_id: 'o1', label: 'Outer', element_type: 'function' }]),
    ).toEqual([{ label: 'Outer', nodeId: 'o1' }])
  })

  it('defaults a missing label to an empty string', () => {
    expect(mapFunctionPath([{ node_id: 'x' }])).toEqual([{ label: '', nodeId: 'x' }])
  })

  it('tolerates a null segment', () => {
    expect(mapFunctionPath([null])).toEqual([{ label: '', nodeId: undefined }])
  })
})
