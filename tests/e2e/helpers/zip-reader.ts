/**
 * Minimal ZIP reader for specs that must assert what an archive actually
 * carries - member names and member bytes - rather than only its PK magic.
 *
 * Reads the central directory, so the sizes are the archive's own and a
 * streamed member with a data descriptor is still readable. Handles the two
 * compression methods WAVE writes: stored and deflate.
 */

import zlib from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const EOCD_FIXED_BYTES = 22
const CENTRAL_FIXED_BYTES = 46
const LOCAL_FIXED_BYTES = 30
const MAX_COMMENT_BYTES = 0xffff
const METHOD_STORED = 0
const METHOD_DEFLATE = 8

export interface ZipEntry {
  /** The member's archive name, e.g. `testdata/<test id>/fixtures/orders.json`. */
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const floor = Math.max(0, buffer.length - EOCD_FIXED_BYTES - MAX_COMMENT_BYTES)
  for (let at = buffer.length - EOCD_FIXED_BYTES; at >= floor; at--) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at
  }
  throw new Error('not a ZIP archive: no end-of-central-directory record')
}

/** Every member of the archive, in central-directory order. */
export function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocd = findEndOfCentralDirectory(buffer)
  const count = buffer.readUInt16LE(eocd + 10)
  let at = buffer.readUInt32LE(eocd + 16)

  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt ZIP: central directory entry ${i} has no signature`)
    }
    const nameLength = buffer.readUInt16LE(at + 28)
    const extraLength = buffer.readUInt16LE(at + 30)
    const commentLength = buffer.readUInt16LE(at + 32)
    entries.push({
      name: buffer.toString('utf8', at + CENTRAL_FIXED_BYTES, at + CENTRAL_FIXED_BYTES + nameLength),
      method: buffer.readUInt16LE(at + 10),
      compressedSize: buffer.readUInt32LE(at + 20),
      uncompressedSize: buffer.readUInt32LE(at + 24),
      localHeaderOffset: buffer.readUInt32LE(at + 42),
    })
    at += CENTRAL_FIXED_BYTES + nameLength + extraLength + commentLength
  }
  return entries
}

/** Just the member names, in central-directory order. */
export function zipEntryNames(buffer: Buffer): string[] {
  return listZipEntries(buffer).map((entry) => entry.name)
}

/** The decompressed bytes of one member, named exactly. */
export function readZipEntry(buffer: Buffer, name: string): Buffer {
  const entries = listZipEntries(buffer)
  const entry = entries.find((candidate) => candidate.name === name)
  if (!entry) {
    throw new Error(
      `archive has no member "${name}". Members: ${entries.map((e) => e.name).join(', ')}`,
    )
  }

  const local = entry.localHeaderOffset
  if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new Error(`corrupt ZIP: member "${name}" has no local header`)
  }
  const start =
    local + LOCAL_FIXED_BYTES + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
  const raw = buffer.subarray(start, start + entry.compressedSize)

  if (entry.method === METHOD_STORED) return Buffer.from(raw)
  if (entry.method === METHOD_DEFLATE) return zlib.inflateRawSync(raw)
  throw new Error(`member "${name}" uses unsupported compression method ${entry.method}`)
}

/** The UTF-8 text of one member, named exactly. */
export function readZipEntryText(buffer: Buffer, name: string): string {
  return readZipEntry(buffer, name).toString('utf-8')
}
