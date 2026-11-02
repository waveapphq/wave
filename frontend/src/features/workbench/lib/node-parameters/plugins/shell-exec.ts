/**
 * Shell Exec Plugin Parameters
 */

import { group, param, type GroupMeta, type InputParam, type OutputParam } from '../types'
import {
  localProcessEnvInput,
  localProcessExecutionInputs,
  localProcessFailureInputs,
  localProcessGroups,
  localProcessOutputs,
  localProcessStopPatternInputs,
} from './_local-process-params'

export const groups: Record<string, GroupMeta> = localProcessGroups(
  group('Command', { description: 'The command line and the shell that runs it' }),
  'command',
)

export const inputs: InputParam[] = [
  // --- Command ---
  param('command', 'Command', 'string', true, 'One command line, run as <shell> -c <command>, so pipes, redirects, globs and && work. For example kubectl get pods -A | grep -c Running.', {
    group: 'Command',
  }),
  param('shell', 'Shell', 'string', false, 'The shell that runs the command. It may include flags, for example /bin/bash -o pipefail.', {
    defaultValue: '/bin/sh',
    group: 'Command',
  }),
  // --- Variables / Execution / Stop on Pattern / Failure Handling ---
  localProcessEnvInput('env_vars', 'Input Variables', 'command'),
  ...localProcessExecutionInputs('command'),
  ...localProcessStopPatternInputs('command'),
  ...localProcessFailureInputs(),
]

export const outputs: OutputParam[] = localProcessOutputs(
  'command',
  'NonZeroExit, Timeout, FailPattern or StartFailed',
)
