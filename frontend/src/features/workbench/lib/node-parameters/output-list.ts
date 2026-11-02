/**
 * Output List
 *
 * The pure half of an author-declared output list (REQ-3.4.2.2): seeding the
 * edit rows from the stored config, merging them back at save, the per-row
 * name errors and the canvas issues.
 */

import { VARIABLE_NAME_REQUIRED_MESSAGE } from '@/lib/field-constraints'
import { followValue } from '@/lib/draft-follow'
import type { NodeIssue } from '../validation/compute-node-issues'
import type { InputParam, OutputListPolicy, OutputListRowState } from './types'

export interface OutputListBase {
  values: Record<string, unknown>
  outputBindings: Record<string, string>
  outputSecretFields: string[]
  hadStoredKey: boolean
}

export type OutputListMerged = Omit<OutputListBase, 'hadStoredKey'>

export function seedOutputListRows(
  paramName: string,
  values: Record<string, unknown>,
  outputBindings: Record<string, string>,
  outputSecretFields: string[],
): OutputListRowState[] {
  const stored = values[paramName]
  if (!Array.isArray(stored)) return []
  return stored.map((item) => {
    const name = String(item)
    return {
      name,
      binding: outputBindings[name] ?? '',
      secret: outputSecretFields.includes(name),
      type: 'string',
    }
  })
}

/** The rows with each binding the canvas changed from `base` to `next`, unless the row's own binding was changed. */
export function followRowBindings(
  rows: OutputListRowState[],
  base: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): OutputListRowState[] {
  let changed = false
  const followed = rows.map((row) => {
    const binding = followValue(base[row.name] ?? '', row.binding, next[row.name] ?? '')
    if (binding === row.binding) return row
    changed = true
    return { ...row, binding }
  })
  return changed ? followed : rows
}

function rowsEqual(rows: OutputListRowState[], seedRows: OutputListRowState[]): boolean {
  return (
    rows.length === seedRows.length &&
    rows.every((row, index) => {
      const seed = seedRows[index]
      return row.name === seed.name && row.binding === seed.binding && row.secret === seed.secret
    })
  )
}

export function mergeOutputList(
  paramName: string,
  rows: OutputListRowState[],
  seedRows: OutputListRowState[],
  schemaOutputNames: string[],
  base: OutputListBase,
): OutputListMerged {
  const { values, outputBindings, outputSecretFields, hadStoredKey } = base
  // Untouched rows leave the stored config byte-for-byte alone, so it does not read as dirty.
  if (rowsEqual(rows, seedRows)) return { values, outputBindings, outputSecretFields }

  const mergedValues = { ...values }
  if (rows.length > 0 || hadStoredKey) mergedValues[paramName] = rows.map((row) => row.name)

  const mergedBindings = Object.fromEntries(
    Object.entries(outputBindings).filter(([name]) => schemaOutputNames.includes(name)),
  )
  for (const row of rows) if (row.binding !== '') mergedBindings[row.name] = row.binding

  const mergedSecrets = [
    ...outputSecretFields.filter((name) => schemaOutputNames.includes(name)),
    ...rows.filter((row) => row.secret).map((row) => row.name),
  ]

  return { values: mergedValues, outputBindings: mergedBindings, outputSecretFields: mergedSecrets }
}

function fill(message: string, name: string): string {
  return message.replaceAll('{name}', name)
}

type NameProblem = 'required' | 'invalid' | 'clash' | 'duplicate'

/** Per-row name problems in check order: empty, pattern, block-output clash, repeat. */
function outputListNameProblems(
  rows: OutputListRowState[],
  policy: OutputListPolicy,
  reservedNames: string[],
): (NameProblem | undefined)[] {
  const pattern = new RegExp(policy.namePattern)
  const seen = new Set<string>()
  const repeated = new Set<string>()
  for (const { name } of rows) {
    if (seen.has(name)) repeated.add(name)
    seen.add(name)
  }
  return rows.map(({ name }) => {
    if (name === '') return 'required'
    if (!pattern.test(name)) return 'invalid'
    if (reservedNames.includes(name)) return 'clash'
    if (repeated.has(name)) return 'duplicate'
    return undefined
  })
}

/** Canvas messages, which name the row. */
export function outputListRowErrors(
  rows: OutputListRowState[],
  policy: OutputListPolicy,
  reservedNames: string[],
): (string | undefined)[] {
  const messages: Record<NameProblem, string> = {
    required: policy.invalidNameMessage,
    invalid: policy.invalidNameMessage,
    clash: policy.clashMessage,
    duplicate: policy.duplicateMessage,
  }
  return outputListNameProblems(rows, policy, reservedNames).map((problem, index) =>
    problem === undefined ? undefined : fill(messages[problem], rows[index].name),
  )
}

/** Sheet messages, shown under the name field. */
export function outputListFieldErrors(
  rows: OutputListRowState[],
  policy: OutputListPolicy,
  reservedNames: string[],
): (string | undefined)[] {
  const messages: Record<NameProblem, string> = {
    required: VARIABLE_NAME_REQUIRED_MESSAGE,
    invalid: policy.nameRuleMessage,
    clash: 'A block output already has this name',
    duplicate: `Another ${policy.itemNoun} has this name`,
  }
  return outputListNameProblems(rows, policy, reservedNames).map((problem) =>
    problem === undefined ? undefined : messages[problem],
  )
}

/** The policy names the parameter holding the body the exports are assigned in. */
type ExportsPolicy = OutputListPolicy & { assignedIn?: string }

const NEVER_SET_MESSAGE = "Script never sets '{name}'"

const STRING_LITERAL = /"""[\s\S]*?"""|'''[\s\S]*?'''|(["'])(?:\\.|[^\\\n])*?\1/g

const NAME = '[A-Za-z_][A-Za-z0-9_]*'

/** The Source-mode body the exports are assigned in, when there is one to read. */
function assignmentBody(policy: OutputListPolicy, values: Record<string, unknown>): string | null {
  const { assignedIn } = policy as ExportsPolicy
  if (assignedIn === undefined) return null
  if (values.script_type !== 'source') return null
  return String(values[assignedIn]).replaceAll(STRING_LITERAL, '')
}

/** A top-level assignment to the name, on its own or as one target of a tuple. */
function assignsName(body: string, name: string): boolean {
  const target = String.raw`(?:${NAME}[ \t]*,[ \t]*)*${name}[ \t]*(?:,[ \t]*${NAME}[ \t]*)*`
  return new RegExp(String.raw`^[ \t]*${target}=(?!=)`, 'm').test(body)
}

export function outputListNodeIssues(
  schema: Pick<InputParam, 'name' | 'outputList'>[],
  values: Record<string, unknown>,
  outputNames: string[],
): NodeIssue[] {
  const issues: NodeIssue[] = []
  for (const parameter of schema) {
    if (!parameter.outputList) continue
    const rows = seedOutputListRows(parameter.name, values, {}, [])
    const nameErrors = outputListRowErrors(rows, parameter.outputList, outputNames)
    const body = assignmentBody(parameter.outputList, values)
    rows.forEach((row, index) => {
      const message = nameErrors[index]
      if (message !== undefined) {
        issues.push({
          code: 'OUTPUT_LIST_NAME',
          severity: 'error',
          paramName: parameter.name,
          message,
        })
        return
      }
      if (body === null || assignsName(body, row.name)) return
      issues.push({
        code: 'OUTPUT_NEVER_ASSIGNED',
        severity: 'warning',
        paramName: parameter.name,
        message: fill(NEVER_SET_MESSAGE, row.name),
      })
    })
  }
  return issues
}
