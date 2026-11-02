/**
 * useParameterHandlers - Parameter CRUD operations with type conversion confirmation
 *
 * Manages adding, updating, deleting parameters, and the confirmation flow
 * for converting non-custom profile types to custom when structure changes.
 *
 * REQ-4.7.4: Profile management UI - parameter management
 */

import * as React from 'react'
import type {
  Parameter,
  ProfileFormData,
  ProfileFormModalProps,
  ProfileTypeSchema,
  ProfileTypeSchemaField,
  WaveType,
  Environment,
} from './types'
import { withEnvironmentElementTypes } from './types'
import type { ElementTypes } from '@/lib/variable-validation'
import { randomUUID } from '@/lib/uuid'
import { useToast } from '@/components/ui/toast'

/**
 * Coerce a schema-provided type string to a WaveType. The schema endpoint
 * returns types already in WAVE's canonical lowercase form, so this is a
 * narrow case-insensitive cast.
 */
function schemaTypeToWaveType(schemaType: string): WaveType {
  return schemaType.toLowerCase() as WaveType
}

/** Per-environment values are held as strings and coerced on save; a map default is held as its JSON. */
function seedValue(declared: ProfileTypeSchemaField['default']): string {
  if (declared === undefined) return ''
  return typeof declared === 'object' ? JSON.stringify(declared) : String(declared)
}

/** One row per schema field, its declared starting value seeded into every environment. */
function seededParameters(
  schemaFields: ProfileTypeSchemaField[],
  environments: Environment[],
): Parameter[] {
  return schemaFields.map((field) => {
    const seed = seedValue(field.default)
    return {
      id: randomUUID(),
      name: field.name,
      type: schemaTypeToWaveType(field.type),
      secret: field.secret,
      values: Object.fromEntries(environments.map((env) => [env.id, seed])),
    }
  })
}

/** Identity of a parameter set ignoring row ids, used to spot author edits. */
function parametersSignature(parameters: Parameter[]): string {
  return JSON.stringify(parameters.map((p) => [p.name, p.type, p.secret, p.values]))
}

function hasEnteredValue(parameters: Parameter[]): boolean {
  return parameters.some((p) => Object.values(p.values).some((v) => v.trim() !== ''))
}

/** Apply partial updates to a parameter by id */
function updateParameterById(
  parameters: Parameter[],
  id: string,
  updates: Partial<Parameter>,
): Parameter[] {
  return parameters.map((p) => (p.id === id ? { ...p, ...updates } : p))
}

export interface UseParameterHandlersOptions {
  open: boolean
  formData: ProfileFormData
  setFormData: React.Dispatch<React.SetStateAction<ProfileFormData>>
  selectedEnvId: string
  environments: Environment[]
  onFetchTypeSchema: ProfileFormModalProps['onFetchTypeSchema']
  /** Receives the schema read for a picked type, whose bounds the form checks. */
  onTypeSchemaRead: (schema: ProfileTypeSchema) => void
  handleFieldChange: (field: string, value: unknown) => void
  setTypeSelectOpen: React.Dispatch<React.SetStateAction<boolean>>
  setTypeSearch: React.Dispatch<React.SetStateAction<string>>
}

export interface UseParameterHandlersReturn {
  // Convert-to-custom state
  convertToCustomOpen: boolean
  setConvertToCustomOpen: React.Dispatch<React.SetStateAction<boolean>>

  /** Type awaiting the data-loss confirmation; empty string when none is pending. */
  pendingType: string

  // Handlers
  handleTypeSelect: (type: string) => void
  handleConfirmTypeChange: () => void
  handleCancelTypeChange: () => void
  handleAddParameter: () => void
  handleUpdateParameter: (id: string, updates: Partial<Parameter>) => void
  handleUpdateParameterValue: (id: string, value: string, elementTypes?: ElementTypes) => void
  handleDeleteParameter: (id: string) => void
  handleCopyValuesConfirm: (sourceEnvId: string) => void
  handleConfirmConvertToCustom: () => void
  handleCancelConvertToCustom: () => void
}

export function useParameterHandlers({
  open,
  formData,
  setFormData,
  selectedEnvId,
  environments,
  onFetchTypeSchema,
  onTypeSchemaRead,
  handleFieldChange,
  setTypeSelectOpen,
  setTypeSearch,
}: UseParameterHandlersOptions): UseParameterHandlersReturn {
  const [convertToCustomOpen, setConvertToCustomOpen] = React.useState(false)
  const [pendingAction, setPendingAction] = React.useState<(() => void) | null>(null)
  const [pendingType, setPendingType] = React.useState('')
  const { error: toastError } = useToast()

  // Signature of the rows as the last type select seeded them; null until one has.
  const seededSignatureRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    seededSignatureRef.current = null
  }, [open])

  /**
   * Check if the current type is a non-custom type that would need conversion
   */
  const isNonCustomType = formData.type && formData.type.toLowerCase() !== 'custom'

  /**
   * Wrap a parameter structure modification (add, delete, rename, change type) with confirmation
   * if the profile type is non-custom. Value changes don't require confirmation.
   */
  const withTypeConversionConfirmation = (action: () => void) => {
    if (isNonCustomType) {
      setPendingAction(() => action)
      setConvertToCustomOpen(true)
    } else {
      action()
    }
  }

  const handleConfirmConvertToCustom = () => {
    setFormData((prev) => ({ ...prev, type: 'custom' }))
    if (pendingAction) {
      pendingAction()
    }
    setConvertToCustomOpen(false)
    setPendingAction(null)
  }

  /* v8 ignore next 4 - COV-BRANCH-160 */
  const handleCancelConvertToCustom = () => {
    setConvertToCustomOpen(false)
    setPendingAction(null)
  }

  /**
   * Handle type selection - fetch schema and populate default parameters for non-custom types
   */
  // The type list cannot await, so a failed schema read names itself in a toast
  // instead of silently leaving the type with no default parameters.
  const applyTypeSelect = (type: string): void => {
    handleFieldChange('type', type)
    setTypeSelectOpen(false)
    setTypeSearch('')

    if (type.toLowerCase() === 'custom') {
      return
    }

    if (onFetchTypeSchema) {
      onFetchTypeSchema(type)
        .then((schemaFields) => {
          if (schemaFields && schemaFields.length > 0) {
            onTypeSchemaRead({ type, fields: schemaFields })
            const defaultParams = seededParameters(schemaFields, environments)
            seededSignatureRef.current = parametersSignature(defaultParams)
            setFormData((prev) => ({
              ...prev,
              parameters: defaultParams,
            }))
          }
        })
        .catch((err: unknown) => {
          toastError(
            err instanceof Error ? err.message : 'Request failed',
            'Could Not Load Default Parameters',
          )
        })
    }
  }

  /** True when re-seeding would throw away rows or values the author put in. */
  const wouldDiscardParameters = (): boolean => {
    const parameters = formData.parameters
    if (parameters.length === 0) {
      return false
    }
    const seeded = seededSignatureRef.current
    if (seeded === null) {
      return hasEnteredValue(parameters)
    }
    return parametersSignature(parameters) !== seeded
  }

  // Choosing custom keeps the rows, so only a re-seeding type can discard anything.
  const handleTypeSelect = (type: string): void => {
    if (type.toLowerCase() !== 'custom' && wouldDiscardParameters()) {
      setTypeSelectOpen(false)
      setTypeSearch('')
      setPendingType(type)
      return
    }
    applyTypeSelect(type)
  }

  const handleConfirmTypeChange = () => {
    applyTypeSelect(pendingType)
    setPendingType('')
  }

  const handleCancelTypeChange = () => {
    setPendingType('')
  }

  const createNewParameter = (): Parameter => {
    const initialValues: Record<string, string> = {}
    environments.forEach((env) => {
      initialValues[env.id] = ''
    })
    return {
      id: randomUUID(),
      name: '',
      type: 'string',
      secret: false,
      values: initialValues,
    }
  }

  const handleAddParameter = () => {
    withTypeConversionConfirmation(() => {
      const newParam = createNewParameter()
      setFormData((prev) => ({
        ...prev,
        parameters: [...prev.parameters, newParam],
      }))
    })
  }

  const handleUpdateParameter = (id: string, updates: Partial<Parameter>) => {
    // A new type starts without element types (REQ-3.1.3.19).
    const effective = 'type' in updates ? { ...updates, elementTypes: undefined } : updates
    const applyUpdate = () => setFormData((prev) => ({
      ...prev,
      parameters: updateParameterById(prev.parameters, id, effective),
    }))

    const isStructuralChange = 'name' in updates || 'type' in updates
    if (isStructuralChange) {
      withTypeConversionConfirmation(applyUpdate)
    } else {
      applyUpdate()
    }
  }

  const handleUpdateParameterValue = (id: string, value: string, elementTypes?: ElementTypes) => {
    setFormData((prev) => ({
      ...prev,
      parameters: prev.parameters.map((p) =>
        p.id === id
          ? withEnvironmentElementTypes(
              { ...p, values: { ...p.values, [selectedEnvId]: value } },
              selectedEnvId,
              elementTypes,
            )
          : p
      ),
    }))
  }

  const handleDeleteParameter = (id: string) => {
    const withoutId = (params: typeof formData.parameters) =>
      params.filter((p) => p.id !== id)
    const applyDelete = () =>
      setFormData((prev) => ({ ...prev, parameters: withoutId(prev.parameters) }))
    withTypeConversionConfirmation(applyDelete)
  }

  const handleCopyValuesConfirm = (sourceEnvId: string) => {
    setFormData((prev) => ({
      ...prev,
      parameters: prev.parameters.map((p) =>
        withEnvironmentElementTypes(
          {
            ...p,
            values: {
              ...p.values,
              /* v8 ignore next - COV-BRANCH-162 */
              [selectedEnvId]: p.values[sourceEnvId] ?? '',
            },
          },
          selectedEnvId,
          p.elementTypes?.[sourceEnvId],
        ),
      ),
    }))
  }

  return {
    convertToCustomOpen,
    setConvertToCustomOpen,
    pendingType,
    handleTypeSelect,
    handleConfirmTypeChange,
    handleCancelTypeChange,
    handleAddParameter,
    handleUpdateParameter,
    handleUpdateParameterValue,
    handleDeleteParameter,
    handleCopyValuesConfirm,
    handleConfirmConvertToCustom,
    handleCancelConvertToCustom,
  }
}
