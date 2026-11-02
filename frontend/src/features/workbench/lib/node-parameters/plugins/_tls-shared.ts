/**
 * The TLS trust rows the HTTP, K8s Connect, SQL and OpenSearch blocks share (REQ-5.1.2, REQ-5.1.4).
 */

import { param, type InputParam } from '../types'

/** Verify Server Certificate, CA Certificate, Client Certificate and Client Key, in that order. */
export function tlsTrustInputs(group: string): [InputParam, InputParam, InputParam, InputParam] {
  return [
    param('verify_ssl', 'Verify Server Certificate', 'boolean', false, 'Verify the server certificate: against CA Certificate when it is set, otherwise against the certificates WAVE trusts (Settings > Network > Certificates)', { defaultValue: true, group }),
    param('ca_cert', 'CA Certificate', 'string', false, 'CA certificate (file path, variable reference, or PEM string); when set, it is the only certificate this block trusts', { group, allowedFormats: ['plain'] }),
    param('client_cert', 'Client Certificate', 'string', false, 'Client certificate for mutual TLS (file path, variable reference, or PEM string)', { group, allowedFormats: ['plain'] }),
    param('client_key', 'Client Key', 'string', false, 'Private key for the client certificate (file path or PEM string)', { group, secret: true, allowedFormats: ['plain'] }),
  ]
}
