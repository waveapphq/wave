/**
 * Client-side XPath Evaluator
 *
 * Uses DOMParser + document.evaluate to test XPath expressions
 * against XML content in the browser. Used by the XML Parser
 * config modal's test button.
 */

import { numberShapeType } from '@/lib/variable-format'

export interface XPathTestResult {
  success: boolean
  type?: string
  value?: unknown
  error?: string
  detail?: string
}

/**
 * Evaluate an XPath expression against XML content.
 *
 * @param xmlContent - The XML document string
 * @param xpathExpr - The XPath expression to evaluate
 * @param namespaces - Optional namespace prefix-to-URI map
 * @returns The evaluation result with type and value, or error details
 */
/** Parse XML content and return the document or an error result */
function parseXmlDocument(xmlContent: string): { doc: Document } | { error: XPathTestResult } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlContent, 'application/xml')
    const parseError = doc.querySelector('parsererror')
    if (parseError) {
      return {
        error: {
          success: false,
          error: 'XML Parse Error',
          detail: parseError.textContent ?? 'Failed to parse XML',
        },
      }
    }
    return { doc }
  } catch (e) {
    return {
      error: {
        success: false,
        error: 'XML Parse Error',
        detail: e instanceof Error ? e.message : String(e),
      },
    }
  }
}

/** Extract namespace prefix-to-URI mappings from root element attributes */
function extractNamespaces(root: Element): Record<string, string> {
  const ns: Record<string, string> = {}
  for (const attr of root.attributes) {
    if (attr.name.startsWith('xmlns:')) {
      ns[attr.name.substring(6)] = attr.value
    }
  }
  return ns
}

/** Build an XPathNSResolver from a namespace map (or null if empty) */
function buildNsResolver(nsMap: Record<string, string>): XPathNSResolver | null {
  if (Object.keys(nsMap).length === 0) return null
  return {
    lookupNamespaceURI: (prefix: string | null) =>
      (prefix && nsMap[prefix]) || null,
  }
}

export function evaluateXPath(
  xmlContent: string,
  xpathExpr: string,
  namespaces?: Record<string, string>
): XPathTestResult {
  const parsed = parseXmlDocument(xmlContent)
  if ('error' in parsed) return parsed.error
  const { doc } = parsed

  const autoNs = extractNamespaces(doc.documentElement)
  const mergedNs = { ...autoNs, ...namespaces }
  const nsResolver = buildNsResolver(mergedNs)

  try {
    const result = doc.evaluate(xpathExpr, doc, nsResolver, XPathResult.ANY_TYPE, null)
    return convertXPathResult(result)
  } catch (e) {
    return {
      success: false,
      error: 'Invalid XPath',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Validate XPath syntax. When xmlContent is provided, namespaces are
 * auto-extracted so that prefixed queries (e.g. //ex:item) don't
 * produce false "unresolvable namespace" errors.
 * Returns null if valid, or an error message if invalid.
 */
export function validateXPathSyntax(xpathExpr: string, xmlContent?: string): string | null {
  if (!xpathExpr.trim()) return null // empty is handled by required-field validation
  try {
    const parser = new DOMParser()
    // Use the actual XML if available so namespace declarations are present,
    // otherwise fall back to a minimal document.
    const doc = xmlContent?.trim()
      ? parser.parseFromString(xmlContent, 'application/xml')
      : parser.parseFromString('<x/>', 'application/xml')

    // Skip validation if the XML itself is malformed (parsererror) -
    // the user will see that error from the XML linter instead.
    if (doc.querySelector('parsererror')) return null

    // Build resolver from root element namespace declarations
    const nsMap: Record<string, string> = {}
    const root = doc.documentElement
    for (const attr of root.attributes) {
      if (attr.name.startsWith('xmlns:')) {
        nsMap[attr.name.substring(6)] = attr.value
      }
    }
    const hasNs = Object.keys(nsMap).length > 0
    const resolver: XPathNSResolver | null = hasNs
      ? { lookupNamespaceURI: (prefix: string | null) => (prefix && nsMap[prefix]) || null }
      : null

    doc.evaluate(xpathExpr, doc, resolver, XPathResult.ANY_TYPE, null)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid XPath expression'
  }
}

/** Convert a string array to either a single-value or array result */
function stringArrayResult(values: string[]): XPathTestResult {
  if (values.length === 0) return { success: true, type: 'array', value: [] }
  if (values.length === 1) return { success: true, type: 'string', value: values[0] }
  return { success: true, type: 'array', value: values }
}

/** Collect text from an XPath node iterator */
function collectIteratorValues(result: XPathResult): string[] {
  const values: string[] = []
  let node = result.iterateNext()
  while (node) {
    values.push(node.textContent ?? '')
    node = result.iterateNext()
  }
  return values
}

/** Collect text from an XPath node snapshot */
function collectSnapshotValues(result: XPathResult): string[] {
  const values: string[] = []
  for (let i = 0; i < result.snapshotLength; i++) {
    const node = result.snapshotItem(i)
    values.push(node?.textContent ?? '')
  }
  return values
}

/**
 * Convert a browser XPathResult to our result format.
 */
function convertXPathResult(result: XPathResult): XPathTestResult {
  switch (result.resultType) {
    case XPathResult.NUMBER_TYPE:
      return {
        success: true,
        type: numberShapeType(result.numberValue),
        value: result.numberValue,
      }

    case XPathResult.STRING_TYPE:
      return { success: true, type: 'string', value: result.stringValue }

    case XPathResult.BOOLEAN_TYPE:
      return { success: true, type: 'boolean', value: result.booleanValue }

    case XPathResult.UNORDERED_NODE_ITERATOR_TYPE:
    case XPathResult.ORDERED_NODE_ITERATOR_TYPE:
      return stringArrayResult(collectIteratorValues(result))

    case XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE:
    case XPathResult.ORDERED_NODE_SNAPSHOT_TYPE:
      return stringArrayResult(collectSnapshotValues(result))

    case XPathResult.ANY_UNORDERED_NODE_TYPE:
    case XPathResult.FIRST_ORDERED_NODE_TYPE: {
      const singleNode = result.singleNodeValue
      return {
        success: true,
        type: 'string',
        value: singleNode?.textContent ?? '',
      }
    }

    default:
      return { success: true, type: 'string', value: '' }
  }
}
