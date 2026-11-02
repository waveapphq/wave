/**
 * ChangelogDialog - Shows the changelog for a specific version.
 *
 * Design: Version dropdown at top to filter by version. The changelog flows in
 * as markdown-source lines (controls: one bullet per line; Functions: the raw
 * markdown split by line) and renders as real Markdown.
 */

import { useState, useMemo, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { MarkdownContent } from '@/components/shared/markdown-content'
import { formatPublishedDate } from '@/lib/timestamp-format'
import type { ControlVersion } from '@/features/workbench/docs/_types'

interface ChangelogDialogProps {
  isOpen: boolean
  onClose: () => void
  elementName: string
  versions: ControlVersion[]
  initialVersion: string
}

export function ChangelogDialog({
  isOpen,
  onClose,
  elementName,
  versions,
  initialVersion,
}: Readonly<ChangelogDialogProps>) {
  const [selectedVersion, setSelectedVersion] = useState(initialVersion)

  // Sync internal state when parent's initialVersion changes
  useEffect(() => {
    setSelectedVersion(initialVersion)
  }, [initialVersion])

  // Find the selected version entry
  const versionEntry = useMemo(
    () => versions.find((v) => v.version === selectedVersion) ?? versions[0],
    [versions, selectedVersion]
  )

  const changelogMarkdown = useMemo(
    () => versionEntry?.changelog.join('\n') ?? '',
    [versionEntry]
  )

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{elementName} - Changelog</DialogTitle>
          <DialogDescription>
            Release notes and changes for this control.
          </DialogDescription>
        </DialogHeader>

        {/* Version selector with release date */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Version:</span>
            <Select value={selectedVersion} onValueChange={setSelectedVersion}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versions.map((v) => (
                  <SelectItem key={v.version} value={v.version}>
                    {v.version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {versionEntry && (
            <span className="text-sm text-muted-foreground">
              Released: {formatPublishedDate(versionEntry.releaseDate)}
            </span>
          )}
        </div>

        {versionEntry && (
          <div
            data-testid="changelog-scroll"
            className="overflow-y-auto overflow-x-hidden max-h-[55vh] pr-4"
          >
            <div className="space-y-3">
              {/* Deprecation warning */}
              {versionEntry.deprecated && (
                <div className="flex items-center gap-2">
                  <Badge variant="warning">Deprecated</Badge>
                  {versionEntry.deprecationMessage && (
                    <span className="text-sm text-destructive">
                      {versionEntry.deprecationMessage}
                    </span>
                  )}
                </div>
              )}

              {/* Changelog entries rendered as Markdown */}
              <MarkdownContent text={changelogMarkdown || '_No changelog._'} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
