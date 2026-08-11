import { describe, expect, it } from 'vitest'
import {
  normalizeReasoningEffortForProvider,
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

  it('uses the TQ3-compatible low level instead of inline-think none', () => {
    expect(normalizeReasoningEffortForProvider(
      'none',
      'deepseek-tq3',
      'deepseek-v4-flash-r2-tq3_4s',
    )).toBe('low')
    expect(normalizeReasoningEffortForProvider(
      'none',
      'custom:deepseek-v4-tq3-local',
      'deepseek-v4-flash-r2-tq3_4s',
    )).toBe('low')
  })

  it('does not change none for non-TQ3 providers', () => {
    expect(normalizeReasoningEffortForProvider('none', 'openai-codex', 'gpt-5.6-luna'))
      .toBe('none')
    expect(normalizeReasoningEffortForProvider('', 'deepseek-tq3', 'deepseek-v4-flash-r2-tq3_4s'))
      .toBeUndefined()
  })
})
