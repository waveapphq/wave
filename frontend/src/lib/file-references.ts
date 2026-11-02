/**
 * WAVE-side file references: the artifact:// and testdata:// schemes and the
 * folder + name split the save-as picker composes.
 */

export const ARTIFACT_SCHEME = 'artifact://'
export const TESTDATA_SCHEME = 'testdata://'
const WAVE_SIDE_SCHEMES: readonly string[] = [ARTIFACT_SCHEME, TESTDATA_SCHEME]

function schemePrefix(value: string): string {
  return WAVE_SIDE_SCHEMES.find((scheme) => value.startsWith(scheme)) ?? ''
}

export function buildTestDataReference(path: string): string {
  return `${TESTDATA_SCHEME}${path}`
}

export function buildArtifactReference(path: string): string {
  return `${ARTIFACT_SCHEME}${path}`
}

export interface ReferenceParts {
  folder: string
  name: string
}

/** Splits at the last separator; the folder keeps its scheme, a bare name has an empty folder. */
export function splitReference(value: string): ReferenceParts {
  const prefix = schemePrefix(value)
  const rest = value.slice(prefix.length)
  const cut = rest.lastIndexOf('/')
  return { folder: prefix + rest.slice(0, Math.max(cut, 0)), name: rest.slice(cut + 1) }
}

/** Inverse of splitReference: a scheme root or "/" folder already ends with its separator. */
export function joinReference(folder: string, name: string): string {
  if (folder === '' || folder.endsWith('/')) {
    return folder + name
  }
  return `${folder}/${name}`
}
