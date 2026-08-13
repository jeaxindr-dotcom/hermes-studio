import { describe, expect, it } from 'vitest'
import { sessionSupportsSteer } from '@/utils/hermes/session-steer'

describe('session steering support', () => {
  it('allows steer on a normal Hermes/bridge session', () => {
    expect(sessionSupportsSteer({ source: 'cli', agent: 'hermes' })).toBe(true)
    expect(sessionSupportsSteer({ source: 'web', agent: '' })).toBe(true)
  })

  it('disables steer on Codex, Claude Code and other coding-agent sessions', () => {
    expect(sessionSupportsSteer({ source: 'coding_agent', agent: 'codex' })).toBe(false)
    expect(sessionSupportsSteer({ source: 'web', agent: 'claude', codingAgentId: 'claude-code' })).toBe(false)
    expect(sessionSupportsSteer({ source: 'web', agent: 'codex' })).toBe(false)
    expect(sessionSupportsSteer(null)).toBe(false)
  })
})
