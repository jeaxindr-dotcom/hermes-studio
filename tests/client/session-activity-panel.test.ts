// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message, SubagentStream } from '@/stores/hermes/chat'

const openSubagentStream = vi.hoisted(() => vi.fn())
const messages: Message[] = [{
  id: 'todo-result',
  role: 'tool',
  content: '',
  timestamp: 10,
  toolName: 'todo',
  toolStatus: 'done',
  toolResult: {
    todos: [
      { id: 'done', content: 'Robot icon', status: 'completed' },
      { id: 'current', content: 'Tasks panel', status: 'in_progress' },
      { id: 'next', content: 'Code workspace', status: 'pending' },
    ],
  },
}]

const streamBase: Omit<SubagentStream, 'subagentId' | 'taskIndex' | 'status'> = {
  sessionId: 'session-1',
  taskCount: 2,
  startedAt: 1,
  updatedAt: 2,
  entries: [],
}
const streams = new Map<string, SubagentStream>([
  ['session-1:child-1', { ...streamBase, subagentId: 'child-1', taskIndex: 0, status: 'running', goal: 'Research the navigation' }],
  ['session-1:child-2', { ...streamBase, subagentId: 'child-2', taskIndex: 1, status: 'completed', goal: 'Review the design' }],
])

vi.mock('@/stores/hermes/chat', () => ({
  useChatStore: () => ({
    activeSessionId: 'session-1',
    messages,
    subagentStreams: streams,
  }),
}))

vi.mock('@/utils/hermes/subagent-stream', () => ({ openSubagentStream }))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => ({
      'activity.tasks': 'Tasks',
      'activity.agents': 'Sous-agents',
      'activity.noTasks': 'Aucune tâche',
      'activity.noAgents': 'Aucun sous-agent',
      'activity.delegationRoot': 'Délégation principale',
      'activity.agent': `Agent ${params?.index || ''}`,
      'activity.running': 'En cours',
      'activity.completed': 'Terminé',
      'activity.failed': 'Échec',
      'activity.cancelled': 'Annulé',
      'activity.interrupted': 'Interrompu',
    } as Record<string, string>)[key] || key,
  }),
}))

const TooltipStub = defineComponent({
  template: '<div><slot name="trigger" /><slot /></div>',
})

import SessionActivityPanel from '@/components/hermes/chat/SessionActivityPanel.vue'

describe('SessionActivityPanel', () => {
  beforeEach(() => {
    openSubagentStream.mockReset()
    localStorage.clear()
  })

  it('routes the mouse wheel to the visible Tasks scroller', async () => {
    const wrapper = mount(SessionActivityPanel, {
      global: { stubs: { NTooltip: TooltipStub } },
    })
    const content = wrapper.get('.activity-content').element as HTMLElement
    Object.defineProperty(content, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 320 })
    content.scrollTop = 0

    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 80,
    })
    content.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    expect(content.scrollTop).toBe(80)
    expect(event.defaultPrevented).toBe(true)
  })

  it('shows the real task progress and keeps completed subagents inspectable', async () => {
    const wrapper = mount(SessionActivityPanel, {
      global: { stubs: { NTooltip: TooltipStub } },
    })

    expect(wrapper.get('.activity-progress-count').text()).toBe('1/3')
    expect(wrapper.findAll('.activity-task-row')).toHaveLength(3)
    expect(wrapper.get('.activity-task-row--in_progress').text()).toContain('Tasks panel')

    await wrapper.get('[aria-label="Sous-agents"]').trigger('click')
    expect(wrapper.findAll('.activity-agent-row')).toHaveLength(2)
    expect(wrapper.findAll('.robot-head-icon').length).toBeGreaterThan(0)
    expect(wrapper.text()).toContain('Review the design')
    expect(wrapper.get('.activity-agent-row--completed').exists()).toBe(true)

    await wrapper.findAll('.activity-agent-row')[0].trigger('click')
    expect(openSubagentStream).toHaveBeenCalledWith('session-1', 'subagent:child-1')
  })
})
