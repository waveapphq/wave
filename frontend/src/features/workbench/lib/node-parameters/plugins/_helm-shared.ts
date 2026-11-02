/**
 * Shared Helm Constants
 *
 * Parameter definitions shared across the Helm block family so the fields keep
 * one name, label, and description on every block. The session, namespace,
 * impersonation and failure rows come from the K8s builders underneath.
 */

import {
  group,
  output,
  param,
  type GroupMeta,
  type InputParam,
  type OutputParam,
  type OutputTypeRule,
} from '../types'
import {
  K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sOutputFormatInput,
} from './_k8s-shared'

export const HELM_AUTH_GROUP = 'Auth & TLS'

export const HELM_CONNECTION_DESCRIPTION = "K8s Session and helm's operation timeout"

export const HELM_ADVANCED_DESCRIPTION = 'Session overrides and the helm executable'

export const HELM_AUTH_DESCRIPTION = 'Credentials and trust for the chart repository'

const HELM_TIMEOUT_DESCRIPTION = 'How long helm gets to finish the operation, in seconds'

const HELM_NAMESPACE_DESCRIPTION =
  'Leave empty to use the namespace the session carries. Otherwise, the namespace the release lives in.'

const HELM_OUTPUT_FORMAT_DESCRIPTION =
  'How Result comes back. Table is the printed summary, Map the parsed release document, JSON and YAML the same document as text.'

const HELM_RESULT_DESCRIPTION =
  'The release in the shape Output Format asks for: the summary as a table, or the whole release document'

// --- Rows shared across the Helm block family ---

/** Connection rows of the blocks whose Timeout is helm's own operation timeout. */
export function helmConnectionInputs(): InputParam[] {
  return k8sConnectionInputs(300, HELM_TIMEOUT_DESCRIPTION)
}

export function helmReleaseInput(description: string): InputParam {
  return param('release', 'Release Name', 'string', true, description)
}

export function helmPathInput(): InputParam {
  return param(
    'helm_path',
    'Helm Path',
    'string',
    false,
    "The helm executable to run: a name looked up on the PATH where the block runs, or a path; a relative path starts at the home folder of the account the block runs as. Empty runs 'helm' from the PATH",
    { placeholder: 'helm' },
  )
}

/** The chart source: what to deploy, from where, and with which values. */
export function helmChartInputs(groupName: string): InputParam[] {
  return [
    param('chart', 'Chart', 'string', true, 'The chart to use: a name in a repository, a path to a local directory or archive, or an OCI reference.', {
      placeholder: 'nginx',
      group: groupName,
      fileReference: 'file-or-folder',
    }),
    param('version', 'Version', 'string', false, 'The chart version to use. Empty takes the newest version the repository offers.', {
      placeholder: '1.2.3',
      group: groupName,
    }),
    param('repo', 'Repository URL', 'string', false, 'The chart repository to fetch the chart from. Leave empty when Chart is a local path or an OCI reference.', {
      placeholder: 'https://charts.example.com',
      group: groupName,
      allowedFormats: ['plain'],
    }),
    param('values', 'Values', 'string', false, "Values applied over the chart's own defaults, as YAML.", {
      allowedFormats: ['yaml'],
      group: groupName,
    }),
    param('set', 'Set', 'map', false, 'Single values to override, one entry per key. Nested keys use dots, like image.tag.', {
      group: groupName,
    }),
  ]
}

/** Credentials and trust for the chart repository, not for the cluster. */
export function helmAuthInputs(): InputParam[] {
  return [
    param('repo_username', 'Repository Username', 'string', false, 'The user name the chart repository asks for.', {
      group: HELM_AUTH_GROUP,
    }),
    param('repo_password', 'Repository Password', 'string', false, 'The password the chart repository asks for.', {
      secret: true,
      group: HELM_AUTH_GROUP,
    }),
    param('repo_ca_cert', 'Repository CA Certificate', 'string', false, "The PEM bundle that verifies the chart repository's certificate; when set, it is the only certificate trusted. Empty trusts the certificates WAVE trusts (Settings > Network > Certificates).", {
      allowedFormats: ['plain'],
      group: HELM_AUTH_GROUP,
    }),
    param('repo_verify_ssl', 'Verify Server Certificate', 'boolean', false, "Check the chart repository's certificate against the trusted authorities. Untick to fetch from a repository with a self-signed certificate.", {
      defaultValue: true,
      group: HELM_AUTH_GROUP,
    }),
  ]
}

export function helmOutputFormatInput(groupName: string): InputParam {
  return {
    ...k8sOutputFormatInput({
      defaultValue: 'table',
      description: HELM_OUTPUT_FORMAT_DESCRIPTION,
    }),
    group: groupName,
  }
}

export function helmCreateNamespaceInput(description: string): InputParam {
  return param('create_namespace', 'Create Namespace', 'boolean', false, description, {
    defaultValue: false,
  })
}

export function helmAtomicInput(description: string): InputParam {
  return param('atomic', 'Atomic', 'boolean', false, description, { defaultValue: false })
}

export function helmCleanupOnFailInput(description: string): InputParam {
  return param('cleanup_on_fail', 'Cleanup on Fail', 'boolean', false, description, {
    defaultValue: false,
  })
}

/** Cleanup Timeout shows while one of these is ticked; a block names the ones it carries. */
export const HELM_ATOMIC_ON = [{ field: 'atomic', values: ['true'] }]
export const HELM_CLEANUP_ON_FAIL_ON = [{ field: 'cleanup_on_fail', values: ['true'] }]

/** The room helm gets to undo a failed write, shown only while it has one to undo. */
export function helmCleanupTimeoutInput(showWhenAny: InputParam['showWhenAny']): InputParam {
  return param(
    'cleanup_timeout',
    'Cleanup Timeout',
    'integer',
    false,
    'How long helm gets to undo the failed operation, in seconds, on top of Timeout. The block is stopped once both have run out.',
    { defaultValue: 300, showWhenAny },
  )
}

// --- Advanced + Failure Handling tail, closing every Helm block's inputs ---

export interface HelmBlockTail {
  /** Emitted between Namespace and Helm Path */
  createNamespace?: InputParam
  /** Emitted between Helm Path and On error, under Failure Handling */
  failureHandlingBeforeOnError?: InputParam[]
}

export function helmBlockTailInputs(tail: HelmBlockTail = {}): InputParam[] {
  return k8sBlockTailInputs({
    namespace: { description: HELM_NAMESPACE_DESCRIPTION },
    impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
    advancedAfterNamespace: [
      ...(tail.createNamespace ? [tail.createNamespace] : []),
      helmPathInput(),
    ],
    failureHandlingBeforeOnError: tail.failureHandlingBeforeOnError,
  })
}

// --- Groups: Connection / verb / Auth & TLS / Advanced / Failure Handling ---

export interface HelmBlockGroups {
  /** Declare the chart-repository group between the verb group and Advanced */
  auth?: boolean
  connectionDescription?: string
}

export function helmBlockGroups(
  verbGroup: GroupMeta,
  options: HelmBlockGroups = {},
): Record<string, GroupMeta> {
  const base = k8sBlockGroups(
    verbGroup,
    HELM_ADVANCED_DESCRIPTION,
    options.connectionDescription ?? HELM_CONNECTION_DESCRIPTION,
  )
  const result: Record<string, GroupMeta> = {}
  for (const [name, meta] of Object.entries(base)) {
    if (name === 'Advanced' && options.auth) {
      result[HELM_AUTH_GROUP] = group(HELM_AUTH_GROUP, { description: HELM_AUTH_DESCRIPTION })
    }
    result[name] = meta
  }
  return result
}

// --- Outputs ---

/** Result starts as a Table and follows Output Format from there (HELM-6). */
export const HELM_FORMAT_TYPE_RULES: OutputTypeRule[] = [
  { when: [{ field: 'output_format', values: ['map'] }], type: 'map' },
  { when: [{ field: 'output_format', values: ['json', 'yaml'] }], type: 'string' },
]

export function helmResultOutput(description: string = HELM_RESULT_DESCRIPTION): OutputParam {
  return output('result', 'Result', 'table', description, { typeWhen: HELM_FORMAT_TYPE_RULES })
}

export function helmStatusOutput(): OutputParam {
  return output(
    'status',
    'Status',
    'string',
    'The release state helm reports, like deployed, failed or pending-upgrade',
  )
}

export function helmReleaseOutputs(): OutputParam[] {
  return [helmResultOutput(), helmStatusOutput()]
}
