/**
 * Static assertion on the name and single-line value fields.
 *
 * None of the target surfaces may rely on `<Input>` from
 * `@/components/ui/input` (or, in `test-form-dialog.tsx`, a bare
 * `<input className="input">`) for the name + single-line value roles in scope.
 *
 * Reads each production file as text via `fs.readFileSync` and asserts
 * that shape. Multi-line `<textarea>` elements and search-only
 * inputs are explicitly out of scope and are NOT asserted here.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(__dirname, '..', '..', 'src')

function readSrc(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), 'utf8')
}

interface TargetSpec {
  /** Path relative to `frontend/src` */
  path: string
  /** What the file must NOT contain (post-migration). */
  forbidden?: RegExp[]
  /** What the file MUST contain (post-migration). */
  required?: RegExp[]
}

// ---------------------------------------------------------------------------
// Per-surface specs - one per migrated surface.
// ---------------------------------------------------------------------------

const TARGETS: TargetSpec[] = [
  {
    // Shared create modal - both Suite + Regression flow through this.
    // Name uses NameField; description uses the multi-line DescriptionField
    // (matches env/test forms - see DescriptionField migration).
    path: 'components/shared/dialogs/entity-create-modal.tsx',
    forbidden: [
      /from '@\/components\/ui\/input'/,
    ],
    required: [
      /NameField/,
      /DescriptionField/,
      /MAX_ENTITY_NAME_LENGTH/,
    ],
  },
  {
    // Shared metadata-edit dialog - both Suite + Regression flow through this.
    path: 'components/shared/dialogs/edit-details-dialog.tsx',
    forbidden: [
      /from '@\/components\/ui\/input'/,
    ],
    required: [
      /NameField/,
      /DescriptionField/,
      /MAX_ENTITY_NAME_LENGTH/,
    ],
  },
  {
    // Shared variable editor - System + Suite + Regression variable scopes.
    // The NAME field uses NameField; the VALUE column is the injected value cell.
    path: 'components/shared/variable-editor/variable-editor.tsx',
    forbidden: [
      /from '@\/components\/ui\/input'/,
    ],
    required: [
      /NameField/,
      /MAX_VARIABLE_NAME_LENGTH/,
    ],
  },
  {
    // Environment form: name -> NameField; description textarea stays.
    path: 'features/settings/components/environment-form.tsx',
    forbidden: [
      // Description textarea is bare <textarea>, not <Input>.
      /from '@\/components\/ui\/input'/,
      // The duplicated local cap must go.
      /const\s+MAX_NAME_LENGTH\s*=\s*255/,
    ],
    required: [
      /NameField/,
      /MAX_ENTITY_NAME_LENGTH/,
    ],
  },
  {
    // Test form dialog: name bare <input className="input"> -> NameField.
    // Description <textarea> stays (multi-line, out of scope).
    path: 'features/workbench/common/test-form/test-form-dialog.tsx',
    forbidden: [
      // The bare <input ... className="input ..."> for the test name must go.
      /<input\b[^>]*className=`?["{][^"}]*\binput\b/,
    ],
    required: [
      /NameField/,
      /MAX_TEST_NAME_LENGTH/,
    ],
  },
  {
    // Test form helpers: local cap deleted, imports MAX_TEST_NAME_LENGTH.
    path: 'features/workbench/common/test-form/helpers.ts',
    forbidden: [
      /const\s+MAX_NAME_LENGTH\s*=\s*255/,
    ],
    required: [
      /MAX_TEST_NAME_LENGTH/,
    ],
  },
  {
    // Profile metadata: name uses NameField; description uses DescriptionField
    // (multi-line, matches env/test - see DescriptionField migration).
    path: 'features/profiles/components/profile-form-modal/metadata-fields.tsx',
    forbidden: [
      /from '@\/components\/ui\/input'/,
    ],
    required: [
      /NameField/,
      /DescriptionField/,
      /MAX_ENTITY_NAME_LENGTH/,
    ],
  },
  {
    // Profile parameter row: parameter name cell migrated to NameField.
    // Parameter names ARE Python variable names, so they get the same
    // NameField + validation contract as variable manager.
    path: 'features/profiles/components/profile-form-modal/parameter-row.tsx',
    forbidden: [
      /from '@\/components\/ui\/input'/,
    ],
    required: [
      /NameField/,
      /MAX_VARIABLE_NAME_LENGTH/,
    ],
  },
]

describe('migration: no bare/legacy inputs remain in target surfaces', () => {
  for (const target of TARGETS) {
    describe(target.path, () => {
      const source = readSrc(target.path)

      if (target.forbidden) {
        for (const pattern of target.forbidden) {
          it(`does NOT contain forbidden pattern: ${pattern}`, () => {
            expect(source).not.toMatch(pattern)
          })
        }
      }

      if (target.required) {
        for (const pattern of target.required) {
          it(`contains required pattern: ${pattern}`, () => {
            expect(source).toMatch(pattern)
          })
        }
      }
    })
  }
})
