import { describe, expect, it } from 'vitest'
import type { Message, SubagentStream } from '@/stores/hermes/chat'
import {
  latestTodoSnapshot,
  subagentStreamsForSession,
} from '@/utils/hermes/session-activity'

function toolMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id || 'tool',
    role: 'tool',
    content: '',
    timestamp: overrides.timestamp || 1,
    ...overrides,
  }
}

describe('session activity derivation', () => {
  it('uses the latest valid todo result from the active session messages', () => {
    const messages: Message[] = [
      toolMessage({
        id: 'old',
        toolName: 'todo',
        timestamp: 10,
        toolResult: JSON.stringify({
          todos: [{ id: 'old-task', content: 'Old task', status: 'completed' }],
        }),
      }),
      toolMessage({ id: 'broken', toolName: 'todo', timestamp: 20, toolResult: 'not-json' }),
      toolMessage({
        id: 'latest',
        toolName: 'todo',
        timestamp: 30,
        toolResult: {
          todos: [
            { id: 'robot', content: 'Robot icon', status: 'completed' },
            { id: 'tasks', content: 'Tasks panel', status: 'in_progress' },
            { id: 'code', content: 'Code workspace', status: 'pending' },
            { id: 'ignored', content: '', status: 'pending' },
          ],
        },
      }),
    ]

    const snapshot = latestTodoSnapshot(messages)
    expect(snapshot?.items.map(item => item.id)).toEqual(['robot', 'tasks', 'code'])
    expect(snapshot?.summary).toEqual({
      total: 3,
      completed: 1,
      inProgress: 1,
      pending: 1,
      cancelled: 0,
    })
    expect(snapshot?.updatedAt).toBe(30)
  })

  it('falls back to the previous valid todo result when the newest one is malformed', () => {
    const messages: Message[] = [
      toolMessage({
        id: 'valid',
        toolName: 'todo',
        timestamp: 10,
        toolResult: { todos: [{ id: 'one', content: 'One', status: 'pending' }] },
      }),
      toolMessage({ id: 'invalid', toolName: 'todo', timestamp: 20, toolResult: '{' }),
    ]

    expect(latestTodoSnapshot(messages)?.items[0]?.id).toBe('one')
  })

  it('keeps completed subagents, filters by session and orders by task index', () => {
    const base: Omit<SubagentStream, 'sessionId' | 'subagentId' | 'taskIndex' | 'status'> = {
      taskCount: 2,
      startedAt: 1,
      updatedAt: 2,
      entries: [],
    }
    const streams = new Map<string, SubagentStream>([
      ['session-a:second', { ...base, sessionId: 'session-a', subagentId: 'second', taskIndex: 1, status: 'completed' }],
      ['session-b:other', { ...base, sessionId: 'session-b', subagentId: 'other', taskIndex: 0, status: 'running' }],
      ['session-a:first', { ...base, sessionId: 'session-a', subagentId: 'first', taskIndex: 0, status: 'running' }],
    ])

    expect(subagentStreamsForSession(streams, 'session-a').map(stream => stream.subagentId)).toEqual([
      'first',
      'second',
    ])
    expect(subagentStreamsForSession(streams, null)).toEqual([])
  })
})
