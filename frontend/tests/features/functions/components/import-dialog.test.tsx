/**
 * FunctionImportDialog adapter.
 *
 * Thin adapter over the shared ImportDialog, mirroring
 * tests/components/import-dialog.tsx. Because the Function backend already
 * returns the canonical shared shape (items/existing_id), the adapter just
 * wires the Function validate/import client + entityLabel="Function" into the
 * shared dialog and bubbles the completion result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Capture the props the adapter hands to the shared dialog.
const sharedProps: Record<string, unknown> = {}
vi.mock('@/components/shared/dialogs/import-dialog', () => ({
  ImportDialog: (props: Record<string, unknown>) => {
    Object.assign(sharedProps, props)
    return <div data-testid="shared-import-dialog">{String(props.entityLabel)}</div>
  },
}))

vi.mock('@/features/functions/api/export-import', () => ({
  validateFunctionImport: vi.fn(),
  importFunctions: vi.fn(),
}))

import { validateFunctionImport, importFunctions } from '@/features/functions/api/export-import'
import { FunctionImportDialog } from '@/features/functions/components/import-dialog'

const mockValidate = vi.mocked(validateFunctionImport)
const mockImport = vi.mocked(importFunctions)

beforeEach(() => {
  for (const key of Object.keys(sharedProps)) delete sharedProps[key]
  vi.clearAllMocks()
})

describe('FunctionImportDialog', () => {
  it('renders the shared dialog with entityLabel "Function"', () => {
    render(
      <FunctionImportDialog open onOpenChange={vi.fn()} onImportComplete={vi.fn()} />,
    )
    expect(screen.getByTestId('shared-import-dialog')).toHaveTextContent('Function')
    expect(sharedProps.entityLabel).toBe('Function')
  })

  it('wires onValidate to the Function validate client', async () => {
    const result = { items: [], total: 0, importable: 0, blocked: 0 }
    mockValidate.mockResolvedValue(result)
    render(
      <FunctionImportDialog open onOpenChange={vi.fn()} onImportComplete={vi.fn()} />,
    )
    const file = new File(['name: x\n'], 'x.yaml')
    const onValidate = sharedProps.onValidate as (f: File) => Promise<unknown>
    await expect(onValidate(file)).resolves.toEqual(result)
    expect(mockValidate).toHaveBeenCalledWith(file)
  })

  it('wires onImport to the Function import client with resolutions', async () => {
    const result = {
      imported: [],
      skipped: [],
      fixes_applied: [],
      total_imported: 0,
      total_skipped: 0,
    }
    mockImport.mockResolvedValue(result)
    render(
      <FunctionImportDialog open onOpenChange={vi.fn()} onImportComplete={vi.fn()} />,
    )
    const file = new File(['name: x\n'], 'x.yaml')
    const onImport = sharedProps.onImport as (
      f: File,
      r: Record<string, 'rename' | 'overwrite' | 'skip'>,
    ) => Promise<unknown>
    await expect(onImport(file, { Dup: 'overwrite' })).resolves.toEqual(result)
    expect(mockImport).toHaveBeenCalledWith(file, { Dup: 'overwrite' })
  })

  it('bubbles the completion result to onImportComplete', () => {
    const onImportComplete = vi.fn()
    render(
      <FunctionImportDialog open onOpenChange={vi.fn()} onImportComplete={onImportComplete} />,
    )
    const result = {
      imported: [{ name: 'x', id: 'id-1', action: 'created' as const }],
      skipped: [],
      fixes_applied: [],
      total_imported: 1,
      total_skipped: 0,
    }
    ;(sharedProps.onImportComplete as (r: unknown) => void)(result)
    expect(onImportComplete).toHaveBeenCalledWith(result)
  })
})
