/**
 * useProfileForm - Custom hook for profile form state management
 *
 * Manages form state, validation, dirty detection, environment selection,
 * and delegates parameter operations to useParameterHandlers.
 *
 * REQ-4.7.4: Profile management UI - Create/Edit modal
 * REQ-4.7.10: Environment-specific configurations
 */

import * as React from 'react'
import { validateVariableName } from '@/features/workbench/hooks/use-variable-name-validation'
import { literalNumberProblem, numberBoundError } from '@/features/workbench/lib/validation/number-bounds'
import { afterPress } from '@/lib/after-press'
import type {
  Parameter,
  ProfileFormData,
  ProfileFormModalProps,
  ProfileTypeSchema,
  ProfileTypeSchemaField,
  Environment,
} from './types'
import { useParameterHandlers } from './use-parameter-handlers'
import type { ElementTypes } from '@/lib/variable-validation'

const NO_FIELDS: readonly ProfileTypeSchemaField[] = []
const NO_PLAIN_TEXT: ReadonlySet<string> = new Set()
const NO_EXPRESSIONS: ReadonlySet<string> = new Set()

/** Parameter id -> the number rule, then the bound its value in the environment breaks (REQ-3.1.3.14, FIELDERR-1). */
function valueErrorsOf(
  fields: readonly ProfileTypeSchemaField[],
  parameters: Parameter[],
  envId: string,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const parameter of parameters) {
    const message = literalNumberProblem(parameter.type, parameter.values[envId], false)
    if (message !== null) errors[parameter.id] = message
  }
  for (const field of fields) {
    const parameter = parameters.find((p) => p.name === field.name)
    if (!parameter || parameter.id in errors) continue
    const message = numberBoundError(field, { [field.name]: parameter.values[envId] }, [], NO_EXPRESSIONS)
    if (message !== null) errors[parameter.id] = message
  }
  return errors
}

export interface UseProfileFormOptions {
  open: boolean
  mode: ProfileFormModalProps['mode']
  profile: ProfileFormModalProps['profile']
  environments: Environment[]
  onFetchTypeSchema: ProfileFormModalProps['onFetchTypeSchema']
  onSubmit: ProfileFormModalProps['onSubmit']
  onDelete: ProfileFormModalProps['onDelete']
  loading: boolean
}

export interface UseProfileFormReturn {
  // Refs
  nameInputRef: React.RefObject<HTMLTextAreaElement | null>

  // Form state
  formData: ProfileFormData
  errors: Record<string, string>
  /** Parameter id -> the message of a value outside its declared bounds, for the environment on screen. */
  valueErrors: Record<string, string>
  /** Names of the fields the type marks plain text; their value editors offer no format. */
  plainTextNames: ReadonlySet<string>
  selectedEnvId: string
  selectedEnv: Environment | undefined

  // Type selector state
  typeSelectOpen: boolean
  setTypeSelectOpen: React.Dispatch<React.SetStateAction<boolean>>
  typeSearch: string
  setTypeSearch: React.Dispatch<React.SetStateAction<string>>

  // Environment selector state
  envSelectOpen: boolean
  setEnvSelectOpen: React.Dispatch<React.SetStateAction<boolean>>
  envSearch: string
  setEnvSearch: React.Dispatch<React.SetStateAction<string>>

  // Copy modal state
  copyModalOpen: boolean
  setCopyModalOpen: React.Dispatch<React.SetStateAction<boolean>>

  // Convert-to-custom state
  convertToCustomOpen: boolean
  setConvertToCustomOpen: React.Dispatch<React.SetStateAction<boolean>>

  /** Type awaiting the data-loss confirmation; empty string when none is pending. */
  pendingType: string

  // Computed
  isDirty: boolean
  /** The form's own fields are complete and valid, whatever its loading state. */
  isFormValid: boolean
  canSubmit: boolean
  isEditMode: boolean
  profileUsage: number
  canDelete: boolean
  deleteTitle: string
  environmentHasValues: (envId: string) => boolean
  envsWithValues: number
  envsWithoutValues: number
  hasIncompleteEnvironments: boolean

  // Handlers
  handleFieldChange: (field: string, value: unknown) => void
  /** A blank Name says so once it is left (FIELDERR-3). */
  handleNameBlur: () => void
  /** The author focuses or clicks Name; the focus it gets as the modal opens does not count (FIELDERR-3). */
  handleNameVisit: () => void
  handleTypeSelect: (type: string) => void
  handleAddParameter: () => void
  handleUpdateParameter: (id: string, updates: Partial<Parameter>) => void
  handleUpdateParameterValue: (id: string, value: string, elementTypes?: ElementTypes) => void
  handleDeleteParameter: (id: string) => void
  handleEnvironmentSelect: (envId: string) => void
  handleCopyValuesConfirm: (sourceEnvId: string) => void
  handleSubmit: (e: { preventDefault: () => void }) => void
  handleDelete: () => void
  handleConfirmConvertToCustom: () => void
  handleCancelConvertToCustom: () => void
  handleConfirmTypeChange: () => void
  handleCancelTypeChange: () => void
}

export function useProfileForm({
  open,
  mode,
  profile,
  environments,
  onFetchTypeSchema,
  onSubmit,
  onDelete,
  loading,
}: UseProfileFormOptions): UseProfileFormReturn {
  const nameInputRef = React.useRef<HTMLTextAreaElement>(null)
  // False from the automatic focus on open until the author types in Name, focuses it or clicks it.
  const nameVisitedRef = React.useRef(true)
  const autoFocusingNameRef = React.useRef(false)
  const [typeSelectOpen, setTypeSelectOpen] = React.useState(false)
  const [typeSearch, setTypeSearch] = React.useState('')
  const [envSelectOpen, setEnvSelectOpen] = React.useState(false)
  const [envSearch, setEnvSearch] = React.useState('')
  const [copyModalOpen, setCopyModalOpen] = React.useState(false)
  const [selectedEnvId, setSelectedEnvId] = React.useState(environments[0]?.id ?? '')

  // Form state
  const [formData, setFormData] = React.useState<ProfileFormData>({
    name: '',
    type: '',
    description: '',
    tags: [],
    parameters: [],
  })
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [originalData, setOriginalData] = React.useState<ProfileFormData | null>(null)
  // Its bounds apply only while the form holds the type it was read for.
  const [typeSchema, setTypeSchema] = React.useState<ProfileTypeSchema | null>(null)

  // Field change handler (needed by parameter handlers for type selection)
  const handleFieldChange = (field: string, value: unknown) => {
    if (field === 'name') nameVisitedRef.current = true
    setFormData((prev) => ({ ...prev, [field]: value }))
    /* v8 ignore start - COV-BRANCH-163 */
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
    /* v8 ignore stop */
  }

  // Parameter handlers (delegated to dedicated hook)
  const paramHandlers = useParameterHandlers({
    open,
    formData,
    setFormData,
    selectedEnvId,
    environments,
    onFetchTypeSchema,
    onTypeSchemaRead: setTypeSchema,
    handleFieldChange,
    setTypeSelectOpen,
    setTypeSearch,
  })

  // Initialize form when profile changes or mode changes
  React.useEffect(() => {
    if (mode === 'edit' && profile) {
      const data: ProfileFormData = {
        name: profile.name,
        type: profile.type,
        /* v8 ignore next - COV-BRANCH-163 */
        description: profile.description ?? '',
        tags: [...profile.tags],
        parameters: profile.parameters.map(p => ({
          ...p,
          values: { ...p.values },
        })),
      }
      setFormData(data)
      setOriginalData(data)
    } else if (mode === 'create') {
      const data: ProfileFormData = {
        name: '',
        type: 'custom',
        description: '',
        tags: [],
        parameters: [],
      }
      setFormData(data)
      setOriginalData(data)
    }
    setSelectedEnvId(environments[0]?.id ?? '')
    setErrors({})
  }, [mode, profile, open, environments])

  // An edit reads its type's schema once on open for the value bounds; a failed read checks nothing.
  const readTypeSchema = React.useEffectEvent((type: string) => {
    onFetchTypeSchema?.(type).then(
      (fields) => setTypeSchema({ type, fields }),
      () => setTypeSchema(null),
    )
  })
  React.useEffect(() => {
    if (open && mode === 'edit' && profile && profile.type.toLowerCase() !== 'custom') {
      readTypeSchema(profile.type)
    }
  }, [open, mode, profile])

  // Focus name input when modal opens; a Name the author already focused is left as it is.
  React.useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        const input = nameInputRef.current
        if (input === null || input === document.activeElement) return
        nameVisitedRef.current = false
        autoFocusingNameRef.current = true
        input.focus()
        autoFocusingNameRef.current = false
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Validation
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}
    /* v8 ignore next 3 - COV-BRANCH-147: V8 tracks if-branch + assignment as separate branches */
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // Dirty detection
  const isDirty = React.useMemo(() => {
    if (!originalData) return false
    return (
      formData.name !== originalData.name ||
      formData.description !== originalData.description ||
      JSON.stringify(formData.tags) !== JSON.stringify(originalData.tags) ||
      JSON.stringify(formData.parameters) !== JSON.stringify(originalData.parameters)
    )
  }, [formData, originalData])

  const valueErrors = React.useMemo(
    () =>
      valueErrorsOf(
        typeSchema?.type === formData.type ? typeSchema.fields : NO_FIELDS,
        formData.parameters,
        selectedEnvId,
      ),
    [typeSchema, formData.type, formData.parameters, selectedEnvId],
  )
  const hasValueErrors = Object.keys(valueErrors).length > 0
  const plainTextNames = React.useMemo(
    () =>
      typeSchema?.type === formData.type
        ? new Set(typeSchema.fields.filter((field) => field.plain).map((field) => field.name))
        : NO_PLAIN_TEXT,
    [typeSchema, formData.type],
  )

  const isFormValid = React.useMemo(() => {
    if (formData.name.trim().length === 0 || formData.type.trim().length === 0 || hasValueErrors) {
      return false
    }
    const nameExists = (name: string, excludeId: string) =>
      formData.parameters.some((p) => p.id !== excludeId && p.name === name)
    // Every parameter must have a non-empty, valid name - an unnamed param is
    // silently dropped on save (parametersToConfig skips blank names), so block Save.
    return formData.parameters.every(
      (p) =>
        p.name.trim().length > 0 &&
        validateVariableName(p.name, { variableId: p.id, nameExists }) === null,
    )
  }, [formData.name, formData.type, formData.parameters, hasValueErrors])
  const canSubmit = !loading && isFormValid

  const handleNameBlur = () => {
    if (nameVisitedRef.current && formData.name.trim() === '') {
      afterPress(() => setErrors((prev) => ({ ...prev, name: 'Name is required' })))
    }
  }

  const handleNameVisit = () => {
    if (!autoFocusingNameRef.current) nameVisitedRef.current = true
  }

  const handleEnvironmentSelect = (envId: string) => {
    setSelectedEnvId(envId)
    setEnvSelectOpen(false)
  }

  const handleSubmit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    /* v8 ignore next 3 - COV-BRANCH-148: V8 tracks early-return branch separately */
    if (!validateForm()) {
      return
    }
    onSubmit({
      ...formData,
      name: formData.name.trim(),
      description: formData.description.trim(),
    })
  }

  const handleDelete = () => {
    if (profile) {
      onDelete(profile.id)
    }
  }

  // Computed values
  const isEditMode = mode === 'edit'
  const profileUsage = profile?.usage ?? 0
  const canDelete = isEditMode && profileUsage === 0
  let deleteTitle: string
  if (canDelete) {
    deleteTitle = 'Delete profile'
  } else {
    /* v8 ignore next - COV-BRANCH-163 */
    deleteTitle = `Cannot delete: in use by ${profileUsage} ${profileUsage === 1 ? 'test' : 'tests'}`
  }

  const selectedEnv = environments.find((e) => e.id === selectedEnvId)

  const environmentHasValues = React.useCallback(
    (envId: string): boolean => {
      if (formData.parameters.length === 0) return false
      return formData.parameters.some((p) => {
        const value = p.values[envId]
        return value !== undefined && value !== ''
      })
    },
    [formData.parameters]
  )

  const envsWithValues = React.useMemo(
    () => environments.filter((env) => environmentHasValues(env.id)).length,
    [environments, environmentHasValues]
  )
  const envsWithoutValues = environments.length - envsWithValues
  const hasIncompleteEnvironments = envsWithoutValues > 0 && formData.parameters.length > 0

  return {
    nameInputRef,
    formData,
    errors,
    valueErrors,
    plainTextNames,
    selectedEnvId,
    selectedEnv,
    typeSelectOpen,
    setTypeSelectOpen,
    typeSearch,
    setTypeSearch,
    envSelectOpen,
    setEnvSelectOpen,
    envSearch,
    setEnvSearch,
    copyModalOpen,
    setCopyModalOpen,
    convertToCustomOpen: paramHandlers.convertToCustomOpen,
    setConvertToCustomOpen: paramHandlers.setConvertToCustomOpen,
    pendingType: paramHandlers.pendingType,
    isDirty,
    isFormValid,
    canSubmit,
    isEditMode,
    profileUsage,
    canDelete,
    deleteTitle,
    environmentHasValues,
    envsWithValues,
    envsWithoutValues,
    hasIncompleteEnvironments,
    handleFieldChange,
    handleNameBlur,
    handleNameVisit,
    handleTypeSelect: paramHandlers.handleTypeSelect,
    handleAddParameter: paramHandlers.handleAddParameter,
    handleUpdateParameter: paramHandlers.handleUpdateParameter,
    handleUpdateParameterValue: paramHandlers.handleUpdateParameterValue,
    handleDeleteParameter: paramHandlers.handleDeleteParameter,
    handleEnvironmentSelect,
    handleCopyValuesConfirm: paramHandlers.handleCopyValuesConfirm,
    handleSubmit,
    handleDelete,
    handleConfirmConvertToCustom: paramHandlers.handleConfirmConvertToCustom,
    handleCancelConvertToCustom: paramHandlers.handleCancelConvertToCustom,
    handleConfirmTypeChange: paramHandlers.handleConfirmTypeChange,
    handleCancelTypeChange: paramHandlers.handleCancelTypeChange,
  }
}
