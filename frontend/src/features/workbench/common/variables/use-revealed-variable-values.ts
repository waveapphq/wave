/**
 * Reactive secret-variable reveal for the Variable Manager (REQ-3.1.3.17).
 *
 * A saved secret variable is a sealed value the FE only ever holds as the masked
 * placeholder. When the system "reveal test variables" flag is on, the backend read
 * path returns those values in the clear, so this hook re-fetches the current test's
 * variables and exposes the plaintext for its secret variables. It is a display
 * overlay only: it never writes the workflow store, so toggling the flag can never
 * clobber unsaved edits. The panel rows and the watcher/inspect modal both reveal
 * under this one flag.
 */

import { useEffect, useState } from 'react'
import { fetchTest, fetchTestWorkflow } from '@/features/tests/api/crud'
import { visitScopes } from '@/features/workbench/lib/function-scope-rows'
import { scopedVariableKey } from '@/features/workbench/lib/variable-scope-key'
import { holdsSecretValue, isStoredSecretValue } from '@/lib/secret-envelope'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { usePageBlock } from '@/hooks/use-page-block'
import { startBlockingRead } from '@/hooks/use-blocking-reads'
import type { Variable } from './variable-manager-content/types'

/** Revealed plaintext by scope and name (`scopedVariableKey`; a Test variable by its bare name). */
export type RevealedVariableValues = Record<string, unknown>

const EMPTY_REVEALED: RevealedVariableValues = {}
const VARIABLE_VALUES_LABEL = 'variable values'

interface RawVariableInfo {
  value?: unknown
  secret?: boolean
  masked?: boolean
}

/** The reveal overlay, and whether the reveal has answered for the current flag and Test. */
export interface RevealedVariableRead {
  values: RevealedVariableValues
  /** False while the reveal is on and no read of the current Test has returned. */
  settled: boolean
}

/** Revealed plaintext of the test's secrets, Function ones included, while the test-variables unmask is on. */
export function useRevealedVariableValues(): RevealedVariableRead {
  const testVariables = useMaskingSettingsStore((s) => s.testVariables)
  const editingTestId = useWorkflowStore((s) => s.editingTestId)
  const [revealed, setRevealed] = useState<RevealedVariableValues>(EMPTY_REVEALED)
  // The Test whose reveal read last returned; a failed read gives no answer.
  const [answeredTestId, setAnsweredTestId] = useState<string | null>(null)
  const { blockPage, clearPageBlock } = usePageBlock()

  useEffect(() => {
    clearPageBlock(VARIABLE_VALUES_LABEL)
    if (!testVariables || !editingTestId) {
      setRevealed(EMPTY_REVEALED)
      setAnsweredTestId(null)
      return
    }
    let active = true
    startBlockingRead(
      {
        label: VARIABLE_VALUES_LABEL,
        canceled: () => !active,
        run: async () => {
          try {
            const [detail, workflow] = await Promise.all([fetchTest(editingTestId), fetchTestWorkflow(editingTestId)])
            if (!active) return
            const vars = (detail.variables ?? {}) as Record<string, RawVariableInfo>
            const next: RevealedVariableValues = {}
            for (const [name, info] of Object.entries(vars)) {
              // The backend returns cleartext (no ``masked`` flag) for a revealed
              // secret variable; a masked entry means the reveal did not apply.
              if (info && typeof info === 'object' && info.secret && !info.masked) {
                next[name] = info.value
              }
            }
            Object.assign(next, revealedFunctionSecrets(workflow.nodes))
            setRevealed(next)
            setAnsweredTestId(editingTestId)
            clearPageBlock(VARIABLE_VALUES_LABEL)
          } catch (err) {
            // Fail closed: reveal nothing, and say the read failed.
            if (active) setRevealed(EMPTY_REVEALED)
            throw err
          }
        },
      },
      blockPage,
    )
    return () => {
      active = false
    }
  }, [testVariables, editingTestId, blockPage, clearPageBlock])

  const settled = !testVariables || !editingTestId || answeredTestId === editingTestId
  return { values: revealed, settled }
}

/** The Function secrets a workflow read returned in the clear (the masked placeholder or a sealed value is not revealed). */
function revealedFunctionSecrets(nodes: unknown[]): RevealedVariableValues {
  const revealed: RevealedVariableValues = {}
  const keep = (name: string, path: string[], value: unknown) => {
    if (holdsSecretValue(value) && !isStoredSecretValue(value)) {
      revealed[scopedVariableKey(name, path)] = value
    }
  }
  visitScopes(nodes, [], null, (path, body) => {
    for (const v of body.variables ?? []) if (v.isSecret) keep(v.name, path, v.value)
    for (const spec of body.outputs ?? []) {
      if (spec.secret === true && typeof spec.name === 'string') keep(spec.name, path, spec.default)
    }
  })
  return revealed
}

/** Overlay revealed plaintext onto the secret rows of the scope at `path`. */
export function applyRevealedValues(
  variables: Variable[],
  revealed: RevealedVariableValues,
  path: readonly string[],
): Variable[] {
  if (Object.keys(revealed).length === 0) return variables
  return variables.map((v) => {
    const key = scopedVariableKey(v.name, path)
    return v.isSecret && key in revealed ? { ...v, value: revealed[key] } : v
  })
}
