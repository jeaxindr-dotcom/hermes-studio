#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const UPDATE_REPORT_SCHEMA_VERSION = 1

// These are user data locations. The updater may back them up, but must never
// merge, replace, or delete them as part of a source update.
export const PROTECTED_DATA_PATHS = [
  '%LOCALAPPDATA%\\hermes',
  '%USERPROFILE%\\.hermes-web-ui',
  '%APPDATA%\\hermes-studio',
]

// Generated/package outputs are rebuilt from the merged source. They should not
// be resolved by choosing one side of a textual merge.
export const GENERATED_ARTIFACT_PATHS = [
  'dist/',
  'docs/openapi.json',
  'package-lock.json',
  'packages/desktop/package-lock.json',
  'packages/desktop/release/',
]

export const SEMANTIC_REVIEW_PATHS = [
  'package.json',
  'packages/desktop/package.json',
  'packages/desktop/electron-builder.yml',
  'packages/desktop/src/main/updater.ts',
  '.github/workflows/desktop-',
]

function runGit(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error) throw result.error
  const stdout = String(result.stdout || '')
  const stderr = String(result.stderr || '')
  if (result.status !== 0 && !allowFailure) {
    const detail = stderr.trim() || stdout.trim() || `exit ${String(result.status)}`
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
  return { status: result.status ?? 1, stdout, stderr }
}

function pathMatches(path, patterns) {
  return patterns.some(pattern => pattern.endsWith('/')
    ? path === pattern.slice(0, -1) || path.startsWith(pattern)
    : pattern.endsWith('-')
      ? path.startsWith(pattern)
      : path === pattern)
}

function worktreeStatus(repoRoot) {
  return runGit(repoRoot, ['status', '--porcelain=v1']).stdout
    .split(/\r?\n/)
    .map(value => value.trimEnd())
    .filter(Boolean)
}

function verifyCommit(repoRoot, ref, label) {
  const value = String(ref || '').trim()
  if (!value) throw new Error(`${label} ref is required`)
  const result = runGit(repoRoot, ['rev-parse', '--verify', `${value}^{commit}`])
  return result.stdout.trim()
}

function listChangedFiles(repoRoot, base, ref) {
  const result = runGit(repoRoot, [
    'diff',
    '--name-only',
    '--diff-filter=ACDMRTUXB',
    base,
    ref,
  ])
  return result.stdout
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
    .sort()
}

function parseMergeTreeOutput(output) {
  const lines = String(output || '').split(/\r?\n/)
  const mergedTree = lines.find(line => /^[0-9a-f]{40,64}$/i.test(line.trim()))?.trim() || null
  const conflicts = new Set()

  for (const line of lines) {
    const stagedPath = line.match(/^\d+\s+[0-9a-f]{40,64}\s+[123]\t(.+)$/i)
    if (stagedPath?.[1]) conflicts.add(stagedPath[1].trim())

    const conflictMessage = line.match(/^CONFLICT\s+\([^)]*\):\s+(.+)$/i)
    if (conflictMessage?.[1]) {
      const message = conflictMessage[1].trim()
      const path = message.match(/(?:in|of|with)\s+(.+?)(?:\.|$)/i)?.[1]
      if (path && !path.includes(' and ')) conflicts.add(path.trim())
    }
  }

  return {
    mergedTree,
    conflicts: [...conflicts].sort(),
  }
}

export function prepareThreeWayMerge({ repoRoot, ours, theirs, base: requestedBase } = {}) {
  const root = resolve(String(repoRoot || process.cwd()))
  const repositoryCheck = runGit(root, ['rev-parse', '--show-toplevel'], { allowFailure: true })
  if (repositoryCheck.status !== 0) {
    throw new Error(`Not a Git checkout: ${root}`)
  }

  const workingTree = worktreeStatus(root)
  const oursCommit = verifyCommit(root, ours || 'HEAD', 'ours')
  const theirsCommit = verifyCommit(root, theirs, 'theirs')
  const baseCommit = requestedBase
    ? verifyCommit(root, requestedBase, 'base')
    : runGit(root, ['merge-base', oursCommit, theirsCommit]).stdout.trim()

  if (!baseCommit) throw new Error('Unable to determine a common merge base')

  const oursFiles = listChangedFiles(root, baseCommit, oursCommit)
  const theirsFiles = listChangedFiles(root, baseCommit, theirsCommit)
  const oursSet = new Set(oursFiles)
  const theirsSet = new Set(theirsFiles)
  const bothTouched = oursFiles.filter(file => theirsSet.has(file))
  const oursOnly = oursFiles.filter(file => !theirsSet.has(file))
  const theirsOnly = theirsFiles.filter(file => !oursSet.has(file))

  const merge = runGit(root, [
    'merge-tree',
    '--write-tree',
    '--merge-base',
    baseCommit,
    oursCommit,
    theirsCommit,
  ], { allowFailure: true })
  const parsed = parseMergeTreeOutput(merge.stdout)
  const status = merge.status === 0 ? 'ready' : 'conflict'
  const allTouched = [...new Set([...oursFiles, ...theirsFiles])]
  const generatedTouched = allTouched.filter(file => pathMatches(file, GENERATED_ARTIFACT_PATHS))
  const semanticReview = allTouched.filter(file => pathMatches(file, SEMANTIC_REVIEW_PATHS))
  const safeToMaterialize = status === 'ready'
  const safeToAutoApply = safeToMaterialize
    && workingTree.length === 0
    && generatedTouched.length === 0
    && semanticReview.length === 0

  return {
    schemaVersion: UPDATE_REPORT_SCHEMA_VERSION,
    status,
    safeToMaterialize,
    safeToAutoApply,
    workingTree,
    base: baseCommit,
    ours: oursCommit,
    theirs: theirsCommit,
    mergedTree: safeToMaterialize ? parsed.mergedTree : null,
    conflicts: parsed.conflicts,
    oursOnly,
    theirsOnly,
    bothTouched,
    generatedTouched,
    semanticReview,
    generatedArtifacts: [...GENERATED_ARTIFACT_PATHS],
    protectedDataPaths: [...PROTECTED_DATA_PATHS],
    recommendedAction: status !== 'ready'
      ? 'Resolve conflicts in a temporary worktree, then rerun the validation gates before publishing.'
      : workingTree.length > 0
        ? 'Commit or stash the active checkout before materializing an automatic candidate.'
        : generatedTouched.length > 0
          ? 'Regenerate generated artifacts in the candidate; do not choose either side of their merge.'
          : semanticReview.length > 0
            ? 'Review updater/release logic manually before publishing.'
            : 'Run focused tests, typechecks, build, and native smoke tests before publishing.',
  }
}

export function writeUpdateReport(report, outputPath) {
  const destination = isAbsolute(outputPath) ? outputPath : resolve(outputPath)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return destination
}

export function createCleanMergeWorktree({ repoRoot, ours, theirs, base, worktreePath } = {}) {
  const report = prepareThreeWayMerge({ repoRoot, ours, theirs, base })
  if (report.status !== 'ready') {
    const error = new Error(`Cannot materialize a merge with conflicts: ${report.conflicts.join(', ') || 'unknown files'}`)
    error.report = report
    throw error
  }

  const root = resolve(String(repoRoot || process.cwd()))
  const destination = resolve(String(worktreePath || join(root, '.hermes-update-worktree')))
  mkdirSync(dirname(destination), { recursive: true })
  runGit(root, ['worktree', 'add', '--detach', destination, report.ours])
  try {
    runGit(destination, ['merge', '--no-commit', '--no-ff', '--no-edit', report.theirs])
  } catch (error) {
    runGit(root, ['worktree', 'remove', '--force', destination], { allowFailure: true })
    throw error
  }

  return { ...report, worktreePath: destination }
}

function parseArgs(argv) {
  const args = { command: argv[0] || 'plan' }
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    args[key] = argv[index + 1]?.startsWith('--') ? true : (argv[index + 1] ?? true)
    if (args[key] !== true) index += 1
  }
  return args
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (!['plan', 'report'].includes(args.command)) {
    throw new Error(`Unknown command: ${args.command}. Use plan or report.`)
  }

  const report = prepareThreeWayMerge({
    repoRoot: args.repo || process.cwd(),
    ours: args.ours || 'HEAD',
    theirs: args.theirs || 'upstream/main',
    base: args.base,
  })
  if (args.output) writeUpdateReport(report, args.output)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return report.status === 'ready' ? 0 : 2
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
const modulePath = fileURLToPath(import.meta.url)
if (invokedPath && invokedPath === modulePath) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
