/**
 * AboutTab Component
 *
 * REQ-5.2.1.42: Settings and preferences screen - About section
 *
 * About section displaying:
 * - SETTINGS-16: About: version, build, support links
 */

import { AlertCircle, ExternalLink, Mail } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/shared/copy-button'
import { Timestamp } from '@/components/shared/timestamp/timestamp'
import { formatTimestamp, type TimezoneMode } from '@/lib/timestamp-format'
import { useTimezoneStore } from '@/stores/timezone-store'
import type { SupportInfo, SystemInfo } from '@/features/settings/api/system-info'

// ============================================================================
// Types
// ============================================================================

export interface AboutTabProps {
  systemInfo?: SystemInfo
  loading: boolean
  error?: string
  onRetry: () => void
  className?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

interface OsDisplayInfo {
  os: string
  version: string | null
}

function getOsDisplay(os: string | null, osVersion: string | null): OsDisplayInfo | null {
  if (!os) return null
  return { os, version: osVersion }
}

function hasAnySupportLinks(support: SupportInfo): boolean {
  return !!(support.documentationUrl || support.issuesUrl || support.contactEmail)
}

function versionReport(info: SystemInfo, mode: TimezoneMode): string {
  return [
    `Version: ${info.version}`,
    `Build: ${info.build}`,
    info.buildDate ? `Build Date: ${formatTimestamp(info.buildDate, 'date', mode)}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

// ============================================================================
// Sub-Components
// ============================================================================

interface InfoFieldProps {
  label: string
  value: React.ReactNode
  testId?: string
  translate?: 'no'
}

function InfoField({ label, value, testId, translate }: Readonly<InfoFieldProps>) {
  return (
    <div data-testid={testId} className="grid grid-cols-[120px_1fr] gap-2 items-baseline">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span translate={translate} className="text-sm font-medium">
        {value}
      </span>
    </div>
  )
}

function OsInfoDisplay({ os, osVersion }: Readonly<{ os: string | null; osVersion: string | null }>) {
  const osDisplay = getOsDisplay(os, osVersion)
  return (
    <span data-testid="os-info">
      {osDisplay ? (
        <>
          <span>{osDisplay.os}</span>
          {osDisplay.version && <> <span>{osDisplay.version}</span></>}
        </>
      ) : '-'}
    </span>
  )
}

// ============================================================================
// Component
// ============================================================================

export function AboutTab({
  systemInfo,
  loading,
  error,
  onRetry,
  className,
}: Readonly<AboutTabProps>) {
  const timezoneMode = useTimezoneStore((state) => state.mode)

  // Loading state
  if (loading) {
    return (
      <div
        data-testid="about-loading"
        aria-busy="true"
        className={cn('space-y-6', className)}
      >
        <Skeleton className="h-8 w-48" data-testid="skeleton" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" data-testid="skeleton" />
          <Skeleton className="h-4 w-24" data-testid="skeleton" />
          <Skeleton className="h-4 w-36" data-testid="skeleton" />
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div
        data-testid="about-error"
        role="alert"
        className={cn('flex flex-col items-center justify-center py-12 text-center', className)}
      >
        <AlertCircle
          className="h-12 w-12 text-error mb-4"
          data-testid="error-icon"
        />
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button variant="outline" onClick={onRetry}>
          Try Again
        </Button>
      </div>
    )
  }

  // No data
  if (!systemInfo) {
    return null
  }

  const hasSupportLinks = hasAnySupportLinks(systemInfo.support)

  return (
    <div data-testid="about-tab" className={cn('space-y-6', className)}>
      <h2 className="text-lg font-semibold">About WAVE</h2>

      {/* Version Section */}
      <div data-testid="version-section" className="grid gap-3">
        <div className="flex items-start justify-between">
          <div className="space-y-3">
            <InfoField
              label="Version"
              value={systemInfo.version}
              testId="version-field"
              translate="no"
            />
            <InfoField label="Build" value={systemInfo.build} translate="no" />
            {systemInfo.buildDate && (
              <InfoField
                label="Released"
                value={
                  <Timestamp value={systemInfo.buildDate} style="date" data-testid="build-date" />
                }
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <CopyButton
              value={versionReport(systemInfo, timezoneMode)}
              ariaLabel="Copy version information"
              testId="copy-version-button"
              copiedTestId="copy-success"
              announcement="Version information copied"
            />
          </div>
        </div>
      </div>

      {/* Runtime Section */}
      <div data-testid="runtime-section" className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">Runtime</h3>
        <div className="grid gap-3">
          <InfoField
            label="Python"
            translate="no"
            value={
              <span data-testid="python-version">
                {systemInfo.runtime.pythonVersion || '-'}
              </span>
            }
          />
          <InfoField
            label="Operating System"
            translate="no"
            value={<OsInfoDisplay os={systemInfo.runtime.os} osVersion={systemInfo.runtime.osVersion} />}
          />
        </div>
      </div>

      {/* Support Section */}
      {hasSupportLinks && (
        <div data-testid="support-section" className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Resources</h3>
          <div className="flex flex-wrap gap-4">
            {systemInfo.support.documentationUrl && (
              <a
                href={systemInfo.support.documentationUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Documentation (opens in new tab)"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Documentation
              </a>
            )}
            {systemInfo.support.issuesUrl && (
              <a
                href={systemInfo.support.issuesUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Report an Issue (opens in new tab)"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                Report an Issue
              </a>
            )}
            {systemInfo.support.contactEmail && (
              <a
                href={`mailto:${systemInfo.support.contactEmail}`}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                <Mail className="h-4 w-4" />
                Contact Support
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
