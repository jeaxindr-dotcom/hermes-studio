export type ResponseMode = 'fast' | 'thinking'

function isTq3Runtime(provider?: string | null, model?: string | null): boolean {
  const target = `${provider || ''} ${model || ''}`.toLowerCase()
  return target.includes('tq3')
    || target.includes('deepseek-v4-flash-r2')
    || target.includes('r2-deepseek-v4-flash')
}

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
 * TQ3 needs the llama.cpp-specific chat-template switch for a genuinely
 * non-thinking request. Sending only reasoning_effort=none can leave an
 * inline <think> block in content, which Hermes rejects while parsing.
 *
 * Keep this compatibility rule narrow so other providers keep their normal
 * OpenAI reasoning semantics.
 */
export function chatTemplateKwargsForProvider(
  effort?: string | null,
  provider?: string | null,
  model?: string | null,
): Record<string, unknown> | undefined {
  const normalizedEffort = effort?.trim() || ''
  if (isTq3Runtime(provider, model) && normalizedEffort === 'none') {
    return { enable_thinking: false }
  }
  return undefined
}

/** llama.cpp-tq3 must not receive reasoning_effort=none alongside its
 * chat-template no-thinking switch; omit the OpenAI reasoning field entirely. */
export function reasoningEffortForProvider(
  effort?: string | null,
  provider?: string | null,
  model?: string | null,
): string | undefined {
  const normalizedEffort = effort?.trim() || ''
  if (isTq3Runtime(provider, model) && normalizedEffort === 'none') return undefined
  return normalizedEffort || undefined
}
