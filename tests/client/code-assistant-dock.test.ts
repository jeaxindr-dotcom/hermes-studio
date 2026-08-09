// @vitest-environment jsdom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  switchSession: vi.fn(async () => undefined),
  selectSession: vi.fn(),
  newChat: vi.fn(),
  loadSessions: vi.fn(async () => undefined),
}))

vi.mock('@/stores/hermes/chat', () => ({
  useChatStore: () => ({
    activeSessionId: 'session-1',
    activeSession: {
      id: 'session-1',
      title: 'Projet actif',
      profile: 'default',
      model: 'model-a',
      provider: 'provider-a',
    },
    sessions: [
      { id: 'session-1', title: 'Projet actif', profile: 'default', source: 'cli', model: 'model-a', provider: 'provider-a', createdAt: 1, updatedAt: 2 },
      { id: 'session-2', title: 'Ancienne discussion', profile: 'default', source: 'cli', model: 'model-a', provider: 'provider-a', createdAt: 1, updatedAt: 1 },
    ],
    sessionsLoaded: true,
    sessionProfileFilter: null,
    switchSession: state.switchSession,
    newChat: state.newChat,
    loadSessions: state.loadSessions,
    switchSessionModel: vi.fn(async () => true),
    isSessionLive: () => false,
    isSessionCompletedUnread: () => false,
    getSubagentStream: () => null,
  }),
}))

vi.mock('@/stores/hermes/app', () => ({
  useAppStore: () => ({
    selectedModel: 'model-a',
    selectedProvider: 'provider-a',
    modelGroups: [{ provider: 'provider-a', label: 'Provider A', models: ['model-a'] }],
    profileModelGroups: [],
    displayModelName: (model: string) => model,
    loadModels: vi.fn(async () => undefined),
  }),
}))

vi.mock('@/stores/hermes/profiles', () => ({
  useProfilesStore: () => ({ activeProfileName: 'default', profiles: [] }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => ({
    'code.assistantTitle': 'Assistant de code',
    'code.assistantChat': 'Chat',
    'code.assistantHistory': 'Historique',
    'code.assistantSearchHistory': 'Rechercher',
    'chat.newChat': 'Nouvelle discussion',
    'models.selectModel': 'Choisir un modèle',
  } as Record<string, string>)[key] || key }),
}))

vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('naive-ui')>()
  return {
    ...actual,
    useMessage: () => ({ success: vi.fn(), error: vi.fn() }),
  }
})

vi.mock('@/components/hermes/chat/MessageList.vue', () => ({
  default: { name: 'MessageList', template: '<div class="message-list-stub" />' },
}))

vi.mock('@/components/hermes/chat/ChatInput.vue', () => ({
  default: { name: 'ChatInput', template: '<div class="chat-input-stub" />' },
}))

vi.mock('@/components/hermes/chat/SessionListItem.vue', () => ({
  default: {
    name: 'SessionListItem',
    props: ['session'],
    emits: ['select'],
    template: '<button class="session-list-item-stub" :data-session-id="session.id" @click="$emit(\'select\')" />',
  },
}))

vi.mock('@/components/hermes/chat/SubagentStreamPanel.vue', () => ({
  default: { name: 'SubagentStreamPanel', template: '<div class="subagent-stream-stub" />' },
}))

vi.mock('@/components/hermes/chat/RealtimeVoiceStage.vue', () => ({
  default: { name: 'RealtimeVoiceStage', template: '<div class="realtime-voice-stub" />' },
}))

import CodeAssistantDock from '@/components/hermes/code/CodeAssistantDock.vue'

const mountOptions = {
  global: {
    stubs: {
      Teleport: true,
    },
  },
}

describe('CodeAssistantDock', () => {
  beforeEach(() => {
    localStorage.clear()
    state.switchSession.mockClear()
    state.selectSession.mockClear()
    state.newChat.mockClear()
  })

  it('uses the active Hermes chat and delegates history selection to the workspace owner', async () => {
    const wrapper = mount(CodeAssistantDock, {
      props: {
        workspace: 'C:/project',
        profile: 'default',
        onSelectSession: state.selectSession,
      },
      ...mountOptions,
    })

    expect(wrapper.findComponent({ name: 'MessageList' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ChatInput' }).exists()).toBe(true)

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await nextTick()

    const items = wrapper.findAll('.session-list-item-stub')
    expect(items).toHaveLength(2)
    await wrapper.get('[data-session-id="session-2"]').trigger('click')
    await nextTick()

    expect(state.selectSession).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-2' }))
    expect(state.switchSession).not.toHaveBeenCalled()
  })

  it('creates a new chat bound to the current Code workspace', async () => {
    localStorage.setItem('hermes.code.assistantTab', 'history')
    const wrapper = mount(CodeAssistantDock, {
      props: { workspace: 'C:/project', profile: 'default' },
      ...mountOptions,
    })

    const buttons = wrapper.findAll('.code-assistant-history-toolbar .n-button')
    const addButton = buttons.at(-1)
    expect(addButton?.text()).toBe('+')
    await addButton!.trigger('click')
    await nextTick()

    expect(state.newChat).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'default',
      workspace: 'C:/project',
      model: 'model-a',
      provider: 'provider-a',
    }))
  })
})
