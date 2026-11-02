/**
 * ParameterTable Component - V-CANVAS-12 Config Modal
 *
 * Renders parameter tables for input and output variables in config modal.
 * - CANVAS-128-131: INPUT/OUTPUT sections structure
 * - CANVAS-138-141: Variable reference syntax and highlighting
 * - CANVAS-146: Enum fields: {x} toggle for Value/Expression mode
 */

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  RowRemovalQuestion,
  useRowRemovalGuard,
} from '@/components/shared/child-editors/row-removal-guard'
import { ParameterRow } from './parameter-row'
import {
  type Parameter,
  type ParameterTableProps,
  clampSibling,
  exclusiveClears,
  isParameterVisible,
  deriveGroups,
} from './parameter-table-types'

// Re-export types for consumers
export type { Parameter, ValidationState, ParameterTableProps } from './parameter-table-types'

/** Choice lists and true / false hold a real value, never a gray default (FIELD-8). */
function holdsChoice(param: Parameter): boolean {
  return param.enumValues !== undefined || param.type === 'boolean'
}

/** Shared fixed column widths so the ungrouped table and the group-card
 *  tables stay aligned (cards carry no thead of their own). */
export function ParameterTableColumns({ isOutput }: Readonly<{ isOutput: boolean }>) {
  return (
    <colgroup>
      <col className="w-8" />
      <col className="w-[160px]" />
      <col className={isOutput ? 'w-[100px]' : 'w-[68px]'} />
      {isOutput && <col className="w-[56px]" />}
      <col />
    </colgroup>
  )
}

/** Muted note line under a param row; the media-type segment renders code-styled. */
function ParamNote({ note }: Readonly<{ note: string }>) {
  const splitAt = note.indexOf(' - ')
  const labelEnd = note.indexOf(': ')
  if (splitAt === -1 || labelEnd === -1 || labelEnd > splitAt) {
    return <p className="text-[11.5px] leading-snug text-muted-foreground">{note}</p>
  }
  return (
    <p className="text-[11.5px] leading-snug text-muted-foreground">
      {note.slice(0, labelEnd + 2)}
      <code className="font-mono text-[11px]">{note.slice(labelEnd + 2, splitAt)}</code>
      {note.slice(splitAt)}
    </p>
  )
}

export function ParameterTable({
  mode,
  parameters,
  values,
  onChange,
  onValidationChange,
  availableVariables,
  fieldErrors = {},
  expressionFields: controlledExpressionFields,
  onExpressionFieldsChange: controlledOnExpressionFieldsChange,
  templateFields: controlledTemplateFields,
  onTemplateFieldsChange: controlledOnTemplateFieldsChange,
  groupMeta,
  secretFields,
  onSecretFieldsChange,
  credentialCatalogKeys,
  mapExtras,
  runsOnRemoteHost,
  readOnly,
  testId,
  scriptEditor,
  elementTypes,
  onElementTypesChange,
  secretSaveTarget,
}: Readonly<ParameterTableProps>) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const rowGuard = useRowRemovalGuard()
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () =>
      new Set(
        Object.values(groupMeta ?? {})
          .filter((meta) => meta.defaultExpanded)
          .map((meta) => meta.name)
      )
  )

  // Controlled/uncontrolled pattern for expressionFields
  const [internalExpressionFields, setInternalExpressionFields] = useState<string[]>([])
  const expressionFields = controlledExpressionFields ?? internalExpressionFields
  const handleExpressionFieldsChange = useCallback((fields: string[]) => {
    if (controlledOnExpressionFieldsChange) {
      controlledOnExpressionFieldsChange(fields)
    } else {
      setInternalExpressionFields(fields)
    }
  }, [controlledOnExpressionFieldsChange])

  // Controlled/uncontrolled pattern for templateFields
  const [internalTemplateFields, setInternalTemplateFields] = useState<string[]>([])
  const templateFields = controlledTemplateFields ?? internalTemplateFields
  const handleTemplateFieldsChange = useCallback((fields: string[]) => {
    if (controlledOnTemplateFieldsChange) {
      controlledOnTemplateFieldsChange(fields)
    } else {
      setInternalTemplateFields(fields)
    }
  }, [controlledOnTemplateFieldsChange])
  // The rows shown at the last render; null until the window first opens.
  const prevShownRef = useRef<{ visible: Set<string>; shown: Set<string> } | null>(null)

  // Filter parameters by showWhen visibility
  const visibleParameters = parameters.filter((param) =>
    isParameterVisible(param, values, parameters)
  )

  // Derive grouped structure from visible parameters
  const { ungrouped, groups } = useMemo(
    () => deriveGroups(visibleParameters, groupMeta),
    [visibleParameters, groupMeta]
  )

  // A row that hides drops its value; a choice-list or true / false row that shows again,
  // or that a version switch brings in, starts on its default, written at that moment (REQ-4.7.16).
  useEffect(() => {
    const visible = new Set(
      parameters.filter((p) => isParameterVisible(p, values, parameters)).map((p) => p.name)
    )
    // A row the remote-host lock replaces is not shown either (HTTP-13).
    const shownParams = new Set(
      parameters.filter(
        (p) => isParameterVisible(p, values, parameters) && !(runsOnRemoteHost && p.lockedOnRemoteHost)
      )
    )
    const shown = new Set([...shownParams].map((p) => p.name))
    const previous = prevShownRef.current
    if (previous !== null) {
      for (const param of parameters) {
        // retainOnHide params keep their draft across mode switches; the stale payload is stripped at save.
        if (
          (param.showWhen || param.showWhenAll || param.showWhenAny) &&
          !param.retainOnHide &&
          previous.visible.has(param.name) &&
          !visible.has(param.name) &&
          values[param.name] !== undefined
        ) {
          onChange(param.name, undefined)
        }
        // Two rows may share a wire name (one per Database type); only the one shown writes its default.
        if (
          holdsChoice(param) &&
          !previous.shown.has(param.name) &&
          shownParams.has(param) &&
          values[param.name] === undefined &&
          param.defaultValue !== undefined
        ) {
          onChange(param.name, param.defaultValue)
        }
      }
    }
    prevShownRef.current = { visible, shown }
  }, [parameters, values, onChange, runsOnRemoteHost])

  // Clean up stale errors when parameters change (e.g., version switch)
  // or when visibility changes (e.g., mode toggle hides a conditionally-required field)
  useEffect(() => {
    const visibleNames = new Set(
      parameters.filter((p) => isParameterVisible(p, values, parameters)).map((p) => p.name)
    )
    setErrors((prev) => {
      const next: Record<string, string> = {}
      for (const [key, value] of Object.entries(prev)) {
        if (visibleNames.has(key)) {
          next[key] = value
        }
      }
      if (Object.keys(next).length === Object.keys(prev).length) return prev
      return next
    })
  }, [parameters, values])

  const handleValidationChange = useCallback(
    (name: string, error: string | null) => {
      setErrors((prev) => {
        const next = { ...prev }
        if (error) {
          next[name] = error
        } else {
          delete next[name]
        }
        return next
      })
    },
    []
  )

  // Report aggregated validation state to parent (outside setState updater)
  useEffect(() => {
    if (onValidationChange) {
      const hasErrors = Object.keys(errors).length > 0
      onValidationChange({
        isValid: !hasErrors,
        errors: errors,
      })
    }
  }, [errors, onValidationChange])

  const toggleGroup = useCallback((groupName: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupName)) {
        next.delete(groupName)
      } else {
        next.add(groupName)
      }
      return next
    })
  }, [])

  const handleSecretChange = useCallback(
    (name: string, checked: boolean) => {
      if (!onSecretFieldsChange) return
      const current = secretFields ?? []
      const next = checked
        ? [...current.filter((n) => n !== name), name]
        : current.filter((n) => n !== name)
      onSecretFieldsChange(next)
    },
    [secretFields, onSecretFieldsChange],
  )

  // OUTPUT adds a Secret column (SECUI-3/4); both modes reserve the leading info
  // column so the two tables line up in the config modal.
  const isOutput = mode === 'output'
  const colCount = isOutput ? 5 : 4

  // A value change that hides rows asks first when one of them has an editor open with changes.
  const hiddenBy = (param: Parameter, value: unknown): string[] => {
    const next = { ...values, [param.name]: value }
    return parameters
      .filter(
        (row) =>
          isParameterVisible(row, values, parameters) && !isParameterVisible(row, next, parameters),
      )
      .map((row) => row.label ?? row.name)
  }

  const renderRow = (param: Parameter) => (
    <Fragment key={param.name}>
      <ParameterRow
        mode={mode}
        parameter={param}
        value={values[param.name]}
        onChange={(value) =>
          rowGuard.request(hiddenBy(param, value), () => {
            onChange(param.name, value)
            const clamp = clampSibling(param, value, values, parameters)
            if (clamp) onChange(clamp.field, clamp.value)
            for (const field of exclusiveClears(param, value)) onChange(field, false)
          })
        }
        onTypeChange={param.selectableType ? (type: string) => onChange(`${param.name}_type`, type) : undefined}
        availableVariables={availableVariables}
        onValidationChange={handleValidationChange}
        fieldError={fieldErrors[param.name]}
        expressionFields={expressionFields}
        onExpressionFieldsChange={handleExpressionFieldsChange}
        templateFields={templateFields}
        onTemplateFieldsChange={handleTemplateFieldsChange}
        secret={isOutput ? (secretFields ?? []).includes(param.name) : undefined}
        onSecretChange={isOutput ? (checked) => handleSecretChange(param.name, checked) : undefined}
        allValues={values}
        allParameters={parameters}
        credentialCatalogKeys={credentialCatalogKeys}
        mapExtras={mapExtras?.[param.name]}
        runsOnRemoteHost={runsOnRemoteHost}
        readOnly={readOnly}
        testId={testId}
        scriptEditor={scriptEditor}
        elementTypes={elementTypes?.[param.name]}
        onElementTypesChange={
          onElementTypesChange && ((types) => onElementTypesChange(param.name, types))
        }
        secretSaveTarget={secretSaveTarget}
      />
    </Fragment>
  )

  // Schema `note` lines gather into one small tinted container per section
  // (the generated-Content-Type / info notes).
  const renderNotesRow = (sectionParams: Parameter[], sectionKey: string) => {
    const noted = sectionParams.filter((param) => param.note)
    if (noted.length === 0) return null
    return (
      <tr data-testid={`param-notes-${sectionKey}`} className="border-b border-border last:border-0">
        <td />
        <td colSpan={colCount - 1} className="px-2 pb-2 pt-1">
          <div className="space-y-1 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
            {noted.map((param) => (
              <div key={param.name} data-testid={`param-note-${param.name}`}>
                <ParamNote note={param.note!} />
              </div>
            ))}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-2.5">
      <RowRemovalQuestion guard={rowGuard} />
      <table className="w-full table-fixed [&>tbody>tr]:border-0">
        <ParameterTableColumns isOutput={isOutput} />
        <thead>
          <tr className="border-b border-border">
            <th className="p-2 w-8" aria-label="Description" />
            <th className="p-2 w-[160px] text-left text-xs font-medium text-muted-foreground">
              Parameter
            </th>
            <th
              className={`p-2 ${isOutput ? 'w-[100px]' : 'w-[68px]'} text-left text-xs font-medium text-muted-foreground`}
            >
              Type
            </th>
            {isOutput && (
              <th className="p-2 w-[56px] text-center text-xs font-medium text-muted-foreground">
                Secret
              </th>
            )}
            <th className="p-2 text-left text-xs font-medium text-muted-foreground">
              {mode === 'input' ? 'Value' : 'Assign to'}
            </th>
          </tr>
        </thead>
        {/* Ungrouped parameters - no dividers outside cards */}
        {ungrouped.length > 0 && (
          <tbody>
            {ungrouped.map(renderRow)}
            {renderNotesRow(ungrouped, 'ungrouped')}
          </tbody>
        )}
      </table>
      {/* Grouped parameters render as contained collapsible cards */}
      {groups.map((group) => {
        const isExpanded = expandedGroups.has(group.name)
        return (
          <div
            key={group.name}
            className="overflow-hidden rounded-[10px] border border-border bg-card"
          >
            <button
              type="button"
              data-testid={`group-header-${group.name}`}
              aria-expanded={isExpanded}
              className={cn(
                'flex w-full items-center gap-1.5 bg-muted/30 p-2 text-left text-xs font-medium text-muted-foreground cursor-pointer select-none',
                isExpanded && 'border-b border-border'
              )}
              onClick={() => toggleGroup(group.name)}
            >
              <ChevronRight
                className={cn('h-3.5 w-3.5 shrink-0 transition-transform', isExpanded && 'rotate-90')}
              />
              <span className="min-w-0 truncate">{group.name}</span>
            </button>
            {isExpanded && (
              <table className="w-full table-fixed">
                <ParameterTableColumns isOutput={isOutput} />
                <tbody>
                  {group.params.map(renderRow)}
                  {renderNotesRow(group.params, group.name)}
                </tbody>
              </table>
            )}
            {isExpanded && group.description && (
              <div
                data-testid={`group-footer-${group.name}`}
                className="border-t border-border px-3 py-1.5 text-[11px] leading-snug text-muted-foreground/70"
              >
                {group.description}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
