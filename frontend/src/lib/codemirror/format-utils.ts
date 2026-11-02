/**
 * Format detection and content formatting utilities shared by the Text Editor
 * Modal and the string inspect watcher.
 *
 * Supports JSON, YAML, XML, and plain text detection and pretty-printing.
 */

import jsYaml from 'js-yaml'
import xmlFormatter from 'xml-formatter'

import { JsonNumberText, plainJsonText } from '@/lib/variable-format'
import { parseJsonExact } from '@/lib/variable-validation'
import { describeJsonError } from './json-data-editor'
import type { ResolvedFormat } from './format-editor'

// A Format keeps every number as written (REQ-3.1.3.14).

interface YamlScalarRule {
  resolve: (data: string) => boolean
  construct: (data: string) => unknown
}

// The YAML 1.2 core number rules js-yaml ships with; its type declarations leave `types` out.
const YAML_NUMBERS = (jsYaml as unknown as { types: Record<'int' | 'float', YamlScalarRule> }).types

/** A YAML number scalar with the text it was written as and the value it stands for. */
class YamlNumberText {
  constructor(
    readonly text: string,
    readonly value: unknown,
  ) {}

  // A map key of this class is written as its text, not as `[object Object]`.
  get [Symbol.toStringTag](): string {
    return 'YamlNumber'
  }

  toString(): string {
    return this.text
  }
}

function exactYamlNumber(tag: string, rule: YamlScalarRule): jsYaml.Type {
  return new jsYaml.Type(tag, {
    kind: 'scalar',
    resolve: (data: string) => rule.resolve(data),
    construct: (data: string) => new YamlNumberText(data, rule.construct(data)),
    instanceOf: YamlNumberText,
    represent: (value: object) => (value as YamlNumberText).text,
  })
}

const EXACT_NUMBER_SCHEMA = jsYaml.DEFAULT_SCHEMA.extend({
  implicit: [
    exactYamlNumber('tag:yaml.org,2002:int', YAML_NUMBERS.int),
    exactYamlNumber('tag:yaml.org,2002:float', YAML_NUMBERS.float),
  ],
})

const JSON_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/** A YAML value as JSON data: a number keeps its text when JSON can write it so, else its value. */
function yamlAsJson(value: unknown): unknown {
  if (value instanceof YamlNumberText) {
    return JSON_NUMBER.test(value.text) ? new JsonNumberText(value.text) : value.value
  }
  if (Array.isArray(value)) return value.map(yamlAsJson)
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, yamlAsJson(entry)]))
}

// ============================================================================
// Format Detection
// ============================================================================

/** Check if any line looks like a YAML key: value pair (word chars followed by colon) */
function hasYamlKeyValueLine(text: string): boolean {
  for (const line of text.split('\n')) {
    const trimmedLine = line.trimStart()
    /* v8 ignore next - COV-DEF-104 */
    if (trimmedLine.length === 0) continue
    const colonIdx = trimmedLine.indexOf(':')
    if (colonIdx <= 0) continue
    const key = trimmedLine.slice(0, colonIdx).trimEnd()
    if (key.length > 0 && isWordCharsOnly(key)) return true
  }
  return false
}

function isWordCharsOnly(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i)!
    /* v8 ignore next 2 - COV-BRANCH-121 */
    const isWordChar = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
    if (!isWordChar) return false
  }
  return true
}

export function detectFormat(content: string): ResolvedFormat {
  const trimmed = content.trim()
  if (!trimmed) return 'plain'

  // Try JSON: must parse AND start with { or [
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {
      // Not valid JSON
    }
  }

  // Check XML: <?xml or starts with a tag
  if (trimmed.startsWith('<?xml') || /^\s*<[a-zA-Z]/.test(trimmed)) {
    return 'xml'
  }

  // Check YAML: starts with --- or has key: value lines
  if (trimmed.startsWith('---') || hasYamlKeyValueLine(trimmed)) {
    return 'yaml'
  }

  return 'plain'
}

// ============================================================================
// Format Helpers
// ============================================================================

function formatJson(content: string): string {
  // Try JSON first, fall back to YAML (handles YAML-to-JSON conversion)
  try {
    return plainJsonText(parseJsonExact(content), '  ') as string
  } catch {
    try {
      const parsed = jsYaml.load(content, { schema: EXACT_NUMBER_SCHEMA })
      return plainJsonText(yamlAsJson(parsed), '  ') as string
    } catch {
      return content
    }
  }
}

function dumpYaml(content: string): string {
  const parsed = jsYaml.load(content, { schema: EXACT_NUMBER_SCHEMA })
  return jsYaml.dump(parsed, { schema: EXACT_NUMBER_SCHEMA, indent: 2, lineWidth: -1, noRefs: true }).trimEnd()
}

function formatXml(content: string): string {
  try {
    return xmlFormatter(content, {
      indentation: '  ',
      collapseContent: true,
      lineSeparator: '\n',
      throwOnFailure: true,
    })
  } catch {
    return content
  }
}

function formatYaml(content: string): string {
  // Try parsing as-is first
  try {
    return dumpYaml(content)
  } catch {
    // Fallback: strip leading whitespace from each line (fixes inconsistent indentation)
    // then try again
    try {
      return dumpYaml(content.split('\n').map((line) => line.trimStart()).join('\n'))
    } catch {
      return content
    }
  }
}

export function formatContent(content: string, format: ResolvedFormat): string {
  switch (format) {
    case 'json':
      return formatJson(content)
    case 'xml':
      return formatXml(content)
    case 'yaml':
      return formatYaml(content)
    // Plain text, a script and a query keep their layout.
    default:
      return content
  }
}

// ============================================================================
// Blocking literal validity (locked DATA formats)
// ============================================================================

function validateXmlWellFormed(text: string): string | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const errorNode = doc.querySelector('parsererror')
  if (!errorNode) return null
  // The parsererror text varies by engine; strip the browser wrapper noise with
  // string ops (no regex) so a malformed message cannot trigger ReDoS.
  const reason = String(errorNode.textContent)
    .split('Below is a rendering of the page')[0]
    .replace('This page contains the following errors:', '')
    .trim()
  return `Invalid XML: ${reason}`
}

/**
 * Human message when `text` is malformed for a strict DATA format (json/xml), else
 * null. Empty/whitespace, plain, and yaml are never blocking (null). JSON reuses
 * describeJsonError; XML reuses the DOMParser parsererror path.
 */
export function validateFormatSyntax(text: string, format: ResolvedFormat): string | null {
  if (!text.trim()) return null
  if (format === 'json') {
    try {
      JSON.parse(text)
      return null
    } catch (error) {
      return describeJsonError(text, error)
    }
  }
  if (format === 'xml') {
    return validateXmlWellFormed(text)
  }
  return null
}
