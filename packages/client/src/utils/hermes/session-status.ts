export type SessionStatus = 'none' | 'working' | 'replied' | 'waiting' | 'finished' | 'error'

export interface SessionStatusSignals {
  hasHistory: boolean
  isWorking: boolean
  waitingForUser: boolean
  hasUnreadReply: boolean
  hasError: boolean
}

/**
 * Derive one visible sidebar state from the authoritative chat signals.
 * Errors and explicit user interaction requests take precedence over run state.
 */
export function deriveSessionStatus(signals: SessionStatusSignals): SessionStatus {
  if (!signals.hasHistory && !signals.hasError && !signals.waitingForUser && !signals.isWorking) {
    return 'none'
  }
  if (signals.hasError) return 'error'
  if (signals.waitingForUser) return 'waiting'
  if (signals.isWorking) return 'working'
  if (signals.hasUnreadReply) return 'replied'
  return 'finished'
}
