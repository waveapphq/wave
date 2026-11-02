/**
 * ProfileBindingSheet - Profile binding management for element configuration
 * - PROFILE-11: "Profiles" button in element config footer
 * - PROFILE-13-14: Sheet header with close
 * - PROFILE-15-18: Bound profiles section with alias editing and remove
 * - PROFILE-19-22: Add profile section with search
 * - PROFILE-24: Done button
 * - PROFILE-25: Access pattern: alias.field
 */

import { useState, useEffect, useMemo, useCallback, type Ref } from 'react'
import { DraggableSheet, type SheetHandle } from '@/components/shared/draggable-sheet'
import { useChildEditor } from '@/components/shared/child-editors/child-editor-scope'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { NameField } from '@/components/shared/fields/name-field'
import { MAX_VARIABLE_NAME_LENGTH } from '@/lib/field-constraints'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X, Plus, GripVertical } from 'lucide-react'
import { fetchProfiles } from '@/features/profiles/api/crud'
import type { Profile } from '@/features/profiles/api/types'
import { validateVariableName } from '@/features/workbench/hooks/use-variable-name-validation'
import type { EnrichedVariable } from '../types'
import { ConditionalTooltip } from '@/components/ui/tooltip'

export interface ProfileBinding {
  profileId: string
  profileName: string
  profileType: string
  alias: string
  /** Profile type schema fields for autocomplete. May be absent in legacy data. */
  fields?: Array<{ name: string; type: string }>
}

interface ProfileBindingModalProps {
  /** Lets the opener raise this sheet again. */
  ref?: Ref<SheetHandle>
  isOpen: boolean
  onClose: () => void
  bindings: ProfileBinding[]
  /**
   * Variables visible at this binding's scope (excluding profile aliases).
   * Used to detect cross-namespace conflicts: a profile alias may not collide
   * with any variable name reachable from the same expression scope.
   */
  availableVariables?: EnrichedVariable[]
  /** Writes the bindings; the sheet closes itself afterwards. */
  onDone: (bindings: ProfileBinding[]) => void
}

/**
 * Generate a default alias from profile name.
 * Lowercase, replace spaces with underscores, strip non-alphanumeric.
 */
export function generateAlias(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/\s+/g, '_')
    .replaceAll(/[^a-z0-9_]/g, '')
}

export function ProfileBindingModal({
  ref,
  isOpen,
  onClose,
  bindings,
  availableVariables = [],
  onDone,
}: Readonly<ProfileBindingModalProps>) {
  const [localBindings, setLocalBindings] = useState<ProfileBinding[]>(bindings)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Variable names that aliases must not collide with (exclude any variable
  // sourced from a profile - those are aliases themselves, handled separately).
  const conflictingVarNames = useMemo(() => {
    const names = new Set<string>()
    for (const v of availableVariables) {
      if (v.source?.startsWith('Profile:')) continue
      if (v.name.includes('.')) continue // dotted namespace entries
      names.add(v.name)
    }
    return names
  }, [availableVariables])

  /** Per-alias validation error: identifier rules + cross-namespace conflict + duplicate alias. */
  const aliasErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    const aliasCounts = new Map<string, number>()
    for (const b of localBindings) {
      aliasCounts.set(b.alias, (aliasCounts.get(b.alias) ?? 0) + 1)
    }
    for (const b of localBindings) {
      const identErr = validateVariableName(b.alias)
      if (identErr) {
        errors[b.profileId] = identErr
        continue
      }
      if (conflictingVarNames.has(b.alias)) {
        errors[b.profileId] = `'${b.alias}' conflicts with an existing variable in scope`
        continue
      }
      // aliasCounts always has b.alias since we just populated it from the same loop input.
      if (aliasCounts.get(b.alias)! > 1) {
        errors[b.profileId] = `Alias '${b.alias}' is used by another bound profile`
      }
    }
    return errors
  }, [localBindings, conflictingVarNames])

  const hasErrors = Object.keys(aliasErrors).length > 0

  // Reset local state and fetch data when modal opens
  useEffect(() => {
    if (isOpen) {
      setLocalBindings(bindings)
      setSearchQuery('')
      setError(null)
      loadData().catch(reportLoadFailure)
    }
  }, [isOpen])

  const reportLoadFailure = () => {
    setError('Failed to load profiles')
  }

  const loadData = async () => {
    setLoading(true)
    try {
      const result = await fetchProfiles({ per_page: 100 })
      setProfiles(result.data)
    } catch {
      reportLoadFailure()
    } finally {
      setLoading(false)
    }
  }

  // Available profiles = all profiles minus already bound
  const availableProfiles = useMemo(() => {
    const boundIds = new Set(localBindings.map((b) => b.profileId))
    let available = profiles.filter((p) => !boundIds.has(p.id))
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      available = available.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.type.toLowerCase().includes(query)
      )
    }
    return available
  }, [profiles, localBindings, searchQuery])

  const handleAdd = useCallback(
    (profile: Profile) => {
      const alias = generateAlias(profile.name)
      // Derive fields from the profile's actual data: union of config keys and
      // all environment_values keys. This works for custom profiles that have no
      // type schema as well as typed profiles whose schema might be incomplete.
      const allKeys = new Set<string>(Object.keys(profile.config))
      for (const envVals of Object.values(profile.environmentValues)) {
        for (const key of Object.keys(envVals)) {
          allKeys.add(key)
        }
      }
      const fields = [...allKeys].map((key) => ({ name: key, type: 'string' as const }))
      setLocalBindings((prev) => [
        ...prev,
        {
          profileId: profile.id,
          profileName: profile.name,
          profileType: profile.type,
          alias,
          fields,
        },
      ])
    },
    []
  )

  const handleRemove = useCallback((profileId: string) => {
    setLocalBindings((prev) => prev.filter((b) => b.profileId !== profileId))
  }, [])

  const handleAliasChange = useCallback(
    (profileId: string, newAlias: string) => {
      setLocalBindings((prev) =>
        prev.map((b) =>
          b.profileId === profileId ? { ...b, alias: newAlias } : b
        )
      )
    },
    []
  )

  const handleDone = useCallback(() => {
    onDone(localBindings)
    onClose()
  }, [localBindings, onDone, onClose])

  useChildEditor(
    isOpen
      ? {
          label: 'Profiles',
          hasChanges: JSON.stringify(localBindings) !== JSON.stringify(bindings),
          cannotBeSaved: hasErrors,
          apply: () => onDone(localBindings),
        }
      : null,
  )

  return (
    <DraggableSheet
      ref={ref}
      open={isOpen}
      onClose={onClose}
      sheetId="profile-binding"
      resizable
      ariaLabel="Profiles"
      data-testid="profile-binding-sheet"
      initialWidth={460}
      minWidth={420}
      minHeight={320}
      className="max-w-[90vw] max-h-[85vh] shadow-xl"
      headerClassName="py-2"
      header={
        <>
          <div className="flex flex-1 items-center gap-2 min-w-0">
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-sm font-semibold truncate">Profiles</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={onClose}
            onPointerDown={(event) => event.stopPropagation()}
            className="h-7 w-7"
          >
            <X className="h-4 w-4" />
          </Button>
        </>
      }
    >
      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-3">
        <p className="text-sm text-muted-foreground">
          Bind profiles to use their fields in expressions as{' '}
          <code className="text-xs bg-muted px-1 rounded">alias.field</code>
        </p>

        {/* Bound Profiles Section */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Bound Profiles
          </h4>
          {localBindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No profiles bound</p>
          ) : (
            <ScrollArea className="max-h-40">
              <div className="space-y-2">
                {localBindings.map((binding) => {
                  const aliasErr = aliasErrors[binding.profileId]
                  return (
                    <div
                      key={binding.profileId}
                      className="space-y-1"
                      data-testid={`bound-profile-${binding.profileId}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm truncate w-28 shrink-0">
                          {binding.profileName}
                        </span>
                        <NameField
                          data-testid={`alias-input-${binding.profileId}`}
                          value={binding.alias}
                          onChange={(value) =>
                            handleAliasChange(binding.profileId, value)
                          }
                          className="h-8 font-mono text-sm bg-muted"
                          placeholder="alias"
                          maxLength={MAX_VARIABLE_NAME_LENGTH}
                          aria-invalid={!!aliasErr}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          onClick={() => handleRemove(binding.profileId)}
                          aria-label={`Remove ${binding.profileName}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {aliasErr && (
                        <p
                          className="text-xs text-destructive pl-[7.5rem] pr-10"
                          role="alert"
                          data-testid={`alias-error-${binding.profileId}`}
                        >
                          {aliasErr}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Add Profile Section */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">
            Add Profile
          </h4>
          <SearchInput
            inputTestId="profile-search"
            className="w-full"
            placeholder="Search profiles…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {(() => {
            if (loading) {
              return (
                <p className="text-sm text-muted-foreground" data-testid="profiles-loading">
                  Loading…
                </p>
              )
            }
            if (error) {
              return (
                <p className="text-sm text-destructive" data-testid="profiles-error">
                  {error}
                </p>
              )
            }
            return (
            <ScrollArea className="max-h-40 bg-muted/30 rounded-md">
              <div className="space-y-1 p-2">
                {availableProfiles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No profiles available
                  </p>
                ) : (
                  availableProfiles.map((profile) => (
                    <div
                      key={profile.id}
                      className="flex items-center justify-between gap-2 py-1"
                      data-testid={`available-profile-${profile.id}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm truncate">{profile.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {profile.type}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => handleAdd(profile)}
                        aria-label={`Add ${profile.name}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
            )
          })()}
        </div>

      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/30 px-3 py-2 rounded-b-lg">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <ConditionalTooltip
          content={hasErrors ? 'Fix alias errors before continuing' : undefined}
          disabled
          wide
        >
          <span className="inline-flex">
            <Button
              onClick={handleDone}
              disabled={hasErrors}
              className={hasErrors ? 'opacity-50 cursor-not-allowed' : undefined}
              data-testid="profile-binding-done"
            >
              Done
            </Button>
          </span>
        </ConditionalTooltip>
      </div>
    </DraggableSheet>
  )
}
