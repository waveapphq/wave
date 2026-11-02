/**
 * Canvas Components - Public API
 *
 * Core canvas components for the visual workflow builder.
 */

// Bars
/* v8 ignore next - COV-V8-004: V8 doesn't properly track barrel re-export coverage */
export { CanvasActionBar } from './canvas-action-bar/index'
/* v8 ignore next - COV-V8-004: V8 doesn't properly track barrel re-export coverage */
export { CanvasBreadcrumbBar } from './chrome/canvas-breadcrumb-bar'
export type { WorkflowStatus } from './canvas-action-bar/index'

/* v8 ignore start - COV-V8-004: V8 doesn't properly track barrel re-export coverage */
// Panels
export { CollapsiblePanel } from './chrome/collapsible-panel'

// Empty State
export { StartNode } from './empty-state/start-node'

// Loading
export { CanvasLoadingOverlay } from './chrome/canvas-loading-overlay'

// Hint Popover
export { InteractionsHintPopover } from './chrome/interactions-hint-bar'
export { HintPopoverToggle } from './chrome/hint-bar-toggle'

// Workflow Canvas
export { WorkflowCanvas } from './workflow-canvas'
export { WorkflowNode } from './workflow-node'
export { StartNodeFlow } from './empty-state/start-node-flow'
export { OnboardingNodeFlow } from './empty-state/onboarding-node-flow'
export type { WorkflowNodeData, WorkflowNodeProps } from './workflow-node'
export type { StartNodeFlowData, StartNodeFlowProps } from './empty-state/start-node-flow'
export type { OnboardingNodeFlowProps } from './empty-state/onboarding-node-flow'

// Dialogs
export { CloseConfirmDialog } from './dialogs/close-confirm-dialog'
export { SwitchTestConfirmDialog } from './dialogs/switch-test-dialog'
export { ValidationErrorDialog } from './dialogs/validation-error-dialog'
export type { CloseConfirmDialogProps } from './dialogs/close-confirm-dialog'
export type { SwitchTestDialogProps } from './dialogs/switch-test-dialog'
export type { ValidationError } from './dialogs/validation-error-dialog'

// Drag Preview
export { DragPreviewPortal } from './chrome/drag-preview'
/* v8 ignore stop */
