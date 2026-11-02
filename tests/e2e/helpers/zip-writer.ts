/** Minimal ZIP writer for specs that must hand WAVE an archive whose members they wrote themselves. */

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipMember {
  name: string
  data: Buffer
}

const ZIP_VERSION = 20
const ZIP_UTF8_NAMES = 0x0800
const ZIP_FIRST_DAY = 0x21

/** A zip archive of the given members, each stored uncompressed. */
export function buildZip(members: readonly ZipMember[]): Buffer {
  const files: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0
  for (const member of members) {
    const name = Buffer.from(member.name, 'utf-8')
    const crc = crc32(member.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(ZIP_VERSION, 4)
    local.writeUInt16LE(ZIP_UTF8_NAMES, 6)
    local.writeUInt16LE(ZIP_FIRST_DAY, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(member.data.length, 18)
    local.writeUInt32LE(member.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(ZIP_VERSION, 4)
    entry.writeUInt16LE(ZIP_VERSION, 6)
    entry.writeUInt16LE(ZIP_UTF8_NAMES, 8)
    entry.writeUInt16LE(ZIP_FIRST_DAY, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(member.data.length, 20)
    entry.writeUInt32LE(member.data.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    files.push(local, name, member.data)
    directory.push(entry, name)
    offset += local.length + name.length + member.data.length
  }
  const entries = Buffer.concat(directory)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(members.length, 8)
  end.writeUInt16LE(members.length, 10)
  end.writeUInt32LE(entries.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...files, entries, end])
}
