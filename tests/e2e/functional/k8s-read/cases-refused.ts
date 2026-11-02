/**
 * R8 case table - the pre-run gate's refusals and their negatives.
 *
 * The table IS the checklist. Every row carries its option id, the exact
 * parameter the gate reports, and the values that
 * make the hole (or, for a negative, the values that make the same empty
 * field legitimate). Specs generate their fixtures from here; the checked-in
 * `fixture-refused-golden.json` pins the emitted node shape.
 */

import { k8sReadNode, literal, type K8sReadElementType, type WorkflowNode } from '../../helpers/k8s-nodes'

/** A quoted literal, so `session` never resolves a variable and no
 *  UNDECLARED_VARIABLE row can join the gate's output. */
export const SESSION_LITERAL = literal('kubeconfig-placeholder')

/** The canvas label each read Block reports itself under. */
export const K8S_READ_LABEL: Record<K8sReadElementType, string> = {
  'k8s-get': 'K8s Get',
  'k8s-events': 'K8s Events',
  'k8s-logs': 'K8s Logs',
  'k8s-top': 'K8s Top',
}

export interface HoleCase {
  /** Option id, or a local marker naming the Block and the parameter where
   *  the matrix has no row for it. */
  id: string
  elementType: K8sReadElementType
  /** The schema name the gate puts in the message - never the sheet label. */
  param: string
  /** What the leg is, for the test title. */
  what: string
  /** Everything the Block carries EXCEPT the hole. */
  values: Record<string, unknown>
}

export interface NegativeCase {
  id: string
  elementType: K8sReadElementType
  /** The parameter that stays empty and must NOT be refused. */
  param: string
  what: string
  values: Record<string, unknown>
}

/** One row per hole the gate must refuse. `session`, `pod` and Logs'
 *  `container` are unconditional; the other five are required only while
 *  their own condition holds. Get's `kind` and Events' `object_kind` are not
 *  holes: left out, the run takes their default `Pod`. */
export const HOLE_CASES: readonly HoleCase[] = [
  {
    id: 'S-02',
    elementType: 'k8s-get',
    param: 'session',
    what: 'session absent',
    values: { resource_type: 'default', kind: 'Pod', search_by: 'list' },
  },
  {
    id: 'G-38',
    elementType: 'k8s-get',
    param: 'name',
    what: 'name absent in Name mode',
    values: {
      session: SESSION_LITERAL,
      resource_type: 'default',
      kind: 'Pod',
      search_by: 'name',
    },
  },
  {
    id: 'GET-KIND-CUSTOM',
    elementType: 'k8s-get',
    param: 'kind_custom',
    what: 'kind_custom absent while Resource Type is Custom',
    values: { session: SESSION_LITERAL, resource_type: 'custom', search_by: 'list' },
  },
  {
    id: 'E-06',
    elementType: 'k8s-events',
    param: 'object_name',
    what: 'object_name absent while scoping',
    values: {
      session: SESSION_LITERAL,
      scope_to_object: true,
      object_type: 'default',
      object_kind: 'Pod',
    },
  },
  {
    id: 'EVENTS-KIND-CUSTOM',
    elementType: 'k8s-events',
    param: 'object_kind_custom',
    what: 'object_kind_custom absent while scoping with Object Type Custom',
    values: {
      session: SESSION_LITERAL,
      scope_to_object: true,
      object_type: 'custom',
      object_name: 'wave-pod-labeled',
    },
  },
  {
    id: 'L-02',
    elementType: 'k8s-logs',
    param: 'pod',
    what: 'pod absent',
    values: { session: SESSION_LITERAL, container: 'app' },
  },
  // Container is required and WAVE never picks one (K8SREAD-20), so L-03 and
  // L-04 are one refusal: the gate never looks at the pod, so a
  // single-container pod and a multi-container one are refused alike.
  {
    id: 'L-03',
    elementType: 'k8s-logs',
    param: 'container',
    what: 'container absent, on any pod (L-03 and L-04 alike)',
    values: { session: SESSION_LITERAL, pod: 'wave-pod-multi' },
  },
  {
    id: 'T-07',
    elementType: 'k8s-top',
    param: 'name',
    what: 'name absent under Select by Name',
    values: { session: SESSION_LITERAL, scope: 'pod', select_by: 'name' },
  },
]

/** One row per conditional parameter, with the condition NOT holding. The same
 *  field is empty and the Test must save and pass the run gate. `session`,
 *  `pod` and Logs' `container` have no negative - they are required
 *  unconditionally. */
export const NEGATIVE_CASES: readonly NegativeCase[] = [
  {
    id: 'G-38',
    elementType: 'k8s-get',
    param: 'name',
    what: 'a Get in List mode with no name',
    values: {
      session: SESSION_LITERAL,
      resource_type: 'default',
      kind: 'Pod',
      search_by: 'list',
    },
  },
  {
    id: 'GET-KIND',
    elementType: 'k8s-get',
    param: 'kind',
    what: 'a Get in Custom resource mode with no kind',
    values: {
      session: SESSION_LITERAL,
      resource_type: 'custom',
      kind_custom: 'WaveWidget',
      search_by: 'list',
    },
  },
  {
    id: 'GET-KIND-CUSTOM',
    elementType: 'k8s-get',
    param: 'kind_custom',
    what: 'a Get in Default resource mode with no kind_custom',
    values: {
      session: SESSION_LITERAL,
      resource_type: 'default',
      kind: 'Pod',
      search_by: 'list',
    },
  },
  {
    id: 'E-06+E-07',
    elementType: 'k8s-events',
    param: 'object_name and object_kind',
    what: 'an Events read with scoping off and no object rows',
    values: { session: SESSION_LITERAL, scope_to_object: false },
  },
  {
    id: 'EVENTS-KIND-CUSTOM',
    elementType: 'k8s-events',
    param: 'object_kind_custom',
    what: 'an Events read scoped through the Kind picker with no object_kind_custom',
    values: {
      session: SESSION_LITERAL,
      scope_to_object: true,
      object_type: 'default',
      object_kind: 'Pod',
      object_name: 'wave-pod-labeled',
    },
  },
  {
    id: 'T-07',
    elementType: 'k8s-top',
    param: 'name',
    what: 'a Top read with Select by left at its default and no name',
    values: { session: SESSION_LITERAL, scope: 'pod' },
  },
  {
    id: 'GET-KIND-DEFAULT',
    elementType: 'k8s-get',
    param: 'kind',
    what: 'a Get in Default resource mode with no kind takes the default Pod',
    values: { session: SESSION_LITERAL, resource_type: 'default', search_by: 'list' },
  },
  {
    id: 'E-07-DEFAULT',
    elementType: 'k8s-events',
    param: 'object_kind',
    what: 'an Events read scoped with no object_kind takes the default Pod',
    values: {
      session: SESSION_LITERAL,
      scope_to_object: true,
      object_type: 'default',
      object_name: 'wave-pod-labeled',
    },
  },
]

/** The canvas id a case's Block carries, so a failure names the row it broke. */
export function caseNodeId(id: string): string {
  return `refused-${id.toLowerCase()}`
}

/** The Block a hole case describes, with the hole left in it. A node
 *  description is capped at 64 characters, so it carries the id and the
 *  parameter only - the full phrasing lives in the test title. */
export function holeNode(hole: HoleCase, values = hole.values): WorkflowNode {
  return k8sReadNode({
    id: caseNodeId(hole.id),
    elementType: hole.elementType,
    description: `${hole.id} ${hole.param} absent`,
    values,
    expressionFields: ['session'],
  })
}

/** The Block a negative case describes - the same field empty, legitimately. */
export function negativeNode(negative: NegativeCase): WorkflowNode {
  return k8sReadNode({
    id: caseNodeId(`neg-${negative.id}`),
    elementType: negative.elementType,
    description: `${negative.id} negative ${negative.param}`,
    values: negative.values,
    expressionFields: ['session'],
  })
}

/** The gate's message for an absent required parameter. */
export function missingMessage(param: string): string {
  return `Required parameter '${param}' is missing`
}

/** The gate's message for a required parameter that is present but blank. */
export function emptyMessage(param: string): string {
  return `Required parameter '${param}' is empty`
}
