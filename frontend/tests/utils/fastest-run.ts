/** Wall-clock ms of the fastest of several runs; a pause on a busy runner only adds time, so the minimum is the real cost. */
export async function fastestRunMs(run: () => unknown, runs = 5): Promise<number> {
  let fastest = Number.POSITIVE_INFINITY
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    await run()
    fastest = Math.min(fastest, performance.now() - start)
  }
  return fastest
}
