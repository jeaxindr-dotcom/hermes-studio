import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

const readClientFile = (path: string) => readFileSync(`packages/client/src/${path}`, 'utf8')

describe('client style system', () => {
  it('keeps the expanded Discussion activity area vertically wheel-scrollable', () => {
    const chatPanel = readClientFile('components/hermes/chat/ChatPanel.vue')
    const codeWorkspace = readClientFile('views/hermes/CodeWorkspaceView.vue')

    expect(chatPanel).toMatch(/\.page-sidebar-top\s*\{[\s\S]*min-height:\s*0;[\s\S]*max-height:[^;]+;[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior:\s*contain;/)
    expect(codeWorkspace).toMatch(/\.code-page-sidebar-nav\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow-y:\s*auto;/)
  })

  it('makes the Discussion sidebar pointer-resizable and persists its width', () => {
    const chatPanel = readClientFile('components/hermes/chat/ChatPanel.vue')

    expect(chatPanel).toContain('readPageSidebarWidth')
    expect(chatPanel).toContain('const pageSidebarWidth = ref(readPageSidebarWidth')
    expect(chatPanel).toContain('class="session-list-resize-handle"')
    expect(chatPanel).toContain('role="separator"')
    expect(chatPanel).toContain('@pointerdown="startPageSidebarResize"')
    expect(chatPanel).toContain('persistStoredPageSidebarWidth(pageSidebarWidth.value, window.localStorage)')
    expect(chatPanel).toMatch(/\.session-list-resize-handle\s*\{[\s\S]*cursor:\s*col-resize;/)
  })

  it('adds the shared persisted resize handle to all four page tabs', () => {
    const groupChat = readClientFile('components/hermes/group-chat/GroupChatPanel.vue')
    const workflow = readClientFile('views/hermes/WorkflowView.vue')
    const code = readClientFile('views/hermes/CodeWorkspaceView.vue')
    const resizeHandle = readClientFile('components/layout/PageSidebarResizeHandle.vue')
    const widthUtility = readClientFile('utils/page-sidebar-width.ts')

    for (const source of [groupChat, workflow, code]) {
      expect(source).toContain('PageSidebarResizeHandle')
      expect(source).toContain(":label=\"t('chat.resizeSidebar')\"")
      expect(source).toContain('var(--page-sidebar-width')
    }
    expect(widthUtility).toContain("export const PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'hermes.pageSidebarWidth'")
    expect(resizeHandle).toContain('persistStoredPageSidebarWidth(pageSidebarWidth.value, window.localStorage)')
    expect(resizeHandle).toContain('@pointerdown="startResize"')
    expect(resizeHandle).toContain('@dblclick="resetWidth"')
  })

  it('captures native sidebar wheel events and routes activity scrolling to the active panel', () => {
    const chatPanel = readClientFile('components/hermes/chat/ChatPanel.vue')
    const app = readClientFile('App.vue')

    expect(chatPanel).toContain('@wheel.capture="handlePageSidebarWheel"')
    expect(chatPanel).toContain('target.closest(".session-activity-panel")')
    expect(chatPanel).toContain('element.scrollTop = nextScrollTop')
    expect(chatPanel).toContain('event.stopPropagation()')
    expect(app).toContain(':deep(.chat-panel > .session-list > .page-sidebar-top .session-activity-panel *)')
    expect(app).toContain(':deep(.group-chat-panel > .room-sidebar > .sidebar-header .session-activity-panel *)')
    expect(app).toContain(':deep(.workflow-view > .workflow-sidebar > .page-sidebar-top .session-activity-panel *)')
    expect(app).toContain('-webkit-app-region: no-drag;')
  })

  it('keeps shared page headers on one layout baseline', () => {
    const globalStyles = readClientFile('styles/global.scss')

    expect(globalStyles).toContain('min-height: 64px;')
    expect(globalStyles).toContain('padding: 14px 20px;')
    expect(globalStyles).toContain('.page-header > .header-actions')
  })

  it('aligns SCSS surfaces and radii with the Naive UI theme', () => {
    const variables = readClientFile('styles/variables.scss')
    const theme = readClientFile('styles/theme.ts')

    expect(variables).toContain('--bg-card: #2a2a2a;')
    expect(theme).toContain("cardColor: '#2a2a2a'")
    expect(variables).toContain('$radius-sm: 6px;')
    expect(variables).toContain('$radius-md: 8px;')
    expect(variables).toContain('$radius-lg: 8px;')
    expect(theme).toContain("borderRadius: '8px'")
    expect(theme).toContain("borderRadiusSmall: '6px'")
  })

  it('keeps chat surfaces aligned while preserving composer elevation in dark mode', () => {
    const chatInput = readClientFile('components/hermes/chat/ChatInput.vue')
    const groupChatInput = readClientFile('components/hermes/group-chat/GroupChatInput.vue')
    const virtualMessageList = readClientFile('components/hermes/chat/VirtualMessageList.vue')

    expect(chatInput).toContain('background-color: $bg-main-surface;')
    expect(groupChatInput).toContain('background-color: $bg-main-surface;')
    expect(virtualMessageList).toContain('background-color: $bg-main-surface;')
    expect(chatInput.match(/background-color: #333333;/g)).toHaveLength(1)
    expect(groupChatInput.match(/background-color: #333333;/g)).toHaveLength(1)
  })

  it('keeps message metadata and context usage on custom theme text colors', () => {
    const chatInput = readClientFile('components/hermes/chat/ChatInput.vue')
    const messageItem = readClientFile('components/hermes/chat/MessageItem.vue')
    const groupMessageItem = readClientFile('components/hermes/group-chat/GroupMessageItem.vue')

    expect(messageItem).toMatch(/\.message-meta\s*\{[^}]*color: \$text-muted;/s)
    expect(groupMessageItem).toMatch(/\.message-meta\s*\{[^}]*color: \$text-muted;/s)
    expect(messageItem).not.toContain('color: #999999;')
    expect(groupMessageItem).not.toContain('color: #999999;')
    expect(chatInput).toMatch(/\.context-usage-row\s*\{[^}]*color: \$text-muted;/s)
    expect(chatInput).not.toContain('color: rgba(255, 255, 255, 0.68);')
    expect(chatInput).toContain('rgba(var(--text-muted-rgb), 0.85)')
  })

  it('keeps selected conversation titles on the primary text color', () => {
    const sessionListItem = readClientFile('components/hermes/chat/SessionListItem.vue')
    const groupChatPanel = readClientFile('components/hermes/group-chat/GroupChatPanel.vue')
    const workflowView = readClientFile('views/hermes/WorkflowView.vue')

    expect(sessionListItem).toMatch(
      /\.session-item\.active \.session-item-title\s*\{\s*color: var\(--text-primary\);/,
    )
    expect(groupChatPanel).toMatch(
      /&\.active \.room-name\s*\{\s*color: \$text-primary;/,
    )
    expect(workflowView).toMatch(
      /&\.selected \.workflow-list-name\s*\{\s*color: var\(--text-primary\);/,
    )
  })

  it('uses the custom selection color for the active profile', () => {
    const profileCard = readClientFile('components/hermes/profiles/ProfileCard.vue')

    expect(profileCard).toContain(
      '<NTag v-if="profile.active" size="tiny" type="primary" :bordered="false">',
    )
    expect(profileCard).toMatch(
      /&\.active\s*\{\s*border-color: rgba\(var\(--accent-primary-rgb\), 0\.4\);/,
    )
    expect(profileCard).not.toContain('rgba(var(--success-rgb), 0.4)')
  })

  it('replays the history detail fade when the selected session changes', () => {
    const historyView = readClientFile('views/hermes/HistoryView.vue')
    const historyMessageList = readClientFile('components/hermes/chat/HistoryMessageList.vue')

    expect(historyView).toContain(`:key="historySession?.id || 'history-empty'"`)
    expect(historyMessageList).toContain('animation: history-message-surface-fade-in 1.5s ease both;')
  })

  it('keeps the four-way conversation switch active state visible in dark mode', () => {
    const pageSidebarNav = readClientFile('components/layout/PageSidebarNav.vue')

    expect(pageSidebarNav).toContain(
      ':global(.dark .conversation-switch--four .conversation-switch-tab.active)',
    )
    expect(pageSidebarNav).toContain('background: $bg-card-hover;')
    expect(pageSidebarNav).toContain('inset 0 0 0 1px $border-color')
  })

  it('keeps the Code workbench below the Windows desktop titlebar', () => {
    const app = readClientFile('App.vue')

    expect(app).toMatch(
      /\.app-shell\.desktop-platform-win32\s*\{[\s\S]*:deep\(\.code-workspace > \.code-workbench\)[\s\S]*margin-top: 50px;/,
    )
    expect(app).toMatch(
      /\.app-shell\.desktop-platform-win32\s*\{[\s\S]*:deep\(\.code-workspace > \.code-assistant-dock\)[\s\S]*margin-top: 50px;/,
    )
    expect(app).toContain('PAGE_SIDEBAR_WIDTH_CHANGED_EVENT')
    expect(app).toContain('pageSidebarWidth.value)) + 20')
  })

  it('keeps the coding agents page aligned with the app main surface', () => {
    const codingAgentsView = readClientFile('views/hermes/CodingAgentsView.vue')

    expect(codingAgentsView).toMatch(
      /\.coding-agents-content\s*\{[^}]*background: \$bg-main-surface;/s,
    )
  })

  it('makes current theme surfaces translucent over custom backgrounds', () => {
    const variables = readClientFile('styles/variables.scss')
    const app = readClientFile('App.vue')
    const globalStyles = readClientFile('styles/global.scss')
    const useTheme = readClientFile('composables/useTheme.ts')
    const groupMessageItem = readClientFile('components/hermes/group-chat/GroupMessageItem.vue')
    const messageItem = readClientFile('components/hermes/chat/MessageItem.vue')
    const customBackgroundStyles = app
      .split('.app-shell--custom-background {')[1]
      ?.split('.app-shell.desktop-platform-darwin')[0]

    expect(variables).toContain('--bg-main-surface-rgb: var(--bg-card-rgb);')
    expect(variables).toContain('--bg-main-surface-rgb: var(--bg-primary-rgb);')
    expect(customBackgroundStyles).toContain('rgba(var(--bg-main-surface-rgb), 0.72)')
    expect(customBackgroundStyles).toContain('rgba(var(--bg-sidebar-surface-rgb), 0.72)')
    expect(customBackgroundStyles).toContain('backdrop-filter: blur(8px) saturate(110%)')
    expect(customBackgroundStyles).toContain(':deep(.chat-panel > .chat-main)')
    expect(customBackgroundStyles).toContain(':deep(.group-chat-panel > .chat-main)')
    expect(customBackgroundStyles).toContain(':deep(.virtual-message-list)')
    expect(customBackgroundStyles).toContain(':deep(.coding-agents-content)')
    expect(customBackgroundStyles).toMatch(
      /:deep\(\.workflow-view\),[\s\S]*:deep\(\.petdex-view\)\s*\{\s*background-color: transparent;/,
    )
    expect(customBackgroundStyles).toMatch(
      /:deep\(\.chat-main-content\),[\s\S]*:deep\(\.group-chat-surface\)\s*\{[\s\S]*background-color: rgba\(var\(--bg-main-surface-rgb\), 0\.42\);[\s\S]*backdrop-filter: none;/,
    )
    expect(customBackgroundStyles).toMatch(
      /:deep\(\.virtual-message-list\),[\s\S]*:deep\(\.group-message-shell\)\s*\{[\s\S]*background-color: transparent;[\s\S]*backdrop-filter: none;/,
    )
    expect(customBackgroundStyles).toMatch(
      /:deep\(\.chat-panel > \.chat-main\),[\s\S]*background-color: transparent;[\s\S]*backdrop-filter: none;/,
    )
    expect(customBackgroundStyles).toMatch(
      /:deep\(\.chat-panel > \.chat-main > \.chat-header\),[\s\S]*background-color: rgba\(var\(--bg-main-surface-rgb\), 0\.72\);[\s\S]*backdrop-filter: blur\(8px\) saturate\(110%\);/,
    )
    expect(customBackgroundStyles).toMatch(
      /:deep\(\.desktop-titlebar\),[\s\S]*:deep\(\.chat-panel > \.chat-main > \.chat-header\),[\s\S]*background-color: rgba\(var\(--bg-main-surface-rgb\), 0\.72\);[\s\S]*backdrop-filter: blur\(8px\) saturate\(110%\);/,
    )
    expect(customBackgroundStyles).toMatch(
      /:deep\(\.chat-input-area \.input-wrapper\)\s*\{[\s\S]*background-color: rgba\(var\(--bg-main-surface-rgb\), 0\.72\);[\s\S]*backdrop-filter: blur\(8px\) saturate\(110%\);/,
    )
    expect(customBackgroundStyles).toMatch(
      /:deep\(\.browser-settings-page > \.settings-card\)\s*\{\s*background-color: transparent;/,
    )
    expect(groupMessageItem).toMatch(
      /:global\(html\.theme-has-custom-background \.group-message:not\(\.embedded\) \.msg-content:not\(\.agent-error\)\),[\s\S]*background-color: rgba\(var\(--bg-main-surface-rgb\), 0\.78\);[\s\S]*border: 1px solid rgba\(var\(--text-primary-rgb\), 0\.18\);[\s\S]*backdrop-filter: blur\(8px\) saturate\(110%\);/,
    )
    expect(messageItem).toMatch(
      /:global\(html\.theme-has-custom-background \.message\.user \.message-bubble:not\(\.system\):not\(\.command\):not\(\.agent-error\)\),[\s\S]*background-color: rgba\(var\(--bg-main-surface-rgb\), 0\.78\);[\s\S]*border: 1px solid rgba\(var\(--text-primary-rgb\), 0\.18\);[\s\S]*backdrop-filter: blur\(8px\) saturate\(110%\);/,
    )
    expect(customBackgroundStyles).toMatch(
      /:deep\(\.chat-main-content\),[\s\S]*background-color: rgba\(var\(--bg-main-surface-rgb\), 0\.42\);/,
    )
    expect(useTheme).toContain(
      "document.documentElement.classList.toggle('theme-has-custom-background', active)",
    )
    expect(globalStyles).toMatch(
      /html\.theme-has-custom-background\s*\{[\s\S]*\.n-base-select-menu,[\s\S]*\.n-dropdown-menu,[\s\S]*\.n-cascader-menu,[\s\S]*background-color: rgba\(var\(--bg-main-surface-rgb\), 0\.72\) !important;[\s\S]*backdrop-filter: blur\(8px\) saturate\(110%\);/,
    )
  })

})
