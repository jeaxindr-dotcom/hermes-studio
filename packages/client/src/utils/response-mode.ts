export type ResponseMode = 'fast' | 'thinking'

/** Map the existing per-session reasoning effort to the simple composer mode. */
export function responseModeFromReasoningEffort(effort?: string | null): ResponseMode {
  return effort === 'none' ? 'fast' : 'thinking'
}

/** Keep a user's detailed thinking level when switching back from Fast. */
export function reasoningEffortForResponseMode(
  mode: ResponseMode,
  currentEffort?: string | null,
): string {
  if (mode === 'fast') return 'none'
  return currentEffort && currentEffort !== 'none' ? currentEffort : 'medium'
}
