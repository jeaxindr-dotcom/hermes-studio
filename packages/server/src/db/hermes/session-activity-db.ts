import { existsSync } from 'fs'
import { sessionDbPathForProfile } from './sessions-db'

export type PersistedSubagentStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'interrupted'

export interface PersistedSubagentStream {
  sessionId: string
  subagentId: string
  taskIndex: number
  taskCount: number
  goal?: string
  model?: string
  status: PersistedSubagentStatus
  startedAt: number
  updatedAt: number
  completedAt?: number
  durationSeconds?: number
  toolCount?: number
  apiCalls?: number
  inputTokens?: number
  outputTokens?: number
  summary?: string
  entries: Array<{
    id: string
    kind: 'text' | 'status'
    timestamp: number
    text?: string
    status?: PersistedSubagentStatus | 'started'
  }>
}

export interface PersistedTodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export interface PersistedSessionActivity {
  sessionId: string
  todo: { items: PersistedTodoItem[]; updatedAt: number } | null
  streams: PersistedSubagentStream[]
}

export interface PersistedDelegationRow {
  delegation_id?: unknown
  state?: unknown
  dispatched_at?: unknown
  completed_at?: unknown
  updated_at?: unknown
  event_json?: unknown
  result_json?: unknown
  task_json?: unknown
}

export interface PersistedTodoRow {
  content?: unknown
  timestamp?: unknown
}

function parseObject(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function toTimestamp(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return Date.now()
  return number < 1_000_000_000_000 ? Math.round(number * 1000) : Math.round(number)
}

function normalizeStatus(value: unknown, fallback: PersistedSubagentStatus = 'running'): PersistedSubagentStatus {
  const status = String(value || '').trim().toLowerCase()
  if (status === 'completed' || status === 'failed' || status === 'error' || status === 'cancelled' || status === 'interrupted') {
    return status
  }
  if (status === 'unknown') return 'interrupted'
  return fallback
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean) : []
}

export function mapPersistedDelegationRows(
  sessionId: string,
  rows: PersistedDelegationRow[],
): PersistedSubagentStream[] {
  const streams: PersistedSubagentStream[] = []

  for (const row of rows) {
    const delegationId = String(row.delegation_id || '').trim()
    if (!delegationId) continue
    const event = parseObject(row.event_json) || {}
    const task = parseObject(row.task_json) || {}
    const result = parseObject(row.result_json) || {}
    const goals = stringArray(event.goals).length ? stringArray(event.goals) : stringArray(task.goals)
    const results = Array.isArray(result.results)
      ? result.results
      : Array.isArray(event.results)
        ? event.results
        : []
    const taskCount = Math.max(goals.length, results.length, Number(event.task_count) || 0, 1)
    const startedAt = toTimestamp(row.dispatched_at)
    const updatedAt = toTimestamp(row.updated_at || row.completed_at || row.dispatched_at)
    const rowStatus = normalizeStatus(row.state)

    for (let index = 0; index < taskCount; index += 1) {
      const rawResult = results.find((item: any) => Number(item?.task_index) === index) || results[index] || {}
      const status = normalizeStatus(rawResult.status, rowStatus)
      const summary = String(rawResult.summary || rawResult.error || '').trim()
      const completedAt = status === 'running' ? undefined : toTimestamp(row.completed_at || row.updated_at)
      const toolCount = Array.isArray(rawResult.tool_trace)
        ? rawResult.tool_trace.length
        : Number.isFinite(Number(rawResult.tool_count))
          ? Number(rawResult.tool_count)
          : undefined
      const entries: PersistedSubagentStream['entries'] = [{
        id: `persisted:${delegationId}:${index}:status`,
        kind: 'status',
        timestamp: startedAt,
        status: 'started',
      }]
      if (summary) {
        entries.push({
          id: `persisted:${delegationId}:${index}:summary`,
          kind: 'text',
          timestamp: completedAt || updatedAt,
          text: summary,
        })
      }
      entries.push({
        id: `persisted:${delegationId}:${index}:terminal`,
        kind: 'status',
        timestamp: completedAt || updatedAt,
        status,
      })

      streams.push({
        sessionId,
        subagentId: `persisted:${delegationId}:${index}`,
        taskIndex: index,
        taskCount,
        goal: goals[index] || String(rawResult.goal || event.goal || task.goal || '').trim() || undefined,
        model: String(rawResult.model || '').trim() || undefined,
        status,
        startedAt,
        updatedAt,
        completedAt,
        durationSeconds: Number.isFinite(Number(rawResult.duration_seconds)) ? Number(rawResult.duration_seconds) : undefined,
        toolCount,
        apiCalls: Number.isFinite(Number(rawResult.api_calls)) ? Number(rawResult.api_calls) : undefined,
        inputTokens: Number.isFinite(Number(rawResult.tokens?.input)) ? Number(rawResult.tokens.input) : undefined,
        outputTokens: Number.isFinite(Number(rawResult.tokens?.output)) ? Number(rawResult.tokens.output) : undefined,
        summary: summary || undefined,
        entries,
      })
    }
  }

  return streams.sort((left, right) => right.startedAt - left.startedAt || left.taskIndex - right.taskIndex)
}

function findTodos(value: unknown): unknown[] | null {
  const payload = parseObject(value)
  if (!payload) return null
  if (Array.isArray(payload.todos)) return payload.todos
  for (const key of ['data', 'result', 'payload']) {
    const nested = findTodos(payload[key])
    if (nested) return nested
  }
  return null
}

export function latestPersistedTodo(
  rows: PersistedTodoRow[],
): { items: PersistedTodoItem[]; updatedAt: number } | null {
  for (const row of rows) {
    const rawItems = findTodos(row.content)
    if (!rawItems) continue
    const items: PersistedTodoItem[] = []
    for (const [index, value] of rawItems.entries()) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const raw = value as Record<string, unknown>
      const content = String(raw.content || '').trim()
      const status = String(raw.status || '').trim() as PersistedTodoItem['status']
      if (!content || !['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) continue
      items.push({ id: String(raw.id || `task-${index + 1}`), content, status })
    }
    return { items, updatedAt: toTimestamp(row.timestamp) }
  }
  return null
}

export async function getPersistedSessionActivity(
  sessionId: string,
  profile?: string,
): Promise<PersistedSessionActivity> {
  const id = String(sessionId || '').trim()
  const empty: PersistedSessionActivity = { sessionId: id, todo: null, streams: [] }
  if (!id) return empty
  const dbPath = sessionDbPathForProfile(profile)
  if (!existsSync(dbPath)) return empty

  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbPath, { open: true, readOnly: true })
  try {
    const hasDelegations = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'async_delegations'").get())
    const delegationColumns = hasDelegations
      ? new Set((db.prepare('PRAGMA table_info(async_delegations)').all() as Array<{ name?: unknown }>).map(row => String(row.name || '')))
      : new Set<string>()
    const sessionColumns = ['origin_session', 'origin_ui_session_id', 'parent_session_id', 'origin_session_id']
      .filter(column => delegationColumns.has(column))
    const delegationRows = sessionColumns.length
      ? db.prepare(`
          SELECT delegation_id, state, dispatched_at, completed_at, updated_at, event_json, result_json, task_json
          FROM async_delegations
          WHERE ${sessionColumns.map(column => `${column} = ?`).join(' OR ')}
          ORDER BY dispatched_at DESC
          LIMIT 100
        `).all(...sessionColumns.map(() => id)) as PersistedDelegationRow[]
      : []
    const todoRows = db.prepare(`
      SELECT content, timestamp
      FROM messages
      WHERE session_id = ? AND role = 'tool' AND tool_name = 'todo'
      ORDER BY id DESC
      LIMIT 50
    `).all(id) as PersistedTodoRow[]

    return {
      sessionId: id,
      todo: latestPersistedTodo(todoRows),
      streams: mapPersistedDelegationRows(id, delegationRows),
    }
  } finally {
    db.close()
  }
}
