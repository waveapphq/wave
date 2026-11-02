/** A Function Block's window: the one Block window with the Function lifecycle chrome in its slots (CANVAS-207). */

import { useEffect, useId, useMemo, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NameField } from '@/components/shared/fields/name-field'
import { MAX_BLOCK_NAME_LENGTH } from '@/lib/field-constraints'
import { refocusSheet, useSheetOpener } from '@/components/shared/draggable-sheet'
import { followValue } from '@/lib/draft-follow'
import { useStoredFollow } from '@/hooks/use-stored-follow'
import { useCanvasReadOnly } from '@/features/workbench/common/canvas/read-only-context'
import { ElementConfigModal } from '@/features/workbench/common/element-config'
import {
  ProfileBindingModal,
  type ProfileBinding,
} from '@/features/workbench/common/element-config/dialogs/profile-binding-modal'
import { ChangelogDialog } from '@/features/workbench/common/element-config/dialogs/changelog-dialog'
import { DetailsDialog } from '@/features/workbench/common/element-config/dialogs/details-dialog'
import type {
  BlockWindowChrome,
  BlockWindowName,
  ElementData,
  EnrichedVariable,
  SaveData,
} from '@/features/workbench/common/element-config/types'
import { useFunctionVersions } from '@/features/functions/hooks/use-function-versions'
import type { VersionDescriptor } from '@/features/functions/api/types'
import type { ControlVersion } from '@/features/workbench/docs/_types'
import { useWorkflowStore } from '@/features/workbench/stores/workflow-store'
import { VersionDropdown } from './version-dropdown'
import { FunctionEmptySection } from './function-empty-section'

// The Function Block's Profiles sheet only shows its bindings, so Done has nothing to write.
const NO_BINDINGS_WRITE = () => {}
const NO_VARIABLES: EnrichedVariable[] = []

/** The Function chrome a Function Block's window reads beside the shared Block element. */
export interface FunctionBlockChromeData {
  kind: 'function'
  lifecycle: 'local' | 'shared'
  /** Shared only: the library Function the Block follows. */
  functionId?: string
  /** Shared only: the library entry's name at drop time, kept through renames of the Block. */
  originalLibraryName?: string
  /** Shared only: the pinned version. */
  selectedVersion?: string
  /** Shared only: the Block holds a draft. */
  editMode: boolean
  /** The version the draft was taken from. */
  sourceVersion?: string
  /** The pinned version is gone from the library. */
  missingVersion: boolean
}

/** A Function Block's element always carries its stored profile bindings, for the Profiles count. */
export type FunctionBlockElement = ElementData & FunctionBlockChromeData & { profileBindings: ProfileBinding[] }

/** Shared instances carry a per-instance version pin; Local ones never do. */
function sharedSelectedVersion(element: FunctionBlockElement): string | undefined {
  return element.lifecycle === 'shared' ? element.selectedVersion : undefined
}

/** The library entry a shared instance came from; a Local one links to none. */
function sharedLibraryName(element: FunctionBlockElement): string | undefined {
  return element.lifecycle === 'shared' ? element.originalLibraryName : undefined
}

/** The fetched versions in the Changelog / Details shape; the dialog joins the changelog lines back as Markdown. */
function toControlVersions(fetchedVersions: VersionDescriptor[]): ControlVersion[] {
  return fetchedVersions.map((v) => ({
    version: v.version,
    releaseDate: v.published_at,
    changelog: v.changelog ? v.changelog.split('\n') : [],
    details: v.details ?? '',
  }))
}

/** The version a shared instance with no pick yet follows (the latest published), else null. */
function resolveAutoSelectVersion(
  isShared: boolean,
  selectedVersion: string | undefined,
  fetchedVersions: VersionDescriptor[],
  latestVersion: string,
): string | null {
  if (!isShared) return null
  if (selectedVersion && selectedVersion.length > 0) return null
  if (fetchedVersions.length === 0) return null
  return latestVersion || fetchedVersions[0].version
}

/** The library entry whose versions this instance tracks; a local instance tracks none. */
function libraryFunctionId(element: FunctionBlockElement): string {
  return element.lifecycle === 'shared' && element.functionId ? element.functionId : ''
}

function computeVersionFlags(args: {
  isShared: boolean
  isEditMode: boolean
  hasFunctionId: boolean
  isLoadingVersions: boolean
  versionsFailed: boolean
  versionCount: number
  missingVersion: boolean
  readOnly: boolean
}): {
  isMissingFunction: boolean
  isMissingVersion: boolean
  showLibraryActions: boolean
  renderVersionDropdown: boolean
  pickDisabled: boolean
  pickMissingVersion: boolean
} {
  // The library entry is gone: the read answered an empty list (a stale pin is a different case).
  const isMissingFunction =
    args.isShared &&
    args.hasFunctionId &&
    !args.isLoadingVersions &&
    !args.versionsFailed &&
    args.versionCount === 0
  const isMissingVersion = args.isShared && args.missingVersion && !isMissingFunction
  const showLibraryActions = args.isShared && !args.isEditMode && !isMissingFunction
  // A shared instance shows its version list when there are versions or the Function is gone.
  const renderVersionDropdown =
    args.isShared && (args.versionCount > 0 || isMissingFunction)
  // No pick while a draft owns the body, the entry is gone or the window is read-only.
  const pickDisabled = args.isEditMode || isMissingFunction || args.readOnly
  const pickMissingVersion = isMissingVersion || isMissingFunction
  return {
    isMissingFunction,
    isMissingVersion,
    showLibraryActions,
    renderVersionDropdown,
    pickDisabled,
    pickMissingVersion,
  }
}

function MissingBanner({
  isMissingFunction,
  isMissingVersion,
  originalLibraryName,
  selectedVersion,
}: Readonly<{
  isMissingFunction: boolean
  isMissingVersion: boolean
  originalLibraryName?: string
  selectedVersion?: string
}>) {
  if (isMissingFunction) {
    return (
      <div
        role="alert"
        data-testid="missing-function-banner"
        className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          Function {originalLibraryName ? `'${originalLibraryName}' ` : ''}
          is no longer available in the library. Replace this instance
          or recreate the library entry.
        </span>
      </div>
    )
  }
  if (isMissingVersion) {
    return (
      <div
        role="alert"
        data-testid="missing-version-banner"
        className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>
          Version v{selectedVersion} is not available in the library.
          Pick an available version from the dropdown.
        </span>
      </div>
    )
  }
  return null
}

function FromLibraryLink({
  name,
  onOpen,
}: Readonly<{ name: string; onOpen: (seed: string) => void }>) {
  return (
    // No hover hint: a focused trigger's hint would take the Escape that closes the window.
    <button
      type="button"
      data-testid="function-from-library-link"
      onClick={() => onOpen(name)}
      className="text-xs text-indigo-600 dark:text-indigo-300 hover:underline focus-visible:underline focus-visible:outline-none truncate max-w-full text-left"
    >
      From library: <span className="font-medium">{name}</span>
    </button>
  )
}

/** The Name field, its message the moment it is blank (FIELDERR-3), and a shared instance's library link. */
function FunctionNameField({
  name,
  onChange,
  readOnly,
  libraryName,
  onOpenLibrary,
}: Readonly<{
  name: string
  onChange: (name: string) => void
  readOnly: boolean
  libraryName?: string
  onOpenLibrary: (seed: string) => void
}>) {
  const nameId = useId()
  const errorId = useId()
  const showError = name.trim().length === 0
  return (
    <div className="space-y-2 min-w-0">
      <label htmlFor={nameId} className="block text-sm font-medium">
        Name
      </label>
      <NameField
        id={nameId}
        name="function-name"
        data-testid="function-name-input"
        aria-label="Function name"
        value={name}
        onChange={onChange}
        aria-invalid={showError}
        aria-describedby={showError ? errorId : undefined}
        maxLength={MAX_BLOCK_NAME_LENGTH}
        placeholder="Function name"
        disabled={readOnly}
      />
      {showError ? (
        <p
          id={errorId}
          role="alert"
          data-testid="function-name-error"
          className="text-xs text-destructive"
        >
          Name is required
        </p>
      ) : null}
      {libraryName && !readOnly ? (
        <FromLibraryLink name={libraryName} onOpen={onOpenLibrary} />
      ) : null}
    </div>
  )
}

/** The version list of a Shared Function Block: the library's versions, the pin, its missing state. */
interface FunctionVersionList {
  selected: string
  available: Array<{ version: string; published_at: string }>
  latest: string
  onChange: (version: string) => void
  disabled: boolean
  missingVersion: boolean
}

/** The Name and, for a Shared Function Block, its own version list in place of the Block's. */
function FunctionNameRow({
  name,
  libraryName,
  onOpenLibrary,
  versionList,
}: Readonly<{
  name: BlockWindowName
  libraryName?: string
  onOpenLibrary: (seed: string) => void
  versionList: FunctionVersionList | null
}>) {
  const readOnly = useCanvasReadOnly()
  return (
    <div className={versionList ? 'grid grid-cols-[1fr_auto] gap-3 items-start' : 'grid grid-cols-1'}>
      <FunctionNameField
        name={name.value}
        onChange={name.onChange}
        readOnly={readOnly}
        libraryName={libraryName}
        onOpenLibrary={onOpenLibrary}
      />
      {versionList ? (
        <div className="space-y-2">
          <span className="block text-sm font-medium">Version</span>
          <VersionDropdown mode="pick" {...versionList} />
        </div>
      ) : null}
    </div>
  )
}

function FooterProfilesButton({
  boundCount,
  onProfiles,
}: Readonly<{ boundCount: number; onProfiles: () => void }>) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onProfiles}
      aria-label="Profiles"
      className="text-blue-600 border-blue-300 hover:bg-blue-50"
    >
      Profiles
      {boundCount > 0 ? (
        <span
          data-testid="profiles-count-badge"
          aria-hidden="true"
          className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white"
        >
          {boundCount}
        </span>
      ) : null}
    </Button>
  )
}

/** What the library footer actions show: the versions and the picked one. */
interface LibraryActions {
  /** The name the dialogs carry in their title. */
  name: string
  versions: ControlVersion[]
  selectedVersion: string
  selected?: VersionDescriptor
}

/** The footer actions of a Function Block: Changelog and Details for a library Function, then Profiles. */
function FunctionConfigFooter({
  library,
  profileBindings,
}: Readonly<{ library: LibraryActions | null; profileBindings: ProfileBinding[] }>) {
  const readOnly = useCanvasReadOnly()
  const profilesSheet = useSheetOpener()
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  return (
    <>
      {/* Edit mode hides Changelog / Details while a draft is unpublished; the lifecycle kebab carries them. */}
      {library ? (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setChangelogOpen(true)}
            disabled={library.versions.length === 0}
            data-testid="function-changelog-button"
          >
            Changelog
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDetailsOpen(true)} data-testid="function-details-button">
            Details
          </Button>
        </>
      ) : null}
      {/* Profiles opens a sheet over the canvas - hidden in read-only mode. */}
      {readOnly ? null : <FooterProfilesButton boundCount={profileBindings.length} onProfiles={profilesSheet.show} />}
      <ProfileBindingModal
        ref={profilesSheet.ref}
        isOpen={profilesSheet.open}
        onClose={profilesSheet.hide}
        bindings={profileBindings}
        availableVariables={NO_VARIABLES}
        onDone={NO_BINDINGS_WRITE}
      />
      {library && library.versions.length > 0 ? (
        <ChangelogDialog
          isOpen={changelogOpen}
          onClose={() => setChangelogOpen(false)}
          elementName={library.name}
          versions={library.versions}
          initialVersion={library.selectedVersion || library.versions[0].version}
        />
      ) : null}
      {library ? (
        <DetailsDialog
          isOpen={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          elementName={library.name}
          version={library.selectedVersion}
          description={library.selected?.description}
          details={library.selected?.details}
        />
      ) : null}
    </>
  )
}

/** The pin a Save writes beside the shared Block fields: the version, its missing state and its contract. */
function functionSaveStamps(
  isShared: boolean,
  selectedVersion: string | undefined,
  selectedVersionMissing: boolean,
  selected: VersionDescriptor | undefined,
): Partial<SaveData> {
  if (!isShared) return { functionVersion: selectedVersion }
  const contract = selected ? { resolvedInputs: selected.inputs ?? [], resolvedOutputs: selected.outputs ?? [] } : {}
  return { functionVersion: selectedVersion, missingVersion: selectedVersionMissing, ...contract }
}

interface FunctionBlockWindowProps {
  element: FunctionBlockElement
  onClose: () => void
  onSave: (data: SaveData) => void
  /** Cascade offset from the centered position (28px per open-order slot). */
  initialOffset?: { x: number; y: number }
}

/** A Function Block in the one Block window, its lifecycle chrome in the window's slots (CANVAS-207). */
export function FunctionBlockWindow({ element, onClose, onSave, initialOffset }: Readonly<FunctionBlockWindowProps>) {
  const readOnly = useCanvasReadOnly()
  const isShared = element.lifecycle === 'shared'
  const isEditMode = isShared && element.editMode
  const openedVersion = sharedSelectedVersion(element)
  const [selectedVersion, setSelectedVersion] = useState(openedVersion)
  // The pin changed on the canvas under the open window: an untouched pick follows it.
  useStoredFollow({ selectedVersion: openedVersion }, (base, next) => {
    setSelectedVersion((draft) => followValue(base.selectedVersion, draft, next.selectedVersion))
  })
  const setFunctionLibraryOpen = useWorkflowStore((s) => s.setFunctionLibraryOpen)

  // One read of the library versions feeds the version list and the dialogs; it blocks while loading.
  const {
    versions: fetchedVersions,
    latest: latestVersion,
    isLoading: isLoadingVersions,
    failed: versionsFailed,
  } = useFunctionVersions(libraryFunctionId(element), null, true)

  // A Block with no pinned version yet follows the latest published one once it is known.
  useEffect(() => {
    const next = resolveAutoSelectVersion(isShared, selectedVersion, fetchedVersions, latestVersion)
    if (next) setSelectedVersion(next)
  }, [isShared, selectedVersion, fetchedVersions, latestVersion])

  // The missing state follows the pick against the live library list, not the load-time stamp.
  const selectedVersionMissing =
    isShared &&
    fetchedVersions.length > 0 &&
    !!selectedVersion &&
    !fetchedVersions.some((v) => v.version === selectedVersion)
  const flags = computeVersionFlags({
    isShared,
    isEditMode,
    hasFunctionId: !!element.functionId,
    isLoadingVersions,
    versionsFailed,
    versionCount: fetchedVersions.length,
    missingVersion: selectedVersionMissing,
    readOnly,
  })
  const versionDocs = useMemo(() => toControlVersions(fetchedVersions), [fetchedVersions])
  const selected = fetchedVersions.find((v) => v.version === selectedVersion)

  // Sheets are non-blocking: the library opens beside this window, seeded with the library name.
  const openLibrary = (seed: string) => {
    setFunctionLibraryOpen(true, seed)
    refocusSheet('functions-library')
  }

  const versionList: FunctionVersionList | null = flags.renderVersionDropdown
    ? {
        selected: selectedVersion ?? '',
        available: fetchedVersions.map((v) => ({ version: v.version, published_at: v.published_at })),
        latest: latestVersion ?? fetchedVersions[0]?.version ?? '',
        onChange: setSelectedVersion,
        disabled: flags.pickDisabled,
        missingVersion: flags.pickMissingVersion,
      }
    : null
  const library: LibraryActions | null = flags.showLibraryActions
    ? {
        name: element.originalLibraryName ?? element.name,
        versions: versionDocs,
        selectedVersion: selectedVersion ?? '',
        selected,
      }
    : null

  const chrome: BlockWindowChrome = {
    typeLabel: 'Function',
    descriptionPlaceholder: 'Optional. Per-instance description for this Function.',
    banner: (
      <MissingBanner
        isMissingFunction={flags.isMissingFunction}
        isMissingVersion={flags.isMissingVersion}
        originalLibraryName={element.originalLibraryName}
        selectedVersion={element.selectedVersion}
      />
    ),
    renderNameRow: (name) => (
      <FunctionNameRow
        name={name}
        libraryName={sharedLibraryName(element)}
        onOpenLibrary={openLibrary}
        versionList={versionList}
      />
    ),
    footerActions: (
      <FunctionConfigFooter library={library} profileBindings={element.profileBindings} />
    ),
    emptyInputs: <FunctionEmptySection kind="inputs" />,
    emptyOutputs: <FunctionEmptySection kind="outputs" />,
    // Edit mode and a missing version offer Save with nothing changed; validity still holds it.
    gate: {
      changed: isShared && selectedVersion !== openedVersion,
      savesUnchanged: isEditMode || flags.isMissingVersion,
    },
  }

  const handleSave = (data: SaveData) =>
    onSave({ ...data, ...functionSaveStamps(isShared, selectedVersion, selectedVersionMissing, selected) })

  return (
    <ElementConfigModal
      isOpen
      onClose={onClose}
      element={element}
      onSave={handleSave}
      initialOffset={initialOffset}
      chrome={chrome}
    />
  )
}
