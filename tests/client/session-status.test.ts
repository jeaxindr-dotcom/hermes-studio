import { describe, expect, it } from 'vitest'
import { deriveSessionStatus, type SessionStatusSignals } from '@/utils/hermes/session-status'

const base: SessionStatusSignals = {
  hasHistory: true,
  isWorking: false,
  waitingForUser: false,
  hasUnreadReply: false,
  hasError: false,
}

describe('session status derivation', () => {
  it('does not show a dot for an empty chat', () => {
    expect(deriveSessionStatus({ ...base, hasHistory: false })).toBe('none')
  })

  it('uses blue working state while the chat is running', () => {
    expect(deriveSessionStatus({ ...base, isWorking: true })).toBe('working')
  })

  it('uses yellow waiting state when the assistant needs the user', () => {
    expect(deriveSessionStatus({ ...base, isWorking: true, waitingForUser: true })).toBe('waiting')
  })

  it('uses green replied state for an unread assistant response', () => {
    expect(deriveSessionStatus({ ...base, hasUnreadReply: true })).toBe('replied')
  })

  it('keeps an unread reply visible when history metadata is not loaded yet', () => {
    expect(deriveSessionStatus({
      ...base,
      hasHistory: false,
      hasUnreadReply: true,
    })).toBe('replied')
  })

  it('uses purple finished state for an idle non-empty chat', () => {
    expect(deriveSessionStatus(base)).toBe('finished')
  })

  it('gives errors priority over every other state', () => {
    expect(deriveSessionStatus({
      ...base,
      isWorking: true,
      waitingForUser: true,
      hasUnreadReply: true,
      hasError: true,
    })).toBe('error')
  })
})
