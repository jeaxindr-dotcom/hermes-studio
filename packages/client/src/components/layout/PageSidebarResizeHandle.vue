<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  emitPageSidebarWidthChanged,
  PAGE_SIDEBAR_DEFAULT_WIDTH,
  PAGE_SIDEBAR_MAX_WIDTH,
  PAGE_SIDEBAR_MIN_WIDTH,
  persistPageSidebarWidth as persistStoredPageSidebarWidth,
  readPageSidebarWidth,
} from '@/utils/page-sidebar-width'

type Props = {
  offset?: number
  label?: string
}

const props = withDefaults(defineProps<Props>(), {
  offset: 12,
})

const { t } = useI18n()
const pageSidebarWidth = ref(loadPageSidebarWidth())
const pageSidebarResizeStart = ref<{ x: number; width: number; deltaSign: 1 | -1 } | null>(null)

const pageSidebarMaxWidth = computed(() => {
  if (typeof window === 'undefined') return PAGE_SIDEBAR_MAX_WIDTH
  return Math.max(
    PAGE_SIDEBAR_MIN_WIDTH,
    Math.min(
      PAGE_SIDEBAR_MAX_WIDTH,
      Math.floor(window.innerWidth * 0.46),
      window.innerWidth - 420,
    ),
  )
})
const pageSidebarStyle = computed(() => ({
  '--page-sidebar-resize-offset': `${props.offset}px`,
}))
const ariaLabel = computed(() => props.label || t('chat.resizeSidebar'))

function loadPageSidebarWidth(): number {
  if (typeof window === 'undefined') return PAGE_SIDEBAR_DEFAULT_WIDTH
  return readPageSidebarWidth(window.localStorage)
}

function clampPageSidebarWidth(width: number): number {
  return Math.min(
    pageSidebarMaxWidth.value,
    Math.max(PAGE_SIDEBAR_MIN_WIDTH, Math.round(width)),
  )
}

function syncPageSidebarWidth(): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--page-sidebar-width', `${pageSidebarWidth.value}px`)
  emitPageSidebarWidthChanged(pageSidebarWidth.value)
}

function persistCurrentPageSidebarWidth(): void {
  if (typeof window === 'undefined') return
  persistStoredPageSidebarWidth(pageSidebarWidth.value, window.localStorage)
}

function handleViewportResize(): void {
  const nextWidth = clampPageSidebarWidth(pageSidebarWidth.value)
  if (nextWidth !== pageSidebarWidth.value) {
    pageSidebarWidth.value = nextWidth
    persistCurrentPageSidebarWidth()
  }
  syncPageSidebarWidth()
}

function handleResizeMove(event: PointerEvent): void {
  const start = pageSidebarResizeStart.value
  if (!start) return
  const delta = (event.clientX - start.x) * start.deltaSign
  pageSidebarWidth.value = clampPageSidebarWidth(start.width + delta)
  syncPageSidebarWidth()
}

function stopResize(): void {
  if (!pageSidebarResizeStart.value) return
  pageSidebarResizeStart.value = null
  window.removeEventListener('pointermove', handleResizeMove)
  window.removeEventListener('pointerup', stopResize)
  persistCurrentPageSidebarWidth()
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
}

function startResize(event: PointerEvent): void {
  event.preventDefault()
  pageSidebarResizeStart.value = {
    x: event.clientX,
    width: pageSidebarWidth.value,
    deltaSign: document.documentElement.dir === 'rtl' ? -1 : 1,
  }
  window.addEventListener('pointermove', handleResizeMove)
  window.addEventListener('pointerup', stopResize)
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
}

function resetWidth(): void {
  pageSidebarWidth.value = clampPageSidebarWidth(PAGE_SIDEBAR_DEFAULT_WIDTH)
  syncPageSidebarWidth()
  persistCurrentPageSidebarWidth()
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const rtlSign = document.documentElement.dir === 'rtl' ? -1 : 1
  const direction = event.key === 'ArrowRight' ? 1 : -1
  pageSidebarWidth.value = clampPageSidebarWidth(pageSidebarWidth.value + direction * rtlSign * 16)
  syncPageSidebarWidth()
  persistCurrentPageSidebarWidth()
}

onMounted(() => {
  syncPageSidebarWidth()
  window.addEventListener('resize', handleViewportResize)
})

onBeforeUnmount(() => {
  stopResize()
  window.removeEventListener('resize', handleViewportResize)
})
</script>

<template>
  <div
    class="page-sidebar-resize-handle"
    :style="pageSidebarStyle"
    role="separator"
    aria-orientation="vertical"
    :aria-label="ariaLabel"
    :aria-valuenow="pageSidebarWidth"
    :aria-valuemin="PAGE_SIDEBAR_MIN_WIDTH"
    :aria-valuemax="pageSidebarMaxWidth"
    tabindex="0"
    @pointerdown="startResize"
    @keydown="handleKeydown"
    @dblclick="resetWidth"
  />
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.page-sidebar-resize-handle {
  position: absolute;
  z-index: 105;
  inset-inline-start: calc(var(--page-sidebar-resize-offset, 12px) + var(--page-sidebar-width, #{$sidebar-width}));
  top: 10px;
  bottom: 10px;
  width: 10px;
  cursor: col-resize;
  touch-action: none;
  -webkit-app-region: no-drag;

  &::after {
    content: '';
    position: absolute;
    inset-inline-start: 4px;
    top: 0;
    bottom: 0;
    width: 1px;
    background: $border-color;
    transition: background-color $transition-fast;
  }

  &::before {
    content: '';
    position: absolute;
    z-index: 1;
    inset-inline-start: -1px;
    top: 50%;
    width: 10px;
    height: 38px;
    transform: translateY(-50%);
    border: 1px solid $border-color;
    border-radius: 6px;
    background:
      linear-gradient($text-muted, $text-muted) center 12px / 6px 1px no-repeat,
      linear-gradient($text-muted, $text-muted) center 19px / 6px 1px no-repeat,
      linear-gradient($text-muted, $text-muted) center 26px / 6px 1px no-repeat,
      $bg-card;
    opacity: 0.88;
    transition: border-color $transition-fast, opacity $transition-fast;
  }

  &:hover::after,
  &:focus-visible::after {
    background: var(--accent-primary);
  }

  &:hover::before,
  &:focus-visible::before {
    border-color: var(--accent-primary);
    opacity: 1;
  }

  &:focus-visible {
    outline: none;
  }
}

@media (max-width: $breakpoint-mobile) {
  .page-sidebar-resize-handle {
    display: none;
  }
}
</style>
