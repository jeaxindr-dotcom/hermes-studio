import { describe, expect, it } from 'vitest'
import {
  latestPersistedTodo,
  mapPersistedDelegationRows,
} from '../../packages/server/src/db/hermes/session-activity-db'

describe('persisted Hermes session activity', () => {
  it('restores completed subagents from async_delegations rows', () => {
    const streams = mapPersistedDelegationRows('session-1', [{
      delegation_id: 'deleg-1',
      state: 'completed',
      dispatched_at: 1_700_000_000,
      completed_at: 1_700_000_020,
      updated_at: 1_700_000_020,
      event_json: JSON.stringify({ goals: ['Inspecter le projet', 'Écrire les tests'] }),
      result_json: JSON.stringify({
        results: [
          { task_index: 0, status: 'completed', summary: 'Inspection terminée', model: 'model-a', duration_seconds: 12, tool_trace: [{ tool: 'read_file' }] },
          { task_index: 1, status: 'failed', summary: 'Test impossible', model: 'model-b', duration_seconds: 18 },
        ],
      }),
    }])

    expect(streams).toHaveLength(2)
    expect(streams[0]).toMatchObject({
      sessionId: 'session-1',
      subagentId: 'persisted:deleg-1:0',
      taskIndex: 0,
      taskCount: 2,
      goal: 'Inspecter le projet',
      model: 'model-a',
      status: 'completed',
      summary: 'Inspection terminée',
      toolCount: 1,
    })
    expect(streams[0].entries.find(entry => entry.kind === 'text')?.text).toBe('Inspection terminée')
    expect(streams[1].status).toBe('failed')
  })

  it('returns the latest valid persisted todo snapshot and skips malformed rows', () => {
    const todo = latestPersistedTodo([
      { content: '{not-json', timestamp: 300 },
      { content: JSON.stringify({ todos: [{ id: 'a', content: 'Livrer', status: 'completed' }] }), timestamp: 200 },
      { content: JSON.stringify({ todos: [{ id: 'old', content: 'Ancien', status: 'pending' }] }), timestamp: 100 },
    ])

    expect(todo).toEqual({
      items: [{ id: 'a', content: 'Livrer', status: 'completed' }],
      updatedAt: 200_000,
    })
  })
})
