// REQ-4.5.16 WAVE Host's Store summary (NET-6)
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import { HostStoreSummary } from '@/features/settings/components/network/host-store-summary'

const STORE = { path: '/srv/wave/certs/ca-certificates.crt', count: 140, last_changed: '2026-08-12' }
const NOT_FOUND = 'No certificate store found on this WAVE host'

describe('HostStoreSummary', () => {
  describe('Store found', () => {
    it('shows the Store fact with the store path', () => {
      const { container } = render(<HostStoreSummary store={STORE} />)
      expect(container).toHaveTextContent(/Store\s*\/srv\/wave\/certs\/ca-certificates\.crt/)
    })

    it('shows the Certificates fact with the count', () => {
      const { container } = render(<HostStoreSummary store={STORE} />)
      expect(container).toHaveTextContent(/Certificates\s*140/)
    })

    it('shows the Last changed fact with the date', () => {
      const { container } = render(<HostStoreSummary store={STORE} />)
      expect(container).toHaveTextContent(/Last changed\s*2026-08-12/)
    })

    it('marks each of the three facts with a lock', () => {
      const { container } = render(<HostStoreSummary store={STORE} />)
      expect(container.querySelectorAll('svg.lucide-lock')).toHaveLength(3)
    })

    it('shows no not-found line', () => {
      render(<HostStoreSummary store={STORE} />)
      expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument()
    })
  })

  describe('Store not found', () => {
    const missing = { path: null, count: 0, last_changed: null }

    it('reads "No certificate store found on this WAVE host"', () => {
      render(<HostStoreSummary store={missing} />)
      expect(screen.getByText(NOT_FOUND)).toBeInTheDocument()
    })

    it('shows none of the three facts', () => {
      render(<HostStoreSummary store={missing} />)
      expect(screen.queryByText('Store')).not.toBeInTheDocument()
      expect(screen.queryByText('Certificates')).not.toBeInTheDocument()
      expect(screen.queryByText('Last changed')).not.toBeInTheDocument()
    })
  })
})
