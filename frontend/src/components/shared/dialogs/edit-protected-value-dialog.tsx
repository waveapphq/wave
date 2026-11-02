/**
 * EditProtectedValueDialog - the canonical "editing drops the stored secret"
 * confirmation gating every secret value editor (profile parameters, entity
 * variables, workbench variable watchers). Confirming consents to the
 * write-only replace: the stored value is discarded and the editor opens
 * empty; Cancel leaves the stored value untouched.
 *
 * REQ-3.1.3.5: Secret variable masking
 */

import { useRef } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface EditProtectedValueDialogProps {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** The control the question was asked from, and its place in case the answer replaces it. */
interface AskedFrom {
  opener: HTMLElement
  parent: ParentNode
  index: number
}

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), ' +
  'button:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

/** The focused element: a page always has one, its body when no control holds focus. */
function focusedElement(): HTMLElement {
  return document.activeElement as HTMLElement
}

function askedFrom(): AskedFrom {
  const opener = focusedElement()
  // The focused element is in the page, so it has a parent.
  const parent = opener.parentNode as ParentNode
  return { opener, parent, index: Array.from(parent.children).indexOf(opener) }
}

/** What takes focus where the question was asked: the opener, or the control that replaced it. */
function controlAt({ opener, parent, index }: AskedFrom): HTMLElement | null {
  if (opener.isConnected) return opener
  const slot: Element | undefined = parent.children[index]
  if (!slot) return null
  return slot.matches(FOCUSABLE) ? (slot as HTMLElement) : slot.querySelector<HTMLElement>(FOCUSABLE)
}

function returnFocus(from: AskedFrom): void {
  // Focus an editor took on its own stays; focus left on the page or on a container around the field moves.
  if (!focusedElement().contains(from.parent)) return
  controlAt(from)?.focus()
}

export function EditProtectedValueDialog({
  open,
  onCancel,
  onConfirm,
}: Readonly<EditProtectedValueDialogProps>) {
  // Where the latest question was asked from; before the first one, where focus was at the start.
  const askedRef = useRef<{ from: AskedFrom } | null>(null)
  askedRef.current ??= { from: askedFrom() }
  const asked = askedRef.current
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={() => {
          asked.from = askedFrom()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus(asked.from)
        }}
      >
        <DialogHeader>
          <DialogTitle>Edit Protected Value?</DialogTitle>
          <DialogDescription>
            Editing will permanently delete the existing protected value. You will need to enter a
            new value. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Delete &amp; Edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
