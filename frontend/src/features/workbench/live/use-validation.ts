/**
 * Validation Hook - Validation error dialog state and handlers
 *
 * Handles validation error dialog state, fix-all, delete fatal test,
 * and validation close navigation.
 */

import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { useToast } from '@/components/ui/toast'
import type {
  ValidationError,
  ValidationDialogMode,
} from '@/features/workbench/common/canvas/dialogs/validation-error-dialog'
import type { PathSegment } from '@/features/workbench/common/canvas/dialogs/validation-path-row'
import { drillToPath, type DrillSegment } from '@/features/functions/canvas/use-drill-handler'
import { convertBackendVariables } from './variable-helpers'
import { canvasLocalFunctionBodies } from '@/features/workbench/lib/canonical-workflow'
import { fixTest } from '@/features/tests/api/validation'

const EMPTY_SEGMENTS: PathSegment[] = []

export interface ValidationResult {
  // State
  showValidationErrorDialog: boolean
  setShowValidationErrorDialog: (show: boolean) => void
  validationErrors: ValidationError[]
  setValidationErrors: (errors: ValidationError[]) => void
  validationFatal: boolean
  setValidationFatal: (fatal: boolean) => void
  validationMode: ValidationDialogMode
  setValidationMode: (mode: ValidationDialogMode) => void
  isFixingTest: boolean
  /** True when the dialog's "Fix All" should be offered:
   *  - load mode: at least one issue carries a BE fix_action (auto-fixable).
   *    Content issues (missing param, undefined ref, missing version) carry
   *    none, so a test with only those offers no Fix All.
   *  - save / run / debug: inline auto-fix only handles UNDECLARED_VARIABLE,
   *    so we only offer the button when at least one such error is present. */
  canFixAll: boolean

  // Handlers
  handleValidationClose: () => void
  handleDeleteFatalTest: () => Promise<void>
  handleFixAll: () => Promise<void>
  /** Drill to the issue's location, focus the leaf, and dismiss the dialog. */
  navigateToIssue: (error: ValidationError, depthIndex?: number) => void
}

/** Only an error pulses a block; a warning is listed and left alone (PYRUN-14). */
function collectAffectedNodeIds(errors: ValidationError[]): string[] {
  const ids = new Set<string>()
  for (const err of errors) {
    if (err.severity === 'warning') continue
    if (err.node_id) ids.add(err.node_id)
  }
  return [...ids]
}

const _VARIABLE_PATH_PREFIX = 'variables.'
const _VAR_TYPES = new Set(['string', 'integer', 'float', 'boolean', 'array', 'map', 'table'])

interface UndeclaredVarFix {
  name: string
  type: 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'
}

/** Extract (name, inferred type) for every UNDECLARED_VARIABLE error.
 *  Type comes from the BE fix_action string "Add variable to manager (type: X)";
 *  unknown / missing types fall back to 'string'. */
function collectUndeclaredVarFixes(errors: ValidationError[]): UndeclaredVarFix[] {
  const out: UndeclaredVarFix[] = []
  const seen = new Set<string>()
  for (const err of errors) {
    if (err.code !== 'UNDECLARED_VARIABLE') continue
    const path = err.path ?? ''
    if (!path.startsWith(_VARIABLE_PATH_PREFIX)) continue
    const name = path.slice(_VARIABLE_PATH_PREFIX.length)
    if (!name || seen.has(name)) continue
    seen.add(name)
    const match = /\(type: (\w+)\)/.exec(err.fix_action ?? '')
    const candidate = match?.[1]
    const type = (candidate && _VAR_TYPES.has(candidate) ? candidate : 'string') as UndeclaredVarFix['type']
    out.push({ name, type })
  }
  return out
}

/** Pick the "click X again" verb for the post-fix toast based on the
 *  validation mode that opened the dialog. */
function pickRetryVerb(mode: ValidationDialogMode): 'save' | 'run' | 'debug' {
  if (mode === 'save') return 'save'
  if (mode === 'run') return 'run'
  return 'debug'
}

export function useValidation(
  clearDraft: () => void,
): ValidationResult {
  const navigate = useNavigate()
  const toast = useToast()

  const reset = useWorkflowStore((state) => state.reset)
  const setNodes = useWorkflowStore((state) => state.setNodes)
  const setEdges = useWorkflowStore((state) => state.setEdges)
  const addVariable = useWorkflowStore((state) => state.addVariable)
  const markSaved = useWorkflowStore((state) => state.markSaved)
  const setPulseValidationNodeIds = useWorkflowStore((state) => state.setPulseValidationNodeIds)
  const requestFitView = useWorkflowStore((state) => state.requestFitView)
  const editingTestId = useWorkflowStore((state) => state.editingTestId)
  const setEditingTest = useWorkflowStore((state) => state.setEditingTest)
  const clearEditingTest = useWorkflowStore((state) => state.clearEditingTest)
  const setVariables = useWorkflowStore((state) => state.setVariables)

  const [showValidationErrorDialog, setShowValidationErrorDialog] = useState(false)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  const [validationFatal, setValidationFatal] = useState(false)
  const [validationMode, setValidationMode] = useState<ValidationDialogMode>('load')
  const [isFixingTest, setIsFixingTest] = useState(false)

  // Handle validation error dialog Close (Cancel).
  // - save / run / debug: stay on canvas, pulse the offending nodes so the
  //   user can see which blocks need attention before retrying.
  // - load (non-fatal): keep the test loaded with regular (non-pulsing)
  //   per-node alerts; the user chose Cancel over Fix, so the workflow
  //   stays unresolved on the canvas. `computeNodeIssues` already drives
  //   those alerts.
  // - load (fatal): the test couldn't load, so dismissing the dialog must
  //   take the user somewhere usable. Navigate back to /tests.
  const handleValidationClose = useCallback(function validationClose() {
    const previousMode = validationMode
    const previousErrors = validationErrors
    const previousFatal = validationFatal
    setShowValidationErrorDialog(false)
    setValidationErrors([])
    setValidationFatal(false)
    setValidationMode('load')
    if (previousMode === 'save' || previousMode === 'run' || previousMode === 'debug') {
      setPulseValidationNodeIds(collectAffectedNodeIds(previousErrors))
      return
    }
    if (previousFatal) {
      reset()
      clearDraft()
      clearEditingTest()
      navigate('/tests')
    }
  }, [validationMode, validationErrors, validationFatal, setPulseValidationNodeIds, reset, clearDraft, clearEditingTest, navigate])

  // Handle fatal validation - delete the broken test
  const handleDeleteFatalTest = useCallback(async function deleteFatalTest() {
    if (!editingTestId) return
    try {
      const { deleteTest } = await import('@/features/tests/api/crud')
      await deleteTest(editingTestId)
      setShowValidationErrorDialog(false)
      setValidationErrors([])
      setValidationFatal(false)
      reset()
      clearDraft()
      clearEditingTest()
      navigate('/tests')
      toast.success('Test has been deleted.', 'Test Deleted')
    } catch (err) {
      console.error('Failed to delete test:', err)
      toast.error('Failed to delete test.', 'Delete Failed')
    }
  }, [editingTestId, reset, clearDraft, clearEditingTest, navigate])

  // Handle validation error dialog Fix.
  //
  // Load mode: call `fix_test` on disk and reload the (now-fixed) test into the
  // canvas. Disk state IS the canvas state, so reloading is safe.
  //
  // Save / Run / Debug modes: the canvas has the user's dirty edits (which is
  // what triggered the validation error in the first place). Reloading from
  // disk would clobber those edits. Instead, apply the fix inline: declare the
  // missing variables on the in-memory workflow store with sensible defaults.
  // The user re-runs Save / Run after the dialog closes; the alert badges
  // disappear immediately because `computeNodeIssues` re-resolves the refs.
  // Load-mode Fix: reload the BE-repaired test into the canvas. Disk
  // becomes the canvas state, so a full reset+reload is safe. The caller
  // (handleFixAll) gates on editingTestId so this is safe to assume.
  const applyLoadModeFix = useCallback(async (testId: string) => {
    const fixResult = await fixTest(testId)

    const testDetails = fixResult.test
    const workflow = testDetails.workflow ?? { nodes: [], edges: [] }

    reset()
    setEditingTest(testId, testDetails.name)

    if (workflow.nodes && workflow.nodes.length > 0) {
      setNodes(canvasLocalFunctionBodies(workflow.nodes) as Parameters<typeof setNodes>[0], { skipDirty: true })
    }
    if (workflow.edges && workflow.edges.length > 0) {
      setEdges(workflow.edges as Parameters<typeof setEdges>[0], { skipDirty: true })
    }

    if (testDetails.variables && Object.keys(testDetails.variables).length > 0) {
      const loadedVariables = convertBackendVariables(testDetails.variables)
      setVariables(loadedVariables, { skipDirty: true })
    } else {
      setVariables([], { skipDirty: true })
    }

    markSaved()
    setPulseValidationNodeIds([])
    clearDraft()
    requestFitView({ padding: 0.2, duration: 0 })
    toast.success('All issues have been automatically fixed.', 'Test Fixed')
  }, [reset, setEditingTest, setNodes, setEdges, setVariables, markSaved, setPulseValidationNodeIds, clearDraft, requestFitView, toast])

  // Save / Run / Debug mode Fix: declare the missing variables in-memory
  // (the canvas owns the dirty edits), holding null like the backend Fix. Toast prompts the user to retry.
  const applyInlineVarFix = useCallback(() => {
    const fixes = collectUndeclaredVarFixes(validationErrors)
    for (const fix of fixes) {
      addVariable({ name: fix.name, type: fix.type })
    }
    setPulseValidationNodeIds([])
    if (fixes.length > 0) {
      const verb = pickRetryVerb(validationMode)
      toast.success(
        `Added ${fixes.length} missing variable(s). Click ${verb.charAt(0).toUpperCase() + verb.slice(1)} again to commit.`,
        'Variables Added',
      )
    }
  }, [validationErrors, validationMode, addVariable, setPulseValidationNodeIds, toast])

  const handleFixAll = useCallback(async function fixAllValidationErrors() {
    if (!editingTestId) return
    setIsFixingTest(true)
    try {
      if (validationMode === 'load') {
        await applyLoadModeFix(editingTestId)
      } else {
        applyInlineVarFix()
      }
      setShowValidationErrorDialog(false)
      setValidationErrors([])
      setValidationFatal(false)
    } catch (err) {
      console.error('Failed to fix test:', err)
      toast.error('Failed to apply automatic fixes. Please try again.', 'Fix Failed')
    } finally {
      setIsFixingTest(false)
    }
  }, [editingTestId, validationMode, applyLoadModeFix, applyInlineVarFix, toast])

  // Drill to an issue's location and dismiss the dialog. Enclosing-Function
  // segments are always Local (the canonical pipeline only descends Local
  // bodies), so a plain pushDrill chain reaches every level. A segment click
  // drills into that Function; a row/leaf click drills to and selects the leaf.
  const navigateToIssue = useCallback(
    (error: ValidationError, depthIndex?: number) => {
      setShowValidationErrorDialog(false)
      const segments = error.functionPath ?? EMPTY_SEGMENTS
      const targetIsSegment = depthIndex !== undefined
      const drillCount = targetIsSegment ? depthIndex + 1 : segments.length
      const pathSegments: DrillSegment[] = []
      for (let i = 0; i < drillCount; i++) {
        const nodeId = segments[i]?.nodeId
        if (nodeId) pathSegments.push({ nodeId })
      }
      drillToPath(pathSegments, targetIsSegment ? undefined : error.node_id)
    },
    [],
  )

  const canFixAll = validationMode === 'load'
    ? validationErrors.some((e) => e.fix_action != null)
    : validationErrors.some((e) => e.code === 'UNDECLARED_VARIABLE')

  return {
    showValidationErrorDialog,
    setShowValidationErrorDialog,
    validationErrors,
    setValidationErrors,
    validationFatal,
    setValidationFatal,
    validationMode,
    setValidationMode,
    isFixingTest,
    canFixAll,
    handleValidationClose,
    handleDeleteFatalTest,
    handleFixAll,
    navigateToIssue,
  }
}
