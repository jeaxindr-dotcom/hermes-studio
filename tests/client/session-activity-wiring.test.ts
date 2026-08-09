import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const readClientFile = (path: string) => readFileSync(`packages/client/src/${path}`, 'utf8')

describe('session activity placement', () => {
  it('keeps Tasks and subagents global through the shared page sidebar navigation', () => {
    const pageSidebarNav = readClientFile('components/layout/PageSidebarNav.vue')
    const chatPanel = readClientFile('components/hermes/chat/ChatPanel.vue')
    const codeWorkspace = readClientFile('views/hermes/CodeWorkspaceView.vue')

    expect(pageSidebarNav).toContain("import SessionActivityPanel from '@/components/hermes/chat/SessionActivityPanel.vue'")
    expect(pageSidebarNav).toMatch(/conversation-switch[\s\S]*<SessionActivityPanel \/>/)
    expect(chatPanel).not.toContain('import SessionActivityPanel')
    expect(codeWorkspace).not.toContain('import SessionActivityPanel')
  })

  it('ships French and English labels for Tasks, subagents and statuses', () => {
    const french = readClientFile('i18n/locales/fr.ts')
    const english = readClientFile('i18n/locales/en.ts')

    for (const source of [french, english]) {
      expect(source).toContain('activity: {')
      expect(source).toContain('tasks:')
      expect(source).toContain('agents:')
      expect(source).toContain('delegationRoot:')
      expect(source).toContain('inProgress:')
    }
  })

  it('keeps subagent details in Chat and Code and routes unsupported modes to Chat', () => {
    const pageSidebarNav = readClientFile('components/layout/PageSidebarNav.vue')

    expect(pageSidebarNav).toContain("if (props.active === 'chat' || props.active === 'code' || forwardingSubagentStream) return")
    expect(pageSidebarNav).toContain("await router.push({ name: 'hermes.chat' })")
    expect(pageSidebarNav).toContain('openSubagentStream(detail.sessionId, `subagent:${detail.subagentId}`)')
    expect(pageSidebarNav).toContain('window.addEventListener(OPEN_SUBAGENT_STREAM_EVENT, forwardSubagentStreamToChat)')
    expect(pageSidebarNav).toContain('window.removeEventListener(OPEN_SUBAGENT_STREAM_EVENT, forwardSubagentStreamToChat)')
  })
})
