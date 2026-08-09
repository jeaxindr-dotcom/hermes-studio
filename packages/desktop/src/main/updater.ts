import { app, dialog } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater'
import { execFile } from 'node:child_process'
import { request as httpsRequest } from 'node:https'
import { rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import { URL } from 'node:url'
import { t } from './desktop-i18n'
import { customizationManifestUrl, CUSTOM_UPDATE_FEED_URL, CUSTOM_UPDATE_TRUSTED_HOSTS, validateCustomizationManifest } from './custom-update-manifest'
import { isWindowsUpdaterLockError, pendingUpdateDirectories } from './updater-helpers'

let initialized = false
let checking = false
let downloadedUpdate: UpdateDownloadedEvent | null = null
let recoveringPendingUpdate = false
let pendingUpdateValidation: Promise<void> | null = null

const MANIFEST_MAX_BYTES = 1024 * 1024
const MANIFEST_REQUEST_TIMEOUT_MS = 10_000

const execFileAsync = promisify(execFile)

interface AutoUpdaterOptions {
  beforeQuitAndInstall?: () => void | Promise<void>
}

let options: AutoUpdaterOptions = {}

function configureUpdateFeed(url: string): void {
  autoUpdater.setFeedURL({
    provider: 'generic',
    url,
  })
}

function fetchJson(url: string, redirectCount = 0): Promise<unknown> {
  const requestUrl = new URL(url)
  if (requestUrl.protocol !== 'https:' || !CUSTOM_UPDATE_TRUSTED_HOSTS.includes(requestUrl.hostname as typeof CUSTOM_UPDATE_TRUSTED_HOSTS[number])) {
    return Promise.reject(new Error('Customization manifest redirect left the trusted HTTPS release hosts.'))
  }
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Hermes-Studio-Custom-Updater',
      },
    }, response => {
      const status = response.statusCode || 0
      const location = response.headers.location
      if (status >= 300 && status < 400 && location) {
        response.resume()
        if (redirectCount >= 5) {
          reject(new Error('Too many redirects while reading the customization manifest.'))
          return
        }
        fetchJson(new URL(location, url).toString(), redirectCount + 1).then(resolve, reject)
        return
      }

      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (Buffer.byteLength(body, 'utf8') > MANIFEST_MAX_BYTES) {
          response.destroy()
          reject(new Error('Customization manifest is too large.'))
        }
      })
      response.on('end', () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`Customization manifest request failed with HTTP ${status}.`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch {
          reject(new Error('Customization manifest is not valid JSON.'))
        }
      })
    })
    request.setTimeout(MANIFEST_REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('Customization manifest request timed out.'))
    })
    request.on('error', reject)
    request.end()
  })
}

async function verifyCustomUpdateManifest(info: UpdateInfo): Promise<void> {
  const manifest = await fetchJson(customizationManifestUrl(CUSTOM_UPDATE_FEED_URL))
  const validation = validateCustomizationManifest(manifest, info.version)
  if (!validation.ok) throw new Error(validation.reason)
  console.log(`[updater] validated Hermes Studio Custom update ${info.version}`)
}

async function checkForUpdates(): Promise<void> {
  configureUpdateFeed(CUSTOM_UPDATE_FEED_URL)
  await autoUpdater.checkForUpdates()
}

function showUpToDate(info?: UpdateInfo) {
  const version = info?.version || app.getVersion()
  dialog.showMessageBox({
    type: 'info',
    title: t('update.upToDateTitle'),
    message: t('update.upToDateMessage'),
    detail: t('update.currentVersion', { version }),
    buttons: [t('common.ok')],
  }).catch(() => undefined)
}

function showUpdateCheckFailed() {
  dialog.showMessageBox({
    type: 'error',
    title: t('update.failedTitle'),
    message: t('update.failedMessage'),
    buttons: [t('common.ok')],
  }).catch(() => undefined)
}

async function clearPendingUpdateDirectories(): Promise<void> {
  if (process.platform !== 'win32') return
  const dirs = pendingUpdateDirectories({
    appDataPath: app.getPath('appData'),
    localAppData: process.env.LOCALAPPDATA,
    appName: app.getName(),
  })
  await Promise.all(dirs.map(async dir => {
    try {
      await rm(dir, { recursive: true, force: true })
      console.warn(`[updater] cleared pending update directory: ${dir}`)
    } catch (err) {
      console.warn(`[updater] failed to clear pending update directory ${dir}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }))
}

async function recoverFailedPendingUpdate(err: unknown): Promise<void> {
  if (recoveringPendingUpdate || process.platform !== 'win32' || !isWindowsUpdaterLockError(err)) return
  recoveringPendingUpdate = true
  try {
    await clearPendingUpdateDirectories()
    downloadedUpdate = null
  } finally {
    recoveringPendingUpdate = false
  }
}

export async function stopOtherWindowsAppInstances(execPath = process.execPath, currentPid = process.pid): Promise<void> {
  if (process.platform !== 'win32') return
  const normalizedExecPath = execPath.trim()
  if (!normalizedExecPath) return
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$target = [System.IO.Path]::GetFullPath($env:HERMES_STUDIO_UPDATE_EXE)
$current = [int]$env:HERMES_STUDIO_UPDATE_PID
function Get-HermesStudioProcess {
  Get-CimInstance Win32_Process | Where-Object {
    try {
      $_.ProcessId -ne $current -and $_.ExecutablePath -and ([System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target)
    } catch {
      $false
    }
  }
}
Get-HermesStudioProcess | ForEach-Object {
  try {
    $process = Get-Process -Id $_.ProcessId
    if ($process) { $process.CloseMainWindow() | Out-Null }
  } catch {}
}
Start-Sleep -Milliseconds 750
Get-HermesStudioProcess | ForEach-Object {
  try { Stop-Process -Id $_.ProcessId -Force } catch {}
}
`.trim()
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      env: {
        ...process.env,
        HERMES_STUDIO_UPDATE_EXE: normalizedExecPath,
        HERMES_STUDIO_UPDATE_PID: String(currentPid),
      },
      timeout: 30_000,
      windowsHide: true,
    })
    console.log(`[updater] stopped other ${basename(normalizedExecPath)} instances before update install`)
  } catch (err) {
    console.warn(`[updater] failed to stop other app instances before update install: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function prepareQuitAndInstall(): Promise<void> {
  try {
    await options.beforeQuitAndInstall?.()
  } catch (err) {
    console.warn(`[updater] beforeQuitAndInstall hook failed: ${err instanceof Error ? err.message : String(err)}`)
  }
  await stopOtherWindowsAppInstances()
}

async function quitAndInstallDownloadedUpdate(): Promise<void> {
  await prepareQuitAndInstall()
  autoUpdater.quitAndInstall()
}

async function promptInstallDownloadedUpdate(info: UpdateInfo): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: t('update.readyTitle'),
    message: t('update.readyMessage', { version: info.version }),
    detail: t('update.readyDetail'),
    buttons: [t('update.restartNow'), t('update.later')],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    await quitAndInstallDownloadedUpdate()
  }
}

async function promptDownloadAvailableUpdate(info: UpdateInfo): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: t('update.availableTitle'),
    message: t('update.availableMessage', { version: info.version }),
    detail: t('update.availableDetail'),
    buttons: [t('update.download'), t('update.later')],
    defaultId: 0,
    cancelId: 1,
  })
  if (response === 0) {
    await autoUpdater.downloadUpdate()
  }
}

export function initAutoUpdater(nextOptions: AutoUpdaterOptions = {}) {
  options = { ...options, ...nextOptions }
  if (initialized) return
  initialized = true

  if (!app.isPackaged) return // dev mode: skip

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', info => {
    console.log(`[updater] custom update available: ${info.version}`)
    pendingUpdateValidation = verifyCustomUpdateManifest(info)
      .then(() => promptDownloadAvailableUpdate(info))
      .catch(err => {
        console.error('[updater] rejected unvalidated custom update:', err)
        if (checking) showUpdateCheckFailed()
        throw err
      })
    pendingUpdateValidation.catch(() => undefined)
  })
  autoUpdater.on('update-not-available', info => {
    console.log('[updater] up to date')
    if (checking) showUpToDate(info)
  })
  autoUpdater.on('error', err => {
    console.error('[updater] error:', err)
    recoverFailedPendingUpdate(err).catch(cleanupErr => {
      console.warn(`[updater] pending update recovery failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`)
    })
    if (checking) showUpdateCheckFailed()
  })
  autoUpdater.on('download-progress', (info: ProgressInfo) => {
    console.log(`[updater] download ${Math.round(info.percent)}%`)
  })
  autoUpdater.on('update-downloaded', async (info: UpdateDownloadedEvent) => {
    downloadedUpdate = info
    await promptInstallDownloadedUpdate(info)
  })

  if (process.env.HERMES_DESKTOP_ENABLE_AUTO_UPDATE !== 'false') {
    checkForDesktopUpdates(false).catch(err => {
      console.error('[updater] initial check failed:', err)
    })
  }
}

export async function checkForDesktopUpdates(manual: boolean): Promise<void> {
  if (!app.isPackaged) {
    if (manual) {
      await dialog.showMessageBox({
        type: 'info',
        title: t('update.checkingTitle'),
        message: t('update.packagedOnlyMessage'),
        buttons: [t('common.ok')],
      })
    }
    return
  }

  if (downloadedUpdate) {
    if (manual) await promptInstallDownloadedUpdate(downloadedUpdate)
    return
  }

  if (manual) {
    await dialog.showMessageBox({
      type: 'info',
      title: t('update.checkingTitle'),
      message: t('update.checkingMessage'),
      buttons: [t('common.ok')],
    })
  }

  checking = manual
  try {
    await checkForUpdates()
    if (pendingUpdateValidation) await pendingUpdateValidation
  } catch (err) {
    if (manual) showUpdateCheckFailed()
    throw err
  } finally {
    checking = false
    pendingUpdateValidation = null
  }
}
