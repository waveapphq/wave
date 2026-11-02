/**
 * Generated-header derivation for the headers map editor:
 * the composed auth header and the auto body Content-Type render as read-only
 * rows; with body headers off, the header the mode would have generated feeds
 * the amber missing-header advisory. Schema-gated: only nodes whose parameter
 * list carries the generated-header params produce extras.
 */

import { MASK_PLACEHOLDER } from '@/lib/secret-envelope'
import type { GeneratedMapRow } from '@/components/shared/variable-bodies/map-edit-body'
import type { MapParamExtras, MissingHeaderAdvisory, Parameter } from './parameter-table-types'

export const MULTIPART_CT_LOCKED_TOOLTIP =
  'The transport owns this header - multipart bodies always send a generated Content-Type'

export const FORM_CT_MISSING_MESSAGE =
  'Content-Type is not set - the transport will send its own default'

export const FILE_CT_MISSING_MESSAGE = 'Content-Type is not set - add a header row to send one'

function resolvedValue(
  name: string,
  values: Record<string, unknown>,
  parameters: Parameter[],
): unknown {
  const raw = values[name]
  if (raw !== undefined) return raw
  return parameters.find((param) => param.name === name)?.defaultValue
}

/** The generated-header params are schema strings; anything else reads as unset. */
function resolvedString(
  name: string,
  values: Record<string, unknown>,
  parameters: Parameter[],
): string | undefined {
  const raw = resolvedValue(name, values, parameters)
  return typeof raw === 'string' ? raw : undefined
}

function authRow(
  values: Record<string, unknown>,
  parameters: Parameter[],
  onChange: (name: string, value: unknown) => void,
): GeneratedMapRow | null {
  if (resolvedValue('auth_enabled', values, parameters) !== true) return null
  const mode = resolvedString('auth_mode', values, parameters) ?? 'basic'
  const key =
    mode === 'api_key'
      ? resolvedString('auth_header_name', values, parameters) || 'X-API-Key'
      : 'Authorization'
  return {
    key,
    value: MASK_PLACEHOLDER,
    masked: true,
    onDelete: () => onChange('auth_enabled', false),
  }
}

function contentTypeRow(
  values: Record<string, unknown>,
  parameters: Parameter[],
  onChange: (name: string, value: unknown) => void,
): { row: GeneratedMapRow | null; advisory: MissingHeaderAdvisory | null } {
  const mode = resolvedString('body_mode', values, parameters) ?? 'text'
  if (mode === 'multipart') {
    // Locked ON for multipart regardless of any stale draft flag.
    return {
      row: {
        key: 'Content-Type',
        value: 'multipart/form-data; boundary=(generated)',
        deleteLocked: true,
        deleteLockedTooltip: MULTIPART_CT_LOCKED_TOOLTIP,
      },
      advisory: null,
    }
  }
  const auto = resolvedValue('body_auto_headers', values, parameters) !== false
  if (mode === 'form') {
    if (!auto) return { row: null, advisory: { key: 'Content-Type', message: FORM_CT_MISSING_MESSAGE } }
    const onDelete = () => onChange('body_auto_headers', false)
    return {
      row: { key: 'Content-Type', value: 'application/x-www-form-urlencoded', onDelete },
      advisory: null,
    }
  }
  if (mode === 'file') {
    if (!auto) return { row: null, advisory: { key: 'Content-Type', message: FILE_CT_MISSING_MESSAGE } }
    const ct = resolvedString('file_content_type', values, parameters) ?? 'auto'
    return {
      row: {
        key: 'Content-Type',
        value: ct === 'auto' ? '(auto from file extension)' : ct,
        onDelete: () => onChange('body_auto_headers', false),
      },
      advisory: null,
    }
  }
  return { row: null, advisory: null }
}

/** Derive the headers param's generated rows + missing-header advisories from
 *  the node's schema, draft values, and config-change sink. */
export function deriveHeaderMapExtras(
  parameters: Parameter[],
  values: Record<string, unknown>,
  onChange: (name: string, value: unknown) => void,
): Record<string, MapParamExtras> | undefined {
  const names = new Set(parameters.map((param) => param.name))
  if (!names.has('headers') || (!names.has('auth_enabled') && !names.has('body_auto_headers'))) {
    return undefined
  }
  const generatedRows: GeneratedMapRow[] = []
  const missingHeaderAdvisories: MissingHeaderAdvisory[] = []
  if (names.has('auth_enabled')) {
    const row = authRow(values, parameters, onChange)
    if (row) generatedRows.push(row)
  }
  if (names.has('body_auto_headers')) {
    const { row, advisory } = contentTypeRow(values, parameters, onChange)
    if (row) generatedRows.push(row)
    if (advisory) missingHeaderAdvisories.push(advisory)
  }
  return { headers: { generatedRows, missingHeaderAdvisories } }
}
