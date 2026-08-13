export function shouldExitOnUncaughtException(err: unknown): boolean {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err || '')
  return /heap out of memory|allocation failed/i.test(message)
}
