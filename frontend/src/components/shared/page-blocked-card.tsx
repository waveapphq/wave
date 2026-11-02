/**
 * The card shown over a page whose load step failed. Non-modal on purpose: the
 * application sidebar has to stay sharp and usable, which is what replaces a
 * Cancel button.
 */

import { useCallback, useState, type ComponentProps, type ReactNode, type Ref } from 'react'
import { AlertTriangle, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { CopyButton } from '@/components/shared/copy-button'
import { formatFailureDetail } from '@/lib/failure-detail'
import { usePageBlockStore } from '@/stores/page-block-store'

// Card spreads the rest of its props onto its div, so React 19 carries ref through.
type BlockCardProps = ComponentProps<typeof Card> & { ref?: Ref<HTMLDivElement> }
const BlockCard: (props: BlockCardProps) => ReactNode = Card

export function PageBlockedCard(): ReactNode {
  const block = usePageBlockStore((state) => state.block)
  const retrying = usePageBlockStore((state) => state.retrying)
  const setRetrying = usePageBlockStore((state) => state.setRetrying)

  const [detailsOpen, setDetailsOpen] = useState(false)

  const takeFocus = useCallback((node: HTMLDivElement | null) => {
    node?.focus()
  }, [])

  if (!block) return null

  const payload = formatFailureDetail(block.detail)
  // The title names one read or several, so the sentence has to agree with it.
  const failedCount = new Set(block.reads?.map((read) => read.label) ?? []).size

  const handleRetry = () => {
    setRetrying(true)
    block
      .retry()
      .finally(() => setRetrying(false))
      .catch(() => {
        // The owner of retry re-blocks with the newer failure.
      })
  }

  return (
    // The wash never catches input; `inert` on the region below is what blocks it.
    <div
      data-testid="page-blocked-wash"
      className="pointer-events-none absolute inset-0 z-10 flex justify-center overflow-auto bg-background/55 p-4"
    >
      <BlockCard
        ref={takeFocus}
        role="alert"
        tabIndex={-1}
        data-testid="page-blocked-card"
        className="pointer-events-auto m-auto w-[420px] max-w-full p-6 text-left shadow-lg focus:outline-none"
      >
        <div className="flex items-center gap-2.5">
          <Icon icon={AlertTriangle} size="lg" color="error" className="shrink-0" />
          <div data-testid="page-blocked-title" className="text-base font-semibold">
            {block.title}
          </div>
        </div>
        <div className="pl-[30px]">
          <p data-testid="page-blocked-description" className="mt-2 text-sm text-muted-foreground">
            This page cannot be used until {failedCount > 1 ? 'they load' : 'it loads'}.
          </p>
          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="mt-4">
            <CollapsibleTrigger
              data-testid="page-blocked-details-trigger"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <Icon
                icon={ChevronRight}
                size="xs"
                className={`transition-transform ${detailsOpen ? 'rotate-90' : ''}`}
              />
              Details
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="relative mt-2">
                <div
                  data-testid="page-blocked-details-panel"
                  className="max-h-[min(168px,25vh)] overflow-auto whitespace-pre rounded-md border border-border bg-muted/50 p-3 pr-10 font-mono text-xs leading-relaxed text-muted-foreground"
                >
                  {payload}
                </div>
                <CopyButton
                  value={payload}
                  ariaLabel="Copy failure details"
                  size="sm"
                  className="absolute right-1 top-1 h-6 w-6 p-0"
                  testId="page-blocked-copy"
                  copiedTestId="page-blocked-copy-success"
                  announcement="Failure details copied to clipboard"
                  tooltip="Copy"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              data-testid="page-blocked-retry"
              loading={retrying}
              onClick={handleRetry}
            >
              Try Again
            </Button>
          </div>
        </div>
      </BlockCard>
    </div>
  )
}
