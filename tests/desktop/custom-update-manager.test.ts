import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GENERATED_ARTIFACT_PATHS,
  PROTECTED_DATA_PATHS,
  prepareThreeWayMerge,
} from '../../scripts/custom-update-manager.mjs'

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function createRepository(): { root: string; base: string; ours: string; theirs: string } {
  const root = mkdtempSync(join(tmpdir(), 'hermes-studio-update-'))
  mkdirSync(join(root, 'packages', 'desktop', 'build'), { recursive: true })
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'user.name', 'Hermes Test')
  writeFileSync(join(root, 'shared.txt'), 'base\n')
  writeFileSync(join(root, 'upstream-only.txt'), 'base\n')
  writeFileSync(join(root, 'packages', 'desktop', 'build', 'generated.txt'), 'base\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'base')
  const base = git(root, 'rev-parse', 'HEAD')

  git(root, 'switch', '-qc', 'ours')
  writeFileSync(join(root, 'shared.txt'), 'base\ncustom\n')
  git(root, 'commit', '-qam', 'custom')
  const ours = git(root, 'rev-parse', 'HEAD')

  git(root, 'switch', '-qc', 'theirs', base)
  writeFileSync(join(root, 'upstream-only.txt'), 'base\nupstream\n')
  writeFileSync(join(root, 'shared.txt'), 'base\nupstream\n')
  git(root, 'commit', '-qam', 'upstream')
  const theirs = git(root, 'rev-parse', 'HEAD')

  return { root, base, ours, theirs }
}

describe('custom update manager', () => {
  it('prepares a conflict report without touching the checkout', () => {
    const fixture = createRepository()
    try {
      const before = readFileSync(join(fixture.root, 'shared.txt'), 'utf8')
      const report = prepareThreeWayMerge({
        repoRoot: fixture.root,
        ours: fixture.ours,
        theirs: fixture.theirs,
        base: fixture.base,
      })

      expect(report.status).toBe('conflict')
      expect(report.safeToMaterialize).toBe(false)
      expect(report.safeToAutoApply).toBe(false)
      expect(report.base).toBe(fixture.base)
      expect(report.ours).toBe(fixture.ours)
      expect(report.theirs).toBe(fixture.theirs)
      expect(report.conflicts).toContain('shared.txt')
      expect(report.theirsOnly).toContain('upstream-only.txt')
      expect(report.generatedArtifacts).toEqual(expect.arrayContaining(GENERATED_ARTIFACT_PATHS))
      expect(report.protectedDataPaths).toEqual(expect.arrayContaining(PROTECTED_DATA_PATHS))
      expect(readFileSync(join(fixture.root, 'shared.txt'), 'utf8')).toBe(before)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('reports a clean merge and its merged tree when changes do not overlap', () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-studio-update-clean-'))
    try {
      git(root, 'init', '-q')
      git(root, 'config', 'user.email', 'test@example.invalid')
      git(root, 'config', 'user.name', 'Hermes Test')
      writeFileSync(join(root, 'shared.txt'), 'base\n')
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'base')
      const base = git(root, 'rev-parse', 'HEAD')
      git(root, 'switch', '-qc', 'ours')
      writeFileSync(join(root, 'shared.txt'), 'base\ncustom\n')
      git(root, 'commit', '-qam', 'custom')
      const ours = git(root, 'rev-parse', 'HEAD')
      git(root, 'switch', '-qc', 'theirs', base)
      writeFileSync(join(root, 'upstream.txt'), 'upstream\n')
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'upstream')
      const theirs = git(root, 'rev-parse', 'HEAD')

      const report = prepareThreeWayMerge({ repoRoot: root, ours, theirs, base })
      expect(report.status).toBe('ready')
      expect(report.safeToMaterialize).toBe(true)
      expect(report.safeToAutoApply).toBe(true)
      expect(report.workingTree).toEqual([])
      expect(report.mergedTree).toMatch(/^[0-9a-f]{40,64}$/)
      expect(report.conflicts).toEqual([])
      expect(report.bothTouched).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('never marks a dirty active checkout safe for automatic application', () => {
    const fixture = createRepository()
    try {
      writeFileSync(join(fixture.root, 'uncommitted.txt'), 'do not overwrite\n')
      const report = prepareThreeWayMerge({
        repoRoot: fixture.root,
        ours: fixture.ours,
        theirs: fixture.theirs,
        base: fixture.base,
      })
      expect(report.workingTree).not.toEqual([])
      expect(report.safeToAutoApply).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('blocks automatic application when a generated artifact changes on only one side', () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-studio-update-generated-'))
    try {
      mkdirSync(join(root, 'packages', 'desktop'), { recursive: true })
      git(root, 'init', '-q')
      git(root, 'config', 'user.email', 'test@example.invalid')
      git(root, 'config', 'user.name', 'Hermes Test')
      writeFileSync(join(root, 'packages', 'desktop', 'package-lock.json'), '{}\n')
      writeFileSync(join(root, 'base.txt'), 'base\n')
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'base')
      const base = git(root, 'rev-parse', 'HEAD')
      git(root, 'switch', '-qc', 'ours')
      writeFileSync(join(root, 'packages', 'desktop', 'package-lock.json'), '{"generated":true}\n')
      git(root, 'commit', '-qam', 'custom generated output')
      const ours = git(root, 'rev-parse', 'HEAD')
      git(root, 'switch', '-qc', 'theirs', base)
      writeFileSync(join(root, 'upstream.txt'), 'upstream\n')
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'upstream source')
      const theirs = git(root, 'rev-parse', 'HEAD')

      const report = prepareThreeWayMerge({ repoRoot: root, ours, theirs, base })
      expect(report.status).toBe('ready')
      expect(report.generatedTouched).toContain('packages/desktop/package-lock.json')
      expect(report.safeToAutoApply).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
