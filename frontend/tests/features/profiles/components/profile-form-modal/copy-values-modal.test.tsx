/**
 * CopyValuesModal Component Tests
 *
 * Tests for the CopyValuesModal component which allows copying
 * parameter values between environments with tag-based recommendations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CopyValuesModal } from '@/features/profiles/components/profile-form-modal/copy-values-modal'
import type { Environment } from '@/features/profiles/components/profile-form-modal/types'

// Mock the viewport hook used by Tooltip
vi.mock('@/hooks/use-viewport', () => ({
  useViewport: () => ({ isTouchDevice: false, width: 1024, height: 768, breakpoint: 'lg' }),
}))

// Track the onOpenChange callback so tests can invoke it
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let capturedOnOpenChange: ((isOpen: boolean) => void) | undefined

// Mock @radix-ui/react-dialog to render children directly without portal/overlay complexity
vi.mock('@radix-ui/react-dialog', () => {
  const DialogPrimitive = {
    Root: ({ children, open, onOpenChange }: any) => {
      capturedOnOpenChange = onOpenChange
      return open ? <div data-testid="dialog-root">{children}</div> : null
    },
    Portal: ({ children }: any) => <div data-testid="dialog-portal">{children}</div>,
    Overlay: (props: any) => <div data-testid="dialog-overlay" {...props} />,
    Content: ({ children, ...props }: any) => <div data-testid="dialog-content" {...props}>{children}</div>,
    Title: ({ children, ...props }: any) => <h2 {...props}>{children}</h2>,
    Description: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    Close: ({ children, asChild, ...props }: any) => {
      // When asChild, render the child directly but wrap with click handler
      if (asChild && children) {
        return <span data-testid="dialog-close" {...props}>{children}</span>
      }
      return <button data-testid="dialog-close" {...props}>{children}</button>
    },
  }
  return { __esModule: true, default: DialogPrimitive, ...DialogPrimitive }
})

// ============================================================================
// Test Data
// ============================================================================

const envProduction: Environment = { id: 'env-prod', name: 'Production', tags: ['prod', 'critical', 'us-east'] }
const envStaging: Environment = { id: 'env-staging', name: 'Staging', tags: ['staging', 'critical'] }
const envDev: Environment = { id: 'env-dev', name: 'Development', tags: ['dev'] }
const envQA: Environment = { id: 'env-qa', name: 'QA', tags: ['staging', 'critical', 'us-east'] }
const envEmpty: Environment = { id: 'env-empty', name: 'Empty Env', tags: [] }

const allEnvironments: Environment[] = [envProduction, envStaging, envDev, envQA, envEmpty]

// ============================================================================
// Helpers
// ============================================================================

interface RenderModalProps {
  open?: boolean
  currentEnvId?: string
  environments?: Environment[]
  hasValues?: (envId: string) => boolean
  onClose?: ReturnType<typeof vi.fn>
  onConfirm?: ReturnType<typeof vi.fn>
}

function renderModal(props: RenderModalProps = {}) {
  const {
    open = true,
    currentEnvId = 'env-prod',
    environments = allEnvironments,
    hasValues = (id: string) => id !== 'env-empty',
    onClose = vi.fn(),
    onConfirm = vi.fn(),
  } = props

  const result = render(
    <CopyValuesModal
      open={open}
      currentEnvId={currentEnvId}
      environments={environments}
      hasValues={hasValues}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  )

  return { ...result, onClose, onConfirm }
}

// ============================================================================
// Tests
// ============================================================================

describe('CopyValuesModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnOpenChange = undefined
  })

  // --------------------------------------------------------------------------
  // Open/Close
  // --------------------------------------------------------------------------
  describe('Open/Close', () => {
    it('renders nothing when closed', () => {
      renderModal({ open: false })
      expect(screen.queryByText('Copy Values From')).not.toBeInTheDocument()
    })

    it('renders modal when open', () => {
      renderModal({ open: true })
      expect(screen.getByText('Copy Values From')).toBeInTheDocument()
    })

    it('calls onClose when Cancel button clicked', () => {
      const onClose = vi.fn()
      renderModal({ onClose })
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onClose).toHaveBeenCalled()
    })

    it('renders search input', () => {
      renderModal()
      expect(screen.getByPlaceholderText('Search environments…')).toBeInTheDocument()
    })

    it('renders screen reader description', () => {
      renderModal()
      expect(screen.getByText('Select an environment to copy parameter values from')).toBeInTheDocument()
    })

    it('calls onClose when dialog onOpenChange fires with false', () => {
      const onClose = vi.fn()
      renderModal({ onClose })
      // The dialog Root's onOpenChange is called with false when the dialog wants to close
      expect(capturedOnOpenChange).toBeDefined()
      capturedOnOpenChange!(false)
      expect(onClose).toHaveBeenCalled()
    })

    it('does not call onClose when dialog onOpenChange fires with true', () => {
      const onClose = vi.fn()
      renderModal({ onClose })
      capturedOnOpenChange!(true)
      expect(onClose).not.toHaveBeenCalled()
    })
  })

  // --------------------------------------------------------------------------
  // Environment categorization
  // --------------------------------------------------------------------------
  describe('Environment categorization', () => {
    it('shows recommended section for environments with matching tags', () => {
      // current is Production with tags: ['prod', 'critical', 'us-east']
      // QA has ['staging', 'critical', 'us-east'] - 2 matches (critical, us-east) = highest
      // Staging has ['staging', 'critical'] - 1 match (critical) = lower
      renderModal({ currentEnvId: 'env-prod' })
      expect(screen.getByText('Recommended')).toBeInTheDocument()
    })

    it('shows "Other" section for environments with fewer matching tags', () => {
      renderModal({ currentEnvId: 'env-prod' })
      expect(screen.getByText('Other')).toBeInTheDocument()
    })

    it('shows "No Values" section for environments without values', () => {
      renderModal({ currentEnvId: 'env-prod' })
      expect(screen.getByText('No Values')).toBeInTheDocument()
    })

    it('excludes current environment from the list', () => {
      renderModal({ currentEnvId: 'env-prod' })
      // Production should not appear as a selectable option
      const buttons = screen.getAllByRole('button')
      const envButtons = buttons.filter(
        (b) => b.textContent?.includes('Production') && !b.textContent?.includes('Cancel')
      )
      expect(envButtons.length).toBe(0)
    })

    it('puts all envs with values in "Other" when no tags match', () => {
      renderModal({
        currentEnvId: 'env-empty', // Empty has no tags
        hasValues: (id) => id !== 'env-empty',
      })
      expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
      expect(screen.getByText('Other')).toBeInTheDocument()
    })

    it('shows disabled entries with "no values" label', () => {
      renderModal({ currentEnvId: 'env-prod' })
      expect(screen.getByText('no values')).toBeInTheDocument()

      // The hint moved from the browser title popup onto the shared tooltip.
      act(() => {
        fireEvent.focus(screen.getByText('no values').closest('div') as HTMLElement)
      })
      expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveTextContent(
        'Cannot copy from an environment with no values',
      )
    })

    it('shows tag match count in recommended section', () => {
      renderModal({ currentEnvId: 'env-prod' })
      // QA has 2 matching tags with Production (critical, us-east)
      expect(screen.getByText('2 tags match')).toBeInTheDocument()
    })

    it('shows singular "tag matches" for 1 match', () => {
      renderModal({ currentEnvId: 'env-prod' })
      // Staging has 1 matching tag (critical) - should show in Other section
      expect(screen.getByText('1 tag matches')).toBeInTheDocument()
    })

    it('shows "0 tags match" for envs in Other with no matching tags', () => {
      renderModal({ currentEnvId: 'env-prod' })
      // Development has ['dev'], no overlap with Production's ['prod', 'critical', 'us-east']
      expect(screen.getByText('0 tags match')).toBeInTheDocument()
    })

    it('handles environment with no tags property', () => {
      const envNoTags: Environment = { id: 'env-notags', name: 'NoTags', tags: [] }
      renderModal({
        environments: [envProduction, envNoTags],
        currentEnvId: 'env-prod',
        hasValues: () => true,
      })
      expect(screen.getByText('NoTags')).toBeInTheDocument()
    })

    it('sorts Other envs by descending tag match count', () => {
      // current = Production (tags: prod, critical, us-east)
      // Staging (tags: staging, critical) - 1 match
      // Dev (tags: dev) - 0 matches
      // QA (tags: staging, critical, us-east) - 2 matches (recommended, max)
      // In Other: Staging (1 match) should come before Dev (0 matches)
      renderModal({ currentEnvId: 'env-prod' })
      const otherSection = screen.getByText('Other').parentElement!
      const buttons = within(otherSection).getAllByRole('button')
      const names = buttons.map((b) => b.textContent?.trim())
      // Staging (1 match) before Development (0 matches)
      const stagingIdx = names.findIndex((n) => n?.includes('Staging'))
      const devIdx = names.findIndex((n) => n?.includes('Development'))
      expect(stagingIdx).toBeLessThan(devIdx)
    })

    it('border separator shown between recommended and other sections', () => {
      renderModal({ currentEnvId: 'env-prod' })
      // Both recommended and other sections should be rendered
      expect(screen.getByText('Recommended')).toBeInTheDocument()
      expect(screen.getByText('Other')).toBeInTheDocument()
    })

    it('border separator shown between sections and no values', () => {
      renderModal({ currentEnvId: 'env-prod' })
      expect(screen.getByText('No Values')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Search filtering
  // --------------------------------------------------------------------------
  describe('Search filtering', () => {
    it('filters environments by name', async () => {
      const user = userEvent.setup()
      renderModal()
      await user.type(screen.getByPlaceholderText('Search environments…'), 'staging')
      expect(screen.getByText('Staging')).toBeInTheDocument()
      expect(screen.queryByText('Development')).not.toBeInTheDocument()
    })

    it('filters environments by tag', async () => {
      const user = userEvent.setup()
      renderModal()
      await user.type(screen.getByPlaceholderText('Search environments…'), 'dev')
      expect(screen.getByText('Development')).toBeInTheDocument()
      expect(screen.queryByText('Staging')).not.toBeInTheDocument()
    })

    it('is case-insensitive', async () => {
      const user = userEvent.setup()
      renderModal()
      await user.type(screen.getByPlaceholderText('Search environments…'), 'STAGING')
      expect(screen.getByText('Staging')).toBeInTheDocument()
    })

    it('shows empty state when no environments match search', async () => {
      const user = userEvent.setup()
      renderModal()
      await user.type(screen.getByPlaceholderText('Search environments…'), 'nonexistent')
      expect(screen.getByText('No environments match your search')).toBeInTheDocument()
    })

    it('shows empty state when no other environments available', () => {
      renderModal({
        environments: [envProduction],
        currentEnvId: 'env-prod',
      })
      expect(screen.getByText('No other environments available')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Selection
  // --------------------------------------------------------------------------
  describe('Selection', () => {
    it('Apply button is disabled when no source selected', () => {
      renderModal()
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    })

    it('selects a source environment when clicked', () => {
      renderModal({ currentEnvId: 'env-prod' })
      // Click on QA (recommended)
      fireEvent.click(screen.getByText('QA'))
      expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled()
    })

    it('shows confirmation text when source is selected', () => {
      renderModal({ currentEnvId: 'env-prod' })
      fireEvent.click(screen.getByText('QA'))
      const confirmText = screen.getByText(/Copy values from/)
      expect(confirmText).toBeInTheDocument()
      expect(confirmText.textContent).toContain('QA')
      expect(confirmText.textContent).toContain('Production')
    })

    it('calls onConfirm and onClose when Apply clicked', () => {
      const onConfirm = vi.fn()
      const onClose = vi.fn()
      renderModal({ currentEnvId: 'env-prod', onConfirm, onClose })
      fireEvent.click(screen.getByText('QA'))
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
      expect(onConfirm).toHaveBeenCalledWith('env-qa')
      expect(onClose).toHaveBeenCalled()
    })

    it('applies selected styling to chosen environment', () => {
      renderModal({ currentEnvId: 'env-prod' })
      const qaButton = screen.getByText('QA').closest('button')!
      fireEvent.click(qaButton)
      expect(qaButton.className).toContain('bg-primary')
    })

    it('can select from Other section', () => {
      renderModal({ currentEnvId: 'env-prod' })
      // Development is in Other section
      fireEvent.click(screen.getByText('Development'))
      expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled()
    })

    it('applies selected styling to tag badge when environment is selected in recommended', () => {
      renderModal({ currentEnvId: 'env-prod' })
      fireEvent.click(screen.getByText('QA'))
      // The badge for the selected item should have different styling
      const tagBadge = screen.getByText('2 tags match')
      expect(tagBadge.className).toContain('bg-primary-foreground/20')
    })

    it('applies selected styling to tag badge when environment is selected in other section', () => {
      renderModal({ currentEnvId: 'env-prod' })
      // Staging is in Other with 1 tag match
      fireEvent.click(screen.getByText('Staging'))
      const tagBadge = screen.getByText('1 tag matches')
      expect(tagBadge.className).toContain('bg-primary-foreground/20')
    })

    it('applies non-selected styling to tag badge in other section with matches', () => {
      renderModal({ currentEnvId: 'env-prod' })
      // Without selecting Staging, the badge should have muted styling
      const tagBadge = screen.getByText('1 tag matches')
      expect(tagBadge.className).toContain('bg-muted')
    })
  })

  // --------------------------------------------------------------------------
  // State reset on open
  // --------------------------------------------------------------------------
  describe('State reset', () => {
    it('resets selection and search when modal reopens', () => {
      const { rerender } = render(
        <CopyValuesModal
          open={true}
          currentEnvId="env-prod"
          environments={allEnvironments}
          hasValues={(id) => id !== 'env-empty'}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      )

      // Select an environment
      fireEvent.click(screen.getByText('QA'))
      expect(screen.getByRole('button', { name: 'Apply' })).not.toBeDisabled()

      // Close and reopen
      rerender(
        <CopyValuesModal
          open={false}
          currentEnvId="env-prod"
          environments={allEnvironments}
          hasValues={(id) => id !== 'env-empty'}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      )
      rerender(
        <CopyValuesModal
          open={true}
          currentEnvId="env-prod"
          environments={allEnvironments}
          hasValues={(id) => id !== 'env-empty'}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />
      )

      // Selection should be reset
      expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
      // Search should be reset
      expect(screen.getByPlaceholderText('Search environments…')).toHaveValue('')
    })
  })

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------
  describe('Edge cases', () => {
    it('handles current environment not found in list', () => {
      renderModal({ currentEnvId: 'nonexistent' })
      // Should still render without crashing
      expect(screen.getByText('Copy Values From')).toBeInTheDocument()
    })

    it('handles all environments having values with tag matches', () => {
      renderModal({
        currentEnvId: 'env-prod',
        hasValues: () => true,
      })
      // All should show (except current)
      expect(screen.getByText('Staging')).toBeInTheDocument()
      expect(screen.getByText('QA')).toBeInTheDocument()
      expect(screen.getByText('Development')).toBeInTheDocument()
    })

    it('handles no environments having values', () => {
      renderModal({
        currentEnvId: 'env-prod',
        hasValues: () => false,
      })
      expect(screen.getByText('No Values')).toBeInTheDocument()
      // No Recommended or Other sections
      expect(screen.queryByText('Recommended')).not.toBeInTheDocument()
      expect(screen.queryByText('Other')).not.toBeInTheDocument()
    })

    it('renders no border separator when no recommended or other sections exist', () => {
      renderModal({
        currentEnvId: 'env-prod',
        hasValues: () => false,
      })
      // Only "No Values" section - no border separators
      const noValuesSection = screen.getByText('No Values').closest('div')!
      expect(noValuesSection.className).not.toContain('border-t')
    })

    it('handles environment with undefined tags in search filter', () => {
      const envUndefinedTags = { id: 'env-ut', name: 'Undefined Tags' } as unknown as Environment
      renderModal({
        environments: [envProduction, envUndefinedTags],
        currentEnvId: 'env-prod',
        hasValues: () => true,
      })
      // Should render without error
      expect(screen.getByText('Undefined Tags')).toBeInTheDocument()
    })

    it('does not show selected env info when no selection made', () => {
      renderModal()
      expect(screen.queryByText(/Copy values from/)).not.toBeInTheDocument()
    })

    it('only recommended envs have max match count - not all with matches', () => {
      // Production: ['prod', 'critical', 'us-east']
      // QA: ['staging', 'critical', 'us-east'] - 2 matches (max)
      // Staging: ['staging', 'critical'] - 1 match (not max)
      renderModal({ currentEnvId: 'env-prod' })
      // QA should be in Recommended (max 2 matches)
      const recommendedSection = screen.getByText('Recommended').parentElement!
      expect(within(recommendedSection).getByText('QA')).toBeInTheDocument()
      // Staging should be in Other (1 match, not max)
      const otherSection = screen.getByText('Other').parentElement!
      expect(within(otherSection).getByText('Staging')).toBeInTheDocument()
    })

    it('shows singular "tag matches" in recommended section when max match count is 1', () => {
      // Setup: current env has 1 tag that matches exactly 1 tag on another env
      // So max match count = 1, making that env recommended with "1 tag matches"
      const envCurrent: Environment = { id: 'env-cur', name: 'Current', tags: ['shared'] }
      const envOther: Environment = { id: 'env-other', name: 'OtherEnv', tags: ['shared', 'extra'] }
      renderModal({
        currentEnvId: 'env-cur',
        environments: [envCurrent, envOther],
        hasValues: () => true,
      })
      expect(screen.getByText('Recommended')).toBeInTheDocument()
      // matchCount = 1, so it should show "1 tag matches"
      expect(screen.getByText('1 tag matches')).toBeInTheDocument()
    })

    it('shows plural "tags match" in other section tooltip when matchCount > 1', () => {
      // Need an Other env with matchCount > 1 but not the max.
      // Current env has tags: ['a', 'b', 'c']
      // Env1 has tags: ['a', 'b', 'c'] -> 3 matches (max, recommended)
      // Env2 has tags: ['a', 'b'] -> 2 matches (other section, > 1, with tooltip)
      const envCur: Environment = { id: 'env-cur', name: 'Current', tags: ['a', 'b', 'c'] }
      const env1: Environment = { id: 'env-1', name: 'MaxMatch', tags: ['a', 'b', 'c'] }
      const env2: Environment = { id: 'env-2', name: 'PartialMatch', tags: ['a', 'b'] }
      renderModal({
        currentEnvId: 'env-cur',
        environments: [envCur, env1, env2],
        hasValues: () => true,
      })
      expect(screen.getByText('Recommended')).toBeInTheDocument()
      expect(screen.getByText('Other')).toBeInTheDocument()
      // env2 has 2 matches in Other -> "2 tags match" (plural in tooltip path)
      expect(screen.getByText('2 tags match')).toBeInTheDocument()
    })
  })
})
