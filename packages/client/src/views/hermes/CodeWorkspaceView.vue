<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NTooltip, useDialog, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import PageSidebarNav from '@/components/layout/PageSidebarNav.vue'
import PageSidebarResizeHandle from '@/components/layout/PageSidebarResizeHandle.vue'
import CodeExplorer from '@/components/hermes/code/CodeExplorer.vue'
import CodeAssistantDock from '@/components/hermes/code/CodeAssistantDock.vue'

import FileEditor from '@/components/hermes/files/FileEditor.vue'
import TerminalPanel from '@/components/hermes/chat/TerminalPanel.vue'
import { useChatStore, type Session } from '@/stores/hermes/chat'
import { useAppStore } from '@/stores/hermes/app'
import { useFilesStore, type EditorTab } from '@/stores/hermes/files'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { isStoredSuperAdmin } from '@/api/client'

const TERMINAL_HEIGHT_STORAGE_KEY = 'hermes.code.terminalHeight'
const TERMINAL_VISIBLE_STORAGE_KEY = 'hermes.code.terminalVisible'
const TERMINAL_MIN_HEIGHT = 160
const TERMINAL_MAX_HEIGHT = 620
const TERMINAL_DEFAULT_HEIGHT = 280

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const chatStore = useChatStore()
const appStore = useAppStore()
const filesStore = useFilesStore()
const profilesStore = useProfilesStore()
const isSuperAdmin = computed(() => isStoredSuperAdmin())

const terminalVisible = ref(localStorage.getItem(TERMINAL_VISIBLE_STORAGE_KEY) !== 'false')
const terminalHeight = ref(loadTerminalHeight())
const resizingTerminal = ref(false)
let resizeStart: { y: number; height: number } | null = null
let workspacePromptOpen = false
let lastRequestedFile = ''

const activeSession = computed(() => chatStore.activeSession)
const workspaceSessionId = computed(() => {
  const session = activeSession.value
  return session?.workspace && !session.isLocalOnly ? session.id : null
})
const workspacePath = computed(() => activeSession.value?.workspace || null)
const activeProfile = computed(() => activeSession.value?.profile || profilesStore.activeProfileName || filesStore.currentProfile || null)
const liveAutoFollowPath = ref('')
const liveFollowSuppressed = ref(false)
const liveEditing = computed(() => {
  const sessionId = workspaceSessionId.value
  return !!sessionId
    && chatStore.isSessionLive(sessionId)
    && !!latestWritePath.value
    && !liveFollowSuppressed.value
})
let liveRefreshTimer: ReturnType<typeof setInterval> | null = null
function editorFileName(tab: EditorTab): string {
  const path = tab.path || ''
  return path.split(/[\\/]/).pop() || path
}

function toolArguments(message: any): Record<string, unknown> {
  const raw = message?.toolArgs
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>
  if (typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function pathFromPatch(value: string): string {
  const match = value.match(/\\*\\*\\*\\s+Update File:\s+(.+)$/m)
  return match?.[1]?.trim() || ''
}

const latestWritePath = computed(() => {
  const messages = activeSession.value?.messages || []
  for (const message of [...messages].reverse()) {
    const toolName = String(message.toolName || '').toLowerCase()
    if (!['write_file', 'writefile', 'patch', 'apply_patch'].includes(toolName)) continue
    const args = toolArguments(message)
    const candidate = typeof args.path === 'string'
      ? args.path
      : typeof args.file_path === 'string'
        ? args.file_path
        : typeof args.patch === 'string'
          ? pathFromPatch(args.patch)
          : ''
    if (candidate.trim()) return candidate.trim().replace(/\\/g, '/')
  }
  return ''
})

function workspaceRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '')
  const workspace = workspacePath.value?.replace(/\\/g, '/').replace(/\/$/, '') || ''
  if (!workspace) return normalized
  const lowerPath = normalized.toLowerCase()
  const lowerWorkspace = workspace.toLowerCase()
  if (lowerPath === lowerWorkspace) return ''
  if (lowerPath.startsWith(`${lowerWorkspace}/`)) return normalized.slice(workspace.length + 1)
  return normalized
}

async function syncLiveEditor() {
  const sessionId = workspaceSessionId.value
  if (!sessionId || !chatStore.isSessionLive(sessionId) || liveFollowSuppressed.value) return
  const candidate = latestWritePath.value
  const relativePath = candidate ? workspaceRelativePath(candidate) : ''
  if (!relativePath) return

  const activePath = filesStore.editingFile?.workspaceRelativePath || ''
  if (activePath !== relativePath) {
    const previousFollowPath = liveAutoFollowPath.value
    liveAutoFollowPath.value = relativePath
    try {
      await filesStore.openEditorTab(relativePath, { profile: activeProfile.value })
    } catch {
      // The file may not exist yet while the tool is still writing it.
      if (liveAutoFollowPath.value === relativePath) liveAutoFollowPath.value = previousFollowPath
      return
    }
  }

  if (filesStore.editingFile?.workspaceRelativePath === relativePath) {
    await filesStore.refreshEditorFromWorkspace().catch(() => false)
  }
}

const liveSignature = computed(() => `${chatStore.activeSessionId}:${chatStore.isSessionLive(chatStore.activeSessionId || '')}:${latestWritePath.value}`)

const workspaceStyle = computed(() => ({
  '--code-terminal-height': `${terminalHeight.value}px`,
}))

function clampTerminalHeight(value: number): number {
  return Math.max(TERMINAL_MIN_HEIGHT, Math.min(TERMINAL_MAX_HEIGHT, Math.round(value)))
}

function loadTerminalHeight(): number {
  const stored = localStorage.getItem(TERMINAL_HEIGHT_STORAGE_KEY)
  if (!stored) return TERMINAL_DEFAULT_HEIGHT
  const value = Number(stored)
  return Number.isFinite(value) ? clampTerminalHeight(value) : TERMINAL_DEFAULT_HEIGHT
}

async function bindWorkspace(discardUnsavedChanges = false) {
  if (workspaceSessionId.value) {
    await filesStore.fetchEntries('', {
      profile: null,
      workspaceSessionId: workspaceSessionId.value,
      workspaceRoomId: null,
      discardUnsavedChanges,
    })
    return
  }
  filesStore.clearWorkspaceScope({ discardUnsavedChanges })
}

async function requestWorkspaceBinding() {
  try {
    await bindWorkspace()
  } catch (err: any) {
    if (err?.code !== 'unsaved_editor_changes') {
      message.error(t('files.backendError'))
      return
    }
    if (workspacePromptOpen) return
    workspacePromptOpen = true
    dialog.warning({
      title: t('files.unsavedChanges'),
      content: t('code.workspaceSwitchUnsaved'),
      positiveText: t('common.ok'),
      negativeText: t('common.cancel'),
      onPositiveClick: async () => {
        workspacePromptOpen = false
        await bindWorkspace(true)
      },
      onNegativeClick: () => {
        workspacePromptOpen = false
        void router.push({ name: 'hermes.chat' })
      },
      onClose: () => {
        workspacePromptOpen = false
      },
    })
  }
}

async function initializeWorkspace() {
  if (!profilesStore.activeProfileName || profilesStore.profiles.length === 0) {
    await profilesStore.fetchProfiles().catch(() => undefined)
  }
  if (!chatStore.sessionsLoaded) {
    await chatStore.loadSessions(chatStore.sessionProfileFilter).catch(() => undefined)
  }
  await requestWorkspaceBinding()
}

function requestedFilePath(): string {
  const value = route.query.openFile
  const path = Array.isArray(value) ? value[0] : value
  return typeof path === 'string' ? path.trim().replace(/\\/g, '/') : ''
}

async function openRequestedFile() {
  const path = requestedFilePath()
  if (!path || path === lastRequestedFile) return
  lastRequestedFile = path
  try {
    await filesStore.openEditorTab(path, { profile: activeProfile.value })
    // The query is a one-shot background command. Removing it keeps refreshes
    // harmless while preserving the current Code route and active tab.
    const nextQuery = { ...route.query }
    delete nextQuery.openFile
    await router.replace({ query: nextQuery })
    lastRequestedFile = ''
  } catch {
    lastRequestedFile = ''
    message.error(t('files.backendError'))
  }
}

function openChat() {
  void router.push({ name: 'hermes.chat' })
}

function openCodingAgents() {
  void router.push({
    name: 'hermes.codingAgents',
    query: {
      workspaceSessionId: workspaceSessionId.value || undefined,
      profile: activeProfile.value || undefined,
    },
  })
}

async function performCodeSessionSwitch(session: Session) {
  filesStore.clearWorkspaceScope({ discardUnsavedChanges: true })
  try {
    await chatStore.switchSession(session.id)
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('files.backendError'))
  }
}

function selectCodeSession(session: Session) {
  if (session.id === chatStore.activeSessionId) return
  if (!filesStore.hasAnyUnsavedChanges) {
    void performCodeSessionSwitch(session)
    return
  }
  dialog.warning({
    title: t('files.unsavedChanges'),
    content: t('code.workspaceSwitchUnsaved'),
    positiveText: t('common.ok'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => performCodeSessionSwitch(session),
  })
}

async function saveActiveFile() {
  if (!filesStore.editingFile) return
  try {
    await filesStore.saveEditor()
    message.success(t('files.saved'))
  } catch {
    message.error(t('files.saveFailed'))
  }
}

function closeEditorTab(tab: EditorTab) {
  const key = filesStore.editorTabKey(tab)
  if (!filesStore.editorTabHasUnsavedChanges(tab)) {
    filesStore.closeEditorTab(key)
    return
  }
  dialog.warning({
    title: t('files.unsavedChanges'),
    positiveText: t('common.ok'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => filesStore.closeEditorTab(key),
  })
}

function toggleTerminal() {
  terminalVisible.value = !terminalVisible.value
}

function startTerminalResize(event: PointerEvent) {
  if (!terminalVisible.value || event.button !== 0) return
  resizeStart = { y: event.clientY, height: terminalHeight.value }
  resizingTerminal.value = true
  window.addEventListener('pointermove', handleTerminalResize)
  window.addEventListener('pointerup', stopTerminalResize, { once: true })
  event.preventDefault()
}

function handleTerminalResize(event: PointerEvent) {
  if (!resizeStart) return
  terminalHeight.value = clampTerminalHeight(resizeStart.height + resizeStart.y - event.clientY)
}

function stopTerminalResize() {
  resizeStart = null
  resizingTerminal.value = false
  localStorage.setItem(TERMINAL_HEIGHT_STORAGE_KEY, String(terminalHeight.value))
  window.removeEventListener('pointermove', handleTerminalResize)
  window.removeEventListener('pointerup', stopTerminalResize)
}

watch(terminalVisible, value => {
  localStorage.setItem(TERMINAL_VISIBLE_STORAGE_KEY, String(value))
})

watch(() => filesStore.editingFile?.workspaceRelativePath, (activePath, previousPath) => {
  if (!liveAutoFollowPath.value || !previousPath || !activePath) return
  if (activePath !== liveAutoFollowPath.value) liveFollowSuppressed.value = true
})

watch(workspaceSessionId, () => {
  liveAutoFollowPath.value = ''
  liveFollowSuppressed.value = false
  void requestWorkspaceBinding()
})

watch(() => route.query.openFile, () => {
  void openRequestedFile()
})

watch(liveSignature, () => {
  void syncLiveEditor()
})

onMounted(() => {
  appStore.setPageSidebarExpanded(true)
  document.title = `${t('code.title')} · Hermes Studio`
  liveRefreshTimer = setInterval(() => {
    void syncLiveEditor()
  }, 700)
  void initializeWorkspace().then(async () => {
    await openRequestedFile()
    await syncLiveEditor()
  })
})

onBeforeUnmount(() => {
  if (liveRefreshTimer) clearInterval(liveRefreshTimer)
  liveRefreshTimer = null
  appStore.setPageSidebarExpanded(false)
  stopTerminalResize()
  document.title = 'Hermes Studio'
})
</script>

<template>
  <div
    class="code-workspace"
    :class="{ 'code-workspace--resizing': resizingTerminal }"
    :style="workspaceStyle"
  >
    <aside class="code-page-sidebar">
      <div class="code-page-sidebar-nav">
        <PageSidebarNav active="code" @primary="openChat" />
      </div>
      <CodeExplorer
        v-if="workspaceSessionId"
        :profile="activeProfile"
        :workspace-key="workspacePath"
      />
      <div v-else class="code-workspace-required">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
        </svg>
        <strong>{{ t('code.workspaceRequired') }}</strong>
        <span>{{ t('code.workspaceRequiredHint') }}</span>
        <NButton size="small" secondary @click="openChat">{{ t('code.returnToChat') }}</NButton>
      </div>
    </aside>
    <PageSidebarResizeHandle
      :offset="0"
      :label="t('chat.resizeSidebar')"
    />

    <main class="code-workbench">
      <header class="code-workbench-header">
        <div class="code-workspace-identity">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
          </svg>
          <div>
            <strong>{{ t('code.title') }}</strong>
            <span :title="workspacePath || activeProfile || t('code.workspace')">
              {{ workspacePath || activeProfile || t('code.workspace') }}
            </span>
            <span v-if="liveEditing" class="code-live-editing" role="status">
              <i aria-hidden="true" />{{ t('code.liveEditing') }}
            </span>
          </div>
        </div>
        <div class="code-workbench-actions">
          <NTooltip v-if="isSuperAdmin" trigger="hover">
            <template #trigger>
              <NButton quaternary circle size="small" :type="terminalVisible ? 'primary' : 'default'" @click="toggleTerminal">
                <template #icon>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="m7 9 3 3-3 3M13 15h4" />
                  </svg>
                </template>
              </NButton>
            </template>
            {{ terminalVisible ? t('code.hideTerminal') : t('code.showTerminal') }}
          </NTooltip>
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton quaternary circle size="small" @click="openCodingAgents">
                <template #icon>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                    <line x1="12" y1="20" x2="14" y2="4" />
                  </svg>
                </template>
              </NButton>
            </template>
            {{ t('code.codingAgents') }}
          </NTooltip>
        </div>
      </header>

      <section class="code-editor-group">
        <div class="code-editor-tabs">
          <div
            v-for="tab in filesStore.editorTabs"
            :key="filesStore.editorTabKey(tab)"
            class="code-editor-tab"
            :class="{ active: filesStore.activeEditorTabKey === filesStore.editorTabKey(tab) }"
            :title="tab.path"
            @click="filesStore.activateEditorTab(filesStore.editorTabKey(tab))"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 3h8l4 4v14H6z" />
              <path d="M14 3v5h5" />
            </svg>
            <span>{{ editorFileName(tab) }}</span>
            <i v-if="filesStore.editorTabHasUnsavedChanges(tab)" class="code-unsaved-dot" :title="t('files.unsavedChanges')" />
            <button type="button" :title="t('files.closeEditor')" @click.stop="closeEditorTab(tab)">×</button>
          </div>
          <div v-if="filesStore.editorTabs.length === 0" class="code-editor-tab code-editor-tab--welcome active">
            <span>{{ t('code.welcomeTab') }}</span>
          </div>
          <div class="code-editor-tab-spacer" />
          <NButton
            v-if="filesStore.editingFile"
            quaternary
            size="tiny"
            :disabled="!filesStore.hasUnsavedChanges"
            :title="t('files.saveFile')"
            @click="saveActiveFile"
          >
            <template #icon>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
            </template>
          </NButton>
        </div>
        <div class="code-editor-surface">
          <FileEditor
            v-if="filesStore.editingFile"
            :key="filesStore.activeEditorTabKey || 'editor'"
            :compact="true"
          />
          <div v-else class="code-editor-welcome">
            <div class="code-editor-welcome-icon">
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="8 9 4 12 8 15" />
                <polyline points="16 9 20 12 16 15" />
                <line x1="14" y1="5" x2="10" y2="19" />
              </svg>
            </div>
            <strong>{{ t('code.noFile') }}</strong>
            <span>{{ t('code.noFileHint') }}</span>
          </div>
        </div>
      </section>

      <section
        v-show="terminalVisible && isSuperAdmin"
        class="code-terminal-panel"
        :aria-label="t('code.terminal')"
      >
        <div class="code-terminal-resize-handle" @pointerdown="startTerminalResize" />
        <div class="code-terminal-header">
          <span class="active">{{ t('code.terminal') }}</span>
          <span>{{ t('code.problems') }}</span>
          <span>{{ t('code.output') }}</span>
        </div>
        <div class="code-terminal-content">
          <TerminalPanel
            :key="workspaceSessionId || workspacePath || 'terminal'"
            :visible="terminalVisible && isSuperAdmin"
            :workspace-session-id="workspaceSessionId"
          />
        </div>
      </section>
    </main>
    <CodeAssistantDock
      :workspace="workspacePath"
      :profile="activeProfile"
      @select-session="selectCodeSession"
    />
  </div>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.code-workspace {
  display: flex;
  width: 100%;
  height: calc(100 * var(--vh));
  min-width: 0;
  position: relative;
  overflow: hidden;
  background: $bg-card;
  color: $text-primary;
}

.code-workspace--resizing {
  cursor: row-resize;
  user-select: none;
}

.code-page-sidebar {
  width: var(--page-sidebar-width, #{$sidebar-width});
  min-width: var(--page-sidebar-width, #{$sidebar-width});
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: $bg-secondary;
  border-inline-end: 1px solid $border-color;
}

.code-page-sidebar-nav {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 58%;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: 12px;
}

.code-workspace-required {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: $text-muted;
  text-align: center;

  strong {
    color: $text-primary;
    font-size: 12px;
  }

  span {
    font-size: 11px;
    line-height: 1.45;
  }
}

.code-workbench {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: $bg-card;
}

.code-workbench-header {
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 12px;
  border-bottom: 1px solid $border-color;
  background: $bg-main-surface;
}

.code-workspace-identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;

  > svg {
    flex: 0 0 auto;
    color: $text-secondary;
  }

  div {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  strong {
    font-size: 13px;
    font-weight: 600;
  }

  span {
    max-width: min(62vw, 760px);
    overflow: hidden;
    color: $text-muted;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.code-live-editing {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: $accent-primary !important;
  font-size: 10px !important;
  font-weight: 600;

  i {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.14);
    animation: code-live-pulse 1.1s ease-in-out infinite;
  }
}

@keyframes code-live-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

.code-workbench-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.code-editor-group {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.code-editor-tabs {
  min-height: 35px;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid $border-color;
  background: $bg-secondary;
}

.code-editor-tab {
  min-width: 0;
  max-width: 260px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border-inline-end: 1px solid $border-color;
  color: $text-secondary;
  font-size: 12px;

  &.active {
    background: $bg-card;
    color: $text-primary;
    box-shadow: inset 0 2px 0 rgba(var(--accent-primary-rgb), 0.75);
  }

  > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button {
    width: 18px;
    height: 18px;
    margin-inline-start: 2px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;

    &:hover {
      background: rgba(var(--accent-primary-rgb), 0.09);
    }
  }
}

.code-editor-tab--welcome {
  color: $text-muted;
}

.code-editor-tab-spacer {
  flex: 1;
}

.code-unsaved-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: $accent-primary;
}

.code-editor-surface {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: $bg-card;
}

.code-editor-welcome {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 7px;
  padding: 30px;
  color: $text-muted;
  text-align: center;

  strong {
    color: $text-secondary;
    font-size: 14px;
    font-weight: 500;
  }

  span {
    max-width: 420px;
    font-size: 12px;
  }
}

.code-editor-welcome-icon {
  margin-bottom: 7px;
  color: rgba(var(--accent-primary-rgb), 0.52);
}

.code-terminal-panel {
  position: relative;
  height: var(--code-terminal-height);
  min-height: 0;
  flex: 0 0 var(--code-terminal-height);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid $border-color;
  background: $bg-card;
}

.code-terminal-resize-handle {
  position: absolute;
  z-index: 3;
  top: -3px;
  right: 0;
  left: 0;
  height: 7px;
  cursor: row-resize;

  &:hover,
  &:active {
    background: rgba(var(--accent-primary-rgb), 0.36);
  }
}

.code-terminal-header {
  min-height: 31px;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 12px;
  border-bottom: 1px solid $border-light;
  background: $bg-secondary;
  color: $text-muted;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;

  span.active {
    color: $text-primary;
  }
}

.code-terminal-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

@media (max-width: $breakpoint-mobile) {
  .code-page-sidebar {
    width: 210px;
    min-width: 210px;
  }

  .code-terminal-panel {
    --code-terminal-height: 220px;
  }
}
</style>
