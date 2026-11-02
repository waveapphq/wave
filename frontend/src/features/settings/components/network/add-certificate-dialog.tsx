/**
 * Add Certificate dialog (NET-8): pasted or chosen PEM is parsed into a preview
 * table; Add hands the checked certificates to the page and writes nothing.
 */

import { useMemo, useRef, useState } from 'react'
import { functionalUpdate, type RowSelectionState } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/data-table/data-table'
import { DescriptionField } from '@/components/shared/fields/description-field'
import { FileDropZone } from '@/components/shared/file-drop-zone'
import { EditDialog } from '@/components/ui/edit-dialog'
import {
  parseCertificateFile,
  parseCertificateText,
  type CertificateParse,
  type ParsedCertificate,
} from '@/features/settings/api/certificates'
import {
  certificateExpiresColumn,
  certificateId,
  certificateNameColumn,
  certificateTypeColumn,
  withColumnWidth,
} from '@/features/settings/components/network/certificate-columns'
import { useDebouncedParse } from '@/features/settings/container/use-debounced-parse'
import { toFailureDetail } from '@/lib/failure-detail'
import { cn } from '@/lib/utils'

const ACCEPT = '.pem,.crt,.cer'
const ACCEPT_LABEL = '.pem, .crt, or .cer'
const ALREADY_ADDED = 'Already added'

export interface AddCertificateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ids in the page's staged Additional Certificates table. */
  stagedIds: ReadonlySet<string>
  onAdd: (certificates: ParsedCertificate[]) => void
}

/** What the preview shows: a parse result, or the reason none came back. */
interface Outcome {
  result?: CertificateParse
  error?: string
}

/** A chosen file's read; a file whose PEM replaced the text hands its result to the text instead. */
interface FileRead {
  name?: string
  pending: boolean
  outcome?: Outcome
}

const NO_FILE: FileRead = { pending: false }
const NO_ROWS: ParsedCertificate[] = []

const isExpired = (row: ParsedCertificate) => row.expired

function previewColumns(stagedIds: ReadonlySet<string>) {
  return [
    certificateNameColumn<ParsedCertificate>({
      marker: (row) => (stagedIds.has(row.id) ? ALREADY_ADDED : undefined),
    }),
    withColumnWidth(certificateTypeColumn<ParsedCertificate>(), 'w-32'),
    withColumnWidth(certificateExpiresColumn<ParsedCertificate>(isExpired), 'w-46'),
  ]
}

function errorMessages(outcome: Outcome): string[] {
  const messages = outcome.result?.errors.map((error) => error.message) ?? []
  return outcome.error === undefined ? messages : [...messages, outcome.error]
}

/** Every selectable row checked: the selection each new result opens with. */
function checkAll(rows: ParsedCertificate[], stagedIds: ReadonlySet<string>): RowSelectionState {
  return Object.fromEntries(rows.filter((row) => !stagedIds.has(row.id)).map((row) => [row.id, true]))
}

function AddCertificateSession({ open, onOpenChange, stagedIds, onAdd }: Readonly<AddCertificateDialogProps>) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<FileRead>(NO_FILE)
  const [selection, setSelection] = useState<{ source?: CertificateParse; selected: RowSelectionState }>({
    selected: {},
  })
  const parse = useDebouncedParse(text, parseCertificateText)
  // Each file choice and each text edit takes a new token; a file response counts only while its token is the latest.
  const fileTokenRef = useRef(0)
  const columns = useMemo(() => previewColumns(stagedIds), [stagedIds])

  const outcome: Outcome = file.outcome ?? { result: parse.result, error: parse.error }
  const rows = outcome.result?.certificates ?? NO_ROWS
  const errors = errorMessages(outcome)
  // A new result opens with every selectable row checked.
  const selected = selection.source === outcome.result ? selection.selected : checkAll(rows, stagedIds)
  const checked = rows.filter((row) => selected[row.id] === true && !stagedIds.has(row.id))
  const pending = parse.status === 'pending' || file.pending

  const editText = (next: string) => {
    fileTokenRef.current += 1
    setText(next)
    setFile(NO_FILE)
  }

  const applyFileResult = (name: string, result: CertificateParse) => {
    if (result.certificates.length === 0) {
      setFile({ name, pending: false, outcome: { result } })
      return
    }
    const pem = result.certificates.map((certificate) => certificate.pem).join('\n')
    parse.prime(pem, result)
    setText(pem)
    setFile({ name, pending: false })
  }

  const chooseFile = (chosen: File) => {
    fileTokenRef.current += 1
    const token = fileTokenRef.current
    const settle = (apply: () => void) => {
      if (fileTokenRef.current === token) apply()
    }
    setFile((previous) => ({ name: chosen.name, pending: true, outcome: previous.outcome }))
    parseCertificateFile(chosen).then(
      (result) => settle(() => applyFileResult(chosen.name, result)),
      (error: unknown) =>
        settle(() =>
          setFile({ name: chosen.name, pending: false, outcome: { error: toFailureDetail(error).message } }),
        ),
    )
  }

  const handleSave = () => {
    onAdd(checked)
    return Promise.resolve()
  }

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add Certificate"
      onSave={handleSave}
      isDirty={false}
      saveDisabled={pending || checked.length === 0}
      saveLabel="Add"
      closeOnEscape
      className="max-w-2xl"
    >
      <div className="flex min-w-0 flex-col">
        <DescriptionField
          value={text}
          onChange={editText}
          aria-label="Certificate PEM"
          name="pem"
          className="h-[138px] resize-y overflow-auto whitespace-pre font-mono text-xs leading-5"
        />
        <div className="mt-4">
          <FileDropZone
            accept={ACCEPT}
            acceptLabel={ACCEPT_LABEL}
            onFile={chooseFile}
            layout="compact"
            selectedName={file.name}
          />
        </div>
        {rows.length > 0 && (
          <DataTable
            className="mt-4"
            columns={columns}
            data={rows}
            entityName="certificates"
            enableSorting={false}
            defaultPageSize={0}
            enableSelection
            rowSelection={selected}
            onRowSelectionChange={(updater) =>
              setSelection({ source: outcome.result, selected: functionalUpdate(updater, selected) })
            }
            canSelectRow={(row) => !stagedIds.has(row.id)}
            getRowId={certificateId}
            getRowLabel={(row) => (stagedIds.has(row.id) ? `${row.name} ${ALREADY_ADDED}` : row.name)}
          />
        )}
        <div
          aria-live="polite"
          className={cn(
            'flex flex-col gap-1 text-sm text-error',
            errors.length > 0 && (rows.length > 0 ? 'mt-2' : 'mt-4'),
          )}
        >
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      </div>
    </EditDialog>
  )
}

export function AddCertificateDialog(props: Readonly<AddCertificateDialogProps>) {
  // Each opening starts a fresh session; the old one stays mounted while the dialog fades out.
  const [session, setSession] = useState({ open: props.open, key: 0 })
  if (session.open !== props.open) {
    setSession({ open: props.open, key: props.open ? session.key + 1 : session.key })
  }
  return <AddCertificateSession key={session.key} {...props} />
}
