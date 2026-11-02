import { valueToText } from '@/lib/variable-format'

import type { OutputParam, OutputTypeRule } from './types'

/** Just enough of an input param to supply a default for an unset field. */
export interface ParamDefault {
  name: string
  defaultValue?: unknown
}

function fieldValue(
  field: string,
  values: Record<string, unknown>,
  inputs?: readonly ParamDefault[],
): string {
  let raw = values[field]
  if (raw === undefined) raw = inputs?.find((p) => p.name === field)?.defaultValue
  if (raw === undefined || raw === null) return ''
  return valueToText(raw)
}

export function resolveOutputType(
  declaredType: string,
  typeWhen: OutputTypeRule[] | undefined,
  values: Record<string, unknown>,
  inputs?: readonly ParamDefault[],
): string {
  if (!typeWhen) return declaredType
  for (const rule of typeWhen) {
    if (rule.when.every((c) => c.values.includes(fieldValue(c.field, values, inputs)))) {
      return rule.type
    }
  }
  return declaredType
}

export function resolveOutputTypes(
  outputs: readonly OutputParam[],
  values: Record<string, unknown>,
  inputs?: readonly ParamDefault[],
): Map<string, string> {
  return new Map(outputs.map((o) => [o.name, resolveOutputType(o.type, o.typeWhen, values, inputs)]))
}
