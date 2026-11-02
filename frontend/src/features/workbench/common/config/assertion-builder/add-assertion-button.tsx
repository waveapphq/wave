/**
 * Assertion Builder - Add Assertion Button (popover with Literal / Expression choices)
 */

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AddAssertionButtonProps {
  testIdSuffix: string
  onAddLiteral: () => void
  onAddExpression: () => void
  compact?: boolean
}

export function AddAssertionButton({
  testIdSuffix,
  onAddLiteral,
  onAddExpression,
  compact = false,
}: Readonly<AddAssertionButtonProps>) {
  const [open, setOpen] = useState(false)

  // When suffix is empty (root level), IDs are: assert-add-assertion, assert-add-literal, assert-add-expression
  // When suffix is a groupId, IDs are: assert-group-add-assertion-{groupId}, etc.
  const prefix = testIdSuffix
    ? `assert-group-add`
    : `assert-add`
  const suffix = testIdSuffix ? `-${testIdSuffix}` : ''

  return (
    <div className="relative inline-block">
      <Button
        variant="outline"
        size="sm"
        data-testid={`${prefix}-assertion${suffix}`}
        aria-label="Add assertion"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Plus className="h-3.5 w-3.5" />
        {!compact && 'Add Assertion'}
      </Button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-40 p-1 rounded-md border bg-popover shadow-md z-50">
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent focus-visible:ring-2 focus-visible:ring-offset-2"
            data-testid={`${prefix}-literal${suffix}`}
            onClick={() => {
              onAddLiteral()
              setOpen(false)
            }}
          >
            Literal
          </button>
          <button
            type="button"
            className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-accent focus-visible:ring-2 focus-visible:ring-offset-2"
            data-testid={`${prefix}-expression${suffix}`}
            onClick={() => {
              onAddExpression()
              setOpen(false)
            }}
          >
            Expression
          </button>
        </div>
      )}
    </div>
  )
}
