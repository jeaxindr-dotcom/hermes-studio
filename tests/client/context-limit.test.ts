import { describe, expect, it } from 'vitest'
import {
  CONTEXT_LIMIT_OPTIONS,
  MAX_CONTEXT_LIMIT,
  contextLimitFromSliderIndex,
  contextLimitLabel,
  contextLimitSliderIndex,
} from '@/utils/context-limit'

describe('context limit slider', () => {
  it('offers discrete context sizes up to exactly 1M', () => {
    expect(CONTEXT_LIMIT_OPTIONS).toEqual([
      4_000,
      8_000,
      16_000,
      32_000,
      64_000,
      128_000,
      256_000,
      512_000,
      1_000_000,
    ])
    expect(MAX_CONTEXT_LIMIT).toBe(1_000_000)
    expect(contextLimitLabel(1_000_000)).toBe('1M')
    expect(contextLimitLabel(256_000)).toBe('256k')
  })

  it('maps slider positions to limits and clamps invalid positions', () => {
    expect(contextLimitFromSliderIndex(0)).toBe(4_000)
    expect(contextLimitFromSliderIndex(8)).toBe(1_000_000)
    expect(contextLimitFromSliderIndex(99)).toBe(1_000_000)
    expect(contextLimitFromSliderIndex(-1)).toBe(4_000)
    expect(contextLimitSliderIndex(4_000)).toBe(0)
    expect(contextLimitSliderIndex(300_000)).toBe(6)
    expect(contextLimitSliderIndex(2_000_000)).toBe(8)
  })
})
