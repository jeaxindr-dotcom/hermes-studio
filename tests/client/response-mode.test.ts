import { describe, expect, it } from 'vitest'
import {
  chatTemplateKwargsForProvider,
  reasoningEffortForProvider,
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

  it('disables thinking through the TQ3 chat template in Fast mode', () => {
    expect(chatTemplateKwargsForProvider(
      'none',
      'deepseek-tq3',
      'deepseek-v4-flash-r2-tq3_4s',
    )).toEqual({ enable_thinking: false })
    expect(chatTemplateKwargsForProvider(
      'none',
      'local',
      'deepseek-v4-flash-r2',
    )).toEqual({ enable_thinking: false })
  })

  it('does not inject TQ3 template kwargs for other modes or providers', () => {
    expect(chatTemplateKwargsForProvider('low', 'deepseek-tq3', 'deepseek-v4-flash-r2-tq3_4s'))
      .toBeUndefined()
    expect(chatTemplateKwargsForProvider('none', 'openai-codex', 'gpt-5.6-luna'))
      .toBeUndefined()
  })

  it('omits none reasoning_effort for TQ3 Fast mode', () => {
    expect(reasoningEffortForProvider('none', 'deepseek-tq3', 'deepseek-v4-flash-r2-tq3_4s'))
      .toBeUndefined()
    expect(reasoningEffortForProvider('low', 'deepseek-tq3', 'deepseek-v4-flash-r2-tq3_4s'))
      .toBe('low')
    expect(reasoningEffortForProvider('none', 'openai-codex', 'gpt-5.6-luna'))
      .toBe('none')
  })
})
