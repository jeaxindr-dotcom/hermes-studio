<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore, type SubagentStream, type SubagentStreamStatus } from '@/stores/hermes/chat'
import { openSubagentStream } from '@/utils/hermes/subagent-stream'
import { fetchPersistedSessionActivity } from '@/api/hermes/sessions'
import {
  latestTodoSnapshot,
  subagentStreamsForSession,
  type SessionTodoSnapshot,
  type SessionTodoStatus,
} from '@/utils/hermes/session-activity'

const STORAGE_KEY = 'hermes.sessionActivity.activeTab'
const { t } = useI18n()
const chatStore = useChatStore()
const storedTab = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
const activeTab = ref<'tasks' | 'agents'>(storedTab === 'agents' ? 'agents' : 'tasks')
const persistedTodo = ref<SessionTodoSnapshot | null>(null)
let activityPoll: ReturnType<typeof setInterval> | null = null
let activityRequestSequence = 0

function summarizePersistedTodo(
  value: { items: SessionTodoSnapshot['items']; updatedAt: number } | null,
): SessionTodoSnapshot | null {
  if (!value) return null
  const completed = value.items.filter(item => item.status === 'completed').length
  const inProgress = value.items.filter(item => item.status === 'in_progress').length
  const pending = value.items.filter(item => item.status === 'pending').length
  const cancelled = value.items.filter(item => item.status === 'cancelled').length
  return {
    ...value,
    summary: { total: value.items.length, completed, inProgress, pending, cancelled },
  }
}

const todoSnapshot = computed(() => {
  const live = latestTodoSnapshot(chatStore.messages)
  if (!persistedTodo.value || (live && live.updatedAt >= persistedTodo.value.updatedAt)) return live
  return persistedTodo.value
})
const streams = computed(() =>
  subagentStreamsForSession(chatStore.subagentStreams, chatStore.activeSessionId),
)
const runningAgents = computed(() => streams.value.filter(stream => stream.status === 'running').length)
const completedTasks = computed(() => todoSnapshot.value?.summary.completed || 0)
const totalTasks = computed(() => todoSnapshot.value?.summary.total || 0)
const visibleTasks = computed(() => todoSnapshot.value?.items.slice(0, 3) || [])
const taskProgress = computed(() =>
  totalTasks.value > 0 ? Math.round((completedTasks.value / totalTasks.value) * 100) : 0,
)

watch(activeTab, tab => {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, tab)
})

async function refreshPersistedActivity() {
  const sessionId = chatStore.activeSessionId
  const sequence = ++activityRequestSequence
  if (!sessionId) {
    persistedTodo.value = null
    return
  }
  const activity = await fetchPersistedSessionActivity(sessionId, chatStore.activeSession?.profile)
  if (sequence !== activityRequestSequence || sessionId !== chatStore.activeSessionId || !activity) return

  persistedTodo.value = summarizePersistedTodo(activity.todo)
  const existingStreams = subagentStreamsForSession(chatStore.subagentStreams, sessionId)
  for (const persisted of activity.streams) {
    const exactKey = `${sessionId}:${persisted.subagentId}`
    const matchingLiveStream = existingStreams.find(stream =>
      !stream.subagentId.startsWith('persisted:') &&
      stream.taskIndex === persisted.taskIndex &&
      stream.goal?.trim() === persisted.goal?.trim() &&
      Math.abs(stream.startedAt - persisted.startedAt) < 60_000,
    )
    if (matchingLiveStream) {
      chatStore.subagentStreams.delete(exactKey)
    } else {
      chatStore.subagentStreams.set(exactKey, persisted as SubagentStream)
    }
  }
}

watch(() => chatStore.activeSessionId, () => {
  persistedTodo.value = null
  void refreshPersistedActivity()
})

onMounted(() => {
  void refreshPersistedActivity()
  activityPoll = setInterval(() => void refreshPersistedActivity(), 5_000)
})

onBeforeUnmount(() => {
  activityRequestSequence += 1
  if (activityPoll) clearInterval(activityPoll)
  activityPoll = null
})

function taskSymbol(status: SessionTodoStatus): string {
  if (status === 'completed') return '✓'
  if (status === 'cancelled') return '×'
  return ''
}

function agentStatusLabel(status: SubagentStreamStatus): string {
  if (status === 'completed') return t('activity.completed')
  if (status === 'running') return t('activity.running')
  if (status === 'cancelled') return t('activity.cancelled')
  if (status === 'interrupted') return t('activity.interrupted')
  return t('activity.failed')
}

function agentStatusSymbol(status: SubagentStreamStatus): string {
  if (status === 'completed') return '✓'
  if (status === 'running') return ''
  if (status === 'cancelled' || status === 'interrupted') return '–'
  return '!'
}

function agentLabel(stream: SubagentStream): string {
  return stream.goal?.trim() || t('activity.agent', { index: stream.taskIndex + 1 })
}

function openAgent(stream: SubagentStream) {
  openSubagentStream(chatStore.activeSessionId, `subagent:${stream.subagentId}`)
}

function activityWheelDelta(event: WheelEvent, element: HTMLElement): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * element.clientHeight
  return event.deltaY
}

function handleActivityWheel(event: WheelEvent) {
  const element = event.currentTarget
  if (!(element instanceof HTMLElement) || event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  const delta = activityWheelDelta(event, element)
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  const nextScrollTop = Math.min(maxScrollTop, Math.max(0, element.scrollTop + delta))
  if (Math.abs(nextScrollTop - element.scrollTop) < 1) return

  event.preventDefault()
  event.stopPropagation()
  element.scrollTop = nextScrollTop
}

</script>

<template>
  <section class="session-activity-panel">
    <div class="activity-mode-switch" role="tablist" :aria-label="t('activity.title')">
      <button
        class="activity-mode-tab"
        :class="{ active: activeTab === 'tasks' }"
        type="button"
        role="tab"
        :aria-label="t('activity.tasks')"
        :aria-selected="activeTab === 'tasks'"
        @click="activeTab = 'tasks'"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        <span>{{ t('activity.tasks') }}</span>
        <b>{{ completedTasks }}/{{ totalTasks }}</b>
      </button>
      <button
        class="activity-mode-tab"
        :class="{ active: activeTab === 'agents' }"
        type="button"
        role="tab"
        :aria-label="t('activity.agents')"
        :aria-selected="activeTab === 'agents'"
        @click="activeTab = 'agents'"
      >
        <svg class="robot-head-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="12" y1="2.5" x2="12" y2="6" />
          <circle cx="12" cy="2.5" r=".8" fill="currentColor" stroke="none" />
          <rect x="5" y="6" width="14" height="12" rx="3" />
          <path d="M5 10H3.8v4H5M19 10h1.2v4H19" />
          <circle cx="9.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
          <line x1="9.5" y1="15" x2="14.5" y2="15" />
        </svg>
        <span>{{ t('activity.agents') }}</span>
        <b :class="{ live: runningAgents > 0 }">{{ streams.length }}</b>
      </button>
    </div>

    <div v-if="activeTab === 'tasks'" class="activity-content activity-task-content" @wheel="handleActivityWheel">
      <template v-if="todoSnapshot">
        <div class="activity-progress-head">
          <span>{{ t('activity.progress') }}</span>
          <strong class="activity-progress-count">{{ completedTasks }}/{{ totalTasks }}</strong>
        </div>
        <div class="activity-progress-track" aria-hidden="true">
          <i :style="{ width: `${taskProgress}%` }" />
        </div>
        <div class="activity-list">
          <div
            v-for="task in visibleTasks"
            :key="task.id"
            class="activity-task-row"
            :class="`activity-task-row--${task.status}`"
            :title="task.content"
          >
            <span class="activity-task-status" aria-hidden="true">{{ taskSymbol(task.status) }}</span>
            <span class="activity-task-content-text">{{ task.content }}</span>
          </div>
        </div>
      </template>
      <div v-else class="activity-empty">{{ t('activity.noTasks') }}</div>
    </div>

    <div v-else class="activity-content activity-agent-content" @wheel="handleActivityWheel">
      <template v-if="streams.length > 0">
        <div class="activity-delegation-root">
          <svg class="robot-head-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="12" y1="2.5" x2="12" y2="6" />
            <circle cx="12" cy="2.5" r=".8" fill="currentColor" stroke="none" />
            <rect x="5" y="6" width="14" height="12" rx="3" />
            <circle cx="9.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
            <circle cx="14.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
            <line x1="9.5" y1="15" x2="14.5" y2="15" />
          </svg>
          <span>{{ t('activity.delegationRoot') }}</span>
        </div>
        <div class="activity-agent-tree">
          <button
            v-for="stream in streams"
            :key="stream.subagentId"
            class="activity-agent-row"
            :class="`activity-agent-row--${stream.status}`"
            type="button"
            :title="agentLabel(stream)"
            @click="openAgent(stream)"
          >
            <span class="activity-tree-branch" aria-hidden="true">{{ stream.taskIndex === streams.length - 1 ? '└' : '├' }}─</span>
            <span class="activity-agent-copy">
              <strong>{{ agentLabel(stream) }}</strong>
              <small>
                {{ t('activity.agent', { index: stream.taskIndex + 1 }) }}
                <template v-if="stream.model"> · {{ stream.model }}</template>
              </small>
            </span>
            <span
              class="activity-agent-status"
              :class="{ running: stream.status === 'running' }"
              :title="agentStatusLabel(stream.status)"
              aria-hidden="true"
            >{{ agentStatusSymbol(stream.status) }}</span>
          </button>
        </div>
      </template>
      <div v-else class="activity-empty">{{ t('activity.noAgents') }}</div>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.session-activity-panel {
  height: 232px;
  box-sizing: border-box;
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid $border-light;
  border-radius: $radius-sm;
  background: rgba(var(--bg-main-surface-rgb), 0.4);
}

.activity-mode-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  padding: 2px;
  border-bottom: 1px solid $border-light;
  background: rgba(var(--accent-primary-rgb), 0.04);
}

.activity-mode-tab {
  min-width: 0;
  height: 29px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: $text-secondary;
  cursor: pointer;
  font-size: 11px;
  transition: background-color $transition-fast, color $transition-fast;

  > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  b {
    min-width: 21px;
    padding: 1px 5px;
    border-radius: 999px;
    background: rgba(var(--text-muted-rgb), 0.12);
    color: $text-muted;
    font-size: 9px;
    font-weight: 600;
    line-height: 15px;

    &.live {
      background: rgba(var(--accent-primary-rgb), 0.13);
      color: $accent-primary;
    }
  }

  &:hover {
    color: $text-primary;
  }

  &.active {
    background: $bg-card-hover;
    color: $text-primary;
    box-shadow: inset 0 0 0 1px $border-color, 0 1px 3px rgba(0, 0, 0, 0.16);
  }
}

.robot-head-icon {
  flex: 0 0 auto;
}

.activity-content {
  height: 196px;
  box-sizing: border-box;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 8px;
  scrollbar-width: thin;
}

.activity-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: $text-muted;
  font-size: 10px;
}

.activity-progress-count {
  color: $text-secondary;
  font-size: 10px;
  font-weight: 600;
}

.activity-progress-track {
  height: 3px;
  margin: 5px 0 7px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(var(--text-muted-rgb), 0.14);

  i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: $accent-primary;
    transition: width $transition-normal;
  }
}

.activity-list,
.activity-agent-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.activity-task-content {
  overflow: hidden;
}

.activity-task-row {
  min-width: 0;
  min-height: 24px;
  max-height: 40px;
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 4px 5px;
  border-radius: 5px;
  color: $text-secondary;
  font-size: 11px;
  line-height: 16px;

  &:hover {
    background: rgba(var(--accent-primary-rgb), 0.05);
  }
}

.activity-task-status {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  border: 1px solid $border-color;
  border-radius: 50%;
  color: $text-muted;
  font-size: 9px;
}

.activity-task-row--completed {
  color: $text-muted;

  .activity-task-status {
    border-color: rgba(var(--accent-primary-rgb), 0.48);
    background: rgba(var(--accent-primary-rgb), 0.12);
    color: $accent-primary;
  }

  .activity-task-content-text {
    text-decoration: line-through;
    opacity: 0.72;
  }
}

.activity-task-row--in_progress {
  color: $text-primary;

  .activity-task-status {
    border-color: $accent-primary;
    box-shadow: inset 0 0 0 3px $bg-card;
    background: $accent-primary;
    animation: activity-pulse 1.6s ease-in-out infinite;
  }
}

.activity-task-row--cancelled {
  opacity: 0.62;
}

.activity-task-content-text {
  min-width: 0;
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.activity-delegation-root {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
  padding: 0 4px;
  color: $text-secondary;
  font-size: 10px;
  font-weight: 600;
}

.activity-agent-row {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 1px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: $text-secondary;
  text-align: start;
  cursor: pointer;

  &:hover {
    background: rgba(var(--accent-primary-rgb), 0.06);
    color: $text-primary;
  }
}

.activity-tree-branch {
  flex: 0 0 auto;
  color: $text-muted;
  font-family: Consolas, "SFMono-Regular", monospace;
  font-size: 10px;
}

.activity-agent-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: inherit;
    font-size: 10.5px;
    font-weight: 500;
  }

  small {
    color: $text-muted;
    font-size: 9px;
  }
}

.activity-agent-status {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: $text-muted;
  font-size: 10px;

  &.running {
    width: 7px;
    height: 7px;
    margin: 4px;
    background: $accent-primary;
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.12);
    animation: activity-pulse 1.6s ease-in-out infinite;
  }
}

.activity-agent-row--completed .activity-agent-status {
  color: $accent-primary;
}

.activity-agent-row--failed .activity-agent-status,
.activity-agent-row--error .activity-agent-status {
  color: $error;
}

.activity-empty {
  padding: 10px 4px;
  color: $text-muted;
  font-size: 11px;
  text-align: center;
}

@keyframes activity-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
</style>
