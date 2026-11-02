/**
 * StatEntryPopover - one Stats entry: the trigger reading it in words and the popover that edits it (OS-7,
 * REQ-3.3.3.2). Every change writes the entry at once; the row input of the Stats editor.
 */

import { use, useRef, type ReactNode, type RefObject } from 'react'
import { Braces, Sigma } from 'lucide-react'
import { useSheetOpener } from '@/components/shared/draggable-sheet'
import { ENTRY_CONTROL_CLASS } from '@/components/shared/variable-bodies/body-parts'
import { ScalarEditBody } from '@/components/shared/variable-bodies/scalar-edit-body'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, safeStringify } from '@/lib/utils'
import { wireNumber } from '@/lib/number-rule'
import type { TextFormat } from '@/lib/codemirror/format-editor'
import { ValueEditorSheet } from '@/features/workbench/common/variables/variable-inspect-modal/value-editor-sheet'
import {
  STAT_OPTIONS,
  changeStat,
  statColumnName,
  statEntryWords,
  statFieldTypes,
  statTakesPercent,
  type StatEntry,
  type StatKind,
} from '@/features/workbench/lib/opensearch/stat-entries'
import type { AvailableVariable } from '../expressions/expression-field'
import { FieldSuggestContext } from './field-suggest-context'
import { FieldSuggestInput } from './field-suggest-input'

const AGGREGATION_FORMATS: TextFormat[] = ['aggregation-json']

const NO_VALID_CHANGE = () => {}

// The control of the Stats row box, which keeps its focus look while the popover is open.
const TRIGGER_CLASS = cn(
  ENTRY_CONTROL_CLASS,
  'flex items-center gap-1.5 font-normal transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50',
)

function StatRow({ caption, children }: Readonly<{ caption: string; children: ReactNode }>) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{caption}</p>
      {children}
    </div>
  )
}

interface StatFormProps {
  entry: StatEntry
  position: number
  onChange: (entry: StatEntry) => void
  onEditJson: () => void
  statRef: RefObject<HTMLButtonElement | null>
}

/** The popover body: the rows the chosen stat takes, then its column name. */
function StatForm({ entry, position, onChange, onEditJson, statRef }: Readonly<StatFormProps>) {
  const fieldTypes = statFieldTypes(entry.stat)
  return (
    <>
      <div className="space-y-3 p-3">
        <StatRow caption="Stat">
          <Select value={entry.stat} onValueChange={(stat) => onChange(changeStat(entry, stat as StatKind))}>
            <SelectTrigger ref={statRef} aria-label="Stat">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </StatRow>
        {statTakesPercent(entry.stat) && (
          <StatRow caption="Percent">
            <div className="w-[72px]">
              {/* The body keeps every digit as typed; the entry holds the number in its wire form. */}
              <ScalarEditBody
                value={entry.percent ?? ''}
                type="float"
                size="field"
                blank="unset"
                ariaLabel="Percent"
                inputTestId="stat-percent"
                onChange={(next) =>
                  onChange({ ...entry, percent: next === '' ? undefined : wireNumber(next as string, 'float') })
                }
                onValidChange={NO_VALID_CHANGE}
              />
            </div>
          </StatRow>
        )}
        {fieldTypes !== null && (
          <StatRow caption="Field">
            <FieldSuggestInput
              value={safeStringify(entry.field)}
              onChange={(field) => onChange({ ...entry, field })}
              source="fields"
              types={fieldTypes}
              ariaLabel="Field"
              look="plain"
            />
          </StatRow>
        )}
        {entry.stat === 'custom' && (
          <>
            <StatRow caption="Aggregation">
              <Button type="button" variant="outline" size="sm" onClick={onEditJson}>
                <Braces className="h-3.5 w-3.5" />
                Edit JSON
              </Button>
            </StatRow>
            <StatRow caption="Column name">
              <Input
                aria-label="Column name"
                autoComplete="off"
                spellCheck={false}
                placeholder={`custom ${position}`}
                value={entry.name ?? ''}
                onChange={(event) => onChange({ ...entry, name: event.target.value })}
                className="!h-9"
              />
            </StatRow>
          </>
        )}
      </div>
      <p className="border-t bg-muted/50 px-3 py-2 font-mono text-xs">
        {statColumnName(entry, position) ?? 'Pick a field'}
      </p>
    </>
  )
}

export function StatEntryPopover({
  index,
  value,
  onChange,
  defaultOpen = false,
  readOnly = false,
  availableVariables,
  testId,
}: Readonly<{
  index: number
  value: unknown
  onChange: (entry: StatEntry) => void
  defaultOpen?: boolean
  readOnly?: boolean
  availableVariables: AvailableVariable[]
  testId?: string
}>) {
  const entry = value as StatEntry
  const position = index + 1
  const words = statEntryWords(entry, position)
  const statRef = useRef<HTMLButtonElement>(null)
  const jsonEditor = useSheetOpener()
  // The Custom (JSON) editor joins the block's Get fields pull and names its Index pattern.
  const suggest = use(FieldSuggestContext)

  return (
    <>
      <Popover defaultOpen={defaultOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid={testId}
            disabled={readOnly}
            aria-label={`Stat ${position}: ${words}`}
            className={TRIGGER_CLASS}
          >
            <Sigma className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{words}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          aria-label={`Stat ${position}`}
          align="start"
          className="w-72 p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            statRef.current?.focus()
          }}
        >
          <StatForm
            entry={entry}
            position={position}
            onChange={onChange}
            onEditJson={jsonEditor.show}
            statRef={statRef}
          />
        </PopoverContent>
      </Popover>
      {jsonEditor.open && (
        <ValueEditorSheet
          ref={jsonEditor.ref}
          label={`Stat ${position} aggregation`}
          name="stats"
          type="string"
          value={entry.json}
          isTemplate={false}
          allowTemplate={false}
          allowedFormats={AGGREGATION_FORMATS}
          availableVariables={availableVariables}
          openSearchFieldsRequest={suggest.request}
          openSearchIndex={suggest.index}
          onSave={(json) => onChange({ ...entry, json: String(json) })}
          onClose={jsonEditor.hide}
        />
      )}
    </>
  )
}
