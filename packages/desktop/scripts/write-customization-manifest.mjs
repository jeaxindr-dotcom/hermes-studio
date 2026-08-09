#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GENERATED_ARTIFACT_PATHS } from '../../../scripts/custom-update-manager.mjs'

const CUSTOM_UPDATE_FEED_URL = 'https://github.com/jeaxindr-dotcom/hermes-studio/releases/latest/download'
const CUSTOM_UPDATE_REPOSITORY = 'https://github.com/jeaxindr-dotcom/hermes-studio'
const UPSTREAM_REPOSITORY = 'https://github.com/EKKOLearnAI/hermes-studio'

function git(repoRoot, args, fallback = '') {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return fallback
  }
}

function packageVersion(repoRoot, desktopRoot) {
  for (const path of [join(desktopRoot, 'package.json'), join(repoRoot, 'package.json')]) {
    if (!existsSync(path)) continue
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'))
      if (typeof value.version === 'string' && value.version.trim()) return value.version.trim()
    } catch {}
  }
  throw new Error('Unable to determine desktop package version')
}

function hashFirstExisting(paths) {
  for (const path of paths) {
    if (!existsSync(path)) continue
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  }
  return null
}

function changedFiles(repoRoot, base, commit) {
  if (!base || !commit) return []
  const output = git(repoRoot, ['diff', '--name-only', '--diff-filter=ACDMRTUXB', base, commit])
  return output.split(/\r?\n/).map(value => value.trim()).filter(Boolean).sort()
}

export function createCustomizationManifest({
  repoRoot = resolve('../../../'),
  desktopRoot = join(repoRoot, 'packages', 'desktop'),
  distRoot = join(repoRoot, 'dist'),
  env = process.env,
  now = new Date(),
} = {}) {
  const root = resolve(repoRoot)
  const desktop = resolve(desktopRoot)
  const dist = resolve(distRoot)
  const desktopVersion = packageVersion(root, desktop)
  const customCommit = String(env.HERMES_STUDIO_CUSTOM_COMMIT || git(root, ['rev-parse', 'HEAD'])).trim()
  const upstreamCommit = String(env.HERMES_STUDIO_UPSTREAM_COMMIT || git(root, ['rev-parse', 'upstream/main'])).trim() || null
  const upstreamBase = String(env.HERMES_STUDIO_UPSTREAM_BASE || upstreamCommit || '').trim() || null
  const upstreamVersion = String(env.HERMES_STUDIO_UPSTREAM_VERSION || desktopVersion).trim()
  const branch = String(env.HERMES_STUDIO_CUSTOM_BRANCH || git(root, ['branch', '--show-current'])).trim() || null
  const clientSha256 = hashFirstExisting([
    join(dist, 'client', 'index.html'),
    join(dist, 'client.js'),
  ])
  const serverSha256 = hashFirstExisting([
    join(dist, 'server', 'index.js'),
    join(dist, 'server.js'),
  ])

  if (!/^[0-9a-f]{40}$/i.test(customCommit)) throw new Error('Custom source commit must be a full 40-character Git SHA')
  if (upstreamCommit && !/^[0-9a-f]{40}$/i.test(upstreamCommit)) throw new Error('Upstream source commit must be a full 40-character Git SHA')
  if (!clientSha256 || !serverSha256) throw new Error(`Built Web UI hashes are missing under ${dist}`)

  return {
    schemaVersion: 1,
    variant: 'hermes-studio-custom',
    desktopVersion,
    update: {
      provider: 'generic',
      feedUrl: CUSTOM_UPDATE_FEED_URL,
      allowOfficialFallback: false,
    },
    source: {
      repository: CUSTOM_UPDATE_REPOSITORY,
      ref: branch,
      commit: customCommit,
    },
    upstream: {
      repository: UPSTREAM_REPOSITORY,
      baseCommit: upstreamCommit,
    },
    upstreamVersion,
    upstreamCommit,
    upstreamBase,
    customCommit,
    customBranch: branch,
    generatedAt: new Date(now).toISOString(),
    clientSha256,
    serverSha256,
    customFiles: changedFiles(root, upstreamBase, customCommit),
    generatedArtifacts: [...GENERATED_ARTIFACT_PATHS],
  }
}

export function writeCustomizationManifest(manifestOrOptions) {
  const input = manifestOrOptions || {}
  const outputPath = input.outputPath
    ? resolve(String(input.outputPath))
    : resolve('packages/desktop/build/customization-manifest.json')
  const manifest = { ...input }
  delete manifest.outputPath
  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return outputPath
}

function main() {
  const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
  const desktopRoot = join(repoRoot, 'packages', 'desktop')
  const manifest = createCustomizationManifest({ repoRoot, desktopRoot, distRoot: join(repoRoot, 'dist') })
  const outputPath = writeCustomizationManifest({
    ...manifest,
    outputPath: join(desktopRoot, 'build', 'customization-manifest.json'),
  })
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, ...manifest }, null, 2)}\n`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath && invokedPath === resolve(fileURLToPath(import.meta.url))) main()
