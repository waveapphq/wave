/**
 * Certificate dialog (NET-9): read-only detail, fetched by id for a saved row
 * or shown at once from a staged row's detail.
 */

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CopyButton } from '@/components/shared/copy-button'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  fetchCertificateDetail,
  type CertificateDetail,
  type CertificateStatus,
} from '@/features/settings/api/certificates'
import { toFailureDetail } from '@/lib/failure-detail'
import { cn } from '@/lib/utils'

const FALLBACK_TITLE = 'Certificate'
const NONE = 'None'
const SKELETON_ROWS = ['subject', 'issuer', 'type', 'valid-from', 'valid-to', 'fingerprint', 'key', 'usage']

export interface CertificateDialogProps {
  /** The row to show; null with no `detail` closes the dialog. */
  certificateId: string | null
  /** A staged row's detail: shown at once, never fetched. */
  detail?: CertificateDetail
  /** The row's name, the title while the detail loads. */
  name?: string
  onClose: () => void
}

type DetailRead =
  | { status: 'loading' }
  | { status: 'failed'; error: string }
  | { status: 'loaded'; detail: CertificateDetail }

function statusBadge(status: CertificateStatus, days: number): { variant: BadgeVariant; text: string } {
  if (status === 'expired') return { variant: 'error', text: 'Expired' }
  if (status === 'expiring') return { variant: 'warning', text: `Expires in ${days} ${days === 1 ? 'day' : 'days'}` }
  return { variant: 'success', text: 'Valid' }
}

/** Splits a colon-separated fingerprint into two lines after its middle byte ("XX:" is three characters). */
function fingerprintLines(fingerprint: string): [string, string] {
  const cut = Math.ceil(fingerprint.split(':').length / 2) * 3
  return [fingerprint.slice(0, cut), fingerprint.slice(cut)]
}

interface Field {
  label: string
  value: ReactNode
  mono?: boolean
}

function FieldGroup({ fields }: Readonly<{ fields: Field[] }>) {
  return (
    <dl className="grid grid-cols-[168px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 text-sm">
      {fields.map((field) => (
        <Fragment key={field.label}>
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd
            className={cn('min-w-0 break-words text-foreground', field.mono && 'font-mono text-xs leading-5')}
            translate={field.mono ? 'no' : undefined}
          >
            {field.value}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

function DetailFields({ detail }: Readonly<{ detail: CertificateDetail }>) {
  const badge = statusBadge(detail.status, detail.days_to_expiry)
  const [firstLine, secondLine] = fingerprintLines(detail.sha256_fingerprint)
  const groups: Field[][] = [
    [
      { label: 'Subject', value: detail.subject },
      { label: 'Issuer', value: detail.issuer },
      { label: 'Type', value: detail.type },
      { label: 'Path length', value: detail.path_length === null ? 'Unlimited' : String(detail.path_length) },
    ],
    [
      { label: 'Valid from', value: detail.valid_from },
      {
        label: 'Valid to',
        value: (
          <span className="flex flex-wrap items-center gap-3">
            <span>{detail.valid_to}</span>
            <Badge variant={badge.variant}>{badge.text}</Badge>
          </span>
        ),
      },
    ],
    [
      {
        label: 'SHA-256 fingerprint',
        mono: true,
        value: (
          <span className="flex items-start gap-2">
            <span>
              <span className="block">{firstLine}</span>
              <span className="block">{secondLine}</span>
            </span>
            <CopyButton
              value={detail.sha256_fingerprint}
              ariaLabel="Copy SHA-256 fingerprint"
              announcement="Copied"
              size="sm"
              className="h-5 w-6 shrink-0 p-0 text-muted-foreground"
            />
          </span>
        ),
      },
      { label: 'Serial number', value: detail.serial_number, mono: true },
    ],
    [
      { label: 'Key', value: detail.key },
      { label: 'Signature algorithm', value: detail.signature_algorithm },
      { label: 'Key usage', value: detail.key_usage.length > 0 ? detail.key_usage.join(', ') : NONE },
    ],
    [
      { label: 'Subject Key ID', value: detail.subject_key_id ?? NONE, mono: true },
      { label: 'Authority Key ID', value: detail.authority_key_id ?? NONE, mono: true },
    ],
  ]

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {groups.map((fields, index) => (
        <Fragment key={fields[0].label}>
          {index > 0 && <Separator />}
          <FieldGroup fields={fields} />
        </Fragment>
      ))}
      <div className="mt-1">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">PEM</span>
          <CopyButton value={detail.pem} text="Copy" announcement="Copied" className="border border-border bg-subtle" />
        </div>
        <pre
          translate="no"
          className="h-[164px] overflow-auto whitespace-pre rounded-lg border border-border bg-subtle p-3 font-mono text-xs leading-[18px] text-foreground"
        >
          {detail.pem}
        </pre>
      </div>
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div data-testid="certificate-detail-loading" className="flex flex-col gap-3" aria-hidden="true">
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="grid grid-cols-[168px_minmax(0,1fr)] gap-x-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ))}
    </div>
  )
}

/** Reads one certificate; the caller keys it by id, so a read never outlives its id. */
function useCertificateDetail(id: string): { read: DetailRead; retry: () => void } {
  const [read, setRead] = useState<DetailRead>({ status: 'loading' })

  const start = useCallback(() => {
    fetchCertificateDetail(id).then(
      (detail) => setRead({ status: 'loaded', detail }),
      (error: unknown) => setRead({ status: 'failed', error: toFailureDetail(error).message }),
    )
  }, [id])

  useEffect(() => {
    start()
  }, [start])

  const retry = useCallback(() => {
    setRead({ status: 'loading' })
    start()
  }, [start])

  return { read, retry }
}

interface DialogBodyProps {
  title: string
  onClose: () => void
  children: ReactNode
}

function DialogBody({ title, onClose, children }: Readonly<DialogBodyProps>) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  return (
    <DialogContent
      aria-describedby={undefined}
      className="max-w-2xl overflow-y-auto"
      onOpenAutoFocus={(event) => {
        event.preventDefault()
        titleRef.current?.focus()
      }}
    >
      <DialogHeader>
        <DialogTitle
          ref={titleRef}
          tabIndex={-1}
          translate={title === FALLBACK_TITLE ? undefined : 'no'}
          className="pr-6 focus:outline-none"
        >
          {title}
        </DialogTitle>
      </DialogHeader>
      {children}
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

interface FetchedDetailProps {
  id: string
  name?: string
  onClose: () => void
}

function FetchedDetail({ id, name, onClose }: Readonly<FetchedDetailProps>) {
  const { read, retry } = useCertificateDetail(id)
  let title = name ?? FALLBACK_TITLE
  let body: ReactNode = <DetailSkeleton />
  if (read.status === 'loaded') {
    title = read.detail.name
    body = <DetailFields detail={read.detail} />
  } else if (read.status === 'failed') {
    body = (
      <div role="alert" className="flex items-center justify-between gap-4 text-sm">
        <p className="text-error">{read.error}</p>
        <Button variant="secondary" size="sm" onClick={retry}>
          Retry
        </Button>
      </div>
    )
  }
  return (
    <DialogBody title={title} onClose={onClose}>
      {body}
    </DialogBody>
  )
}

export function CertificateDialog({ certificateId, detail, name, onClose }: Readonly<CertificateDialogProps>) {
  const open = detail !== undefined || certificateId !== null
  let content: ReactNode = null
  if (detail) {
    content = (
      <DialogBody title={detail.name} onClose={onClose}>
        <DetailFields detail={detail} />
      </DialogBody>
    )
  } else if (certificateId !== null) {
    content = <FetchedDetail key={certificateId} id={certificateId} name={name} onClose={onClose} />
  }

  return (
    // No trigger exists, so every open change is a close (corner X or Esc).
    <Dialog open={open} onOpenChange={() => onClose()}>
      {content}
    </Dialog>
  )
}
