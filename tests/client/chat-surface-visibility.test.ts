import { describe, expect, it } from 'vitest'
import {
  registerVisibleChatSurface,
  unregisterVisibleChatSurface,
  visibleChatSessionIds,
} from '@/utils/hermes/chat-surface-visibility'

describe('visible Hermes chat surfaces', () => {
  it('tracks visible sessions without dropping a session still shown by another surface', () => {
    unregisterVisibleChatSurface('surface-a')
    unregisterVisibleChatSurface('surface-b')

    registerVisibleChatSurface('surface-a', 'session-1')
    registerVisibleChatSurface('surface-b', 'session-1')
    expect(visibleChatSessionIds.has('session-1')).toBe(true)

    unregisterVisibleChatSurface('surface-a')
    expect(visibleChatSessionIds.has('session-1')).toBe(true)

    registerVisibleChatSurface('surface-b', 'session-2')
    expect(visibleChatSessionIds.has('session-1')).toBe(false)
    expect(visibleChatSessionIds.has('session-2')).toBe(true)

    unregisterVisibleChatSurface('surface-b')
    expect(visibleChatSessionIds.size).toBe(0)
  })
})
