/**
 * Credential-argument advisory analysis (REQ-3.4.1.4).
 *
 * The advisory has two surfaces: the expression walk for credential fields (ANY
 * string literal or non-secret variable reference fires, f'weak_pass' included),
 * and the map-entry advisory - a LITERAL value
 * under a credential-catalog key fires whenever it is non-empty plaintext; an
 * EXPRESSION value runs the same credential walk (a pure secret-variable
 * expression stays calm).
 */
import { describe, it, expect, vi } from 'vitest'

// Pass-through mock: real parsing by default, overridable per test to drive
// the parser-unavailable (null root) contract path.
const parseExpressionMock = vi.hoisted(() => vi.fn())
vi.mock('@/features/workbench/lib/ast-visitor/helpers', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/features/workbench/lib/ast-visitor/helpers')
  >()
  parseExpressionMock.mockImplementation(actual.parseExpression)
  return { ...actual, parseExpression: parseExpressionMock }
})

import {
  credentialExpressionAdvisory,
  mapEntryCredentialAdvisory,
  type CredentialAdvisoryVariable,
} from '@/features/workbench/lib/expression-validation/credential-advisory'

const VARS: CredentialAdvisoryVariable[] = [
  { name: 'user', isSecret: true },
  { name: 'password', isSecret: true },
  { name: 'api_token', isSecret: true },
  { name: 'prefix', isSecret: false },
  { name: 'token', isSecret: false },
]

const CREDENTIAL_KEYS = ['authorization', 'x-api-key', 'x-auth-token']

const advisory = (expression: string) => credentialExpressionAdvisory(expression, VARS)

describe('credentialExpressionAdvisory - protected shapes stay silent', () => {
  it('a bare secret variable reference', () => {
    expect(advisory('api_token')).toBe(false)
  })

  it('a composite of secret variables only', () => {
    expect(advisory('api_token + api_token')).toBe(false)
  })

  it('a method call on a secret variable', () => {
    expect(advisory('api_token.strip()')).toBe(false)
  })

  it('Python literals are not variable references', () => {
    expect(advisory('password if True else None')).toBe(false)
  })

  it('an identifier spelled like a Python literal never counts as a reference', () => {
    // The real grammar parses True/False/None as keyword nodes, so the walk's
    // literal skip is pinned with a synthetic identifier node.
    parseExpressionMock.mockReturnValueOnce({ type: 'identifier', text: 'True', children: [] })
    expect(
      credentialExpressionAdvisory('True', [{ name: 'True', isSecret: false }]),
    ).toBe(false)
  })

  it('an unparsable expression stays silent (validation owns syntax errors)', () => {
    parseExpressionMock.mockReturnValueOnce(null)
    expect(advisory('user')).toBe(false)
  })

  it('an empty expression', () => {
    expect(advisory('')).toBe(false)
  })

  it('an unknown identifier (unresolved refs belong to validation, not the advisory)', () => {
    expect(advisory('mystery_var')).toBe(false)
  })
})

describe('credentialExpressionAdvisory - unprotected material fires', () => {
  it('a bare string literal', () => {
    expect(advisory('"abc123"')).toBe(true)
  })

  it("the f-string literal bug (f'weak_pass')", () => {
    expect(advisory("f'weak_pass'")).toBe(true)
  })

  it('an f-string with literal text around a secret interpolation', () => {
    expect(advisory('f"tok_{api_token}"')).toBe(true)
  })

  it('a bare non-secret variable reference', () => {
    expect(advisory('token')).toBe(true)
  })

  it('a composite mixing a secret with a non-secret variable', () => {
    expect(advisory('prefix + api_token')).toBe(true)
  })

  it('a composite mixing secrets with a string literal', () => {
    expect(advisory('user + ":" + password')).toBe(true)
  })
})

describe('credentialExpressionAdvisory - keyword arguments', () => {
  it('a keyword-argument NAME shadowing a non-secret variable stays silent', () => {
    // "token" is a known non-secret variable, but here it is only the kwarg's
    // name - the actual argument is the secret password.
    expect(advisory('login(token=password)')).toBe(false)
  })

  it('a non-secret variable passed AS a keyword-argument value fires', () => {
    expect(advisory('login(header=token)')).toBe(true)
  })
})

describe('mapEntryCredentialAdvisory - credential-catalog entries', () => {
  const literal = (key: string, value: string) =>
    mapEntryCredentialAdvisory(key, value, CREDENTIAL_KEYS, VARS, false)
  const expr = (key: string, value: string) =>
    mapEntryCredentialAdvisory(key, value, CREDENTIAL_KEYS, VARS, true)

  it('fires for a plain literal under a credential key', () => {
    expect(literal('X-Api-Key', 'sk_live_9f2d41c8a7')).toBe(true)
  })

  it('matches credential keys case-insensitively', () => {
    expect(literal('authorization', 'Basic dXNlcjpwYXNz')).toBe(true)
  })

  it('fires for a literal that happens to contain {{ }} characters (it is verbatim, not an expression)', () => {
    expect(literal('X-Api-Key', '{{ api_token }}')).toBe(true)
  })

  it('stays silent for a literal under a non-credential key', () => {
    expect(literal('Accept', 'application/json')).toBe(false)
  })

  it('stays silent for an empty value (nothing to protect yet)', () => {
    expect(literal('X-Api-Key', '')).toBe(false)
  })

  it('stays calm for an expression that is a pure secret variable', () => {
    expect(expr('Authorization', 'api_token')).toBe(false)
  })

  it('fires for an expression carrying raw literal material under a credential key', () => {
    expect(expr('X-Auth-Token', "f'tok_{api_token}'")).toBe(true)
  })

  it('fires for an expression referencing a non-secret variable', () => {
    expect(expr('Authorization', 'token')).toBe(true)
  })

  it('stays silent for an expression under a non-credential key', () => {
    expect(expr('X-Trace-Id', "'sk_live_9f2d'")).toBe(false)
  })
})
