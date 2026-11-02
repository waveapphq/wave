/**
 * mapEntryErrorMessages keyPolicy checks (REQ-3.4.1.4).
 *
 * A resolved key policy rides mapEntryErrorMessages as plain data opts so one
 * validator backs the Visual editor, the Code view, and the strip: a case-
 * insensitive duplicate check with the policy noun, plus blocked keys carrying
 * their exact messages. The mode-owned key rules are retired (section 9) and
 * Transfer-Encoding left the blocklist (section 6). Generic maps (no policy)
 * keep today's behavior untouched.
 */
import { describe, it, expect } from 'vitest'
import {
  mapEntryErrorMessages,
  mapKeyPolicyFlaggedIndexes,
  type ResolvedMapKeyPolicy,
  type ValueType,
} from '@/lib/variable-validation'

function entry(key: string, value = 'v'): { key: string; value: string; type: ValueType } {
  return { key, value, type: 'string' }
}

const BLOCKED_CONTENT_LENGTH =
  'Header "Content-Length" cannot be set manually - the HTTP stack blocks length overrides'

const HEADER_POLICY: ResolvedMapKeyPolicy = {
  keyNoun: 'header',
  caseInsensitive: true,
  blockedKeys: {
    'content-length': BLOCKED_CONTENT_LENGTH,
  },
}

describe('keyPolicy - case-insensitive duplicates', () => {
  it('flags keys differing only by case with the exact header message', () => {
    const messages = mapEntryErrorMessages(
      [entry('Authorization'), entry('authorization')],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual([
      'Duplicate header "authorization" (header names are case-insensitive)',
    ])
  })

  // Casing: the message names the LATER duplicate row as typed.
  it('uses the later-typed casing in the message', () => {
    const messages = mapEntryErrorMessages(
      [entry('x-trace-id'), entry('X-Trace-Id')],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual([
      'Duplicate header "X-Trace-Id" (header names are case-insensitive)',
    ])
  })

  it('reports an exact-case duplicate with the same header wording', () => {
    const messages = mapEntryErrorMessages(
      [entry('Accept'), entry('Accept')],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual(['Duplicate header "Accept" (header names are case-insensitive)'])
  })

  it('reports each duplicated key once', () => {
    const messages = mapEntryErrorMessages(
      [entry('Accept'), entry('accept'), entry('ACCEPT')],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual(['Duplicate header "accept" (header names are case-insensitive)'])
  })
})

describe('keyPolicy - blocked framing headers (section 6)', () => {
  it('flags Content-Length with the exact reworded message', () => {
    const messages = mapEntryErrorMessages([entry('Content-Length')], undefined, HEADER_POLICY)
    expect(messages).toEqual([BLOCKED_CONTENT_LENGTH])
  })

  it('renders the canonical casing regardless of the typed casing', () => {
    const messages = mapEntryErrorMessages([entry('content-length')], undefined, HEADER_POLICY)
    expect(messages).toEqual([BLOCKED_CONTENT_LENGTH])
  })

  it('leaves Transfer-Encoding unflagged (manual framing forwards to the transport)', () => {
    const messages = mapEntryErrorMessages(
      [entry('Transfer-Encoding', 'chunked')],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual([])
  })

  it('leaves Content-Type unflagged in every mode (mode-conflict rule retired)', () => {
    const messages = mapEntryErrorMessages(
      [entry('Content-Type', 'application/json')],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual([])
  })

  it('leaves Host and Connection unflagged (vhost + keep-alive stay legal)', () => {
    const messages = mapEntryErrorMessages(
      [entry('Host', 'api.internal'), entry('Connection', 'keep-alive')],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual([])
  })
})

describe('keyPolicy - message order and coexistence', () => {
  it('emits messages in row order', () => {
    const messages = mapEntryErrorMessages(
      [
        entry('Content-Length', '10'),
        entry('Authorization', 'Bearer {{ api_token }}'),
        entry('authorization', 'Basic dXNlcjpwYXNz'),
      ],
      undefined,
      HEADER_POLICY,
    )
    expect(messages[0]).toBe(BLOCKED_CONTENT_LENGTH)
    expect(messages[1]).toBe(
      'Duplicate header "authorization" (header names are case-insensitive)',
    )
    expect(messages).toHaveLength(2)
  })

  it('keeps ordinary keys silent alongside a flagged one', () => {
    const messages = mapEntryErrorMessages(
      [entry('X-Trace-Id', 'wave-1'), entry('Content-Length', '10')],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual([BLOCKED_CONTENT_LENGTH])
  })

  it('still skips a fully-empty transient row under a policy', () => {
    const messages = mapEntryErrorMessages(
      [entry('Accept', 'text/html'), { key: '', value: '', type: 'string' }],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual([])
  })

  it('still reports a missing key when a value is present', () => {
    const messages = mapEntryErrorMessages(
      [{ key: '', value: 'orphan', type: 'string' }],
      undefined,
      HEADER_POLICY,
    )
    expect(messages).toEqual(['Element #0: key missing'])
  })
})

describe('generic maps without a keyPolicy stay untouched', () => {
  it('keeps the plain duplicate message for exact duplicates', () => {
    const messages = mapEntryErrorMessages([entry('a'), entry('a')])
    expect(messages).toEqual(['Duplicate key "a"'])
  })

  it('does NOT flag keys differing only by case', () => {
    const messages = mapEntryErrorMessages([entry('Key'), entry('key')])
    expect(messages).toEqual([])
  })

  it('does NOT flag Content-Length in a policy-free map', () => {
    const messages = mapEntryErrorMessages([entry('Content-Length', '10')])
    expect(messages).toEqual([])
  })
})

const SHELL_NAME_PATTERN = '^[A-Za-z_][A-Za-z0-9_]*$'

const INVALID_NAME = (key: string): string => `Invalid variable name: '${key}'`
const BLOCKED_PREFIX = (key: string): string =>
  `Variable names may not start with WAVE_: '${key}'`

/** The Input Variables policy of Shell Script and Shell Exec (SHRUN-5). */
const INPUT_VARS_POLICY: ResolvedMapKeyPolicy = {
  keyNoun: 'variable',
  keyPattern: { pattern: SHELL_NAME_PATTERN, message: "Invalid variable name: '{key}'" },
  blockedPrefixes: [
    { prefix: 'WAVE_', message: "Variable names may not start with WAVE_: '{key}'" },
  ],
}

describe('keyPolicy - shell identifier pattern (SHRUN-5)', () => {
  it('flags a key that is not a shell identifier', () => {
    expect(mapEntryErrorMessages([entry('1X')], undefined, INPUT_VARS_POLICY)).toEqual([
      INVALID_NAME('1X'),
    ])
  })

  it('flags a key holding a character the pattern rejects', () => {
    expect(mapEntryErrorMessages([entry('MY-VAR')], undefined, INPUT_VARS_POLICY)).toEqual([
      INVALID_NAME('MY-VAR'),
    ])
  })

  it('accepts a plain shell identifier', () => {
    expect(mapEntryErrorMessages([entry('MY_VAR2')], undefined, INPUT_VARS_POLICY)).toEqual([])
  })

  it('accepts a leading underscore', () => {
    expect(mapEntryErrorMessages([entry('_hidden')], undefined, INPUT_VARS_POLICY)).toEqual([])
  })

  it('checks the key exactly as saved, so a leading space fails with the space shown', () => {
    expect(mapEntryErrorMessages([entry(' X')], undefined, INPUT_VARS_POLICY)).toEqual([
      INVALID_NAME(' X'),
    ])
  })

  it('checks a trailing space the same way', () => {
    expect(mapEntryErrorMessages([entry('X ')], undefined, INPUT_VARS_POLICY)).toEqual([
      INVALID_NAME('X '),
    ])
  })
})

describe('keyPolicy - blocked WAVE_ prefix (SHRUN-5)', () => {
  it('flags a valid identifier that starts with WAVE_', () => {
    expect(mapEntryErrorMessages([entry('WAVE_HOME')], undefined, INPUT_VARS_POLICY)).toEqual([
      BLOCKED_PREFIX('WAVE_HOME'),
    ])
  })

  it('gives only the identifier message when the key fails the pattern as well', () => {
    expect(mapEntryErrorMessages([entry('WAVE_X-Y')], undefined, INPUT_VARS_POLICY)).toEqual([
      INVALID_NAME('WAVE_X-Y'),
    ])
  })

  it('is case-sensitive: a lowercase wave_ prefix passes', () => {
    expect(mapEntryErrorMessages([entry('wave_home')], undefined, INPUT_VARS_POLICY)).toEqual([])
  })

  it('is case-sensitive: the uppercase prefix fails', () => {
    expect(mapEntryErrorMessages([entry('WAVE_x')], undefined, INPUT_VARS_POLICY)).toEqual([
      BLOCKED_PREFIX('WAVE_x'),
    ])
  })

  it('accepts a name that only contains WAVE_ later on', () => {
    expect(mapEntryErrorMessages([entry('MY_WAVE_HOME')], undefined, INPUT_VARS_POLICY)).toEqual([])
  })
})

describe('keyPolicy - name rules alongside the other checks', () => {
  it('emits one message per offending row, in row order', () => {
    const messages = mapEntryErrorMessages(
      [entry('OK'), entry('1X'), entry('WAVE_HOME')],
      undefined,
      INPUT_VARS_POLICY,
    )
    expect(messages).toEqual([INVALID_NAME('1X'), BLOCKED_PREFIX('WAVE_HOME')])
  })

  it('still skips a fully-empty transient row beside a flagged one', () => {
    const messages = mapEntryErrorMessages(
      [entry('1X'), { key: '', value: '', type: 'string' }],
      undefined,
      INPUT_VARS_POLICY,
    )
    expect(messages).toEqual([INVALID_NAME('1X')])
  })

  it('keeps the plain duplicate message for a repeated valid name', () => {
    const messages = mapEntryErrorMessages(
      [entry('COUNT'), entry('COUNT')],
      undefined,
      INPUT_VARS_POLICY,
    )
    expect(messages).toEqual(['Duplicate key "COUNT"'])
  })
})

describe('mapKeyPolicyFlaggedIndexes - name rules', () => {
  it('flags the rows that fail the pattern and the rows with the blocked prefix', () => {
    const flagged = mapKeyPolicyFlaggedIndexes(
      [entry('OK'), entry('1X'), entry('WAVE_HOME')],
      INPUT_VARS_POLICY,
    )
    expect(flagged).toEqual(new Set([1, 2]))
  })

  it('flags a key that is only invalid untrimmed', () => {
    expect(mapKeyPolicyFlaggedIndexes([entry(' X')], INPUT_VARS_POLICY)).toEqual(new Set([0]))
  })

  it('flags nothing when every key follows the rules', () => {
    const flagged = mapKeyPolicyFlaggedIndexes(
      [entry('COUNT'), entry('wave_home')],
      INPUT_VARS_POLICY,
    )
    expect(flagged).toEqual(new Set())
  })
})
