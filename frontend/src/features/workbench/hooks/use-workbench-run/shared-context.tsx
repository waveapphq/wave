/**
 * WorkbenchRunSharedContext - shares a single useWorkbenchRun instance.
 *
 * The live workbench renders both the page container (which needs full
 * useWorkbenchRun state to drive run/stop/debug controls) and a breadcrumb
 * bar (which needs executionId + parentExecutionId + sessionTestName to
 * compose the breadcrumb path). Without this context, each component
 * would call `useWorkbenchRun()` separately, spawning two independent
 * session-recovery fetches and parallel WebSocket subscriptions for the
 * same session on every mount.
 *
 * The container wraps the rendered subtree in `<WorkbenchRunSharedContext.Provider>`
 * with its own `useWorkbenchRun()` return value. Children that call
 * `useWorkbenchRun()` again pick up the shared instance from context and
 * skip their own recovery / subscription effects.
 */

import { createContext } from 'react'
import type { UseWorkbenchRunReturn } from './types'

export const WorkbenchRunSharedContext = createContext<UseWorkbenchRunReturn | null>(null)
