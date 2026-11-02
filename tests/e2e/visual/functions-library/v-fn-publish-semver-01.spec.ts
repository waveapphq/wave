/**
 * V-FN-PUBLISH-SEMVER-01 + V-FN-PUBLISH-NOBACKPORT-01.
 * REQ: REQ-3.1.2.2 / REQ-3.1.2.5
 *
 * The Function version validator is full semver 2.0.0 (pre-release + build
 * metadata allowed), and a publish must advance past the latest version within
 * its OWN major line (per-major no-backports, VIEW-9): a 1.x target is unconstrained
 * by the 2.x line, but a target at or below its line head (a backport, or a
 * pre-release of an already-released version) is rejected. Both arms are proven
 * against the real backend via the test-independent publish route, plus the nav
 * ordering on the detail page.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { publishLibraryFunction, addLibraryVersion, type SeededLibraryFunction } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const RUN = randomUUID().slice(0, 8)

async function seedV1(request: APIRequestContext, suffix: string): Promise<SeededLibraryFunction> {
  return publishLibraryFunction(request, {
    name: `SemverFn-${RUN}-${suffix}`,
    version: '1.0.0',
    description: 'semver guard',
    changelog: 'Initial',
  })
}

/** POST a version directly so the rejection message is readable. */
async function rawAddVersion(request: APIRequestContext, fn: SeededLibraryFunction, source: string, target: string) {
  return request.post(`${BACKEND_URL}/functions/${fn.functionId}/versions`, {
    data: {
      source_version: source,
      target_version: target,
      draft_definition: {
        name: fn.name,
        description: '',
        tags: [],
        inputs: [],
        outputs: [],
        dependencies: { functions: [], plugins: [] },
        workflow: { nodes: [], edges: [] },
      },
      changelog: `to ${target}`,
      description: '',
      tags: [],
      details: '',
    },
  })
}

test.describe('V-FN-PUBLISH-SEMVER-01: full semver accepted', () => {
  test('the backend accepts a pre-release and a build-metadata version', async ({
    request,
  }) => {
    // The BE validator accepts full semver 2.0.0, so "2.0.0-dev1" and build metadata
    // publish cleanly.
    const preFn = await seedV1(request, 'pre')
    expect(await addLibraryVersion(request, preFn, { sourceVersion: '1.0.0', targetVersion: '2.0.0-dev1' })).toBe(201)

    const buildFn = await seedV1(request, 'build')
    expect(await addLibraryVersion(request, buildFn, { sourceVersion: '1.0.0', targetVersion: '1.5.0+build.7' })).toBe(201)
  })

  test('the nav orders a pre-release just below its release', async ({ page, request }) => {
    // The released 2.0.0 outranks its pre-release
    // 2.0.0-dev1 (release > pre-release in semver-2 precedence). Both publish
    // from the 1.0.0 source so each target strictly advances past the latest.
    const fn = await seedV1(request, 'order')
    expect(await addLibraryVersion(request, fn, { sourceVersion: '1.0.0', targetVersion: '2.0.0-dev1' })).toBe(201)
    expect(await addLibraryVersion(request, fn, { sourceVersion: '1.0.0', targetVersion: '2.0.0' })).toBe(201)

    await page.goto(`/functions/${fn.functionId}`)
    await expect(page.locator('[data-testid="function-detail-page"]')).toBeVisible()

    // Both live under the open major-2 group; 2.0.0 carries Latest, 2.0.0-dev1 does not.
    const release = page.locator('[data-testid="version-nav-item-2.0.0"]')
    const prerelease = page.locator('[data-testid="version-nav-item-2.0.0-dev1"]')
    await expect(release).toBeVisible()
    await expect(prerelease).toBeVisible()
    await expect(release).toContainText('Latest')
    await expect(prerelease).not.toContainText('Latest')

    // The release sits above its pre-release in the nav.
    const releaseY = (await release.boundingBox())?.y ?? 0
    const prereleaseY = (await prerelease.boundingBox())?.y ?? 0
    expect(releaseY, 'release must order above its pre-release').toBeLessThan(prereleaseY)
  })
})

test.describe('V-FN-PUBLISH-NOBACKPORT-01: publish must advance within its major line (VIEW-9)', () => {
  test('a lower major line still accepts versions when a higher major exists', async ({ request }) => {
    // VIEW-9: 1.0.1 can be created even if 2.0.0
    // exists - a 1.x target is unconstrained by the 2.x line.
    const fn = await seedV1(request, 'permajor-allow')
    expect(await addLibraryVersion(request, fn, { sourceVersion: '1.0.0', targetVersion: '2.0.0' })).toBe(201)
    // 1.0.1 advances past the 1.x line head (1.0.0); the 2.x line does not block it.
    expect(await addLibraryVersion(request, fn, { sourceVersion: '1.0.0', targetVersion: '1.0.1' })).toBe(201)
  })

  test('a target at or below the latest IN ITS OWN major line is rejected', async ({ request }) => {
    // VIEW-9: a publish must advance past the line head
    // of the TARGET's major line - blocking a pre-release of an already-released
    // version (within 2.x) and a patch backport (within 1.x).
    const preFn = await seedV1(request, 'permajor-pre')
    expect(await addLibraryVersion(request, preFn, { sourceVersion: '1.0.0', targetVersion: '2.0.0' })).toBe(201)
    // 2.0.0-dev1 sorts below the 2.x line head 2.0.0 -> rejected (per-major message).
    const preResp = await rawAddVersion(request, preFn, '1.0.0', '2.0.0-dev1')
    expect(preResp.status(), 'pre-release of an existing release is rejected').toBe(422)
    expect(JSON.stringify(await preResp.json())).toContain(
      "must be greater than the latest version '2.0.0' in the 2.x line",
    )

    // Seed the 1.x line head at 1.0.2, then a 1.0.1 backport within 1.x is rejected.
    const backFn = await seedV1(request, 'permajor-back')
    expect(await addLibraryVersion(request, backFn, { sourceVersion: '1.0.0', targetVersion: '1.0.2' })).toBe(201)
    const backResp = await rawAddVersion(request, backFn, '1.0.0', '1.0.1')
    expect(backResp.status(), 'a backport within the same major line is rejected').toBe(422)
    expect(JSON.stringify(await backResp.json())).toContain(
      "must be greater than the latest version '1.0.2' in the 1.x line",
    )
  })
})
