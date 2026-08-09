// @vitest-environment jsdom
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRouter: () => ({ push: routerPush }),
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'sidebar.code': 'Code',
      'sidebar.singleChat': 'Discussion',
      'sidebar.groupChat': 'Groupe',
      'sidebar.workflow': 'Workflow',
      'sidebar.history': 'Historique',
      'sidebar.search': 'Rechercher',
      'sidebar.apiRelay': 'API Relay',
      'chat.newChat': 'Nouvelle discussion',
    } as Record<string, string>)[key] || key,
  }),
}))

vi.mock('@/composables/useSessionSearch', () => ({
  useSessionSearch: () => ({ openSessionSearch: vi.fn() }),
}))

vi.mock('@/components/hermes/chat/SessionActivityPanel.vue', () => ({
  default: defineComponent({ template: '<div class="session-activity-panel-stub" />' }),
}))

const TooltipStub = defineComponent({
  template: '<div class="tooltip-stub"><slot name="trigger" /><slot /></div>',
})

import PageSidebarNav from '@/components/layout/PageSidebarNav.vue'

describe('PageSidebarNav Code mode', () => {
  beforeEach(() => {
    routerPush.mockReset()
  })

  it('renders Code as the fourth mode and navigates to the Code workspace', async () => {
    const wrapper = mount(PageSidebarNav, {
      props: { active: 'chat' },
      global: {
        plugins: [createPinia()],
        stubs: { NTooltip: TooltipStub, SessionActivityPanel: true },
      },
    })

    const switcher = wrapper.get('.conversation-switch')
    const tabs = switcher.findAll('.conversation-switch-tab')
    expect(tabs).toHaveLength(4)
    expect(switcher.classes()).toContain('conversation-switch--four')

    const codeTab = switcher.get('[aria-label="Code"]')
    expect(codeTab.classes()).not.toContain('active')
    expect(codeTab.attributes('aria-selected')).toBe('false')

    await codeTab.trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'hermes.code' })

    const activeWrapper = mount(PageSidebarNav, {
      props: { active: 'code' as never },
      global: {
        plugins: [createPinia()],
        stubs: { NTooltip: TooltipStub, SessionActivityPanel: true },
      },
    })
    expect(activeWrapper.get('[aria-label="Code"]').classes()).toContain('active')
    expect(activeWrapper.get('[aria-label="Code"]').attributes('aria-selected')).toBe('true')
  })

  it('routes subagent details from modes without a detail host to Discussion and forwards the request', async () => {
    const forwarded: CustomEvent[] = []
    const observe = (event: Event) => forwarded.push(event as CustomEvent)
    window.addEventListener('hermes:open-subagent-stream', observe)
    const wrapper = mount(PageSidebarNav, {
      props: { active: 'workflow' as never },
      global: {
        plugins: [createPinia()],
        stubs: { NTooltip: TooltipStub, SessionActivityPanel: true },
      },
    })

    window.dispatchEvent(new CustomEvent('hermes:open-subagent-stream', {
      detail: { sessionId: 'session-1', subagentId: 'child-1' },
    }))
    await flushPromises()

    expect(routerPush).toHaveBeenCalledWith({ name: 'hermes.chat' })
    expect(forwarded).toHaveLength(2)
    expect(forwarded[1].detail).toEqual({ sessionId: 'session-1', subagentId: 'child-1' })

    wrapper.unmount()
    window.removeEventListener('hermes:open-subagent-stream', observe)
  })
})
