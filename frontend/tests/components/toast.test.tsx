/**
 * Toast Component Tests
 *
 * REQ-5.2.1.6: Reusable UI component library
 * REQ-5.2.1.7: Modern design system with consistent styling
 *
 * Tests for Toast component following design system specifications.
 *
 * Toast specifications:
 * - Width: 360px max (max-w-[360px])
 * - Padding: 16px (p-4)
 * - Border Radius: 8px (rounded-lg)
 * - Gap (icon to content): 12px (gap-3)
 * - Position: Bottom-right, 16px from edges (bottom-4 right-4)
 * - Stack Gap: 8px between toasts (gap-2)
 * - Shadow: shadow-lg
 *
 * Variants:
 * - Success: CheckCircle icon, --color-success-text border
 * - Error: AlertCircle icon, --color-error-text border
 * - Warning: AlertTriangle icon, --color-warning-text border
 * - Info: Info icon, --color-info-text border
 *
 * Auto-dismiss: 5s default (configurable), pause on hover
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Toast,
  ToastProvider,
  ToastContainer,
  useToast,
} from '@/components/ui/toast'

// Helper component to access toast hook
function ToastTrigger({ variant = 'info' as const, ...props }) {
  const { toast } = useToast()
  return (
    <button
      onClick={() => toast({ variant, message: 'Test message', ...props })}
      data-testid="trigger"
    >
      Show Toast
    </button>
  )
}

describe('Toast Component', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    // Only run pending timers if fake timers are active
    // Wrap in act() to handle state updates from timer callbacks
    try {
      await act(async () => {
        vi.runOnlyPendingTimers()
      })
    } catch {
      // Timers not mocked (test used vi.useRealTimers())
    }
    vi.useRealTimers()
  })

  describe('Basic Rendering', () => {
    it('renders toast with message', () => {
      render(
        <Toast
          id="test-1"
          message="Operation successful"
          variant="success"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByText('Operation successful')).toBeInTheDocument()
    })

    it('renders with role="status" for non-critical notifications', () => {
      render(
        <Toast
          id="test-1"
          message="Info message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('renders with role="alert" for error notifications', () => {
      render(
        <Toast
          id="test-1"
          message="Error message"
          variant="error"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('applies base toast class', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('toast')
    })
  })

  describe('Variants', () => {
    it('applies success variant styles', () => {
      render(
        <Toast
          id="test-1"
          message="Success"
          variant="success"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('toast-success')
    })

    it('applies error variant styles', () => {
      render(
        <Toast
          id="test-1"
          message="Error"
          variant="error"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('toast-error')
    })

    it('applies warning variant styles', () => {
      render(
        <Toast
          id="test-1"
          message="Warning"
          variant="warning"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('toast-warning')
    })

    it('applies info variant styles', () => {
      render(
        <Toast
          id="test-1"
          message="Info"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('toast-info')
    })
  })

  describe('Icons', () => {
    it('renders CheckCircle icon for success variant', () => {
      render(
        <Toast
          id="test-1"
          message="Success"
          variant="success"
          onDismiss={() => {}}
        />
      )
      expect(document.querySelector('[data-toast-icon="success"]')).toBeInTheDocument()
    })

    it('renders AlertCircle icon for error variant', () => {
      render(
        <Toast
          id="test-1"
          message="Error"
          variant="error"
          onDismiss={() => {}}
        />
      )
      expect(document.querySelector('[data-toast-icon="error"]')).toBeInTheDocument()
    })

    it('renders AlertTriangle icon for warning variant', () => {
      render(
        <Toast
          id="test-1"
          message="Warning"
          variant="warning"
          onDismiss={() => {}}
        />
      )
      expect(document.querySelector('[data-toast-icon="warning"]')).toBeInTheDocument()
    })

    it('renders Info icon for info variant', () => {
      render(
        <Toast
          id="test-1"
          message="Info"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(document.querySelector('[data-toast-icon="info"]')).toBeInTheDocument()
    })

    it('applies gap-3 (12px) between icon and content', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('gap-3')
    })

    it('renders icon at 18px size (icon-md per design system)', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      const iconWrapper = document.querySelector('[data-toast-icon="info"]')
      expect(iconWrapper).toBeInTheDocument()
      const svg = iconWrapper?.querySelector('svg')
      expect(svg).toHaveAttribute('width', '18')
      expect(svg).toHaveAttribute('height', '18')
    })
  })

  describe('Design System Compliance', () => {
    it('applies rounded-lg border radius', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('rounded-lg')
    })

    it('applies p-4 padding (16px)', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('p-4')
    })

    it('applies shadow via CSS (per design system)', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      // Shadow is applied via CSS .toast class, not Tailwind
      expect(screen.getByTestId('toast')).toHaveClass('toast')
    })

    it('applies flex layout', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('flex')
    })

    it('aligns items at start', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('items-start')
    })

    it('applies maximum width of 400px (per design system)', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('max-w-[400px]')
    })
  })

  describe('Title and Description', () => {
    it('renders title when provided', () => {
      render(
        <Toast
          id="test-1"
          title="Toast Title"
          message="Message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByText('Toast Title')).toBeInTheDocument()
    })

    it('applies font-semibold to title', () => {
      render(
        <Toast
          id="test-1"
          title="Toast Title"
          message="Message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByText('Toast Title')).toHaveClass('font-semibold')
    })

    it('renders message as description', () => {
      render(
        <Toast
          id="test-1"
          message="Detailed message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByText('Detailed message')).toBeInTheDocument()
    })

    it('applies text-sm to message', () => {
      render(
        <Toast
          id="test-1"
          title="Title"
          message="Message text"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByText('Message text')).toHaveClass('text-sm')
    })

    it('applies font-medium to message when no title (per design system)', () => {
      render(
        <Toast
          id="test-1"
          message="Primary message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByText('Primary message')).toHaveClass('font-medium')
    })

    it('does not apply font-medium to description when title exists', () => {
      render(
        <Toast
          id="test-1"
          title="Title"
          message="Description text"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByText('Description text')).not.toHaveClass('font-medium')
    })
  })

  describe('Dismiss Button', () => {
    it('renders dismiss button', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument()
    })

    it('calls onDismiss when dismiss button clicked', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
      const handleDismiss = vi.fn()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={handleDismiss}
        />
      )

      await user.click(screen.getByRole('button', { name: /dismiss/i }))
      expect(handleDismiss).toHaveBeenCalledWith('test-1')
    })

    it('has accessible label', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Dismiss notification')
    })
  })

  describe('Auto-dismiss', () => {
    it('auto-dismisses after default duration (5000ms)', () => {
      const handleDismiss = vi.fn()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={handleDismiss}
        />
      )

      expect(handleDismiss).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(5000)
      })

      expect(handleDismiss).toHaveBeenCalledWith('test-1')
    })

    it('auto-dismisses after custom duration', () => {
      const handleDismiss = vi.fn()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={handleDismiss}
          duration={3000}
        />
      )

      act(() => {
        vi.advanceTimersByTime(2999)
      })
      expect(handleDismiss).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(handleDismiss).toHaveBeenCalledWith('test-1')
    })

    it('does not auto-dismiss when duration is 0 (persistent)', () => {
      const handleDismiss = vi.fn()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={handleDismiss}
          duration={0}
        />
      )

      act(() => {
        vi.advanceTimersByTime(10000)
      })

      expect(handleDismiss).not.toHaveBeenCalled()
    })

    it('pauses timer on mouse enter', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
      const handleDismiss = vi.fn()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={handleDismiss}
          data-testid="toast"
        />
      )

      const toast = screen.getByTestId('toast')
      await user.hover(toast)

      // Timer should be paused, verify with attribute or state
      expect(toast).toHaveAttribute('data-paused', 'true')
    })

    it('resumes timer on mouse leave', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
      const handleDismiss = vi.fn()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={handleDismiss}
          data-testid="toast"
        />
      )

      const toast = screen.getByTestId('toast')
      await user.hover(toast)
      await user.unhover(toast)

      expect(toast).toHaveAttribute('data-paused', 'false')
    })
  })

  describe('Action Button', () => {
    it('renders action button when action is provided', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          action={{ label: 'Undo', onClick: () => {} }}
        />
      )
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    })

    it('calls action onClick when action button clicked', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
      const handleAction = vi.fn()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          action={{ label: 'Undo', onClick: handleAction }}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Undo' }))
      expect(handleAction).toHaveBeenCalledTimes(1)
    })

    it('dismisses toast after action click by default', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
      const handleDismiss = vi.fn()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={handleDismiss}
          action={{ label: 'Undo', onClick: () => {} }}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Undo' }))
      expect(handleDismiss).toHaveBeenCalledWith('test-1')
    })

    it('does not dismiss after action click when dismissOnAction is false', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()
      const handleDismiss = vi.fn()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={handleDismiss}
          action={{ label: 'Undo', onClick: () => {}, dismissOnAction: false }}
        />
      )

      await user.click(screen.getByRole('button', { name: 'Undo' }))
      expect(handleDismiss).not.toHaveBeenCalled()
    })
  })

  describe('Animation', () => {
    it('applies enter animation class', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('toast-enter')
    })

    it('applies duration-300 for toast transitions', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('duration-300')
    })

    it('applies ease-out timing function', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('ease-out')
    })

    it('respects reduced-motion preference', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('motion-reduce:transition-none')
    })
  })

  describe('Exit Animation', () => {
    it('applies toast-exit class when exiting', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )

      const toast = screen.getByTestId('toast')
      const dismissButton = screen.getByRole('button', { name: /dismiss/i })

      // Trigger dismiss - the toast should get exit animation class before removal
      await user.click(dismissButton)

      // Toast should have exit animation class applied
      expect(toast).toHaveClass('toast-exit')
    })

    it('applies ease-in for exit animation (per design system)', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )

      const toast = screen.getByTestId('toast')
      await user.click(screen.getByRole('button', { name: /dismiss/i }))

      expect(toast).toHaveClass('exit-ease-in')
    })

    it('applies duration-200 for exit animation (per design system)', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )

      const toast = screen.getByTestId('toast')
      await user.click(screen.getByRole('button', { name: /dismiss/i }))

      expect(toast).toHaveClass('exit-duration-200')
    })

    it('sets data-exiting attribute during exit animation', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )

      const toast = screen.getByTestId('toast')
      await user.click(screen.getByRole('button', { name: /dismiss/i }))

      expect(toast).toHaveAttribute('data-exiting', 'true')
    })
  })
})

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    // Only run pending timers if fake timers are active
    // Wrap in act() to handle state updates from timer callbacks
    try {
      await act(async () => {
        vi.runOnlyPendingTimers()
      })
    } catch {
      // Timers not mocked (test used vi.useRealTimers())
    }
    vi.useRealTimers()
  })

  it('provides toast context to children', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
        <ToastContainer />
      </ToastProvider>
    )
    expect(screen.getByTestId('trigger')).toBeInTheDocument()
  })

  it('throws error when useToast is used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<ToastTrigger />)
    }).toThrow('useToast must be used within a ToastProvider')

    consoleError.mockRestore()
  })
})

describe('ToastContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    // Only run pending timers if fake timers are active
    // Wrap in act() to handle state updates from timer callbacks
    try {
      await act(async () => {
        vi.runOnlyPendingTimers()
      })
    } catch {
      // Timers not mocked (test used vi.useRealTimers())
    }
    vi.useRealTimers()
  })

  it('renders toast container', () => {
    render(
      <ToastProvider>
        <ToastContainer data-testid="container" />
      </ToastProvider>
    )
    expect(screen.getByTestId('container')).toBeInTheDocument()
  })

  it('positions container at bottom-right by default (per design system)', () => {
    render(
      <ToastProvider>
        <ToastContainer data-testid="container" />
      </ToastProvider>
    )
    const container = screen.getByTestId('container')
    expect(container).toHaveClass('bottom-4')
    expect(container).toHaveClass('right-4')
  })

  it('supports top-right position', () => {
    render(
      <ToastProvider>
        <ToastContainer position="top-right" data-testid="container" />
      </ToastProvider>
    )
    const container = screen.getByTestId('container')
    expect(container).toHaveClass('top-4')
    expect(container).toHaveClass('right-4')
  })

  it('supports top-left position', () => {
    render(
      <ToastProvider>
        <ToastContainer position="top-left" data-testid="container" />
      </ToastProvider>
    )
    const container = screen.getByTestId('container')
    expect(container).toHaveClass('top-4')
    expect(container).toHaveClass('left-4')
  })

  it('supports bottom-left position', () => {
    render(
      <ToastProvider>
        <ToastContainer position="bottom-left" data-testid="container" />
      </ToastProvider>
    )
    const container = screen.getByTestId('container')
    expect(container).toHaveClass('bottom-4')
    expect(container).toHaveClass('left-4')
  })

  it('applies fixed positioning', () => {
    render(
      <ToastProvider>
        <ToastContainer data-testid="container" />
      </ToastProvider>
    )
    expect(screen.getByTestId('container')).toHaveClass('fixed')
  })

  it('applies z-index 9999 for proper stacking above dialogs', () => {
    render(
      <ToastProvider>
        <ToastContainer data-testid="container" />
      </ToastProvider>
    )
    expect(screen.getByTestId('container')).toHaveStyle({ zIndex: 9999 })
  })

  it('applies gap-2 (8px) between stacked toasts', () => {
    render(
      <ToastProvider>
        <ToastContainer data-testid="container" />
      </ToastProvider>
    )
    expect(screen.getByTestId('container')).toHaveClass('gap-2')
  })

  it('applies flex-col layout', () => {
    render(
      <ToastProvider>
        <ToastContainer data-testid="container" />
      </ToastProvider>
    )
    expect(screen.getByTestId('container')).toHaveClass('flex-col')
  })
})

describe('useToast Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    // Only run pending timers if fake timers are active
    // Wrap in act() to handle state updates from timer callbacks
    try {
      await act(async () => {
        vi.runOnlyPendingTimers()
      })
    } catch {
      // Timers not mocked (test used vi.useRealTimers())
    }
    vi.useRealTimers()
  })

  it('toast function shows toast notification', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    render(
      <ToastProvider>
        <ToastTrigger message="Hello World" />
        <ToastContainer />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('trigger'))

    await waitFor(() => {
      expect(screen.getByText('Hello World')).toBeInTheDocument()
    })
  })

  it('success helper shows success toast', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    function SuccessTrigger() {
      const { success } = useToast()
      return (
        <button onClick={() => success('Success!')} data-testid="trigger">
          Trigger
        </button>
      )
    }

    render(
      <ToastProvider>
        <SuccessTrigger />
        <ToastContainer />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('trigger'))

    await waitFor(() => {
      expect(screen.getByText('Success!')).toBeInTheDocument()
      expect(document.querySelector('.toast-success')).toBeInTheDocument()
    })
  })

  it('error helper shows error toast', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    function ErrorTrigger() {
      const { error } = useToast()
      return (
        <button onClick={() => error('Error!')} data-testid="trigger">
          Trigger
        </button>
      )
    }

    render(
      <ToastProvider>
        <ErrorTrigger />
        <ToastContainer />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('trigger'))

    await waitFor(() => {
      expect(screen.getByText('Error!')).toBeInTheDocument()
      expect(document.querySelector('.toast-error')).toBeInTheDocument()
    })
  })

  it('warning helper shows warning toast', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    function WarningTrigger() {
      const { warning } = useToast()
      return (
        <button onClick={() => warning('Warning!')} data-testid="trigger">
          Trigger
        </button>
      )
    }

    render(
      <ToastProvider>
        <WarningTrigger />
        <ToastContainer />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('trigger'))

    await waitFor(() => {
      expect(screen.getByText('Warning!')).toBeInTheDocument()
      expect(document.querySelector('.toast-warning')).toBeInTheDocument()
    })
  })

  it('info helper shows info toast', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    function InfoTrigger() {
      const { info } = useToast()
      return (
        <button onClick={() => info('Info!')} data-testid="trigger">
          Trigger
        </button>
      )
    }

    render(
      <ToastProvider>
        <InfoTrigger />
        <ToastContainer />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('trigger'))

    await waitFor(() => {
      expect(screen.getByText('Info!')).toBeInTheDocument()
      expect(document.querySelector('.toast-info')).toBeInTheDocument()
    })
  })

  it('dismiss function removes specific toast', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    function DismissTrigger() {
      const { toast, dismiss } = useToast()
      return (
        <>
          <button
            onClick={() => toast({ id: 'toast-1', message: 'Toast 1', variant: 'info' })}
            data-testid="show"
          >
            Show
          </button>
          <button onClick={() => dismiss('toast-1')} data-testid="dismiss">
            Dismiss
          </button>
        </>
      )
    }

    render(
      <ToastProvider>
        <DismissTrigger />
        <ToastContainer />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('show'))
    await waitFor(() => {
      expect(screen.getByText('Toast 1')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('dismiss'))
    await waitFor(() => {
      expect(screen.queryByText('Toast 1')).not.toBeInTheDocument()
    })
  })

  it('dismissAll function removes all toasts', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    function DismissAllTrigger() {
      const { toast, dismissAll } = useToast()
      return (
        <>
          <button
            onClick={() => {
              toast({ id: 'toast-1', message: 'Toast 1', variant: 'info' })
              toast({ id: 'toast-2', message: 'Toast 2', variant: 'success' })
            }}
            data-testid="show"
          >
            Show
          </button>
          <button onClick={() => dismissAll()} data-testid="dismiss-all">
            Dismiss All
          </button>
        </>
      )
    }

    render(
      <ToastProvider>
        <DismissAllTrigger />
        <ToastContainer />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('show'))
    await waitFor(() => {
      expect(screen.getByText('Toast 1')).toBeInTheDocument()
      expect(screen.getByText('Toast 2')).toBeInTheDocument()
    })

    await user.click(screen.getByTestId('dismiss-all'))
    await waitFor(() => {
      expect(screen.queryByText('Toast 1')).not.toBeInTheDocument()
      expect(screen.queryByText('Toast 2')).not.toBeInTheDocument()
    })
  })
})

describe('Multiple Toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    // Only run pending timers if fake timers are active
    // Wrap in act() to handle state updates from timer callbacks
    try {
      await act(async () => {
        vi.runOnlyPendingTimers()
      })
    } catch {
      // Timers not mocked (test used vi.useRealTimers())
    }
    vi.useRealTimers()
  })

  it('renders multiple toasts in stack', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    function MultiToastTrigger() {
      const { toast } = useToast()
      return (
        <button
          onClick={() => {
            toast({ id: '1', message: 'First', variant: 'info' })
            toast({ id: '2', message: 'Second', variant: 'success' })
            toast({ id: '3', message: 'Third', variant: 'warning' })
          }}
          data-testid="trigger"
        >
          Show Toasts
        </button>
      )
    }

    render(
      <ToastProvider>
        <MultiToastTrigger />
        <ToastContainer />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('trigger'))

    await waitFor(() => {
      expect(screen.getByText('First')).toBeInTheDocument()
      expect(screen.getByText('Second')).toBeInTheDocument()
      expect(screen.getByText('Third')).toBeInTheDocument()
    })
  })

  it('renders toasts in chronological order (oldest first in DOM, newest at bottom)', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    function SequentialToastTrigger() {
      const { toast } = useToast()
      return (
        <button
          onClick={() => {
            toast({ id: 'toast-oldest', message: 'Oldest toast', variant: 'info' })
            toast({ id: 'toast-middle', message: 'Middle toast', variant: 'success' })
            toast({ id: 'toast-newest', message: 'Newest toast', variant: 'warning' })
          }}
          data-testid="trigger"
        >
          Show Toasts
        </button>
      )
    }

    render(
      <ToastProvider>
        <SequentialToastTrigger />
        <ToastContainer data-testid="container" />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('trigger'))

    await waitFor(() => {
      const container = screen.getByTestId('container')
      const toasts = container.querySelectorAll('.toast')

      expect(toasts).toHaveLength(3)

      // Per design: "newer toasts appearing below existing ones"
      // "Stack grows upward from the bottom, ensuring the newest toast
      // remains closest to typical cursor position"
      // DOM order: oldest first, newest last (bottom of stack visually)
      expect(toasts[0]).toHaveTextContent('Oldest toast')
      expect(toasts[1]).toHaveTextContent('Middle toast')
      expect(toasts[2]).toHaveTextContent('Newest toast')
    })
  })

  it('limits maximum visible toasts', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()

    function ManyToastsTrigger() {
      const { toast } = useToast()
      return (
        <button
          onClick={() => {
            for (let i = 1; i <= 10; i++) {
              toast({ id: `toast-${i}`, message: `Toast ${i}`, variant: 'info' })
            }
          }}
          data-testid="trigger"
        >
          Show Many
        </button>
      )
    }

    render(
      <ToastProvider maxToasts={5}>
        <ManyToastsTrigger />
        <ToastContainer />
      </ToastProvider>
    )

    await user.click(screen.getByTestId('trigger'))

    await waitFor(() => {
      const toasts = document.querySelectorAll('.toast')
      expect(toasts.length).toBeLessThanOrEqual(5)
    })
  })
})

describe('Accessibility', () => {
  it('has aria-live="polite" for info toasts', () => {
    render(
      <Toast
        id="test-1"
        message="Info"
        variant="info"
        onDismiss={() => {}}
      />
    )
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('has aria-live="assertive" for error toasts', () => {
    render(
      <Toast
        id="test-1"
        message="Error"
        variant="error"
        onDismiss={() => {}}
      />
    )
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive')
  })

  it('dismiss button is focusable', () => {
    render(
      <Toast
        id="test-1"
        message="Message"
        variant="info"
        onDismiss={() => {}}
      />
    )
    const dismissButton = screen.getByRole('button', { name: /dismiss/i })
    expect(dismissButton).not.toHaveAttribute('tabindex', '-1')
  })

  it('action button is focusable', () => {
    render(
      <Toast
        id="test-1"
        message="Message"
        variant="info"
        onDismiss={() => {}}
        action={{ label: 'Undo', onClick: () => {} }}
      />
    )
    const actionButton = screen.getByRole('button', { name: 'Undo' })
    expect(actionButton).not.toHaveAttribute('tabindex', '-1')
  })
})

describe('Toast Duration Zero', () => {
  it('does not start timer when duration is 0', () => {
    vi.useFakeTimers()
    const handleDismiss = vi.fn()

    render(
      <Toast
        id="test-1"
        message="Persistent toast"
        variant="info"
        duration={0}
        onDismiss={handleDismiss}
      />
    )

    // Advance time significantly
    act(() => {
      vi.advanceTimersByTime(30000)
    })

    // Toast should NOT be dismissed
    expect(handleDismiss).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('ignores hover when duration is 0', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const handleDismiss = vi.fn()

    render(
      <Toast
        id="test-1"
        message="Persistent toast"
        variant="info"
        duration={0}
        onDismiss={handleDismiss}
        data-testid="toast"
      />
    )

    const toast = screen.getByTestId('toast')

    // Hover and unhover should not cause errors
    await user.hover(toast)
    await user.unhover(toast)

    // Should not have been dismissed
    expect(handleDismiss).not.toHaveBeenCalled()
    // Should not have paused state since duration=0 ignores hover
    expect(toast).toHaveAttribute('data-paused', 'false')
  })
})

/**
 * REQ-5.2.1.19: Additional tests for complete coverage
 */
describe('REQ-5.2.1.19 Complete Coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    // Wrap in act() to handle state updates from timer callbacks
    try {
      await act(async () => {
        vi.runOnlyPendingTimers()
      })
    } catch {
      // Timers not mocked
    }
    vi.useRealTimers()
  })

  describe('Container Class', () => {
    it('applies toast-container class to container', () => {
      render(
        <ToastProvider>
          <ToastContainer data-testid="container" />
        </ToastProvider>
      )
      expect(screen.getByTestId('container')).toHaveClass('toast-container')
    })
  })

  describe('Helper Methods with Title', () => {
    it('success helper shows toast with title', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      function SuccessWithTitleTrigger() {
        const { success } = useToast()
        return (
          <button onClick={() => success('Operation completed', 'Success!')} data-testid="trigger">
            Trigger
          </button>
        )
      }

      render(
        <ToastProvider>
          <SuccessWithTitleTrigger />
          <ToastContainer />
        </ToastProvider>
      )

      await user.click(screen.getByTestId('trigger'))

      await waitFor(() => {
        expect(screen.getByText('Success!')).toBeInTheDocument()
        expect(screen.getByText('Operation completed')).toBeInTheDocument()
      })
    })

    it('error helper shows toast with title', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      function ErrorWithTitleTrigger() {
        const { error } = useToast()
        return (
          <button onClick={() => error('Something went wrong', 'Error!')} data-testid="trigger">
            Trigger
          </button>
        )
      }

      render(
        <ToastProvider>
          <ErrorWithTitleTrigger />
          <ToastContainer />
        </ToastProvider>
      )

      await user.click(screen.getByTestId('trigger'))

      await waitFor(() => {
        expect(screen.getByText('Error!')).toBeInTheDocument()
        expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      })
    })

    it('warning helper shows toast with title', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      function WarningWithTitleTrigger() {
        const { warning } = useToast()
        return (
          <button onClick={() => warning('Please review', 'Warning!')} data-testid="trigger">
            Trigger
          </button>
        )
      }

      render(
        <ToastProvider>
          <WarningWithTitleTrigger />
          <ToastContainer />
        </ToastProvider>
      )

      await user.click(screen.getByTestId('trigger'))

      await waitFor(() => {
        expect(screen.getByText('Warning!')).toBeInTheDocument()
        expect(screen.getByText('Please review')).toBeInTheDocument()
      })
    })

    it('info helper shows toast with title', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      function InfoWithTitleTrigger() {
        const { info } = useToast()
        return (
          <button onClick={() => info('Good to know', 'Info!')} data-testid="trigger">
            Trigger
          </button>
        )
      }

      render(
        <ToastProvider>
          <InfoWithTitleTrigger />
          <ToastContainer />
        </ToastProvider>
      )

      await user.click(screen.getByTestId('trigger'))

      await waitFor(() => {
        expect(screen.getByText('Info!')).toBeInTheDocument()
        expect(screen.getByText('Good to know')).toBeInTheDocument()
      })
    })
  })

  describe('Custom ID Support', () => {
    it('uses provided custom ID for toast', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      function CustomIdTrigger() {
        const { toast, dismiss } = useToast()
        return (
          <>
            <button
              onClick={() => toast({ id: 'my-custom-id', message: 'Custom toast', variant: 'info' })}
              data-testid="show"
            >
              Show
            </button>
            <button onClick={() => dismiss('my-custom-id')} data-testid="dismiss">
              Dismiss
            </button>
          </>
        )
      }

      render(
        <ToastProvider>
          <CustomIdTrigger />
          <ToastContainer />
        </ToastProvider>
      )

      await user.click(screen.getByTestId('show'))
      await waitFor(() => {
        expect(screen.getByText('Custom toast')).toBeInTheDocument()
      })

      // Dismiss using custom ID should work
      await user.click(screen.getByTestId('dismiss'))
      await waitFor(() => {
        expect(screen.queryByText('Custom toast')).not.toBeInTheDocument()
      })
    })

    it('generates unique ID when not provided', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      function AutoIdTrigger() {
        const { toast } = useToast()
        return (
          <button
            onClick={() => {
              toast({ message: 'First', variant: 'info' })
              toast({ message: 'Second', variant: 'info' })
            }}
            data-testid="trigger"
          >
            Show
          </button>
        )
      }

      render(
        <ToastProvider>
          <AutoIdTrigger />
          <ToastContainer />
        </ToastProvider>
      )

      await user.click(screen.getByTestId('trigger'))

      await waitFor(() => {
        expect(screen.getByText('First')).toBeInTheDocument()
        expect(screen.getByText('Second')).toBeInTheDocument()
      })
    })
  })

  describe('Variant ARIA Properties', () => {
    it('success toast has aria-live="polite"', () => {
      render(
        <Toast
          id="test-1"
          message="Success"
          variant="success"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    })

    it('warning toast has aria-live="polite"', () => {
      render(
        <Toast
          id="test-1"
          message="Warning"
          variant="warning"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    })
  })

  describe('Description Styling', () => {
    it('applies text-muted to description when title exists', () => {
      render(
        <Toast
          id="test-1"
          title="Title"
          message="Description text"
          variant="info"
          onDismiss={() => {}}
        />
      )
      expect(screen.getByText('Description text')).toHaveClass('text-muted')
    })
  })

  describe('Border Styling', () => {
    it('applies border class to toast', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      expect(screen.getByTestId('toast')).toHaveClass('border')
    })
  })

  describe('Duration Configuration', () => {
    it('supports custom duration through toast function', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      function CustomDurationTrigger() {
        const { toast } = useToast()
        return (
          <button
            onClick={() => toast({ message: 'Quick toast', variant: 'info', duration: 1000 })}
            data-testid="trigger"
          >
            Show
          </button>
        )
      }

      render(
        <ToastProvider>
          <CustomDurationTrigger />
          <ToastContainer />
        </ToastProvider>
      )

      await user.click(screen.getByTestId('trigger'))

      await waitFor(() => {
        expect(screen.getByText('Quick toast')).toBeInTheDocument()
      })
    })
  })

  describe('Max Toasts Limit', () => {
    it('removes oldest toasts when exceeding maxToasts', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      function ManyToastsTrigger() {
        const { toast } = useToast()
        return (
          <button
            onClick={() => {
              toast({ id: 'toast-1', message: 'Toast 1', variant: 'info' })
              toast({ id: 'toast-2', message: 'Toast 2', variant: 'info' })
              toast({ id: 'toast-3', message: 'Toast 3', variant: 'info' })
              toast({ id: 'toast-4', message: 'Toast 4', variant: 'info' })
            }}
            data-testid="trigger"
          >
            Show Many
          </button>
        )
      }

      render(
        <ToastProvider maxToasts={3}>
          <ManyToastsTrigger />
          <ToastContainer />
        </ToastProvider>
      )

      await user.click(screen.getByTestId('trigger'))

      await waitFor(() => {
        // Toast 1 should be removed (oldest)
        expect(screen.queryByText('Toast 1')).not.toBeInTheDocument()
        // Newest 3 should remain
        expect(screen.getByText('Toast 2')).toBeInTheDocument()
        expect(screen.getByText('Toast 3')).toBeInTheDocument()
        expect(screen.getByText('Toast 4')).toBeInTheDocument()
      })
    })
  })

  describe('Action Button Styling', () => {
    it('action button has primary text color', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          action={{ label: 'Undo', onClick: () => {} }}
        />
      )
      const actionButton = screen.getByRole('button', { name: 'Undo' })
      expect(actionButton).toHaveClass('text-primary')
    })

    it('action button has hover underline style', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          action={{ label: 'Undo', onClick: () => {} }}
        />
      )
      const actionButton = screen.getByRole('button', { name: 'Undo' })
      expect(actionButton).toHaveClass('hover:underline')
    })

    it('action button has margin top', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          action={{ label: 'Undo', onClick: () => {} }}
        />
      )
      const actionButton = screen.getByRole('button', { name: 'Undo' })
      expect(actionButton).toHaveClass('mt-2')
    })
  })

  describe('Dismiss Button Styling', () => {
    it('dismiss button has muted text color', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      const dismissButton = screen.getByRole('button', { name: /dismiss/i })
      expect(dismissButton).toHaveClass('text-muted')
    })

    it('dismiss button has hover styles', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      const dismissButton = screen.getByRole('button', { name: /dismiss/i })
      expect(dismissButton).toHaveClass('hover:bg-subtle')
      expect(dismissButton).toHaveClass('hover:text-default')
    })

    it('dismiss button has rounded style', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      const dismissButton = screen.getByRole('button', { name: /dismiss/i })
      expect(dismissButton).toHaveClass('rounded')
    })

    it('dismiss button has minimum 20px touch target (per design system)', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
        />
      )
      const dismissButton = screen.getByRole('button', { name: /dismiss/i })
      // Design system specifies 20px touch target
      // Button uses p-1 (4px padding) around 16px icon = 24px total
      // Also uses -m-1 to pull in the visual hit area
      // min-w-5 min-h-5 ensures minimum 20px touch target
      expect(dismissButton).toHaveClass('min-w-5')
      expect(dismissButton).toHaveClass('min-h-5')
    })
  })

  describe('Stack Reposition Animation', () => {
    it('applies transition classes for smooth repositioning', () => {
      render(
        <ToastProvider>
          <ToastContainer data-testid="container" />
        </ToastProvider>
      )
      const container = screen.getByTestId('container')
      // Container should have transition for smooth stack repositioning
      expect(container).toHaveClass('transition-[opacity,transform]')
    })

    it('toasts have transition for smooth repositioning when others are dismissed', () => {
      render(
        <Toast
          id="test-1"
          message="Message"
          variant="info"
          onDismiss={() => {}}
          data-testid="toast"
        />
      )
      const toast = screen.getByTestId('toast')
      // Toast should have transition classes for smooth movement when stack changes
      expect(toast).toHaveClass('transition-[opacity,transform]')
    })

    it('remaining toasts reposition smoothly when middle toast is dismissed', async () => {
      vi.useRealTimers()
      const user = userEvent.setup()

      function StackRepositionTrigger() {
        const { toast, dismiss } = useToast()
        return (
          <>
            <button
              onClick={() => {
                toast({ id: 'toast-1', message: 'First', variant: 'info' })
                toast({ id: 'toast-2', message: 'Second', variant: 'success' })
                toast({ id: 'toast-3', message: 'Third', variant: 'warning' })
              }}
              data-testid="show"
            >
              Show
            </button>
            <button onClick={() => dismiss('toast-2')} data-testid="dismiss-middle">
              Dismiss Middle
            </button>
          </>
        )
      }

      render(
        <ToastProvider>
          <StackRepositionTrigger />
          <ToastContainer data-testid="container" />
        </ToastProvider>
      )

      await user.click(screen.getByTestId('show'))

      await waitFor(() => {
        expect(screen.getByText('First')).toBeInTheDocument()
        expect(screen.getByText('Second')).toBeInTheDocument()
        expect(screen.getByText('Third')).toBeInTheDocument()
      })

      // Dismiss the middle toast
      await user.click(screen.getByTestId('dismiss-middle'))

      // Verify middle toast is removed and others remain
      await waitFor(() => {
        expect(screen.queryByText('Second')).not.toBeInTheDocument()
        expect(screen.getByText('First')).toBeInTheDocument()
        expect(screen.getByText('Third')).toBeInTheDocument()
      })

      // Verify remaining toasts maintain correct order
      const container = screen.getByTestId('container')
      const remainingToasts = container.querySelectorAll('.toast')
      expect(remainingToasts).toHaveLength(2)
      expect(remainingToasts[0]).toHaveTextContent('First')
      expect(remainingToasts[1]).toHaveTextContent('Third')
    })
  })
})
