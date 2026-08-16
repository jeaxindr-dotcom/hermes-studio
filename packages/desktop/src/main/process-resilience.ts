export type RendererGoneReason =
  | 'clean-exit'
  | 'abnormal-exit'
  | 'killed'
  | 'crashed'
  | 'oom'
  | 'launch-failed'
  | 'integrity-failure'

export function shouldReloadRendererAfterGone(details: { reason?: string | null }): boolean {
  return details.reason !== 'clean-exit'
}

export function scheduleRendererRecovery(
  recover: () => void,
  schedule: (callback: () => void) => unknown = setImmediate,
): void {
  schedule(recover)
}

export function shouldRestartWebUiAfterExit(input: {
  isQuitting: boolean
  exitCode: number | null
  signal: NodeJS.Signals | string | null
  restartCount: number
  maxRestarts?: number
}): { restart: boolean; delayMs: number } {
  if (input.isQuitting) return { restart: false, delayMs: 0 }
  const unexpected = input.exitCode !== 0 || Boolean(input.signal)
  if (!unexpected) return { restart: false, delayMs: 0 }
  const maxRestarts = input.maxRestarts ?? 5
  if (input.restartCount >= maxRestarts) return { restart: false, delayMs: 0 }
  return {
    restart: true,
    delayMs: Math.min(30_000, 1000 * (2 ** input.restartCount)),
  }
}

export function mergeNodeHeapOptions(existing?: string | null): string {
  const parts = String(existing || '')
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)
  if (parts.some(part => part.startsWith('--max-old-space-size='))) {
    return parts.join(' ')
  }
  parts.push('--max-old-space-size=8192')
  return parts.join(' ')
}
