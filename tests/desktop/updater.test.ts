import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWindowsUpdaterLockError, pendingUpdateDirectories } from '../../packages/desktop/src/main/updater-helpers'

function source(path: string): string {
  return readFileSync(resolve(path), 'utf-8').replaceAll('\r', '')
}

describe('desktop updater helpers', () => {
  it('detects Squirrel locked-exe update failures', async () => {
    expect(isWindowsUpdaterLockError(new Error('Failed to uninstall old application files. Please try running the installer again.: 2'))).toBe(true)
    expect(isWindowsUpdaterLockError(new Error('Squirrel update failed with code 2'))).toBe(true)
    expect(isWindowsUpdaterLockError(new Error('network timeout'))).toBe(false)
  })

  it('includes local and roaming pending update cache directories', async () => {
    const localRoot = 'C:\\Users\\A\\AppData\\Local'
    const roamingRoot = 'C:\\Users\\A\\AppData\\Roaming'
    expect(pendingUpdateDirectories({
      appDataPath: roamingRoot,
      localAppData: localRoot,
      appName: 'Hermes Studio',
    })).toEqual(expect.arrayContaining([
      join(localRoot, 'Hermes Studio-updater', 'pending'),
      join(localRoot, 'hermes-studio-updater', 'pending'),
      join(roamingRoot, 'hermes-studio-updater', 'pending'),
    ]))
  })

  it('checks on startup and from the tray without forcing an update', () => {
    const updaterSource = source('packages/desktop/src/main/updater.ts')
    const manifestSource = source('packages/desktop/src/main/custom-update-manifest.ts')
    const mainSource = source('packages/desktop/src/main/index.ts')

    expect(mainSource).toContain('checkForDesktopUpdates(true)')
    expect(updaterSource).toContain('checkForDesktopUpdates(false)')
    expect(updaterSource).toContain('autoUpdater.autoDownload = false')
    expect(updaterSource).toContain('autoUpdater.autoInstallOnAppQuit = true')
    expect(updaterSource).toContain("buttons: [t('update.download'), t('update.later')]")
    expect(updaterSource).toContain('if (response === 0) {\n    await autoUpdater.downloadUpdate()')
    expect(manifestSource).toContain('jeaxindr-dotcom/hermes-studio/releases/download/custom-latest')
    expect(manifestSource).not.toContain('releases/latest/download')
    expect(manifestSource).toContain('customization-manifest.json')
    expect(manifestSource).not.toContain('EKKOLearnAI/hermes-studio/releases/latest/download')
    expect(manifestSource).not.toContain('download.ekkolearnai.com/latest')
    expect(updaterSource).not.toContain('setInterval(')
  })

  it('gracefully stops the current app before starting a downloaded update', () => {
    const updaterSource = source('packages/desktop/src/main/updater.ts')
    const mainSource = source('packages/desktop/src/main/index.ts')

    expect(mainSource).toContain('async function prepareAppShutdown(): Promise<void>')
    expect(mainSource).toContain('await stopWebUiServer().catch(() => undefined)')
    expect(mainSource).toContain('initAutoUpdater({ beforeQuitAndInstall: prepareAppShutdown })')
    expect(mainSource).toContain('try {\n      await prepareAppShutdown()\n    } finally {\n      app.exit(0)')

    const prepareCurrentInstance = updaterSource.indexOf('await options.beforeQuitAndInstall?.()')
    const stopOtherInstances = updaterSource.indexOf('await stopOtherWindowsAppInstances()', prepareCurrentInstance)
    const startInstaller = updaterSource.indexOf('autoUpdater.quitAndInstall()', stopOtherInstances)
    expect(prepareCurrentInstance).toBeGreaterThan(-1)
    expect(stopOtherInstances).toBeGreaterThan(prepareCurrentInstance)
    expect(startInstaller).toBeGreaterThan(stopOtherInstances)
  })
})
