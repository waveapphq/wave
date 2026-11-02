/**
 * Shared Canvas State Hook
 *
 * Provides localStorage-persisted state management for canvas pages
 * including environment selection, debug options, and recent environments.
 */

import { useState, useCallback, useEffect } from 'react'

// Storage keys
export const STORAGE_KEYS = {
  SELECTED_ENV: 'wave_selected_environment',
  REMEMBER_SELECTION: 'wave_remember_env_selection',
  DEBUG_OPTIONS: 'wave_debug_options',
  RECENT_ENVS: 'wave_recent_environments',
}

// Max recent environments to track
const MAX_RECENT_ENVS = 3

// Shared noop function - avoids creating new functions on each render
/* v8 ignore next 3 - COV-BRANCH-156 */
export function noop(): void {
  // intentionally empty - placeholder for unimplemented handlers
}

// State initializers (extracted to avoid V8 function tracking issues with inline arrow functions)
function initRememberSelection(): boolean {
  const stored = localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION)
  return stored === 'true'
}

function initSelectedEnvironment(): string | null {
  const remember = localStorage.getItem(STORAGE_KEYS.REMEMBER_SELECTION) === 'true'
  if (remember) {
    return localStorage.getItem(STORAGE_KEYS.SELECTED_ENV)
  }
  return null
}

function initRecentEnvironments(): { id: string; name: string }[] {
  const stored = localStorage.getItem(STORAGE_KEYS.RECENT_ENVS)
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch {
      return []
    }
  }
  return []
}

function initDebugOptions(): { pauseOnFirstBlock: boolean; pauseOnErrors: boolean } {
  const stored = localStorage.getItem(STORAGE_KEYS.DEBUG_OPTIONS)
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Record<string, unknown>
      return {
        pauseOnFirstBlock: !!(parsed.pauseOnFirstBlock ?? parsed.pauseOnFirst),
        pauseOnErrors: !!parsed.pauseOnErrors,
      }
    } catch {
      return { pauseOnFirstBlock: false, pauseOnErrors: false }
    }
  }
  return { pauseOnFirstBlock: false, pauseOnErrors: false }
}

// Shared hook for canvas page state with localStorage persistence
export function useCanvasState(
  availableEnvironments: { id: string; name: string }[],
  // Only a successful read is an answer: an empty list from a FAILED read must
  // never reach the pruning below, which would wipe the stored recents.
  environmentsLoaded: boolean = true
) {
  // Initialize from localStorage using named functions
  const [rememberSelection, setRememberSelection] = useState(initRememberSelection)
  const [selectedEnvironment, setSelectedEnvironment] = useState(initSelectedEnvironment)
  const [recentEnvironments, setRecentEnvironments] = useState(initRecentEnvironments)
  const [debugOptions, setDebugOptions] = useState(initDebugOptions)

  // Validate recents against available environments when environments change
  // This removes deleted environments from the recents list
  useEffect(
    function validateRecentsAgainstAvailable() {
      // Wait until environments have finished loading before validating
      // This distinguishes "not loaded yet" from "loaded but empty"
      if (!environmentsLoaded) return

      setRecentEnvironments(function filterValidRecents(prev) {
        // If no environments exist, clear all recents
        if (availableEnvironments.length === 0) {
          /* v8 ignore next 3 - COV-DEF-067: Clear recents when all envs deleted */
          if (prev.length > 0) {
            localStorage.setItem(STORAGE_KEYS.RECENT_ENVS, JSON.stringify([]))
          }
          return []
        }

        /* v8 ignore next - COV-V8-FUNC-003 */
        const availableIds = new Set(availableEnvironments.map(function getId(e) { return e.id }))
        const validRecents = prev.filter(function isValid(recent) {
          return availableIds.has(recent.id)
        })

        // If any were removed, update localStorage
        /* v8 ignore next 3 - COV-DEF-068: Update localStorage when recents pruned */
        if (validRecents.length !== prev.length) {
          localStorage.setItem(STORAGE_KEYS.RECENT_ENVS, JSON.stringify(validRecents))
        }

        return validRecents
      })

      // Also validate selected environment
      if (selectedEnvironment) {
        /* v8 ignore next 3 - COV-V8-FUNC-003 */
        const stillExists = availableEnvironments.some(function checkExists(e) {
          return e.id === selectedEnvironment
        })
        /* v8 ignore next 4 - COV-DEF-066: Defensive cleanup when env is deleted */
        if (!stillExists) {
          setSelectedEnvironment(null)
          localStorage.removeItem(STORAGE_KEYS.SELECTED_ENV)
        }
      }
    },
    [availableEnvironments, selectedEnvironment, environmentsLoaded]
  )

  // Wrapper to persist environment selection and track recents
  /* v8 ignore next 2 - COV-V8-FUNC-003 */
  const handleSelectEnvironment = useCallback(
    function handleSetSelectedEnvironment(env: string | null) {
      setSelectedEnvironment(env)
      if (rememberSelection && env) {
        localStorage.setItem(STORAGE_KEYS.SELECTED_ENV, env)
      } else if (!rememberSelection) {
        localStorage.removeItem(STORAGE_KEYS.SELECTED_ENV)
      }

      // Track recent environments (last 3 used)
      if (env) {
        const envId = env
        const envData = availableEnvironments.find(function findEnv(e) {
          return e.id === envId
        })
        if (envData) {
          setRecentEnvironments(function updateRecentEnvs(
            prev: { id: string; name: string }[]
          ) {
            // Remove if already in list, add to front
            const filtered = prev.filter(function excludeEnv(e) {
              return e.id !== envId
            })
            const updated = [envData, ...filtered].slice(0, MAX_RECENT_ENVS)
            localStorage.setItem(STORAGE_KEYS.RECENT_ENVS, JSON.stringify(updated))
            return updated
          })
        }
      }
    },
    [rememberSelection, availableEnvironments]
  )

  // Wrapper to persist remember selection preference
  const handleRememberSelection = useCallback(
    function handleSetRememberSelection(remember: boolean) {
      setRememberSelection(remember)
      localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, String(remember))
      if (remember && selectedEnvironment) {
        localStorage.setItem(STORAGE_KEYS.SELECTED_ENV, selectedEnvironment)
      } else if (!remember) {
        localStorage.removeItem(STORAGE_KEYS.SELECTED_ENV)
      }
    },
    [selectedEnvironment]
  )

  // Wrapper to persist debug options
  const handleSetDebugOptions = useCallback(function handleSetDebugOptions(options: {
    pauseOnFirstBlock: boolean
    pauseOnErrors: boolean
  }) {
    setDebugOptions(options)
    localStorage.setItem(STORAGE_KEYS.DEBUG_OPTIONS, JSON.stringify(options))
  }, [])

  return {
    selectedEnvironment,
    setSelectedEnvironment: handleSelectEnvironment,
    recentEnvironments,
    rememberSelection,
    setRememberSelection: handleRememberSelection,
    debugOptions,
    setDebugOptions: handleSetDebugOptions,
  }
}
