<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NModal, NSelect, NTooltip, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import MessageList from '@/components/hermes/chat/MessageList.vue'
import ChatInput from '@/components/hermes/chat/ChatInput.vue'
import SessionListItem from '@/components/hermes/chat/SessionListItem.vue'
import SubagentStreamPanel from '@/components/hermes/chat/SubagentStreamPanel.vue'
import RealtimeVoiceStage from '@/components/hermes/chat/RealtimeVoiceStage.vue'
import { useChatStore, type Session } from '@/stores/hermes/chat'
import type { SessionStatus } from '@/utils/hermes/session-status'
import { useAppStore } from '@/stores/hermes/app'
import { useProfilesStore } from '@/stores/hermes/profiles'
import { OPEN_SUBAGENT_STREAM_EVENT, type OpenSubagentStreamDetail } from '@/utils/hermes/subagent-stream'
import { registerVisibleChatSurface, unregisterVisibleChatSurface } from '@/utils/hermes/chat-surface-visibility'

const WIDTH_STORAGE_KEY = 'hermes.code.assistantWidth'
const COLLAPSED_STORAGE_KEY = 'hermes.code.assistantCollapsed'
const TAB_STORAGE_KEY = 'hermes.code.assistantTab'
const MIN_WIDTH = 320
const DEFAULT_WIDTH = 390
const MAX_WIDTH = 680

const props = defineProps<{
  workspace?: string | null
  profile?: string | null
}>()
const emit = defineEmits<{
  'select-session': [session: Session]
}>()

const { t } = useI18n()
const message = useMessage()
const chatStore = useChatStore()
const appStore = useAppStore()
const profilesStore = useProfilesStore()
const storedTab = typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_STORAGE_KEY) : null
const activeTab = ref<'chat' | 'history'>(storedTab === 'history' ? 'history' : 'chat')
const collapsed = ref(typeof localStorage !== 'undefined' && localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true')
const width = ref(loadWidth())
const search = ref('')
const historyLoading = ref(false)
const showModelPicker = ref(false)
const selectedModelKey = ref('')
const switchingModel = ref(false)
const selectedSubagent = ref<OpenSubagentStreamDetail | null>(null)
const showRealtimeVoice = ref(false)
let resizeStart: { x: number; width: number } | null = null

const dockStyle = computed(() => ({
  '--code-assistant-width': `${collapsed.value ? 42 : width.value}px`,
}))
const activeSessionTitle = computed(() =>
  chatStore.activeSession?.title?.trim() || t('chat.newChat'),
)
const chatReady = computed(() =>
  chatStore.sessionsLoaded && Boolean(chatStore.activeSessionId && chatStore.activeSession),
)
const activeSessionModelLabel = computed(() => {
  const session = chatStore.activeSession
  if (!session?.model) return t('models.selectModel')
  if (session.provider === 'moa') return `MoA · ${session.model}`
  return appStore.displayModelName(session.model, session.provider)
})
const historySessions = computed(() => {
  const query = search.value.trim().toLowerCase()
  return [...chatStore.sessions]
    .filter(session => session.source !== 'group_chat' && session.source !== 'workflow')
    .filter(session => {
      if (!query) return true
      return `${session.title || ''} ${session.profile || ''} ${session.model || ''}`.toLowerCase().includes(query)
    })
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
})
const effectiveProfile = computed(() =>
  props.profile || chatStore.activeSession?.profile || profilesStore.activeProfileName || 'default',
)
const modelGroups = computed(() =>
  appStore.profileModelGroups.find(item => item.profile === effectiveProfile.value)?.groups
  || appStore.modelGroups,
)
const modelOptions = computed(() => modelGroups.value.flatMap(group =>
  group.models.map(model => ({
    label: `${group.label || group.provider} · ${appStore.displayModelName(model, group.provider)}`,
    value: JSON.stringify([group.provider, model]),
    disabled: Boolean(group.model_meta?.[model]?.disabled),
  })),
))
const selectedSubagentStream = computed(() => {
  const selected = selectedSubagent.value
  return selected ? chatStore.getSubagentStream(selected.sessionId, selected.subagentId) : null
})

function sessionStatusFor(sessionId: string): SessionStatus {
  return typeof chatStore.getSessionStatus === 'function'
    ? chatStore.getSessionStatus(sessionId)
    : 'none'
}

function loadWidth(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_WIDTH
  const value = Number(localStorage.getItem(WIDTH_STORAGE_KEY))
  return Number.isFinite(value) ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value))) : DEFAULT_WIDTH
}

function setActiveTab(tab: 'chat' | 'history') {
  activeTab.value = tab
  localStorage.setItem(TAB_STORAGE_KEY, tab)
}

function toggleCollapsed() {
  collapsed.value = !collapsed.value
  localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed.value))
}

function handleResizeMove(event: PointerEvent) {
  if (!resizeStart) return
  const nextWidth = resizeStart.width + (resizeStart.x - event.clientX)
  width.value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(nextWidth)))
}

function stopResize() {
  if (!resizeStart) return
  resizeStart = null
  window.removeEventListener('pointermove', handleResizeMove)
  window.removeEventListener('pointerup', stopResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  localStorage.setItem(WIDTH_STORAGE_KEY, String(width.value))
}

function startResize(event: PointerEvent) {
  if (collapsed.value) return
  event.preventDefault()
  resizeStart = { x: event.clientX, width: width.value }
  window.addEventListener('pointermove', handleResizeMove)
  window.addEventListener('pointerup', stopResize)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

async function refreshHistory() {
  historyLoading.value = true
  try {
    await chatStore.loadSessions(chatStore.sessionProfileFilter)
  } finally {
    historyLoading.value = false
  }
}

async function selectHistorySession(session: Session) {
  selectedSubagent.value = null
  if (chatStore.activeSessionId !== session.id) emit('select-session', session)
  setActiveTab('chat')
}

function createWorkspaceChat() {
  selectedSubagent.value = null
  chatStore.newChat({
    profile: effectiveProfile.value,
    model: appStore.selectedModel || undefined,
    provider: appStore.selectedProvider || undefined,
    workspace: props.workspace || null,
  })
  setActiveTab('chat')
}

function handleOpenSubagentStream(event: Event) {
  const detail = (event as CustomEvent<OpenSubagentStreamDetail>).detail
  if (!detail?.sessionId || detail.sessionId !== chatStore.activeSessionId) return
  selectedSubagent.value = detail
  setActiveTab('chat')
}

function syncVisibleChatSurface() {
  unregisterVisibleChatSurface('code-assistant')
  if (!collapsed.value && activeTab.value === 'chat' && chatReady.value && chatStore.activeSessionId) {
    registerVisibleChatSurface('code-assistant', chatStore.activeSessionId)
  }
}

watch([collapsed, activeTab, () => chatStore.activeSessionId, chatReady], syncVisibleChatSurface, { immediate: true })

async function openModelPicker() {
  if (appStore.modelGroups.length === 0 && appStore.profileModelGroups.length === 0) {
    await appStore.loadModels()
  }
  const session = chatStore.activeSession
  selectedModelKey.value = session?.provider && session?.model
    ? JSON.stringify([session.provider, session.model])
    : ''
  showModelPicker.value = true
}

async function applySelectedModel(value: string) {
  if (!value || !chatStore.activeSessionId) return
  let provider = ''
  let model = ''
  try {
    ;[provider, model] = JSON.parse(value)
  } catch {
    return
  }
  if (!provider || !model) return
  switchingModel.value = true
  try {
    const ok = await chatStore.switchSessionModel(model, provider, chatStore.activeSessionId)
    if (!ok) {
      message.error(t('chat.modelSetFailed'))
      return
    }
    showModelPicker.value = false
    message.success(t('chat.modelSet'))
  } finally {
    switchingModel.value = false
  }
}

onMounted(async () => {
  window.addEventListener(OPEN_SUBAGENT_STREAM_EVENT, handleOpenSubagentStream)
  if (!chatStore.sessionsLoaded) await refreshHistory().catch(() => undefined)
  if (appStore.modelGroups.length === 0 && appStore.profileModelGroups.length === 0) {
    void appStore.loadModels()
  }
})

onBeforeUnmount(() => {
  stopResize()
  unregisterVisibleChatSurface('code-assistant')
  window.removeEventListener(OPEN_SUBAGENT_STREAM_EVENT, handleOpenSubagentStream)
})
</script>

<template>
  <aside
    class="code-assistant-dock"
    :class="{ 'code-assistant-dock--collapsed': collapsed }"
    :style="dockStyle"
    :aria-label="t('code.assistantTitle')"
  >
    <div v-if="!collapsed" class="code-assistant-resize-handle" @pointerdown="startResize" />

    <template v-if="collapsed">
      <NTooltip trigger="hover" placement="left">
        <template #trigger>
          <button class="code-assistant-expand" type="button" @click="toggleCollapsed">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
            </svg>
          </button>
        </template>
        {{ t('code.showAssistant') }}
      </NTooltip>
    </template>

    <template v-else>
      <header class="code-assistant-header">
        <div class="code-assistant-heading">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="7" width="14" height="11" rx="3" />
            <path d="M12 3v4M9 12h.01M15 12h.01M9 15h6" />
          </svg>
          <div>
            <strong>{{ t('code.assistantTitle') }}</strong>
            <span :title="activeSessionTitle">{{ activeSessionTitle }}</span>
          </div>
        </div>
        <NButton quaternary circle size="tiny" :title="t('code.hideAssistant')" @click="toggleCollapsed">
          <template #icon>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="9 18 15 12 9 6"/></svg>
          </template>
        </NButton>
      </header>

      <div class="code-assistant-tabs" role="tablist" :aria-label="t('code.assistantTitle')">
        <button type="button" role="tab" :aria-selected="activeTab === 'chat'" :class="{ active: activeTab === 'chat' }" @click="setActiveTab('chat')">
          {{ t('code.assistantChat') }}
        </button>
        <button type="button" role="tab" :aria-selected="activeTab === 'history'" :class="{ active: activeTab === 'history' }" @click="setActiveTab('history')">
          {{ t('code.assistantHistory') }}
          <span>{{ historySessions.length }}</span>
        </button>
      </div>

      <section v-if="activeTab === 'chat'" class="code-assistant-chat">
        <SubagentStreamPanel
          v-if="selectedSubagentStream"
          :stream="selectedSubagentStream"
          @close="selectedSubagent = null"
        />
        <template v-else-if="chatReady">
          <MessageList
            :approval-portal-to-body="showRealtimeVoice"
            scroll-scope="code-assistant"
          />
          <ChatInput
            :model-label="activeSessionModelLabel"
            @model-click="openModelPicker"
            @voice-click="showRealtimeVoice = true"
          />
        </template>
        <div v-else class="code-assistant-empty">
          <span>{{ t('code.assistantNoChat') }}</span>
          <NButton size="small" type="primary" @click="createWorkspaceChat">{{ t('chat.newChat') }}</NButton>
        </div>
      </section>

      <section v-else class="code-assistant-history">
        <div class="code-assistant-history-toolbar">
          <NInput v-model:value="search" size="small" clearable :placeholder="t('code.assistantSearchHistory')" />
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton quaternary circle size="small" :loading="historyLoading" @click="refreshHistory">
                <template #icon>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 11a8 8 0 1 0-2.34 5.66"/><polyline points="20 4 20 11 13 11"/></svg>
                </template>
              </NButton>
            </template>
            {{ t('common.refresh') }}
          </NTooltip>
          <NButton size="small" type="primary" secondary @click="createWorkspaceChat">+</NButton>
        </div>
        <div class="code-assistant-session-list">
          <SessionListItem
            v-for="session in historySessions"
            :key="session.id"
            :session="session"
            :active="session.id === chatStore.activeSessionId"
            :pinned="false"
            :can-delete="false"
            :streaming="chatStore.isSessionLive(session.id)"
            :status="sessionStatusFor(session.id)"
            :completed-unread="chatStore.isSessionCompletedUnread(session.id)"
            :show-profile="true"
            @select="selectHistorySession(session)"
          />
          <div v-if="historySessions.length === 0" class="code-assistant-empty">{{ t('chat.noSessions') }}</div>
        </div>
      </section>

      <NModal v-model:show="showModelPicker" preset="card" :title="t('chat.setModelTitle')" :style="{ width: 'min(480px, calc(100vw - 32px))' }">
        <NSelect
          v-model:value="selectedModelKey"
          filterable
          :options="modelOptions"
          :loading="switchingModel"
          :placeholder="t('models.searchPlaceholder')"
          @update:value="applySelectedModel"
        />
      </NModal>
      <Teleport to="body">
        <RealtimeVoiceStage
          v-if="showRealtimeVoice"
          @close="showRealtimeVoice = false"
        />
      </Teleport>
    </template>
  </aside>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.code-assistant-dock {
  position: relative;
  width: var(--code-assistant-width);
  min-width: var(--code-assistant-width);
  max-width: min(52vw, 680px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-inline-start: 1px solid $border-color;
  background: $bg-main-surface;
  color: $text-primary;
}

.code-assistant-dock--collapsed {
  align-items: center;
  background: $bg-secondary;
}

.code-assistant-resize-handle {
  position: absolute;
  z-index: 5;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 7px;
  cursor: col-resize;

  &:hover,
  &:active {
    background: rgba(var(--accent-primary-rgb), 0.32);
  }
}

.code-assistant-expand {
  width: 34px;
  height: 34px;
  margin-top: 9px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: $radius-sm;
  background: transparent;
  color: $text-secondary;
  cursor: pointer;

  &:hover {
    background: rgba(var(--accent-primary-rgb), 0.08);
    color: $text-primary;
  }
}

.code-assistant-header {
  min-height: 48px;
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 9px 6px 12px;
  border-bottom: 1px solid $border-color;
}

.code-assistant-heading {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;

  > svg {
    flex: 0 0 auto;
    color: $text-secondary;
  }

  div {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  strong {
    font-size: 12px;
    font-weight: 600;
  }

  span {
    overflow: hidden;
    color: $text-muted;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.code-assistant-tabs {
  min-height: 34px;
  flex: 0 0 34px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  padding: 2px;
  border-bottom: 1px solid $border-light;
  background: $bg-secondary;

  button {
    min-width: 0;
    border: 0;
    border-radius: $radius-sm;
    background: transparent;
    color: $text-muted;
    font-size: 11px;
    cursor: pointer;

    &.active {
      background: $bg-card;
      color: $text-primary;
      box-shadow: inset 0 -2px 0 rgba(var(--accent-primary-rgb), 0.75);
    }

    span {
      margin-inline-start: 4px;
      color: $text-muted;
      font-size: 9px;
    }
  }
}

.code-assistant-chat,
.code-assistant-history {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.code-assistant-chat :deep(.message-list-shell) {
  min-height: 0;
}

.code-assistant-chat :deep(.virtual-message-list) {
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.code-assistant-chat :deep(.chat-input-area) {
  padding: 8px;
}

.code-assistant-chat :deep(.input-wrapper) {
  max-width: none;
}

.code-assistant-history-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px;
  border-bottom: 1px solid $border-light;
}

.code-assistant-session-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  padding: 6px;
}

.code-assistant-empty {
  flex: 1;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  color: $text-muted;
  font-size: 12px;
  text-align: center;
}

@media (max-width: 1000px) {
  .code-assistant-dock:not(.code-assistant-dock--collapsed) {
    position: absolute;
    z-index: 80;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(420px, 88vw);
    min-width: min(420px, 88vw);
    max-width: 88vw;
    box-shadow: -12px 0 28px rgba(0, 0, 0, 0.22);
  }
}
</style>
