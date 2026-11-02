/** The stack's own config file: where it is, what it holds, and its mode (REQ-4.7.15, REQ-4.7.16). */

import fs from 'fs'
import type { APIRequestContext } from '@playwright/test'
import { BACKEND_URL } from './config'

interface StackPaths {
  configFile: string
  dataFolder: string
}

/** The config file and data folder the stack's backend reports. */
export async function stackPaths(request: APIRequestContext): Promise<StackPaths> {
  const response = await request.get(`${BACKEND_URL}/server/status`)
  if (!response.ok()) throw new Error(`GET /server/status failed: ${response.status()}`)
  const body = await response.json()
  return { configFile: body.config_file, dataFolder: body.data_folder }
}

export function readConfigText(configFile: string): string {
  return fs.readFileSync(configFile, 'utf-8')
}

/** One top-level section of the file, from its `name:` line to the next top-level key. */
export function configSection(configFile: string, name: string): string {
  const lines = readConfigText(configFile).split('\n')
  const start = lines.findIndex((line) => line.startsWith(`${name}:`))
  if (start === -1) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^[^\s#]/.test(line))
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join('\n')
}

/** Run `action` with `target` at `mode`, then put its mode back. */
export async function withMode<T>(target: string, mode: number, action: () => Promise<T>): Promise<T> {
  const previous = fs.statSync(target).mode & 0o777
  fs.chmodSync(target, mode)
  try {
    return await action()
  } finally {
    fs.chmodSync(target, previous)
  }
}
