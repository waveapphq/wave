/**
 * Copyable reachable-address chips (mono, one per URL) with a transient copied
 * cue. Shared by the MCP status bar and the WAVE Server fact cards.
 */

import { useState } from 'react'

import { CopyButton } from '@/components/shared/copy-button'

export interface AddressChipsProps {
  urls: string[]
  /** testid stamped on the transient check icon (the copied-success cue). */
  copyTestId?: string
}

export function AddressChips({ urls, copyTestId }: Readonly<AddressChipsProps>) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  if (urls.length === 0) return null

  return (
    <div className="mt-2 flex flex-wrap gap-2 pl-[22px]">
      {urls.map((url) => (
        <span
          key={url}
          className="flex min-w-0 items-center gap-1 rounded border border-border bg-muted/50 px-2 py-0.5"
        >
          <span translate="no" className="min-w-0 truncate font-mono text-xs">
            {url}
          </span>
          {/* The chip copied last owns its own cue; every other chip is held off. */}
          <CopyButton
            value={url}
            ariaLabel={`Copy ${url}`}
            size="sm"
            className="h-5 w-5 p-0"
            testId="copy-address-button"
            copiedTestId={copyTestId}
            announcement="URL copied to clipboard"
            copied={copiedUrl === url ? undefined : false}
            onCopied={() => setCopiedUrl(url)}
          />
        </span>
      ))}
    </div>
  )
}
