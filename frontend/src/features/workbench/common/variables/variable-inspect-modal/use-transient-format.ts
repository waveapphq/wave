/**
 * useTransientFormat - the shared transient string-Format engine behind every
 * string value editor (the inspect panel via use-string-format, the create
 * modal, and the Edit-value sheet): an Auto/Plain/JSON/XML/YAML pick whose Auto
 * resolves to the format detected LIVE from the current text, so syntax
 * highlighting tracks what you type. Detection is disabled (-> plain) when
 * `enabled` is false (a complex or template value, where the control is hidden).
 *
 * Format is a transient view setting - never persisted.
 *
 * REQ-3.1.3.11: Variable watching UI panel
 */

import { useState } from 'react'

import { detectFormat } from '@/lib/codemirror/format-utils'
import type { TextFormat, ResolvedFormat } from '@/lib/codemirror/format-editor'

// Only a data format pretty-prints; a script or query format colors the editor alone (PYRUN-13, SQL-10, OS-12).
const DATA_FORMATS: ReadonlySet<ResolvedFormat> = new Set(['json', 'yaml', 'xml'])

function isDataFormatOf(format: ResolvedFormat): boolean {
  return DATA_FORMATS.has(format)
}

export interface TransientFormat {
  format: TextFormat
  setFormat: (format: TextFormat) => void
  /** The format Auto detected LIVE from `text` (shown as the Auto suffix). */
  detectedFormat: ResolvedFormat
  /** The active format: the explicit pick, or the live detection while on Auto. */
  resolvedFormat: ResolvedFormat
  /** The resolved format is a data format (not plain) - the pretty-print button applies. */
  isDataFormat: boolean
}

export function useTransientFormat(
  text: string,
  enabled: boolean,
  lockedFormat?: ResolvedFormat,
): TransientFormat {
  const [format, setFormat] = useState<TextFormat>('auto')
  // A locked-format param (single allowedFormats) pins the format and suppresses
  // live detection: the picker shows disabled, never Auto.
  if (lockedFormat) {
    return {
      format: lockedFormat,
      setFormat,
      detectedFormat: lockedFormat,
      resolvedFormat: lockedFormat,
      isDataFormat: isDataFormatOf(lockedFormat),
    }
  }
  const detectedFormat: ResolvedFormat = enabled ? detectFormat(text) : 'plain'
  const resolvedFormat: ResolvedFormat =
    format === 'auto' ? detectedFormat : (format as ResolvedFormat)
  return {
    format,
    setFormat,
    detectedFormat,
    resolvedFormat,
    isDataFormat: isDataFormatOf(resolvedFormat),
  }
}
