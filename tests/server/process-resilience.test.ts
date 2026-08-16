import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shouldExitOnUncaughtException } from '../../packages/server/src/process-resilience'

describe('server process resilience', () => {
  it('keeps the Web UI server alive after a normal uncaught exception', () => {
    expect(shouldExitOnUncaughtException(new Error('socket hang up'))).toBe(false)
    expect(shouldExitOnUncaughtException(new TypeError('Cannot read properties of undefined'))).toBe(false)
  })

  it('still exits on heap exhaustion, which Node cannot recover from', () => {
    expect(shouldExitOnUncaughtException(new Error('JavaScript heap out of memory'))).toBe(true)
    expect(shouldExitOnUncaughtException(new RangeError('Allocation failed - JavaScript heap out of memory'))).toBe(true)
  })

  it('uses the policy in the server entrypoint instead of unconditionally exiting', () => {
    const source = readFileSync(resolve('packages/server/src/index.ts'), 'utf8')
    expect(source).toContain('shouldExitOnUncaughtException')
    expect(source).toContain('if (shouldExitOnUncaughtException(err)) process.exit(1)')
    expect(source).not.toMatch(/uncaughtException[\s\S]{0,80}logger\.fatal[\s\S]{0,40}\n\s*process\.exit\(1\)/)
  })

  it('raises the JSON body limit so long Codex sessions do not die with 413', () => {
    const source = readFileSync(resolve('packages/server/src/middleware/request-body-parser.ts'), 'utf8')
    expect(source).toContain("jsonLimit: '100mb'")
    expect(source).toContain("formLimit: '100mb'")
    expect(source).toContain("textLimit: '100mb'")
  })
})
