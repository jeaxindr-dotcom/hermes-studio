import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createCustomizationManifest,
  writeCustomizationManifest,
} from '../../packages/desktop/scripts/write-customization-manifest.mjs'

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

describe('customization manifest writer', () => {
  it('pins the custom release workflow metadata to the official version tag', () => {
    const workflow = readFileSync(resolve('.github/workflows/custom-release.yml'), 'utf8')
    expect(workflow).toContain('UPSTREAM_VERSION_TAG="v${DESKTOP_VERSION}"')
    expect(workflow).toContain('git fetch --no-tags upstream "refs/tags/${UPSTREAM_VERSION_TAG}:refs/tags/${UPSTREAM_VERSION_TAG}"')
    expect(workflow).toContain('UPSTREAM_COMMIT=$(git rev-parse "${UPSTREAM_VERSION_TAG}^{commit}")')
    expect(workflow).toContain('HERMES_STUDIO_UPSTREAM_VERSION: ${{ env.DESKTOP_VERSION }}')
    expect(workflow).not.toContain('UPSTREAM_COMMIT=$(git rev-parse upstream/main)')
  })

  it('records the upstream/custom commits and bundle hashes without user data paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'hermes-custom-manifest-'))
    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.6.40' }))
      writeFileSync(join(root, 'client.js'), 'client-build')
      writeFileSync(join(root, 'server.js'), 'server-build')
      git(root, 'init', '-q')
      git(root, 'config', 'user.email', 'test@example.invalid')
      git(root, 'config', 'user.name', 'Hermes Test')
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'custom')

      const manifest = createCustomizationManifest({
        repoRoot: root,
        desktopRoot: root,
        distRoot: root,
        env: {
          HERMES_STUDIO_CUSTOM_COMMIT: 'a'.repeat(40),
          HERMES_STUDIO_UPSTREAM_COMMIT: 'b'.repeat(40),
          HERMES_STUDIO_UPSTREAM_VERSION: '0.6.40',
        },
        now: new Date('2026-08-09T20:00:00.000Z'),
      })
      expect(manifest).toMatchObject({
        schemaVersion: 1,
        variant: 'hermes-studio-custom',
        desktopVersion: '0.6.40',
        upstreamVersion: '0.6.40',
        customCommit: 'a'.repeat(40),
        upstreamCommit: 'b'.repeat(40),
        generatedAt: '2026-08-09T20:00:00.000Z',
      })
      expect(manifest.clientSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(manifest.serverSha256).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(manifest)).not.toContain('LOCALAPPDATA')
      expect(JSON.stringify(manifest)).not.toContain('credentials')

      const output = writeCustomizationManifest({
        ...manifest,
        outputPath: join(root, 'build', 'customization-manifest.json'),
      })
      expect(readFileSync(output, 'utf8')).toContain('"variant": "hermes-studio-custom"')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
