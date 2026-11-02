/**
 * Shared version-dropdown trigger + menu used by both the Function instance
 * config modal (mode="pick") and the edit-mode publish dialog (mode="bump").
 *
 *   mode="pick": lists available library versions with publish dates + latest
 *   chip; supports the missing-version visuals (red border / strikethrough /
 *   destructive "Missing" chip).
 *
 *   mode="bump": lists PATCH / MINOR / MAJOR bump targets driven by the
 *   `compute_allowed_bumps` result; blocked levels are disabled with an `(i)`
 *   tooltip; trigger gains a red ring when only MAJOR remains. A Custom field
 *   accepts arbitrary semver (pre-release, build metadata).
 */

import { useState } from 'react'
import { Check, Info } from 'lucide-react'

import { cn } from '@/lib/utils'
import { ConditionalTooltip } from '@/components/ui/tooltip'
import { MAX_VERSION_LENGTH } from '@/lib/field-constraints'
import type { BumpLevel, ComputedBumps } from '@/features/functions/api/types'
import {
  isValidSemver,
  classifyBumpLevel,
  nextAvailableTarget,
  comparePrecedence,
} from '@/features/functions/lib/semver'


export interface PickModeVersionEntry {
  version: string
  published_at?: string
}


export interface VersionDropdownPickProps {
  mode: 'pick'
  selected: string
  available: PickModeVersionEntry[]
  latest: string
  onChange: (version: string) => void
  /** When true, render destructive visuals + omit the missing pinned row. */
  missingVersion?: boolean
  disabled?: boolean
  testId?: string
}


export interface VersionDropdownBumpProps {
  mode: 'bump'
  source: string
  selected: string
  allowedBumps: ComputedBumps
  /** Live set of already-published versions; bump targets skip these and the custom field rejects them. */
  existingVersions: string[]
  /** Latest published version, shown in the menu footer for context. */
  latest: string
  onChange: (version: string) => void
  disabled?: boolean
  testId?: string
}


export type VersionDropdownProps = VersionDropdownPickProps | VersionDropdownBumpProps


const BUMP_CHIP_CLASS: Record<BumpLevel, string> = {
  patch: 'bg-green-500/15 text-green-800 dark:text-green-300 border-green-500/30',
  minor: 'bg-amber-500/20 text-amber-900 dark:text-amber-300 border-amber-500/30',
  major: 'bg-red-500/15 text-red-900 dark:text-red-300 border-red-500/30',
}


function BumpChip({ level }: Readonly<{ level: BumpLevel }>) {
  return (
    <span
      data-testid={`bump-chip-${level}`}
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide',
        BUMP_CHIP_CLASS[level],
      )}
    >
      {level}
    </span>
  )
}


function LatestChip() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide bg-secondary text-muted-foreground border-border">
      latest
    </span>
  )
}


function formatPublishedDate(date?: string): string {
  if (!date) return ''
  const trimmed = date.split('T')[0]
  return trimmed
}


/** Monospace `v{version}` that truncates (long versions never clip the
 *  date / latest chip) and reveals the full value on hover. */
function VersionText({
  version,
  className,
}: Readonly<{ version: string; className?: string }>) {
  const label = `v${version}`
  return (
    <ConditionalTooltip content={label}>
      <span className={cn('font-mono min-w-0 truncate', className)}>{label}</span>
    </ConditionalTooltip>
  )
}


/** Validate a custom semver entry against the allowed bump set. Pure so the
 *  branchy validation is unit-testable and out of the component's body. */
export function validateCustomVersion(
  source: string,
  value: string,
  allowedBumps: ComputedBumps,
  existingVersions: Iterable<string> = [],
  latest = '',
): { error: string | null; valid: boolean } {
  if (!value) return { error: null, valid: false }
  if (value.length > MAX_VERSION_LENGTH) {
    return {
      error: `Version exceeds the maximum length of ${MAX_VERSION_LENGTH} characters`,
      valid: false,
    }
  }
  if (!isValidSemver(value)) return { error: 'Not a valid semver', valid: false }
  if (new Set(existingVersions).has(value)) {
    return { error: `Version ${value} already exists`, valid: false }
  }
  // No backports: a publish must advance past the latest (also blocks a
  // pre-release of an already-released version, e.g. 2.0.0-dev1 when 2.0.0 exists).
  if (latest && comparePrecedence(value, latest) <= 0) {
    return { error: `Must be newer than the latest version ${latest}`, valid: false }
  }
  const level = classifyBumpLevel(source, value)
  if (level === null) {
    return { error: 'Target must be greater than the source version', valid: false }
  }
  if (!allowedBumps.allowed.includes(level)) {
    const blocked = allowedBumps.blocked[level]
    return {
      error: blocked ?? `${level.toUpperCase()} is blocked for this draft`,
      valid: false,
    }
  }
  return { error: null, valid: true }
}


function PickStatusChip({
  missingVersion,
  isLatest,
}: Readonly<{ missingVersion?: boolean; isLatest: boolean }>) {
  if (missingVersion) {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide bg-red-500/15 text-red-800 dark:text-red-300 border-red-500/30"
        aria-label="Missing"
      >
        Missing
      </span>
    )
  }
  if (isLatest) {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide bg-green-500/15 text-green-800 dark:text-green-300 border-green-500/30"
        aria-label="latest"
      >
        latest
      </span>
    )
  }
  return null
}


function renderPickTrigger(pickProps: VersionDropdownPickProps) {
  return (
    <>
      <span className="inline-flex items-center gap-2 min-w-0">
        <VersionText
          version={pickProps.selected}
          className={cn(
            'text-sm',
            pickProps.missingVersion ? 'line-through text-red-700 dark:text-red-300' : '',
          )}
        />
        <PickStatusChip
          missingVersion={pickProps.missingVersion}
          isLatest={pickProps.selected === pickProps.latest}
        />
      </span>
      <span aria-hidden="true">▾</span>
    </>
  )
}

function renderBumpTrigger(bumpProps: VersionDropdownBumpProps) {
  const level = classifyBumpLevel(bumpProps.source, bumpProps.selected)
  return (
    <>
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-sm">{bumpProps.selected}</span>
        {level ? <BumpChip level={level} /> : null}
      </span>
      <span aria-hidden="true">▾</span>
    </>
  )
}

/** Trigger gets a destructive red ring for a missing pinned version (pick) or
 *  when MAJOR is the only allowed bump (bump). */
function isDestructiveTrigger(props: VersionDropdownProps): boolean {
  const onlyMajorAllowed =
    props.mode === 'bump' &&
    props.allowedBumps.allowed.length === 1 &&
    props.allowedBumps.allowed[0] === 'major'
  return (props.mode === 'pick' && props.missingVersion === true) || onlyMajorAllowed
}

export function VersionDropdown(props: Readonly<VersionDropdownProps>) {
  const [open, setOpen] = useState(false)
  const [customValue, setCustomValue] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)
  const [customValid, setCustomValid] = useState(false)

  const destructiveRing = isDestructiveTrigger(props)

  const triggerClass = cn(
    'inline-flex items-center justify-between gap-2 min-w-[200px] px-3 py-1.5 text-sm rounded-md border bg-background',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    destructiveRing
      ? 'border-red-600 ring-2 ring-red-500/10'
      : 'border-input ring-0',
    props.disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
  )

  // The button's `disabled` attribute already blocks the click when disabled,
  // so handleToggle needs no internal disabled guard.
  const handleToggle = () => {
    setOpen((value) => !value)
  }

  // `onChange` is common to both union members; no mode narrowing needed.
  const handlePickSelect = (version: string) => {
    props.onChange(version)
    setOpen(false)
  }

  // Receives the already-narrowed bump props from the bump-mode JSX branch so
  // there is no unreachable mode-guard branch.
  const handleBumpSelect = (bumpProps: VersionDropdownBumpProps, level: BumpLevel) => {
    if (!bumpProps.allowedBumps.allowed.includes(level)) return
    const target = nextAvailableTarget(bumpProps.source, level, bumpProps.existingVersions)
    bumpProps.onChange(target)
    setOpen(false)
  }

  const handleCustomInput = (bumpProps: VersionDropdownBumpProps, value: string) => {
    setCustomValue(value)
    const { error, valid } = validateCustomVersion(
      bumpProps.source,
      value,
      bumpProps.allowedBumps,
      bumpProps.existingVersions,
      bumpProps.latest,
    )
    setCustomError(error)
    setCustomValid(valid)
  }

  // Custom version commits only on the explicit apply (check) button.
  const handleCustomApply = (bumpProps: VersionDropdownBumpProps) => {
    bumpProps.onChange(customValue)
    setOpen(false)
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        data-testid={props.testId ?? 'version-dropdown-trigger'}
        onClick={handleToggle}
        disabled={props.disabled}
        className={triggerClass}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {props.mode === 'bump' ? renderBumpTrigger(props) : renderPickTrigger(props)}
      </button>
      {open ? (
        <VersionDropdownMenu
          props={props}
          customValue={customValue}
          customError={customError}
          customValid={customValid}
          onPickSelect={handlePickSelect}
          onBumpSelect={handleBumpSelect}
          onCustomInput={handleCustomInput}
          onCustomApply={handleCustomApply}
        />
      ) : null}
    </div>
  )
}

interface VersionDropdownMenuProps {
  props: VersionDropdownProps
  customValue: string
  customError: string | null
  customValid: boolean
  onPickSelect: (version: string) => void
  onBumpSelect: (bumpProps: VersionDropdownBumpProps, level: BumpLevel) => void
  onCustomInput: (bumpProps: VersionDropdownBumpProps, value: string) => void
  onCustomApply: (bumpProps: VersionDropdownBumpProps) => void
}

function VersionDropdownMenu({
  props,
  customValue,
  customError,
  customValid,
  onPickSelect,
  onBumpSelect,
  onCustomInput,
  onCustomApply,
}: Readonly<VersionDropdownMenuProps>) {
  return (
    <div
      role="menu"
      data-testid="version-dropdown-menu"
      className={cn(
        'absolute z-50 mt-1 min-w-[260px] rounded-md border border-input bg-popover shadow-lg p-1',
        // pick lives in the config modal's right column - right-align so a long
        // version cannot push the menu past the dialog edge; bump is left-aligned.
        props.mode === 'pick' ? 'right-0' : 'left-0',
      )}
    >
      {props.mode === 'bump' ? (
        <div
          data-testid="version-dropdown-latest"
          className="flex items-center gap-2 border-b border-input mb-1 px-2 py-1.5"
        >
          <LatestChip />
          <span className="font-mono text-xs">{`-> ${props.latest || '-'}`}</span>
        </div>
      ) : null}
      {props.mode === 'pick'
        ? renderPickOptions(props, onPickSelect)
        : (['patch', 'minor', 'major'] as BumpLevel[]).map((level) => (
            <BumpOption
              key={level}
              level={level}
              source={props.source}
              selected={props.selected}
              existing={props.existingVersions}
              isDisabled={!props.allowedBumps.allowed.includes(level)}
              blockedReason={props.allowedBumps.blocked[level]}
              onSelect={(lvl) => onBumpSelect(props, lvl)}
            />
          ))}
      {props.mode === 'bump' ? (
        <CustomVersionInput
          value={customValue}
          error={customError}
          valid={customValid}
          onInput={(value) => onCustomInput(props, value)}
          onApply={() => onCustomApply(props)}
        />
      ) : null}
    </div>
  )
}

interface CustomVersionInputProps {
  value: string
  error: string | null
  valid: boolean
  onInput: (value: string) => void
  onApply: () => void
}

function CustomVersionInput({
  value,
  error,
  valid,
  onInput,
  onApply,
}: Readonly<CustomVersionInputProps>) {
  return (
    <div className="border-t border-input mt-1 pt-2 px-2 pb-1">
      <label
        htmlFor="version-dropdown-custom"
        className="block text-xs text-muted-foreground mb-1"
      >
        Custom version
      </label>
      <div className="flex items-center gap-1">
        <input
          id="version-dropdown-custom"
          type="text"
          data-testid="version-dropdown-custom-input"
          value={value}
          placeholder="1.4.3-beta.1"
          spellCheck={false}
          autoComplete="off"
          maxLength={MAX_VERSION_LENGTH}
          aria-invalid={error !== null}
          onChange={(event) => onInput(event.target.value)}
          className={cn(
            'flex-1 min-w-0 px-2 py-1 rounded border text-sm font-mono bg-background',
            error ? 'border-red-600 ring-2 ring-red-500/10' : 'border-input',
          )}
        />
        <button
          type="button"
          data-testid="version-dropdown-custom-apply"
          aria-label="Apply custom version"
          disabled={!valid}
          onClick={onApply}
          className={cn(
            'shrink-0 inline-flex items-center justify-center rounded border px-2 py-1.5',
            valid
              ? 'border-input hover:bg-accent cursor-pointer'
              : 'border-input opacity-50 cursor-not-allowed',
          )}
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
      {error ? (
        <p
          data-testid="version-dropdown-custom-error"
          className="text-xs text-red-800 dark:text-red-300 mt-1"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}


// Blocked-bump indicator. The (i) is hoverable with its own help cursor
// (not the option's not-allowed cursor) and carries the blocking reason via the
// shared ConditionalTooltip (fast disabled-state timing), replacing the slow,
// cursor-suppressing native `title`.
function BlockedInfoIcon({ reason }: Readonly<{ reason?: string }>) {
  return (
    <ConditionalTooltip content={reason} disabled side="left">
      <span
        data-testid="blocked-info-icon"
        className="inline-flex items-center justify-center text-muted-foreground cursor-help"
      >
        <Info className="h-3.5 w-3.5" />
      </span>
    </ConditionalTooltip>
  )
}


function PickOption({
  entry,
  selected,
  latest,
  onSelect,
}: Readonly<{
  entry: PickModeVersionEntry
  selected: string
  latest: string
  onSelect: (version: string) => void
}>) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={entry.version === selected}
      onClick={() => onSelect(entry.version)}
      className={cn(
        'flex w-full items-center justify-between gap-3 px-2 py-1.5 rounded text-sm hover:bg-accent text-left',
        entry.version === selected ? 'bg-accent' : '',
      )}
    >
      <VersionText version={entry.version} />
      <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <span>{formatPublishedDate(entry.published_at)}</span>
        {entry.version === latest ? (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium uppercase tracking-wide bg-green-500/15 text-green-800 dark:text-green-300 border-green-500/30">
            latest
          </span>
        ) : null}
      </span>
    </button>
  )
}


function renderPickOptions(
  pickProps: VersionDropdownPickProps,
  onSelect: (version: string) => void,
) {
  return pickProps.available
    .filter((entry) => !pickProps.missingVersion || entry.version !== pickProps.selected)
    .map((entry) => (
      <PickOption
        key={entry.version}
        entry={entry}
        selected={pickProps.selected}
        latest={pickProps.latest}
        onSelect={onSelect}
      />
    ))
}


function BumpOption({
  level,
  source,
  selected,
  existing,
  isDisabled,
  blockedReason,
  onSelect,
}: Readonly<{
  level: BumpLevel
  source: string
  selected: string
  existing: Iterable<string>
  isDisabled: boolean
  blockedReason?: string
  onSelect: (level: BumpLevel) => void
}>) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={classifyBumpLevel(source, selected) === level}
      aria-disabled={isDisabled || undefined}
      onClick={() => onSelect(level)}
      className={cn(
        'flex w-full items-center justify-between gap-3 px-2 py-1.5 rounded text-sm text-left',
        isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent cursor-pointer',
      )}
    >
      <span className="inline-flex items-center gap-2">
        <BumpChip level={level} />
        <span className="font-mono text-xs">{`-> ${nextAvailableTarget(source, level, existing)}`}</span>
      </span>
      {isDisabled ? <BlockedInfoIcon reason={blockedReason} /> : null}
    </button>
  )
}
