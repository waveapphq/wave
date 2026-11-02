/**
 * PartRow - one multipart part: Kind (Text/File) select, Name, and a Value
 * input that is either a literal string or, via the {x} expression toggle, the
 * host-injected expression editor (text parts only). File parts show a Source
 * input with the host-path placeholder. A text-part value is a
 * literal or a whole-value expression - no {{ }}-in-string mixing.
 */

import type { ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TrashIcon } from '@/components/ui/icon'
import { ExpressionToggle } from '@/components/shared/fields/expression-toggle'
import { cn } from '@/lib/utils'
import type { MapExpressionEditorProps } from '@/components/shared/variable-bodies/map-edit-body'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export const PARTS_GRID =
  'grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.4fr)_2rem_2rem] items-center gap-2 px-2.5'

const FILE_SOURCE_PLACEHOLDER = 'artifact://…, testdata://…, or /abs/path on host'

// The one 32px row height of the editors, as the Kind select is (FIELD-1).
const INPUT_CLASS =
  'h-8 w-full min-w-0 rounded-md border bg-background px-2 py-1 font-mono text-sm ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500'

export interface PartDraft {
  kind: 'text' | 'file'
  name: string
  value: string
  source: string
  /** A text-part value in whole-value expression mode (the {x} toggle). */
  isExpr: boolean
}

export interface PartRowProps {
  part: PartDraft
  index: number
  /** Host-injected expression editor for a text-part value in expression mode. */
  expressionEditor?: (props: MapExpressionEditorProps) => ReactNode
  onKindChange: (index: number, kind: 'text' | 'file') => void
  onNameChange: (index: number, name: string) => void
  onValueChange: (index: number, value: string) => void
  onSourceChange: (index: number, source: string) => void
  onExprToggle: (index: number, pressed: boolean) => void
  /** Opens the file-reference picker for a file part's Source. */
  onBrowse?: (index: number) => void
  onRemove: (index: number) => void
}

export function PartRow({
  part,
  index,
  expressionEditor,
  onKindChange,
  onNameChange,
  onValueChange,
  onSourceChange,
  onExprToggle,
  onBrowse,
  onRemove,
}: Readonly<PartRowProps>) {
  const isText = part.kind === 'text'
  const canToggle = isText && expressionEditor !== undefined
  const inExprEditor = canToggle && part.isExpr
  const canBrowse = !isText && onBrowse !== undefined
  return (
    <div className={cn(PARTS_GRID, 'border-b border-border/60 py-1.5 last:border-b-0')}>
      <Select value={part.kind} onValueChange={(kind) => onKindChange(index, kind as 'text' | 'file')}>
        <SelectTrigger
          data-testid={`part-kind-${index}`}
          aria-label={`Part ${index} kind`}
          className="h-8 text-sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="text">Text</SelectItem>
          <SelectItem value="file">File</SelectItem>
        </SelectContent>
      </Select>
      <input
        data-testid={`part-name-${index}`}
        aria-label={`Part ${index} name`}
        autoComplete="off"
        spellCheck={false}
        value={part.name}
        onChange={(event) => onNameChange(index, event.target.value)}
        className={INPUT_CLASS}
      />
      {(() => {
        if (inExprEditor && expressionEditor) {
          return expressionEditor({
            value: part.value,
            onChange: (value) => onValueChange(index, value),
            ariaLabel: `Part ${index} value`,
            testId: `part-expr-value-${index}`,
          })
        }
        if (isText) {
          return (
            <input
              data-testid={`part-value-${index}`}
              aria-label={`Part ${index} value`}
              autoComplete="off"
              spellCheck={false}
              value={part.value}
              onChange={(event) => onValueChange(index, event.target.value)}
              className={INPUT_CLASS}
            />
          )
        }
        return (
          <input
            data-testid={`part-source-${index}`}
            aria-label={`Part ${index} source`}
            autoComplete="off"
            spellCheck={false}
            placeholder={FILE_SOURCE_PLACEHOLDER}
            value={part.source}
            onChange={(event) => onSourceChange(index, event.target.value)}
            className={cn(INPUT_CLASS, 'placeholder:italic placeholder:text-muted-foreground/60')}
          />
        )
      })()}
      {canBrowse ? (
        <ConditionalTooltip content="Browse Test Data and Artifacts">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-testid={`part-browse-${index}`}
            aria-label={`Browse files for Part ${index} source`}
            onClick={() => onBrowse(index)}
            className="text-muted-foreground"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        </ConditionalTooltip>
      ) : (
        // Locked while the part cannot switch to {x}.
        <ExpressionToggle
          data-testid={canToggle ? `part-expr-toggle-${index}` : undefined}
          pressed={inExprEditor}
          onPressedChange={(pressed) => onExprToggle(index, pressed)}
          disabled={!canToggle}
          label={`Part ${index} expression mode`}
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-testid={`part-remove-${index}`}
        aria-label={`Remove part ${index}`}
        onClick={() => onRemove(index)}
        className="justify-self-end text-muted-foreground hover:text-destructive"
      >
        <TrashIcon size={14} />
      </Button>
    </div>
  )
}
