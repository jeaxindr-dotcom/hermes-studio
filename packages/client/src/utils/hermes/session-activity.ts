import type { Message, SubagentStream } from '@/stores/hermes/chat'

export type SessionTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface SessionTodoItem {
  id: string
  content: string
  status: SessionTodoStatus
}

export interface SessionTodoSnapshot {
  items: SessionTodoItem[]
  updatedAt: number
  summary: {
    total: number
    completed: number
    inProgress: number
    pending: number
    cancelled: number
  }
}

function objectPayload(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function todoArray(payload: Record<string, unknown> | null): unknown[] | null {
  if (!payload) return null
  if (Array.isArray(payload.todos)) return payload.todos
  for (const key of ['data', 'result', 'payload']) {
    const nested = objectPayload(payload[key])
    if (nested && Array.isArray(nested.todos)) return nested.todos
  }
  return null
}

function todoStatus(value: unknown): SessionTodoStatus | null {
  const status = String(value || '').trim().toLowerCase()
  if (status === 'pending' || status === 'in_progress' || status === 'completed' || status === 'cancelled') {
    return status
  }
  return null
}

function normalizeTodoItems(values: unknown[]): SessionTodoItem[] {
  const items: SessionTodoItem[] = []
  for (const [index, value] of values.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const raw = value as Record<string, unknown>
    const content = String(raw.content || '').trim()
    const status = todoStatus(raw.status)
    if (!content || !status) continue
    const id = String(raw.id || `task-${index + 1}`).trim() || `task-${index + 1}`
    items.push({ id, content, status })
  }
  return items
}

export function latestTodoSnapshot(messages: Message[]): SessionTodoSnapshot | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'tool' || message.toolName !== 'todo' || message.toolStatus === 'running') continue

    let values: unknown[] | null = null
    for (const candidate of [message.toolResult, message.content, message.toolPreview]) {
      values = todoArray(objectPayload(candidate))
      if (values) break
    }
    if (!values) continue

    const items = normalizeTodoItems(values)
    const completed = items.filter(item => item.status === 'completed').length
    const inProgress = items.filter(item => item.status === 'in_progress').length
    const pending = items.filter(item => item.status === 'pending').length
    const cancelled = items.filter(item => item.status === 'cancelled').length
    return {
      items,
      updatedAt: message.timestamp,
      summary: {
        total: items.length,
        completed,
        inProgress,
        pending,
        cancelled,
      },
    }
  }
  return null
}

export function subagentStreamsForSession(
  streams: Map<string, SubagentStream>,
  sessionId: string | null | undefined,
): SubagentStream[] {
  if (!sessionId) return []
  return [...streams.values()]
    .filter(stream => stream.sessionId === sessionId)
    .sort((a, b) => a.taskIndex - b.taskIndex || a.startedAt - b.startedAt || a.subagentId.localeCompare(b.subagentId))
}
