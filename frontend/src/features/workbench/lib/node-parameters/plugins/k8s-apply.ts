/**
 * K8s Apply Plugin Parameters
 *
 * Applies a pasted manifest, or builds one of three kinds from a short form
 * (K8SWRITE-1). ConfigMap data and Secret data are separate wire names so only
 * the Secret one is masked run-wide; the Secret rows and Output Format each
 * carry several descriptors under one wire name so the row follows the chosen
 * kind, Secret type and mode.
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
import type { QuickInsertMenu } from '@/lib/quick-inserts'
import {
  K8S_ADVANCED_DESCRIPTION,
  K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  k8sBlockGroups,
  k8sBlockTailInputs,
  k8sConnectionInputs,
  k8sNameInput,
  k8sOutputCore,
} from './_k8s-shared'

const DEFINE_MANIFEST = { field: 'define_with', values: ['manifest'] }
const DEFINE_FORM = { field: 'define_with', values: ['form'] }
const KIND_CONFIGMAP = { field: 'kind', values: ['ConfigMap'] }
const KIND_SECRET = { field: 'kind', values: ['Secret'] }
const KIND_JOB = { field: 'kind', values: ['Job'] }
const SECRET_TYPE_OPAQUE = { field: 'secret_type', values: ['Opaque'] }
const SECRET_TYPE_TLS = { field: 'secret_type', values: ['kubernetes.io/tls'] }
const SECRET_TYPE_DOCKERCONFIG = {
  field: 'secret_type',
  values: ['kubernetes.io/dockerconfigjson'],
}
const JOB_FROM_IMAGE = { field: 'job_from', values: ['image'] }
const JOB_FROM_CRONJOB = { field: 'job_from', values: ['cronjob'] }

const SECRET_DATA_DESCRIPTION =
  'The keys and values to store. WAVE encodes them for you - do not paste base64. Values are hidden everywhere the run is recorded.'

const TLS_QUICK_INSERTS: QuickInsertMenu[] = [
  {
    label: '+ Key',
    items: [
      { label: 'tls.crt', key: 'tls.crt', value: '' },
      { label: 'tls.key', key: 'tls.key', value: '' },
    ],
  },
]

const DOCKERCONFIG_QUICK_INSERTS: QuickInsertMenu[] = [
  {
    label: '+ Key',
    items: [{ label: '.dockerconfigjson', key: '.dockerconfigjson', value: '' }],
  },
]

// Define with picks the Output Format row, so the first option is named after the type it yields.
const OUTPUT_FORMAT_VALUES = ['map', 'json', 'yaml']

function applyOutputFormatInput(
  firstLabel: string,
  description: string,
  showWhen: InputParam['showWhen'],
): InputParam {
  return param('output_format', 'Output Format', 'string', false, description, {
    enumValues: OUTPUT_FORMAT_VALUES,
    enumLabels: { map: firstLabel, json: 'JSON', yaml: 'YAML' },
    defaultValue: 'map',
    noExpression: true,
    group: 'Resource',
    showWhen,
  })
}

function secretDataInput(
  secretTypeCondition: { field: string; values: string[] },
  quickInserts?: QuickInsertMenu[],
): InputParam {
  return param('secret_data', 'Data', 'map', false, SECRET_DATA_DESCRIPTION, {
    group: 'Resource',
    secret: true,
    showWhenAll: [DEFINE_FORM, KIND_SECRET, secretTypeCondition],
    ...(quickInserts ? { quickInserts } : {}),
  })
}

export const groups: Record<string, GroupMeta> = k8sBlockGroups(
  group('Resource', {
    description: 'What to apply, and what to do when it is already there',
    defaultExpanded: true,
  }),
  K8S_ADVANCED_DESCRIPTION,
)

export const inputs: InputParam[] = [
  // --- Connection ---
  ...k8sConnectionInputs(),
  // --- Resource ---
  param('define_with', 'Define with', 'string', false, 'Paste a manifest, or fill in a short form for one of the common kinds.', {
    enumValues: ['manifest', 'form'],
    enumLabels: { manifest: 'Manifest', form: 'Form' },
    defaultValue: 'manifest',
    noExpression: true,
    group: 'Resource',
  }),
  param('manifest', 'Manifest', 'string', false, 'The object to apply, as YAML or JSON. Several documents separated by --- are applied in order.', {
    allowedFormats: ['yaml', 'json'],
    group: 'Resource',
    showWhen: DEFINE_MANIFEST,
    requiredWhen: DEFINE_MANIFEST,
    retainOnHide: true,
  }),
  param('kind', 'Kind', 'string', false, 'The kind to build. Anything else goes in a manifest.', {
    enumValues: ['ConfigMap', 'Secret', 'Job'],
    defaultValue: 'ConfigMap',
    noExpression: true,
    group: 'Resource',
    showWhen: DEFINE_FORM,
    requiredWhen: DEFINE_FORM,
    retainOnHide: true,
  }),
  {
    ...k8sNameInput("The object's name."),
    group: 'Resource',
    showWhen: DEFINE_FORM,
    requiredWhen: DEFINE_FORM,
    retainOnHide: true,
  },
  param('data', 'Data', 'map', false, 'The keys and values to store. Point a value at a secret variable to keep it out of the config.', {
    group: 'Resource',
    showWhenAll: [DEFINE_FORM, KIND_CONFIGMAP],
  }),
  secretDataInput(SECRET_TYPE_OPAQUE),
  secretDataInput(SECRET_TYPE_TLS, TLS_QUICK_INSERTS),
  secretDataInput(SECRET_TYPE_DOCKERCONFIG, DOCKERCONFIG_QUICK_INSERTS),
  param('secret_type', 'Secret Type', 'string', false, "The Secret's type. Kubernetes fixes this when the Secret is created and will not let it change.", {
    enumValues: ['Opaque', 'kubernetes.io/tls', 'kubernetes.io/dockerconfigjson'],
    defaultValue: 'Opaque',
    noExpression: true,
    group: 'Resource',
    showWhenAll: [DEFINE_FORM, KIND_SECRET],
    retainOnHide: true,
  }),
  param('job_from', 'Job from', 'string', false, 'Run an image you name, or run an existing CronJob now without waiting for its schedule.', {
    enumValues: ['image', 'cronjob'],
    enumLabels: { image: 'Image', cronjob: 'CronJob' },
    defaultValue: 'image',
    noExpression: true,
    group: 'Resource',
    showWhenAll: [DEFINE_FORM, KIND_JOB],
    retainOnHide: true,
  }),
  param('cronjob_name', 'CronJob Name', 'string', false, 'The CronJob to copy. The Job runs the same thing the schedule would have run.', {
    group: 'Resource',
    showWhenAll: [DEFINE_FORM, KIND_JOB, JOB_FROM_CRONJOB],
    requiredWhenAll: [DEFINE_FORM, KIND_JOB, JOB_FROM_CRONJOB],
    retainOnHide: true,
  }),
  param('image', 'Image', 'string', false, 'The container image to run, like busybox:1.28 or registry.example.com/team/app:1.4.2.', {
    group: 'Resource',
    showWhenAll: [DEFINE_FORM, KIND_JOB, JOB_FROM_IMAGE],
    requiredWhenAll: [DEFINE_FORM, KIND_JOB, JOB_FROM_IMAGE],
    retainOnHide: true,
  }),
  param('command', 'Command', 'string', false, 'The command to run in the container. Write it as you would type it in a shell - quotes group arguments.', {
    group: 'Resource',
    showWhenAll: [DEFINE_FORM, KIND_JOB, JOB_FROM_IMAGE],
    retainOnHide: true,
  }),
  param('if_exists', 'If exists', 'string', false, 'Update brings the object to match and can be run again safely. Fail creates it and refuses when it is already there.', {
    enumValues: ['update', 'fail'],
    enumLabels: { update: 'Update', fail: 'Fail' },
    defaultValue: 'update',
    noExpression: true,
    group: 'Resource',
  }),
  applyOutputFormatInput('Map', 'How Result comes back. Map is the applied object, JSON and YAML the same object as text.', DEFINE_FORM),
  applyOutputFormatInput('Array', 'How Result comes back. Array is one applied object per document, JSON and YAML the same objects as text.', DEFINE_MANIFEST),
  // --- Advanced + Failure Handling ---
  ...k8sBlockTailInputs({
    namespace: {
      description: 'Leave empty to use the namespace the session carries. Ignored for cluster-scoped kinds like Namespace. A manifest that names its own namespace wins.',
    },
    impersonateUserDescription: K8S_IMPERSONATE_USER_WRITE_DESCRIPTION,
  }),
]

// Result's declared type is the form case; JSON and YAML win over the manifest array (K8SWRITE-2).
const RESULT_TYPE_WHEN: OutputTypeRule[] = [
  { when: [{ field: 'output_format', values: ['json', 'yaml'] }], type: 'string' },
  { when: [{ field: 'define_with', values: ['manifest'] }], type: 'array' },
]

export const outputs: OutputParam[] = [
  output('summary', 'Summary', 'table', 'One row per object: the resource and what happened to it, as kubectl prints it. Created or configured - a server-side apply cannot tell an unchanged object from a changed one.'),
  output('result', 'Result', 'map', 'What was applied. Its type follows Output Format: a map for a form, an array for a manifest, or text for JSON and YAML.', { typeWhen: RESULT_TYPE_WHEN }),
  output('names', 'Names', 'array', 'The names of the objects applied, in the order they were applied'),
  output('count', 'Count', 'integer', 'How many objects were applied; with a multi-document manifest, how many landed before a failure'),
  ...k8sOutputCore(),
]
