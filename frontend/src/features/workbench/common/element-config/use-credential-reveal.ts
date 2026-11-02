/**
 * Reactive credential-field reveal for the config modal (REQ-3.1.3.18).
 *
 * A stored credential is a sealed `wave:enc:v1:` envelope the FE cannot decrypt.
 * When the system "unmask plugin credential input fields" flag is on, the backend
 * read paths return the credential params in the clear, so this hook re-fetches
 * the current test's workflow for the open node and exposes the plaintext for the
 * node's declared credential params. It is a display overlay only: it never writes
 * to the canvas store, so toggling the flag can never clobber unsaved edits.
 */

import { createContext, useEffect, useState } from 'react'
import { fetchTestWorkflow } from '@/features/tests/api/crud'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useMaskingSettingsStore } from '@/stores/masking-settings-store'
import { isSealedSecret } from '@/lib/secret-envelope'
import { findNodeDeepById } from '@/features/functions/canvas/inner-workflow'
import { usePageBlock } from '@/hooks/use-page-block'
import { startBlockingRead } from '@/hooks/use-blocking-reads'

/** Map of credential param name -> revealed plaintext for the open node. */
export type RevealedCredentials = Record<string, string>

const EMPTY_REVEALED: RevealedCredentials = {}
const CREDENTIALS_LABEL = 'credential values'

/** Revealed plaintext for the open config-modal node's credential params. */
export const CredentialRevealContext = createContext<RevealedCredentials>(EMPTY_REVEALED)

interface WorkflowNodeShape {
  id: string
  data?: Record<string, unknown> & { config?: { values?: Record<string, unknown> } }
}

/** Fetch and expose the revealed credential values for one node while the
 *  credential-inputs unmask flag is on. Returns an empty map when off or when
 *  ``enabled`` is false (non-plugin nodes have no credential fields). */
export function useCredentialReveal(nodeId: string, enabled: boolean): RevealedCredentials {
  const credentialInputs = useMaskingSettingsStore((s) => s.credentialInputs)
  const editingTestId = useWorkflowStore((s) => s.editingTestId)
  const [revealed, setRevealed] = useState<RevealedCredentials>(EMPTY_REVEALED)
  const { blockPage, clearPageBlock } = usePageBlock()

  useEffect(() => {
    clearPageBlock(CREDENTIALS_LABEL)
    if (!enabled || !credentialInputs || !editingTestId) {
      setRevealed(EMPTY_REVEALED)
      return
    }
    let active = true
    startBlockingRead(
      {
        label: CREDENTIALS_LABEL,
        canceled: () => !active,
        run: async () => {
          try {
            const workflow = await fetchTestWorkflow(editingTestId)
            if (!active) return
            const nodes = (workflow.nodes ?? []) as WorkflowNodeShape[]
            const node = findNodeDeepById(nodes, nodeId)
            const values = node?.data?.config?.values ?? {}
            const next: RevealedCredentials = {}
            for (const [key, value] of Object.entries(values)) {
              // The backend returned this cleartext only for a revealed credential;
              // a sealed envelope means it is not a revealable credential param.
              if (typeof value === 'string' && !isSealedSecret(value)) next[key] = value
            }
            setRevealed(next)
            clearPageBlock(CREDENTIALS_LABEL)
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
  }, [enabled, credentialInputs, editingTestId, nodeId, blockPage, clearPageBlock])

  return revealed
}
