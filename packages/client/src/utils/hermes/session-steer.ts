export function sessionSupportsSteer(session?: {
  source?: string | null
  agent?: string | null
  codingAgentId?: string | null
} | null): boolean {
  if (!session) return false
  if (session.source === 'coding_agent' || session.codingAgentId) return false
  return !['claude', 'codex', 'ekko-agent'].includes(session.agent || '')
}
