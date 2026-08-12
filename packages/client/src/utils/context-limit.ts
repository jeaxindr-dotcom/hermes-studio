export const CONTEXT_LIMIT_OPTIONS = [
  4_000,
  8_000,
  16_000,
  32_000,
  64_000,
  128_000,
  256_000,
  512_000,
  1_000_000,
] as const

export const MIN_CONTEXT_LIMIT = CONTEXT_LIMIT_OPTIONS[0]
export const MAX_CONTEXT_LIMIT = CONTEXT_LIMIT_OPTIONS[CONTEXT_LIMIT_OPTIONS.length - 1]

export function contextLimitLabel(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

export function contextLimitFromSliderIndex(index: number): number {
  const rounded = Math.round(Number.isFinite(index) ? index : 0)
  const clamped = Math.min(Math.max(rounded, 0), CONTEXT_LIMIT_OPTIONS.length - 1)
  return CONTEXT_LIMIT_OPTIONS[clamped]
}

export function contextLimitSliderIndex(value: number): number {
  const numeric = Number.isFinite(value) ? value : MIN_CONTEXT_LIMIT
  let bestIndex = 0
  let bestDistance = Math.abs(CONTEXT_LIMIT_OPTIONS[0] - numeric)
  for (let index = 1; index < CONTEXT_LIMIT_OPTIONS.length; index += 1) {
    const distance = Math.abs(CONTEXT_LIMIT_OPTIONS[index] - numeric)
    if (distance < bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
  }
  return bestIndex
}
