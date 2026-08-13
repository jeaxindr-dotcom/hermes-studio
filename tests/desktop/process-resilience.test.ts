import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CUSTOM_UPDATE_FEED_URL } from '../../packages/desktop/src/main/custom-update-manifest'
import {
  mergeNodeHeapOptions,
  shouldReloadRendererAfterGone,
  shouldRestartWebUiAfterExit,
} from '../../packages/desktop/src/main/process-resilience'

describe('desktop process resilience', () => {
  it('reloads the main renderer after crash, OOM, or kill, but not a clean exit', () => {
    expect(shouldReloadRendererAfterGone({ reason: 'crashed' })).toBe(true)
    expect(shouldReloadRendererAfterGone({ reason: 'oom' })).toBe(true)
    expect(shouldReloadRendererAfterGone({ reason: 'killed' })).toBe(true)
    expect(shouldReloadRendererAfterGone({ reason: 'abnormal-exit' })).toBe(true)
    expect(shouldReloadRendererAfterGone({ reason: 'clean-exit' })).toBe(false)
  })

  it('restarts an unexpectedly dead Web UI server with backoff, and stops when quitting', () => {
    expect(shouldRestartWebUiAfterExit({
      isQuitting: true,
      exitCode: 1,
      signal: null,
      restartCount: 0,
    })).toEqual({ restart: false, delayMs: 0 })

    expect(shouldRestartWebUiAfterExit({
      isQuitting: false,
      exitCode: 0,
      signal: null,
      restartCount: 0,
    })).toEqual({ restart: false, delayMs: 0 })

    expect(shouldRestartWebUiAfterExit({
      isQuitting: false,
      exitCode: 1,
      signal: null,
      restartCount: 0,
    })).toEqual({ restart: true, delayMs: 1000 })

    expect(shouldRestartWebUiAfterExit({
      isQuitting: false,
      exitCode: null,
      signal: 'SIGKILL',
      restartCount: 2,
    })).toEqual({ restart: true, delayMs: 4000 })

    expect(shouldRestartWebUiAfterExit({
      isQuitting: false,
      exitCode: 1,
      signal: null,
      restartCount: 5,
    })).toEqual({ restart: false, delayMs: 0 })
  })

  it('pins a larger Node heap for the bundled Web UI without dropping existing flags', () => {
    expect(mergeNodeHeapOptions(undefined)).toContain('--max-old-space-size=8192')
    expect(mergeNodeHeapOptions('--enable-source-maps')).toContain('--max-old-space-size=8192')
    expect(mergeNodeHeapOptions('--max-old-space-size=4096')).toBe('--max-old-space-size=4096')
  })

  it('wires renderer-gone reload and Web UI restart into the packaged desktop main process', () => {
    const main = readFileSync(resolve('packages/desktop/src/main/index.ts'), 'utf8')
    const server = readFileSync(resolve('packages/desktop/src/main/webui-server.ts'), 'utf8')
    expect(main).toContain("webContents.on('render-process-gone'")
    expect(main).toContain('shouldReloadRendererAfterGone')
    expect(server).toContain('shouldRestartWebUiAfterExit')
    expect(server).toContain('mergeNodeHeapOptions')
  })

  it('does not package the official updater URL in electron-builder.yml', () => {
    const yml = readFileSync(resolve('packages/desktop/electron-builder.yml'), 'utf8')
    expect(yml).not.toContain('download.ekkolearnai.com')
    expect(yml).toContain(CUSTOM_UPDATE_FEED_URL)
  })
})
