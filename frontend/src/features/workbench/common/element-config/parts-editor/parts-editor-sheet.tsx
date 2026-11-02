/**
 * PartsEditorSheet - the bespoke multipart Parts editor: one row per part
 * (Kind / Name / Value-or-Source), a text-part value being a literal or a
 * whole-value expression via the host-injected {x} editor, "+ Add
 * part", a Visual/Code switch (Code = JSON array of part objects; an expression
 * value renders as a bare {{ expr }}), and value-editor sheet chrome with a
 * PARTS badge. Expression-ness is a sidecar set of text-part indices.
 */

import { lazy, Suspense, useRef, useState, type ReactNode, type Ref } from 'react'
import { GripVertical, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DraggableSheet, openOrRefocus, type SheetHandle } from '@/components/shared/draggable-sheet'
import { useChildEditor } from '@/components/shared/child-editors/child-editor-scope'
import {
  RowRemovalQuestion,
  useRowRemovalGuard,
} from '@/components/shared/child-editors/row-removal-guard'
import { PlusIcon } from '@/components/ui/icon'
import { EDIT_HEADER_LABEL } from '@/components/shared/variable-bodies/body-parts'
import { useStableKeys } from '@/components/shared/variable-bodies/use-stable-keys'
import type { MapExpressionEditorProps } from '@/components/shared/variable-bodies/map-edit-body'
import { openEditorAfterRemoval } from '@/lib/child-editors'
import { describeJsonError } from '@/lib/codemirror/json-data-editor'
import { maskBareExpressionsForLint } from '@/lib/variable-validation'
import { cn } from '@/lib/utils'
import { ViewDropdown, type InspectView } from '@/features/workbench/common/variables/variable-inspect-modal/view-dropdown'
import { ValidationStrip } from '@/features/workbench/common/variables/variable-inspect-modal/validation-strip'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { FileReferencePickerSheet } from '../parameters/file-reference-picker-sheet'
import { parsePartsCode, serializePartsForCode } from './parts-code'
import { PartRow, PARTS_GRID, type PartDraft } from './part-row'

const CodeBody = lazy(() =>
  import('@/components/shared/variable-bodies/code-body').then((module) => ({
    default: module.CodeBody,
  })),
)

const VISUAL_CODE_VIEWS: InspectView[] = ['visual', 'code']
const VISUAL_DISABLED: InspectView[] = ['visual']
const FIX_JSON_TOOLTIP = 'Fix JSON errors to switch to Visual'
const EMPTY_INDICES: ReadonlySet<number> = new Set()

export type Part =
  | { kind: 'text'; name: string; value: string }
  | { kind: 'file'; name: string; source: string }

export interface PartsEditorSheetProps {
  /** Lets the opener raise this sheet again. */
  ref?: Ref<SheetHandle>
  /** The label of the row this editor was opened from, as the row shows it. */
  label: string
  value: Part[]
  /** Host-injected expression editor for text-part values in expression mode. */
  expressionEditor?: (props: MapExpressionEditorProps) => ReactNode
  /** Text-part indices whose value is an expression (seeds the per-row toggle). */
  expressionIndices?: ReadonlySet<number>
  onSave: (parts: Part[], exprIndices: number[]) => void
  onClose: () => void
}

function seedDrafts(value: Part[], exprIndices: ReadonlySet<number>): PartDraft[] {
  return value.map((part, index) => ({
    kind: part.kind,
    name: part.name,
    value: part.kind === 'text' ? part.value : '',
    source: part.kind === 'file' ? part.source : '',
    isExpr: part.kind === 'text' && exprIndices.has(index),
  }))
}

function isDraftEmpty(draft: PartDraft): boolean {
  return draft.name.trim() === '' && draft.value.trim() === '' && draft.source.trim() === ''
}

function buildParts(drafts: PartDraft[]): Part[] {
  const parts: Part[] = []
  for (const draft of drafts) {
    if (isDraftEmpty(draft)) continue
    if (draft.kind === 'text') {
      parts.push({ kind: 'text', name: draft.name, value: draft.value })
    } else {
      parts.push({ kind: 'file', name: draft.name, source: draft.source })
    }
  }
  return parts
}

/** The expression indices in the FINAL emitted parts array (empty drafts are
 *  dropped, so the index is recomputed against the emitted parts). */
function buildExprIndices(drafts: PartDraft[]): number[] {
  const indices: number[] = []
  let emitted = 0
  for (const draft of drafts) {
    if (isDraftEmpty(draft)) continue
    if (draft.kind === 'text' && draft.isExpr) indices.push(emitted)
    emitted++
  }
  return indices
}

const EMPTY_DRAFT: PartDraft = { kind: 'text', name: '', value: '', source: '', isExpr: false }

/** What a Save would write, for the has-changes comparison. */
function savedForm(drafts: PartDraft[]): string {
  return JSON.stringify([buildParts(drafts), buildExprIndices(drafts)])
}

export function PartsEditorSheet({
  ref,
  label,
  value,
  expressionEditor,
  expressionIndices,
  onSave,
  onClose,
}: Readonly<PartsEditorSheetProps>) {
  const [drafts, setDrafts] = useState<PartDraft[]>(() =>
    seedDrafts(value, expressionIndices ?? EMPTY_INDICES),
  )
  const [openedWith] = useState(() => savedForm(drafts))
  const [view, setView] = useState<'visual' | 'code'>('visual')
  const [syntaxError, setSyntaxError] = useState<string | null>(null)
  const [structureErrors, setStructureErrors] = useState<string[]>([])
  const [codeValid, setCodeValid] = useState(true)
  // The row whose file Source the picker is browsing for.
  const [browsing, setBrowsing] = useState<number | null>(null)
  const pickerRef = useRef<SheetHandle>(null)
  const rowGuard = useRowRemovalGuard()
  const partLabel = (index: number) => `Part ${index + 1}`
  const testId = useWorkflowStore((s) => s.editingTestId)
  const rowKeys = useStableKeys(drafts.length)

  const patch = (index: number, changes: Partial<PartDraft>) =>
    setDrafts((prev) => prev.map((draft, i) => (i === index ? { ...draft, ...changes } : draft)))

  const handleKindChange = (index: number, kind: 'text' | 'file') =>
    patch(index, kind === 'file' ? { kind, isExpr: false } : { kind })

  const removePart = (index: number) => {
    // The picker of a part that goes closes with it; the parts after it keep theirs.
    setBrowsing((browsed) => openEditorAfterRemoval(browsed, index))
    setDrafts((prev) => prev.filter((_, i) => i !== index))
  }

  const handleRemove = (index: number) =>
    rowGuard.request([partLabel(index)], () => removePart(index))

  const handleCodeChange = (text: string) => {
    try {
      const { parts, exprIndices, errors } = parsePartsCode(text)
      setSyntaxError(null)
      setStructureErrors(errors)
      if (errors.length === 0) setDrafts(seedDrafts(parts, new Set(exprIndices)))
    } catch (error) {
      setSyntaxError(describeJsonError(text, error))
    }
  }

  const inCode = view === 'code'
  const stripMessage = inCode ? (syntaxError ?? structureErrors[0] ?? null) : null
  const stripMessages = inCode && syntaxError === null ? structureErrors : null
  const codeBroken = inCode && (syntaxError !== null || !codeValid || structureErrors.length > 0)
  const partCount = drafts.length

  const commit = () => onSave(buildParts(drafts), buildExprIndices(drafts))

  // A document that does not parse always differs from the parts it was opened with.
  useChildEditor({
    label,
    hasChanges: codeBroken || savedForm(drafts) !== openedWith,
    cannotBeSaved: codeBroken,
    apply: commit,
  })

  return (
    <DraggableSheet
      ref={ref}
      open
      onClose={onClose}
      sheetId="parts-editor"
      resizable
      ariaLabel="Edit value"
      data-testid="parts-editor-sheet"
      initialWidth={560}
      initialHeight={420}
      minWidth={480}
      minHeight={300}
      className="max-w-[90vw] max-h-screen shadow-xl"
      headerClassName="py-2"
      header={
        <>
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-semibold truncate">Edit value</span>
            <span
              data-testid="parts-editor-type-badge"
              className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-600 dark:text-teal-400"
            >
              parts
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close parts editor"
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            className="h-7 w-7"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      }
    >
      {inCode ? (
        <div className="flex flex-1 min-h-0 flex-col px-4 py-3">
          <Suspense fallback={<div className="h-full" />}>
            <CodeBody
              key="parts-code"
              value={buildParts(drafts)}
              variant="current"
              editable
              serialize={(v) => serializePartsForCode(v as Part[], new Set(buildExprIndices(drafts)))}
              onChange={handleCodeChange}
              onValidChange={setCodeValid}
              jsonMask={maskBareExpressionsForLint}
            />
          </Suspense>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto px-4 py-3">
          <div className="overflow-hidden rounded-lg border">
            <div className={cn(PARTS_GRID, 'border-b border-border bg-muted py-1.5')}>
              <span className={EDIT_HEADER_LABEL}>Kind</span>
              <span className={EDIT_HEADER_LABEL}>Name</span>
              <span className={EDIT_HEADER_LABEL}>Value / Source</span>
              <span />
              <span />
            </div>
            {drafts.map((draft, index) => (
              <PartRow
                key={rowKeys[index]}
                part={draft}
                index={index}
                expressionEditor={expressionEditor}
                onKindChange={handleKindChange}
                onNameChange={(i, name) => patch(i, { name })}
                onValueChange={(i, value) => patch(i, { value })}
                onSourceChange={(i, source) => patch(i, { source })}
                onExprToggle={(i, pressed) => patch(i, { isExpr: pressed })}
                onBrowse={(i) => openOrRefocus(browsing !== null, pickerRef, () => setBrowsing(i))}
                onRemove={handleRemove}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="parts-add-part"
            className="h-7 w-fit whitespace-nowrap px-2 text-xs font-semibold text-foreground hover:text-foreground"
            onClick={() => setDrafts((prev) => [...prev, { ...EMPTY_DRAFT }])}
          >
            <PlusIcon size={12} className="mr-1" />
            Add Part
          </Button>
        </div>
      )}

      <RowRemovalQuestion guard={rowGuard} />

      {browsing !== null && (
        <FileReferencePickerSheet
          ref={pickerRef}
          open
          label={partLabel(browsing)}
          mode="file"
          initialValue={drafts[browsing].source}
          testId={testId}
          onChoose={(source) => patch(browsing, { source })}
          onClose={() => setBrowsing(null)}
        />
      )}

      {stripMessage && (
        <ValidationStrip
          testId="parts-editor-validation"
          message={stripMessage}
          messages={stripMessages && stripMessages.length > 1 ? stripMessages : null}
        />
      )}

      <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30 rounded-b-lg shrink-0">
        <ViewDropdown
          value={view}
          onValueChange={(next) => {
            const nextView = next === 'code' ? 'code' : 'visual'
            if (nextView === 'visual' && codeBroken) return
            setSyntaxError(null)
            setStructureErrors([])
            setCodeValid(true)
            setView(nextView)
          }}
          options={VISUAL_CODE_VIEWS}
          disabledOptions={codeBroken ? VISUAL_DISABLED : undefined}
          disabledOptionTooltip={FIX_JSON_TOOLTIP}
        />
        <span data-testid="parts-editor-metric" className="text-xs text-muted-foreground tabular-nums">
          {partCount} {partCount === 1 ? 'part' : 'parts'}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="parts-editor-cancel-button"
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="parts-editor-save-button"
          disabled={codeBroken}
          onClick={() => {
            commit()
            onClose()
          }}
        >
          Save
        </Button>
      </div>
    </DraggableSheet>
  )
}
