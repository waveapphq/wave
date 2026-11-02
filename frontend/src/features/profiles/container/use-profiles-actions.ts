/**
 * Profile CRUD action hooks
 *
 * Manages modal state and handlers for creating, editing,
 * deleting, and duplicating profiles.
 */

import { useCallback, useState } from 'react'
import type { Profile as ModalProfile, ProfileFormData } from '@/features/profiles/components/profile-form-modal'
import type { WaveType } from '@/features/profiles/components/profile-form-modal/types'
import { useToast } from '@/components/ui/toast'
import {
  fetchProfile,
  fetchProfileTypeSchema,
  createProfile,
  updateProfile,
  deleteProfile,
  duplicateProfile,
} from '@/features/profiles/api/crud'
import type {
  Profile,
  Environment,
  ProfileTypeSchemaField,
} from '@/features/profiles/api/types'
import {
  apiProfileToModalProfile,
  parametersToAllConfigs,
} from './transforms'
import { ENVIRONMENTS_UNAVAILABLE, ENVIRONMENTS_UNAVAILABLE_TOAST } from './refusal-copy'

/** The field types a typed profile declares, which a field it holds no value for takes (K8SPROF-6). */
async function declaredFieldTypes(type: string): Promise<Record<string, WaveType>> {
  if (type.toLowerCase() === 'custom') return {}
  try {
    const schema = await fetchProfileTypeSchema(type)
    return Object.fromEntries(schema.fields.map((field) => [field.name, field.type]))
  } catch {
    // An unreadable schema leaves each row to the type its stored values show.
    return {}
  }
}

export interface ModalState {
  modalOpen: boolean
  modalMode: 'create' | 'edit'
  editingProfile: ModalProfile | undefined
  modalLoading: boolean
  modalError: string | undefined
}

export interface DeleteState {
  deleteDialogOpen: boolean
  profileToDelete: Profile | null
  deleteLoading: boolean
}

export interface UseProfilesActionsReturn extends ModalState, DeleteState {
  handleNewProfile: () => void
  handleEditProfile: (profileId: string) => void
  handleDeleteProfile: (profileId: string) => void
  handleConfirmDelete: () => void
  handleCloseDeleteDialog: () => void
  handleModalClose: () => void
  handleModalSubmit: (data: ProfileFormData) => void
  handleDuplicateProfile: (profileId: string) => void
  handleFetchTypeSchema: (type: string) => Promise<ProfileTypeSchemaField[]>
}

export function useProfilesActions(
  profiles: Profile[],
  environments: Environment[],
  environmentsFailed: boolean,
  loadData: () => void,
  setError: (error: string | null) => void
): UseProfilesActionsReturn {
  const { warning, error: toastError } = useToast()

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create')
  const [editingProfile, setEditingProfile] = useState<ModalProfile | undefined>(undefined)
  const [modalLoading, setModalLoading] = useState(false)
  const [modalError, setModalError] = useState<string | undefined>(undefined)

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const handleNewProfile = useCallback(() => {
    // A failed environments read is not an empty environments list.
    if (environmentsFailed) {
      toastError(ENVIRONMENTS_UNAVAILABLE_TOAST, 'New Profile Not Created')
      return
    }
    // Cannot create profiles without environments
    if (environments.length === 0) {
      warning('Please create at least one environment in Settings before creating profiles.', 'No Environments')
      return
    }
    setModalMode('create')
    setEditingProfile(undefined)
    setModalError(undefined)
    setModalOpen(true)
  }, [environments, environmentsFailed, warning, toastError])

  // The row action cannot await, so a failed read lands on the page's own error state.
  const handleEditProfile = useCallback((profileId: string): void => {
    if (environmentsFailed) {
      toastError(ENVIRONMENTS_UNAVAILABLE_TOAST, 'Profile Not Opened for Editing')
      return
    }
    setModalMode('edit')
    setModalError(undefined)
    fetchProfile(profileId)
      .then(async (profile) => {
        const declared = await declaredFieldTypes(profile.type)
        setEditingProfile(apiProfileToModalProfile(profile, environments, declared))
        setModalOpen(true)
      })
      .catch((err: unknown) => {
        console.error('Failed to load profile for edit:', err)
        /* v8 ignore next - COV-DEF-023 */
        setError(err instanceof Error ? err.message : 'Failed to load profile')
      })
  }, [environments, environmentsFailed, setError, toastError])

  // Request to delete a profile - shows confirmation dialog
  const handleDeleteProfile = useCallback(
    (profileId: string) => {
      // Find the profile to get its name for the confirmation dialog
      const profile = profiles.find((p) => p.id === profileId)
      if (profile) {
        setProfileToDelete(profile)
        setDeleteDialogOpen(true)
      }
    },
    [profiles]
  )

  // Confirming closes the dialog, so both the refusal and the failure report at the gesture.
  const handleConfirmDelete = useCallback((): void => {
    /* v8 ignore next - COV-DEF-024 */
    if (!profileToDelete) return
    // Dialogs are portalled, so they outlive the inert region the block draws over the page.
    if (environmentsFailed) {
      toastError(ENVIRONMENTS_UNAVAILABLE_TOAST, 'Profile Not Deleted')
      return
    }
    setDeleteLoading(true)
    deleteProfile(profileToDelete.id)
      .then(() => {
        setDeleteDialogOpen(false)
        setProfileToDelete(null)
        setModalOpen(false)
        loadData()
      })
      .finally(() => setDeleteLoading(false))
      .catch((err: unknown) => {
        console.error('Failed to delete profile:', err)
        toastError(err instanceof Error ? err.message : 'Failed to delete profile', 'Delete Failed')
      })
  }, [profileToDelete, environmentsFailed, loadData, toastError])

  // Close the delete confirmation dialog
  const handleCloseDeleteDialog = useCallback(() => {
    if (!deleteLoading) {
      setDeleteDialogOpen(false)
      setProfileToDelete(null)
    }
  }, [deleteLoading])

  /* v8 ignore start - COV-DEF-050: Modal close callback state resets */
  const handleModalClose = useCallback(() => {
    setModalOpen(false)
    setEditingProfile(undefined)
    setModalError(undefined)
  }, [])
  /* v8 ignore stop */

  // The form's Save button cannot await, so a failed write lands on the
  // modal's own error line.
  const handleModalSubmit = useCallback(
    (data: ProfileFormData): void => {
      // Saving now would write a config built from environments that never arrived.
      if (environmentsFailed) {
        setModalError(ENVIRONMENTS_UNAVAILABLE)
        return
      }
      setModalLoading(true)
      setModalError(undefined)
      const save = async (): Promise<void> => {
        try {
          // Determine the profile type for proper config formatting
          /* v8 ignore next - COV-DEF-017 */
          const profileType = data.type || (modalMode === 'edit' && editingProfile ? editingProfile.type : 'custom')

          // Get configs for all environments (format depends on profile type)
          const environmentValues = parametersToAllConfigs(data.parameters, environments, profileType)

          if (modalMode === 'create') {
            await createProfile({
              name: data.name,
              /* v8 ignore next - COV-DEF-018 */
              type: data.type || 'custom',
              description: data.description,
              tags: data.tags,
              environment_values: environmentValues,
            })
          } else if (editingProfile) {
            await updateProfile(editingProfile.id, {
              name: data.name,
              /* v8 ignore next - COV-DEF-019 */
              type: data.type || editingProfile.type,
              description: data.description,
              tags: data.tags,
              environment_values: environmentValues,
            })
          }
          setModalOpen(false)
          setEditingProfile(undefined)
          loadData()
        } finally {
          setModalLoading(false)
        }
      }
      save().catch((err: unknown) => {
        console.error('Failed to save profile:', err)
        setModalError(err instanceof Error ? err.message : 'Failed to save profile')
      })
    },
    [modalMode, editingProfile, environments, environmentsFailed, loadData]
  )

  const handleDuplicateProfile = useCallback(
    (profileId: string): void => {
      if (environmentsFailed) {
        toastError(ENVIRONMENTS_UNAVAILABLE_TOAST, 'Profile Not Duplicated')
        return
      }
      duplicateProfile(profileId)
        .then(loadData)
        .catch((err: unknown) => {
          console.error('Failed to duplicate profile:', err)
          setError(err instanceof Error ? err.message : 'Failed to duplicate profile')
        })
    },
    [environmentsFailed, loadData, setError, toastError]
  )

  // Fetch profile type schema for default parameters
  const handleFetchTypeSchema = useCallback(async (type: string) => {
    const schema = await fetchProfileTypeSchema(type)
    return schema.fields
  }, [])

  return {
    // Modal state
    modalOpen,
    modalMode,
    editingProfile,
    modalLoading,
    modalError,
    // Delete state
    deleteDialogOpen,
    profileToDelete,
    deleteLoading,
    // Handlers
    handleNewProfile,
    handleEditProfile,
    handleDeleteProfile,
    handleConfirmDelete,
    handleCloseDeleteDialog,
    handleModalClose,
    handleModalSubmit,
    handleDuplicateProfile,
    handleFetchTypeSchema,
  }
}
