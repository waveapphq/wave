/**
 * DetailsDialog - Shows documentation for a specific version.
 *
 * Details are per-version to support version-specific documentation and render
 * as real Markdown.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { MarkdownContent } from '@/components/shared/markdown-content'

interface DetailsDialogProps {
  isOpen: boolean
  onClose: () => void
  elementName: string
  version: string
  description?: string
  details?: string
}

export function DetailsDialog({
  isOpen,
  onClose,
  elementName,
  version,
  description,
  details,
}: Readonly<DetailsDialogProps>) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{elementName} - Documentation</DialogTitle>
          <DialogDescription className="break-words [overflow-wrap:anywhere]">
            {description ?? `Documentation for version ${version}`}
          </DialogDescription>
        </DialogHeader>

        {/* Version indicator */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Version:</span>
          <Badge variant="info">{version}</Badge>
        </div>

        <div
          data-testid="details-scroll"
          className="overflow-y-auto overflow-x-hidden max-h-[55vh] pr-4"
        >
          {details ? (
            <MarkdownContent text={details} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No detailed documentation available for this version.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
