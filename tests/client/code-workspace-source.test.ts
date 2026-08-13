import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const readClientFile = (path: string) => readFileSync(`packages/client/src/${path}`, 'utf8')

describe('Hermes Code workspace composition', () => {
  it('registers Code as a first-class page-sidebar route', () => {
    const router = readClientFile('router/index.ts')
    const app = readClientFile('App.vue')

    expect(router).toContain("path: '/hermes/code'")
    expect(router).toContain("name: 'hermes.code'")
    expect(router).toContain("import('@/views/hermes/CodeWorkspaceView.vue')")
    expect(app).toContain("'hermes.code'")
  })

  it('composes the existing explorer, Monaco editor, terminal and coding-agent entry point', () => {
    const view = readClientFile('views/hermes/CodeWorkspaceView.vue')

    expect(view).toContain('PageSidebarNav')
    expect(view).toContain('useAppStore')
    expect(view).toContain('appStore.setPageSidebarExpanded(true)')
    expect(view).toContain('active="code"')
    expect(view).toContain('CodeExplorer')
    expect(view).toContain('openAttachWorkspace')
    expect(view).toContain('FolderPicker')
    expect(view).toContain('setSessionWorkspace')
    expect(view).toContain('FileEditor')
    expect(view).toContain(':compact="true"')
    expect(view).toContain('filesStore.editorTabs')
    expect(view).toContain('filesStore.activateEditorTab')
    expect(view).toContain('filesStore.closeEditorTab')
    expect(view).toContain(":key=\"filesStore.activeEditorTabKey || 'editor'\"")
    expect(view).toContain('TerminalPanel')
    expect(view).toContain('class="code-terminal-resize-handle"')
    expect(view).toContain("name: 'hermes.codingAgents'")
    expect(view).toContain('workspaceSessionId: workspaceSessionId.value')
    expect(view).toContain('profile: activeProfile.value')
  })

  it('passes the active project through to the workspace terminal', () => {
    const view = readClientFile('views/hermes/CodeWorkspaceView.vue')
    const terminal = readClientFile('components/hermes/chat/TerminalPanel.vue')

    expect(view).toContain(':workspace-session-id="workspaceSessionId"')
    expect(terminal).toContain("params.set('workspaceSessionId', props.workspaceSessionId.trim())")
  })

  it('propagates the project workspace through Coding Agents launch requests', () => {
    const api = readClientFile('api/coding-agents.ts')
    const view = readClientFile('views/hermes/CodingAgentsView.vue')
    const controller = readFileSync('packages/server/src/controllers/coding-agents.ts', 'utf8')

    expect(api).toContain('workspaceSessionId?: string | null')
    expect(view).toContain("useRoute")
    expect(view).toContain("route.query.workspaceSessionId")
    expect(view).toContain('workspaceSessionId: launchWorkspaceSessionId.value')
    expect(controller).toContain('workspaceSessionId?: string | null')
    expect(controller).toContain('const session = getSession(workspaceSessionId)')
    expect(controller).toContain('const workspace = await realpath(rawWorkspace)')
    expect(controller).not.toContain('workspace: body.workspace')
  })

  it('keeps the editor and terminal inside Hermes Studio theme surfaces', () => {
    const view = readClientFile('views/hermes/CodeWorkspaceView.vue')

    expect(view).toContain('@use "@/styles/variables" as *;')
    expect(view).toMatch(/\.code-workspace\s*\{[\s\S]*background: \$bg-card;/)
    expect(view).toMatch(/\.code-terminal-panel\s*\{[\s\S]*border-top: 1px solid \$border-color;/)
    expect(view).toContain('var(--code-terminal-height)')
  })

  it('preserves the declared default terminal height when no preference exists', () => {
    const view = readClientFile('views/hermes/CodeWorkspaceView.vue')

    expect(view).toContain("const stored = localStorage.getItem(TERMINAL_HEIGHT_STORAGE_KEY)")
    expect(view).toContain("if (!stored) return TERMINAL_DEFAULT_HEIGHT")
  })

  it('docks the active Hermes chatbot and chat history beside the Code workbench', () => {
    const view = readClientFile('views/hermes/CodeWorkspaceView.vue')
    const dock = readClientFile('components/hermes/code/CodeAssistantDock.vue')
    const pendingActions = readClientFile('components/layout/GlobalPendingActions.vue')

    expect(view).toContain("import CodeAssistantDock from '@/components/hermes/code/CodeAssistantDock.vue'")
    expect(view).toContain('<CodeAssistantDock')
    expect(view).toContain(':workspace="workspacePath"')
    expect(view).toContain(':profile="activeProfile"')
    expect(view).toContain('@select-session="selectCodeSession"')
    expect(view).toContain('filesStore.hasAnyUnsavedChanges')
    expect(view).toContain('filesStore.clearWorkspaceScope({ discardUnsavedChanges: true })')
    expect(view).toContain('await chatStore.switchSession(session.id)')
    expect(dock).toContain("import MessageList from '@/components/hermes/chat/MessageList.vue'")
    expect(dock).toContain("import ChatInput from '@/components/hermes/chat/ChatInput.vue'")
    expect(dock).toContain("import SessionListItem from '@/components/hermes/chat/SessionListItem.vue'")
    expect(dock).toContain("import RealtimeVoiceStage from '@/components/hermes/chat/RealtimeVoiceStage.vue'")
    expect(dock).toContain('<MessageList')
    expect(dock).toContain('scroll-scope="code-assistant"')
    expect(dock).toContain('<ChatInput')
    expect(dock).toContain('@voice-click="showRealtimeVoice = true"')
    expect(dock).toContain('<RealtimeVoiceStage')
    expect(dock).toContain("emit('select-session', session)")
    expect(dock).not.toContain('chatStore.switchSession(session.id)')
    expect(dock).toContain('chatStore.sessionsLoaded')
    expect(dock).toContain('chatStore.activeSession')
    expect(dock).toContain('registerVisibleChatSurface')
    expect(dock).toContain('unregisterVisibleChatSurface')
    expect(dock).toContain('chatStore.newChat({')
    expect(dock).toContain("activeTab = ref<'chat' | 'history'>")
    expect(pendingActions).toContain('suppressVisibleSources && visibleChatSessionIds.has(pending.sessionId)')
  })
})
