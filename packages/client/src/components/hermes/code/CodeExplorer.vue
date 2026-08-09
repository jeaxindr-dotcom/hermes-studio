<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { NButton, NEmpty, NSpin, NTree } from 'naive-ui'
import type { TreeOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useFilesStore } from '@/stores/hermes/files'
import type { FileEntry } from '@/api/hermes/files'

const props = defineProps<{
  profile?: string | null
  workspaceKey?: string | null
}>()

const { t } = useI18n()
const filesStore = useFilesStore()
const treeData = ref<TreeOption[]>([])
const selectedKeys = ref<Array<string | number>>([])
const expandedKeys = ref<Array<string | number>>([])
const treeInstanceKey = ref(0)
const loading = ref(false)
let loadSequence = 0

const effectiveProfile = computed(() =>
  props.profile === undefined ? filesStore.currentProfile : props.profile,
)
const rootLabel = computed(() => {
  const workspace = props.workspaceKey?.replace(/\\/g, '/').replace(/\/$/, '')
  if (workspace) return workspace.split('/').pop() || workspace
  return effectiveProfile.value || t('code.workspace')
})

function toTreeOption(entry: FileEntry): TreeOption {
  return {
    key: entry.path,
    label: entry.name,
    isLeaf: !entry.isDir,
    isDir: entry.isDir,
    rawEntry: entry,
  }
}

async function listPath(path: string): Promise<TreeOption[]> {
  const result = filesStore.currentWorkspaceSessionId || filesStore.currentWorkspaceRoomId
    ? await filesStore.listEntries(path)
    : await filesStore.fetchDirectory(path, { profile: effectiveProfile.value })
  return [...result.entries]
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    .map(toTreeOption)
}

async function loadRoot() {
  const sequence = ++loadSequence
  loading.value = true
  try {
    const next = await listPath('')
    if (sequence !== loadSequence) return
    treeData.value = next
    treeInstanceKey.value += 1
  } catch {
    if (sequence === loadSequence) treeData.value = []
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

async function handleLoad(node: TreeOption): Promise<void> {
  if (node.isLeaf) return
  node.children = await listPath(String(node.key || ''))
}

async function handleSelect(
  keys: Array<string | number>,
  options: Array<TreeOption | null>,
) {
  const option = options[0]
  if (!option) return
  selectedKeys.value = keys
  const path = String(option.key || '')
  if (!path) return
  if (option.isDir) {
    await filesStore.navigateTo(path, { profile: effectiveProfile.value })
    if (!expandedKeys.value.includes(path)) expandedKeys.value = [...expandedKeys.value, path]
    return
  }
  await filesStore.openEditorTab(path, { profile: effectiveProfile.value })
}

function renderLabel({ option }: { option: TreeOption }) {
  const isDir = option.isDir === true
  const icon = isDir
    ? h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
        h('path', { d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z' }),
      ])
    : h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [
        h('path', { d: 'M6 3h8l4 4v14H6z' }),
        h('path', { d: 'M14 3v5h5' }),
      ])
  return h('span', { class: 'code-tree-label', title: String(option.label || '') }, [
    icon,
    h('span', { class: 'code-tree-name' }, String(option.label || '')),
  ])
}

watch(
  [effectiveProfile, () => filesStore.currentWorkspaceSessionId, () => filesStore.currentWorkspaceRoomId, () => props.workspaceKey],
  () => {
    selectedKeys.value = []
    expandedKeys.value = []
    void loadRoot()
  },
  { immediate: true },
)
</script>

<template>
  <section class="code-explorer" aria-label="Explorer">
    <header class="code-explorer-header">
      <div class="code-explorer-title">
        <span>{{ t('code.explorer') }}</span>
        <strong :title="workspaceKey || rootLabel">{{ rootLabel }}</strong>
      </div>
      <NButton quaternary circle size="tiny" :title="t('code.refreshExplorer')" @click="loadRoot">
        <template #icon>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15A9 9 0 1 1 18.36 5.64L23 10" />
          </svg>
        </template>
      </NButton>
    </header>
    <div class="code-explorer-tree">
      <NSpin :show="loading">
        <NEmpty v-if="!loading && treeData.length === 0" size="small" :description="t('files.emptyDir')" />
        <NTree
          v-else
          :key="treeInstanceKey"
          :data="treeData"
          :selected-keys="selectedKeys"
          :expanded-keys="expandedKeys"
          :on-load="handleLoad"
          :render-label="renderLabel"
          :indent="12"
          block-line
          expand-on-click
          @update:selected-keys="handleSelect"
          @update:expanded-keys="expandedKeys = $event"
        />
      </NSpin>
    </div>
  </section>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.code-explorer {
  min-height: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  border-top: 1px solid $border-light;
}

.code-explorer-header {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 7px 12px;
  border-bottom: 1px solid $border-light;
}

.code-explorer-title {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;

  span {
    color: $text-muted;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  strong {
    overflow: hidden;
    color: $text-primary;
    font-size: 12px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.code-explorer-tree {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

:deep(.code-tree-label) {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;

  svg {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

:deep(.code-tree-name) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.n-tree-node-content) {
  min-width: 0;
}
</style>
