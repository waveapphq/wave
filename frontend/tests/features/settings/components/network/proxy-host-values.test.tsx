/**
 * ProxyHostValues Component Tests
 *
 * REQ-4.7.14 / REQ-5.2.1.42 (NET-10): the WAVE host's HTTPS_PROXY, HTTP_PROXY and
 * NO_PROXY as three read-only facts in that order, "Not set" for a variable the
 * WAVE host does not set, and a masked value shown as given.
 *
 * Component: frontend/src/features/settings/components/network/proxy-host-values.tsx
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { ProxySettings } from '@/features/settings/api/proxy'
import { ProxyHostValues } from '@/features/settings/components/network/proxy-host-values'

type HostValues = ProxySettings['host_values']

const HTTPS_VALUE = 'http://proxy.corp.example:3128'
const HTTP_VALUE = 'http://proxy.corp.example:8080'
const NO_PROXY_VALUE = '.corp.example,localhost'
const MASKED_VALUE = 'http://user:********@proxy.corp.example:3128'
const NOT_SET = 'Not set'

const ALL_SET: HostValues = {
  https_proxy: HTTPS_VALUE,
  http_proxy: HTTP_VALUE,
  no_proxy: NO_PROXY_VALUE,
}

const NONE_SET: HostValues = { https_proxy: null, http_proxy: null, no_proxy: null }

function renderValues(values: HostValues): HTMLElement {
  return render(<ProxyHostValues values={values} />).container
}

// Each text must show after the one before it, so the list is the reading order.
function expectTextSequence(container: HTMLElement, texts: readonly string[]): void {
  const all = container.textContent ?? ''
  let from = 0
  for (const text of texts) {
    const at = all.indexOf(text, from)
    expect(at, `"${text}" after offset ${from} of "${all}"`).toBeGreaterThanOrEqual(0)
    from = at + text.length
  }
}

describe('ProxyHostValues', () => {
  describe('Three facts', () => {
    it('shows the three labels', () => {
      renderValues(ALL_SET)

      expect(screen.getByText('HTTPS_PROXY')).toBeInTheDocument()
      expect(screen.getByText('HTTP_PROXY')).toBeInTheDocument()
      expect(screen.getByText('NO_PROXY')).toBeInTheDocument()
    })

    it('shows each value the WAVE host sets', () => {
      renderValues(ALL_SET)

      expect(screen.getByText(HTTPS_VALUE)).toBeInTheDocument()
      expect(screen.getByText(HTTP_VALUE)).toBeInTheDocument()
      expect(screen.getByText(NO_PROXY_VALUE)).toBeInTheDocument()
    })

    it('reads HTTPS_PROXY, HTTP_PROXY, NO_PROXY in that order, each label followed by its value', () => {
      const container = renderValues(ALL_SET)

      expectTextSequence(container, [
        'HTTPS_PROXY',
        HTTPS_VALUE,
        'HTTP_PROXY',
        HTTP_VALUE,
        'NO_PROXY',
        NO_PROXY_VALUE,
      ])
    })

    it('shows the same value on two variables once for each', () => {
      renderValues({ https_proxy: HTTPS_VALUE, http_proxy: HTTPS_VALUE, no_proxy: null })

      expect(screen.getAllByText(HTTPS_VALUE)).toHaveLength(2)
    })
  })

  describe('A variable the WAVE host does not set', () => {
    it('reads "Not set" for HTTPS_PROXY alone', () => {
      const container = renderValues({ ...ALL_SET, https_proxy: null })

      expect(screen.getAllByText(NOT_SET)).toHaveLength(1)
      expectTextSequence(container, [
        'HTTPS_PROXY',
        NOT_SET,
        'HTTP_PROXY',
        HTTP_VALUE,
        'NO_PROXY',
        NO_PROXY_VALUE,
      ])
    })

    it('reads "Not set" for HTTP_PROXY alone', () => {
      const container = renderValues({ ...ALL_SET, http_proxy: null })

      expect(screen.getAllByText(NOT_SET)).toHaveLength(1)
      expectTextSequence(container, [
        'HTTPS_PROXY',
        HTTPS_VALUE,
        'HTTP_PROXY',
        NOT_SET,
        'NO_PROXY',
        NO_PROXY_VALUE,
      ])
    })

    it('reads "Not set" for NO_PROXY alone', () => {
      const container = renderValues({ ...ALL_SET, no_proxy: null })

      expect(screen.getAllByText(NOT_SET)).toHaveLength(1)
      expectTextSequence(container, [
        'HTTPS_PROXY',
        HTTPS_VALUE,
        'HTTP_PROXY',
        HTTP_VALUE,
        'NO_PROXY',
        NOT_SET,
      ])
    })

    it('reads "Not set" three times when the WAVE host sets none of them', () => {
      const container = renderValues(NONE_SET)

      expect(screen.getAllByText(NOT_SET)).toHaveLength(3)
      expectTextSequence(container, [
        'HTTPS_PROXY',
        NOT_SET,
        'HTTP_PROXY',
        NOT_SET,
        'NO_PROXY',
        NOT_SET,
      ])
    })

    it('shows no "Not set" when every variable is set', () => {
      renderValues(ALL_SET)

      expect(screen.queryByText(NOT_SET)).not.toBeInTheDocument()
    })
  })

  describe('A masked value', () => {
    it('shows a value with a masked password exactly as given', () => {
      renderValues({ ...ALL_SET, https_proxy: MASKED_VALUE })

      expect(screen.getByText(MASKED_VALUE)).toBeInTheDocument()
    })

    it('shows the masked value on HTTP_PROXY too', () => {
      const container = renderValues({ ...ALL_SET, http_proxy: MASKED_VALUE })

      expectTextSequence(container, ['HTTP_PROXY', MASKED_VALUE, 'NO_PROXY'])
    })
  })

  describe('Read-only', () => {
    it('renders the facts as text, with no input of any kind', () => {
      const container = renderValues(ALL_SET)

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0)
    })

    it('renders no input for a variable that is not set', () => {
      const container = renderValues(NONE_SET)

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(container.querySelectorAll('input, textarea, select')).toHaveLength(0)
    })

    it('marks each fact with a lock icon hidden from assistive tech', () => {
      const container = renderValues(ALL_SET)

      const locks = container.querySelectorAll('svg.lucide-lock')
      expect(locks).toHaveLength(3)
      for (const lock of locks) {
        expect(lock).toHaveAttribute('aria-hidden', 'true')
      }
    })

    it('keeps the variable names out of page translation', () => {
      renderValues(ALL_SET)

      for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY']) {
        expect(screen.getByText(name).closest('[translate="no"]')).not.toBeNull()
      }
    })
  })
})
