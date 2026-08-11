import { describe, expect, it } from 'vitest'
import {
  reasoningEffortForResponseMode,
  responseModeFromReasoningEffort,
} from '@/utils/response-mode'

describe('response mode', () => {
  it('maps only explicit none to Fast', () => {
    expect(responseModeFromReasoningEffort('none')).toBe('fast')
    expect(responseModeFromReasoningEffort('')).toBe('thinking')
    expect(responseModeFromReasoningEffort('high')).toBe('thinking')
  })

  it('sets Fast to none', () => {
    expect(reasoningEffortForResponseMode('fast', 'high')).toBe('none')
  })

  it('restores the detailed thinking level when possible', () => {
    expect(reasoningEffortForResponseMode('thinking', 'high')).toBe('high')
    expect(reasoningEffortForResponseMode('thinking', 'none')).toBe('medium')
    expect(reasoningEffortForResponseMode('thinking', '')).toBe('medium')
  })
})
