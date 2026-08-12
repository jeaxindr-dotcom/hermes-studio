// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createTestingPinia } from '@pinia/testing'
import { nextTick } from 'vue'
import { useChatStore } from '@/stores/hermes/chat'
import { useSettingsStore } from '@/stores/hermes/settings'
import ChatInput from '@/components/hermes/chat/ChatInput.vue'

const fetchSkillsMock = vi.hoisted(() => vi.fn())
const fetchSkillBundlesMock = vi.hoisted(() => vi.fn())
const deleteSkillBundleApiMock = vi.hoisted(() => vi.fn())
const dialogWarningMock = vi.hoisted(() => vi.fn())
const setModelContextMock = vi.hoisted(() => vi.fn())

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('naive-ui', () => ({
  NButton: { template: '<button type="button" v-bind="$attrs"><slot /><slot name="icon" /></button>' },
  NTooltip: { template: '<div><slot name="trigger" /><slot /></div>' },
  NSwitch: { template: '<button type="button"></button>' },
  NDropdown: {
    props: ['options'],
    emits: ['select'],
    template: '<div><slot /><button v-for="option in options || []" :key="option.key" type="button" class="n-dropdown-option-test" :data-key="option.key" @click="$emit(\'select\', option.key)">{{ option.label }}</button></div>',
  },
  NModal: { template: '<div><slot /><slot name="footer" /></div>' },
  NInputNumber: { template: '<input />' },
  NPopover: {
    template: '<div class="n-popover-stub"><slot name="trigger" /><slot /></div>',
  },
  NSlider: {
    props: ['value', 'min', 'max', 'step'],
    emits: ['update:value'],
    template: `
      <input
        class="n-slider-stub"
        type="range"
        :value="value"
        :min="min"
        :max="max"
        :step="step"
        @input="$emit('update:value', Number($event.target.value))"
      />
    `,
  },
  useMessage: () => ({ error: vi.fn(), success: vi.fn() }),
  useDialog: () => ({ warning: dialogWarningMock }),
}))

vi.mock('@/api/hermes/sessions', () => ({
  fetchContextLength: vi.fn().mockResolvedValue(256000),
}))

vi.mock('@/api/hermes/model-context', () => ({
  setModelContext: setModelContextMock,
}))

vi.mock('@/api/hermes/skills', () => ({
  fetchSkills: fetchSkillsMock,
}))

vi.mock('@/api/hermes/skill-bundles', () => ({
  fetchSkillBundles: fetchSkillBundlesMock,
  deleteSkillBundleApi: deleteSkillBundleApiMock,
}))

vi.mock('@/components/hermes/chat/BundleCreateModal.vue', () => ({
  default: {
    name: 'BundleCreateModal',
    props: ['profile'],
    emits: ['close', 'created'],
    template: '<div class="bundle-create-modal">{{ profile }}</div>',
  },
}))

vi.mock('@/composables/useToolTraceVisibility', () => ({
  useToolTraceVisibility: () => ({ toolTraceVisible: { value: true }, toggleToolTraceVisible: vi.fn() }),
}))

function mountForSession(
  sessionId: string,
  sessionOverrides: Partial<ReturnType<typeof useChatStore>['sessions'][number]> = {},
  displayOverrides: Record<string, any> = {},
) {
  const pinia = createTestingPinia({ stubActions: false, createSpy: vi.fn })
  const chatStore = useChatStore()
  const settingsStore = useSettingsStore()
  chatStore.sessions = [
    { id: sessionId, title: sessionId, source: 'cli', messages: [], createdAt: Date.now(), updatedAt: Date.now(), ...sessionOverrides },
  ]
  chatStore.activeSessionId = sessionId
  chatStore.activeSession = chatStore.sessions[0]
  settingsStore.display = displayOverrides
  return mount(ChatInput, { global: { plugins: [pinia] } })
}

describe('ChatInput draft persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    window.innerWidth = 1024
    fetchSkillsMock.mockReset()
    fetchSkillsMock.mockResolvedValue({ categories: [], archived: [] })
    fetchSkillBundlesMock.mockReset()
    fetchSkillBundlesMock.mockResolvedValue([])
    deleteSkillBundleApiMock.mockReset()
    deleteSkillBundleApiMock.mockResolvedValue(undefined)
    dialogWarningMock.mockReset()
    setModelContextMock.mockReset()
    setModelContextMock.mockResolvedValue(undefined)
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:chat-attachment'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  it('adds a pasted non-image file to the attachment list', async () => {
    const wrapper = mountForSession('session-file-paste')
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
        files: [file],
      },
    })

    wrapper.get('textarea').element.dispatchEvent(paste)
    await nextTick()

    expect(paste.defaultPrevented).toBe(true)
    expect(wrapper.get('.attachment-file').text()).toContain('notes.txt')
  })

  it('accepts a browser selection directly into the current composer', async () => {
    const wrapper = mountForSession('session-browser-selection')
    const image = new File(['png'], 'browser-element.png', { type: 'image/png' })
    const context = '{"browser_selection":{"annotations":[{"marker":1,"mode":"element","note":"Make this element clearer"}]}}'

    ;(wrapper.vm as unknown as { addBrowserAttachment: (file: File, context: string) => void }).addBrowserAttachment(image, context)
    await nextTick()

    expect(wrapper.get('.attachment-thumb').attributes('alt')).toBe('browser-element.png')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('')
    expect(wrapper.get('.attachment-context').attributes('open')).toBeUndefined()
    expect(wrapper.get('.attachment-context pre').text()).toBe(context)
  })

  it('restores unsent text for the active session after the chat view is remounted', async () => {
    const wrapper = mountForSession('session-a')
    const textarea = wrapper.get('textarea')

    await textarea.setValue('draft before tab switch')
    await nextTick()
    wrapper.unmount()

    const remounted = mountForSession('session-a')
    await nextTick()

    expect((remounted.get('textarea').element as HTMLTextAreaElement).value).toBe('draft before tab switch')
  })

  it('stores drafts under one localStorage key mapped by session id', async () => {
    const wrapperA = mountForSession('session-a')
    await wrapperA.get('textarea').setValue('draft for session a')
    await nextTick()
    wrapperA.unmount()

    const wrapperB = mountForSession('session-b')
    await wrapperB.get('textarea').setValue('draft for session b')
    await nextTick()
    wrapperB.unmount()

    expect(localStorage.getItem('hermes_chat_input_draft_v1')).toBeNull()
    expect(JSON.parse(localStorage.getItem('hermes_chat_input_drafts_v1') || '{}')).toEqual({
      'session-a': 'draft for session a',
      'session-b': 'draft for session b',
    })

    const remountedA = mountForSession('session-a')
    await nextTick()
    expect((remountedA.get('textarea').element as HTMLTextAreaElement).value).toBe('draft for session a')
  })

  it('shows and cancels the active session message reference', async () => {
    const wrapper = mountForSession('session-reference')
    const chatStore = useChatStore()

    chatStore.setMessageReference('session-reference', {
      id: 'assistant-1',
      role: 'assistant',
      content: 'A referenced assistant response',
    })
    await nextTick()

    expect(wrapper.get('.message-reference-preview').text()).toContain('A referenced assistant response')
    expect(wrapper.get('.message-reference-preview').element.parentElement?.classList.contains('input-wrapper')).toBe(false)
    expect(chatStore.activeMessageReference?.id).toBe('assistant-1')

    await wrapper.get('.message-reference-remove').trigger('click')

    expect(wrapper.find('.message-reference-preview').exists()).toBe(false)
    expect(chatStore.activeMessageReference).toBeNull()
  })

  it('applies the configured desktop input height from display settings', async () => {
    const wrapper = mountForSession('session-a', {}, { chat_input_height: 180 })
    await flushPromises()
    await nextTick()

    expect((wrapper.get('textarea').element as HTMLTextAreaElement).style.height).toBe('180px')
    expect((wrapper.get('.input-wrapper').element as HTMLElement).style.minHeight).toBe('251px')
  })

  it('applies display setting changes after a manual resize', async () => {
    const wrapper = mountForSession('session-a')
    const settingsStore = useSettingsStore()
    const resizeHandle = wrapper.get('.resize-handle')

    await resizeHandle.trigger('mousedown', { clientY: 100 })
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 50 }))
    document.dispatchEvent(new MouseEvent('mouseup'))
    await nextTick()

    settingsStore.display.chat_input_height = 220
    await nextTick()

    expect((wrapper.get('textarea').element as HTMLTextAreaElement).style.height).toBe('220px')
    expect((wrapper.get('.input-wrapper').element as HTMLElement).style.minHeight).toBe('291px')
  })

  it('keeps mobile chat input behavior even when a desktop height is configured', async () => {
    window.innerWidth = 640
    const wrapper = mountForSession('session-mobile', {}, { chat_input_height: 180 })
    await flushPromises()
    await nextTick()

    expect((wrapper.get('textarea').element as HTMLTextAreaElement).style.height).not.toBe('180px')
  })

  it('shows context usage for coding-agent sessions', async () => {
    const wrapper = mountForSession('session-codex', {
      source: 'coding_agent',
      agent: 'codex',
      codingAgentId: 'codex',
      inputTokens: 1200,
      outputTokens: 800,
      contextTokens: 2000,
    })
    await nextTick()

    expect(wrapper.find('.context-info').exists()).toBe(true)
    expect(wrapper.find('.context-info').text()).toContain('2.0k')
    expect(wrapper.find('.context-bar').exists()).toBe(true)
  })

  it('renders the context picker through 1M and persists the maximum option', async () => {
    const { setModelContext } = await import('@/api/hermes/model-context')
    const wrapper = mountForSession('session-context-picker', {
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
    })
    await nextTick()

    const popover = wrapper.get('.n-popover-stub')
    const slider = wrapper.get('.context-limit-slider')
    expect(popover.attributes('placement')).toBe('top')
    expect(slider.attributes('min')).toBe('0')
    expect(slider.attributes('max')).toBe('8')
    expect(wrapper.get('.context-limit-marks').text()).toContain('1M')

    await slider.setValue('8')
    await new Promise(resolve => setTimeout(resolve, 220))

    expect(setModelContext).toHaveBeenCalledWith('openai-codex', 'gpt-5.6-luna', 1_000_000, 'default')
  })

  it('keeps a delayed context save scoped to the session where it was selected', async () => {
    const { setModelContext } = await import('@/api/hermes/model-context')
    const wrapper = mountForSession('session-context-a', {
      profile: 'profile-a',
      provider: 'provider-a',
      model: 'model-a',
    })
    const store = useChatStore()
    await nextTick()

    await wrapper.get('.context-limit-slider').setValue('8')
    store.sessions = [{
      ...store.sessions[0],
      id: 'session-context-b',
      title: 'session-context-b',
      profile: 'profile-b',
      provider: 'provider-b',
      model: 'model-b',
    }]
    store.activeSessionId = 'session-context-b'
    store.activeSession = store.sessions[0]
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 220))
    await flushPromises()

    expect(setModelContext).toHaveBeenCalledTimes(1)
    expect(setModelContext).toHaveBeenCalledWith('provider-a', 'model-a', 1_000_000, 'profile-a')
    expect(wrapper.get('.context-limit-editable').text()).toContain('256.0k')
  })

  it('persists pending context selections for both sessions during a rapid switch', async () => {
    const wrapper = mountForSession('session-context-a', {
      profile: 'profile-a',
      provider: 'provider-a',
      model: 'model-a',
    })
    const store = useChatStore()
    await nextTick()

    await wrapper.get('.context-limit-slider').setValue('8')
    store.sessions = [{
      ...store.sessions[0],
      id: 'session-context-b',
      title: 'session-context-b',
      profile: 'profile-b',
      provider: 'provider-b',
      model: 'model-b',
    }]
    store.activeSessionId = 'session-context-b'
    store.activeSession = store.sessions[0]
    await nextTick()
    await wrapper.get('.context-limit-slider').setValue('7')
    await new Promise(resolve => setTimeout(resolve, 220))
    await flushPromises()

    expect(setModelContextMock.mock.calls).toEqual(expect.arrayContaining([
      ['provider-a', 'model-a', 1_000_000, 'profile-a'],
      ['provider-b', 'model-b', 512_000, 'profile-b'],
    ]))
  })

  it('flushes a pending context selection before the composer unmounts', async () => {
    const wrapper = mountForSession('session-context-unmount', {
      profile: 'profile-a',
      provider: 'provider-a',
      model: 'model-a',
    })
    await nextTick()

    await wrapper.get('.context-limit-slider').setValue('8')
    wrapper.unmount()
    await flushPromises()

    expect(setModelContextMock).toHaveBeenCalledWith(
      'provider-a',
      'model-a',
      1_000_000,
      'profile-a',
    )
  })

  it('shows reasoning effort selector for coding-agent sessions', async () => {
    const wrapper = mountForSession('session-codex', {
      source: 'coding_agent',
      agent: 'codex',
      codingAgentId: 'codex',
    })
    await nextTick()

    expect(wrapper.find('.reasoning-effort-button').exists()).toBe(true)
    expect(wrapper.find('.reasoning-effort-slider').exists()).toBe(true)
    expect(wrapper.get('.reasoning-effort-slider').attributes('min')).toBe('0')
    expect(wrapper.get('.reasoning-effort-slider').attributes('max')).toBe('7')
  })

  it('hides the reasoning effort selector for MoA sessions', async () => {
    const wrapper = mountForSession('session-moa', {
      provider: 'moa',
      model: 'research-team',
    })
    await nextTick()

    expect(wrapper.find('.reasoning-effort-button').exists()).toBe(false)
  })

  it('renders the authorization mode control after the model selector', async () => {
    const wrapper = mountForSession('session-authorization')
    await nextTick()

    const modelButton = wrapper.get('.input-model-button').element
    const authorizationButton = wrapper.get('.authorization-mode-button').element
    expect(modelButton.compareDocumentPosition(authorizationButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wrapper.get('.authorization-mode-button').attributes('aria-label')).toContain('chat.authorizationMode')
  })

  it('persists manual authorization mode through the active profile approvals config', async () => {
    const wrapper = mountForSession('session-authorization-manual')
    const settingsStore = useSettingsStore()
    const saveSection = vi.spyOn(settingsStore, 'saveSection').mockResolvedValue(undefined)

    await wrapper.get('.n-dropdown-option-test[data-key="manual"]').trigger('click')

    expect(saveSection).toHaveBeenCalledWith('approvals', { mode: 'manual' }, expect.objectContaining({ shouldCommit: expect.any(Function) }))
  })

  it('updates the authorization mode immediately while persistence is pending', async () => {
    const wrapper = mountForSession('session-authorization-pending')
    const settingsStore = useSettingsStore()
    let resolveSave: () => void = () => {}
    const savePromise = new Promise<void>((resolve) => {
      resolveSave = resolve
    })
    vi.spyOn(settingsStore, 'saveSection').mockReturnValue(savePromise)

    const pendingClick = wrapper.get('.n-dropdown-option-test[data-key="manual"]').trigger('click')
    await nextTick()

    expect(wrapper.get('.authorization-mode-button').classes()).toContain('authorization-mode-button--manual')

    resolveSave()
    await pendingClick
  })

  it('serializes rapid authorization saves and keeps the latest successful mode', async () => {
    const wrapper = mountForSession('session-authorization-race')
    const settingsStore = useSettingsStore()
    const pending: Array<{ resolve: () => void; reject: () => void }> = []
    vi.spyOn(settingsStore, 'saveSection').mockImplementation(() => new Promise<void>((resolve, reject) => {
      pending.push({ resolve, reject })
    }))

    const first = wrapper.get('.n-dropdown-option-test[data-key="manual"]').trigger('click')
    await nextTick()
    const second = wrapper.get('.n-dropdown-option-test[data-key="smart"]').trigger('click')
    await nextTick()

    expect(pending).toHaveLength(1)
    pending[0].reject()
    await flushPromises()
    expect(pending).toHaveLength(2)

    pending[1].resolve()
    await Promise.all([first, second])
    await nextTick()

    expect(wrapper.get('.authorization-mode-button').classes()).not.toContain('authorization-mode-button--manual')
    expect(settingsStore.approvals.mode).toBe('smart')
  })

  it('requires explicit confirmation before enabling full authorization mode', async () => {
    const wrapper = mountForSession('session-authorization-off')
    const settingsStore = useSettingsStore()
    const saveSection = vi.spyOn(settingsStore, 'saveSection').mockResolvedValue(undefined)

    await wrapper.get('.n-dropdown-option-test[data-key="off"]').trigger('click')

    expect(dialogWarningMock).toHaveBeenCalled()
    expect(saveSection).not.toHaveBeenCalled()

    const positiveResult = dialogWarningMock.mock.calls[0][0].onPositiveClick()
    expect(positiveResult).toBe(true)
    await flushPromises()
    expect(saveSection).toHaveBeenCalledWith('approvals', { mode: 'off' }, expect.objectContaining({ shouldCommit: expect.any(Function) }))
  })

  it('stores maximum reasoning effort for the active session', async () => {
    const wrapper = mountForSession('session-reasoning-max')
    const store = useChatStore()

    await wrapper.get('.reasoning-effort-slider').setValue('7')
    await nextTick()

    expect(store.sessions[0].reasoningEffort).toBe('max')
    expect(localStorage.getItem('hermes:reasoning_effort:session-reasoning-max')).toBe('max')
    expect(wrapper.get('.reasoning-effort-button').attributes('style')).toContain('--reasoning-effort-accent-color: #ef4444')
    expect(wrapper.get('.reasoning-effort-slider').classes()).toContain('reasoning-effort-slider--max')
  })

  it('stores the selected reasoning effort for the active session', async () => {
    const wrapper = mountForSession('session-reasoning')
    const store = useChatStore()

    await wrapper.get('.reasoning-effort-slider').setValue('5')
    await nextTick()

    expect(store.sessions[0].reasoningEffort).toBe('high')
    expect(localStorage.getItem('hermes:reasoning_effort:session-reasoning')).toBe('high')
    expect(wrapper.get('.reasoning-effort-button').attributes('style')).toContain('--reasoning-effort-accent-color: #f9c33c')
    expect(wrapper.get('.reasoning-effort-slider').classes()).not.toContain('reasoning-effort-slider--max')
  })

  it('opens the skill picker from /skill and inserts the selected skill command', async () => {
    fetchSkillsMock.mockResolvedValue({
      categories: [
        {
          name: 'review',
          description: '',
          skills: [
            { name: 'github-pr-review', description: 'Review pull requests', enabled: true },
            { name: 'disabled-skill', description: 'Hidden', enabled: false },
          ],
        },
      ],
      archived: [],
    })
    const wrapper = mountForSession('session-skills', { profile: 'work' })
    const textarea = wrapper.get('textarea')

    await textarea.setValue('/skill')
    await nextTick()

    await wrapper.get('.slash-command-item').trigger('mousedown')
    await flushPromises()
    await nextTick()

    expect(fetchSkillsMock).toHaveBeenCalledWith('work')
    expect(wrapper.text()).toContain('/skill github-pr-review')
    expect(wrapper.text()).toContain('Review pull requests')
    expect(wrapper.text()).not.toContain('disabled-skill')

    await wrapper.get('.skill-picker-item').trigger('click')
    await nextTick()

    expect((textarea.element as HTMLTextAreaElement).value).toBe('/skill github-pr-review ')
  })

  it('opens the profile-scoped bundle picker from /bundles and inserts the selected bundle command', async () => {
    fetchSkillBundlesMock.mockResolvedValue([
      {
        name: 'PR Review Team',
        commandName: 'pr-review-team',
        description: 'Review a pull request',
        skills: ['github-pr-review', 'security-review'],
      },
    ])
    const wrapper = mountForSession('session-bundles', { profile: 'work' })
    const textarea = wrapper.get('textarea')

    await textarea.setValue('/bundles')
    await nextTick()
    await wrapper.findAll('.slash-command-item')[0].trigger('mousedown')
    await flushPromises()
    await nextTick()

    expect(fetchSkillBundlesMock).toHaveBeenCalledWith('work')
    expect(wrapper.text()).toContain('/bundles pr-review-team')
    expect(wrapper.text()).toContain('Review a pull request')
    expect(wrapper.text()).toContain('github-pr-review, security-review')

    await wrapper.get('.bundle-picker-select').trigger('click')
    await nextTick()

    expect((textarea.element as HTMLTextAreaElement).value).toBe('/bundles pr-review-team ')
  })

  it('opens the bundle creator when /bundles create is submitted', async () => {
    const wrapper = mountForSession('session-bundle-create', { profile: 'research' })
    const textarea = wrapper.get('textarea')

    await textarea.setValue('/bundles create')
    await nextTick()
    await wrapper.get('.send-button').trigger('click')
    await nextTick()

    expect(wrapper.get('.bundle-create-modal').text()).toBe('research')
  })

  it('deletes a bundle from the current profile after confirmation', async () => {
    fetchSkillBundlesMock.mockResolvedValue([
      {
        name: 'PR Review Team',
        commandName: 'pr-review-team',
        description: '',
        skills: ['github-pr-review'],
      },
    ])
    const wrapper = mountForSession('session-bundle-delete', { profile: 'work' })
    const textarea = wrapper.get('textarea')

    await textarea.setValue('/bundles')
    await nextTick()
    await wrapper.findAll('.slash-command-item')[0].trigger('mousedown')
    await flushPromises()
    await wrapper.get('.bundle-picker-delete').trigger('click')

    expect(dialogWarningMock).toHaveBeenCalledOnce()
    await dialogWarningMock.mock.calls[0][0].onPositiveClick()
    await flushPromises()

    expect(deleteSkillBundleApiMock).toHaveBeenCalledWith('work', 'pr-review-team')
    expect(wrapper.text()).not.toContain('/bundles pr-review-team')
  })

  it('hides bridge autocomplete for non-Hermes slash prefixes', async () => {
    const wrapper = mountForSession('session-prefixes')
    const textarea = wrapper.get('textarea')

    await textarea.setValue('/')
    await nextTick()
    expect(wrapper.findAll('.slash-command-item').length).toBeGreaterThan(0)

    await textarea.setValue('/ter')
    ;(textarea.element as HTMLTextAreaElement).setSelectionRange(4, 4)
    await textarea.trigger('input')
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 220))
    expect(wrapper.find('.slash-command-dropdown').exists()).toBe(false)
  })
})
