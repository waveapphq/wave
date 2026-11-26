// The docs check of a pull request: the template's ticked "No docs change needed" line, or its ticked docs link.
const NO_DOCS_LINE = /^\s*[-*]\s*\[[xX]\]\s*No docs change needed\s*$/m
const DOCS_LINK_LINE =
  /^\s*[-*]\s*\[[xX]\]\s*Docs pull request link:\s*https:\/\/github\.com\/waveapphq\/wave-docs\/pull\/(\d+)\s*$/gim

/** Returns the status of the pull request's docs check as { state, text }. */
module.exports = async function check({ github, pr }) {
  // A release branch of this repo goes into master with no docs branch of its own.
  if (pr.head.ref.startsWith('release/') && pr.head.repo?.full_name === pr.base.repo?.full_name) {
    return { state: 'success', text: 'A release branch needs no docs pull request.' }
  }
  // Repeat until stable so a comment rebuilt by a removal is removed too.
  let body = pr.body ?? ''
  let prev
  do {
    prev = body
    body = body.replace(/<!--[\s\S]*?-->/g, '')
  } while (body !== prev)
  if (NO_DOCS_LINE.test(body)) {
    return { state: 'success', text: 'No docs change needed.' }
  }
  let reason = 'Its description ticks no box and links no docs pull request.'
  let open
  const links = body.matchAll(DOCS_LINK_LINE)
  const numbers = [...new Set([...links].map((m) => Number(m[1])))].slice(0, 20)
  for (const pull_number of numbers) {
    try {
      const { data } = await github.rest.pulls.get({ owner: 'waveapphq', repo: 'wave-docs', pull_number })
      if (data.head.ref !== pr.head.ref) {
        reason = `Docs pull request ${pull_number} is on the branch ${data.head.ref}, not ${pr.head.ref}.`
      } else if (data.merged_at) {
        return { state: 'success', text: `waveapphq/wave-docs#${pull_number} is merged.` }
      } else if (data.state === 'open') {
        open ??= pull_number
      } else {
        reason = `Docs pull request ${pull_number} was closed without a merge.`
      }
    } catch (error) {
      if (error.status !== 404) throw error
      reason = `Docs pull request ${pull_number} was not found.`
    }
  }
  if (open) return { state: 'pending', text: `Waiting for waveapphq/wave-docs#${open} to merge. Re-run this check after the merge.` }
  return { state: 'failure', text: reason }
}
