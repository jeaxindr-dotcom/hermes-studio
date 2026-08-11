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

/**
 * llama.cpp-tq3 cannot reliably expose a clean final answer when the OpenAI
 * bridge sends reasoning_effort=none: it may put the inline <think> block in
 * content, which Hermes then rejects while parsing the stream. The runtime
 * does produce a normal reasoning_content/final-content split for low.
 *
 * Keep this compatibility rule narrow so Fast keeps its existing semantics for
 * every other provider/model.
 */
export function normalizeReasoningEffortForProvider(
  effort?: string | null,
  provider?: string | null,
  model?: string | null,
): string | undefined {
  const normalizedEffort = effort?.trim() || ''
  if (!normalizedEffort) return undefined

  const target = `${provider || ''} ${model || ''}`.toLowerCase()
  const isTq3Runtime = target.includes('tq3')
    || target.includes('r2-deepseek-v4-flash')

  if (isTq3Runtime && normalizedEffort === 'none') return 'low'
  return normalizedEffort
}
