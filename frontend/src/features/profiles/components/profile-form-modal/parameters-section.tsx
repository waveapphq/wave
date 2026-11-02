/**
 * ParametersSection - Parameters table with header and empty state
 *
 * PROFILE-33: "PARAMETERS" label
 * PROFILE-34: "+ Add" blue, right-aligned
 * PROFILE-35: Columns: Name | Type | Lock | Value | Actions
 * PROFILE-42: Empty state message
 */

import { useCallback } from 'react'
import { Lock, Plus } from 'lucide-react'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ParameterRow } from './parameter-row'
import type { Parameter } from './types'
import type { ElementTypes } from '@/lib/variable-validation'

const NO_PLAIN_TEXT: ReadonlySet<string> = new Set()

export interface ParametersSectionProps {
  parameters: Parameter[]
  selectedEnvId: string
  /** Parameter id -> the message of its out-of-bounds value. */
  valueErrors: Record<string, string>
  /** Names of the plain-text fields, whose value editors offer no format. */
  plainTextNames?: ReadonlySet<string>
  loading: boolean
  /** When true, parameter structure is locked (profile is in use). */
  structureLocked?: boolean
  /** Number of tests using this profile (drives the lock notice copy). */
  usage?: number
  onAddParameter: () => void
  onUpdateParameter: (id: string, updates: Partial<Parameter>) => void
  onUpdateParameterValue: (id: string, value: string, elementTypes?: ElementTypes) => void
  onDeleteParameter: (id: string) => void
}

export function ParametersSection({
  parameters,
  selectedEnvId,
  valueErrors,
  plainTextNames = NO_PLAIN_TEXT,
  loading,
  structureLocked = false,
  usage = 0,
  onAddParameter,
  onUpdateParameter,
  onUpdateParameterValue,
  onDeleteParameter,
}: Readonly<ParametersSectionProps>) {
  const nameExists = useCallback(
    (name: string, excludeId: string) =>
      parameters.some((p) => p.id !== excludeId && p.name === name),
    [parameters],
  )

  const testWord = usage === 1 ? 'test' : 'tests'
  const lockTitle = structureLocked
    ? `Parameter structure is locked: profile is in use by ${usage} ${testWord}. Values can still be edited.`
    : undefined

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Parameters
        </span>
        {structureLocked ? (
          <ConditionalTooltip content={lockTitle} disabled>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-disabled
              data-testid="add-parameter-btn"
              className={cn(
                'h-7 text-primary hover:text-primary opacity-50 cursor-not-allowed',
              )}
              onClick={(e) => e.preventDefault()}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add
            </Button>
          </ConditionalTooltip>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onAddParameter}
            disabled={loading}
            data-testid="add-parameter-btn"
            className="h-7 text-primary hover:text-primary"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>

      {structureLocked && (
        <p className="text-xs text-muted-foreground" role="note" data-testid="params-locked-notice">
          Parameter structure is locked: profile is in use by {usage} {testWord}. Values can still be edited.
        </p>
      )}

      <div className="rounded-md border border-border">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="py-2 pl-3 pr-2 text-left font-medium text-muted-foreground w-44">Name</th>
              <th className="py-2 px-2 text-left font-medium text-muted-foreground w-28">Type</th>
              <th className="py-2 px-2 text-center font-medium text-muted-foreground w-10">
                <Lock className="h-3.5 w-3.5 mx-auto" />
              </th>
              <th className="py-2 px-2 text-left font-medium text-muted-foreground">Value</th>
              <th className="py-2 px-2 text-center font-medium text-muted-foreground w-10"></th>
            </tr>
          </thead>
          <tbody>
            {parameters.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground">
                  No parameters yet. Click + Add to create one.
                </td>
              </tr>
            ) : (
              parameters.map((param) => (
                <ParameterRow
                  key={param.id}
                  parameter={param}
                  environmentId={selectedEnvId}
                  valueError={valueErrors[param.id]}
                  plainText={plainTextNames.has(param.name)}
                  disabled={loading}
                  structureLocked={structureLocked}
                  onUpdate={onUpdateParameter}
                  onUpdateValue={onUpdateParameterValue}
                  onDelete={onDeleteParameter}
                  nameExists={nameExists}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
