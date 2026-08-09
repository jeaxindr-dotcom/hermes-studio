export const PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'hermes.pageSidebarWidth'
export const LEGACY_PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'hermes.chat.pageSidebarWidth'
export const PAGE_SIDEBAR_WIDTH_CHANGED_EVENT = 'hermes:page-sidebar-width-changed'

export const PAGE_SIDEBAR_MIN_WIDTH = 200
export const PAGE_SIDEBAR_DEFAULT_WIDTH = 240
export const PAGE_SIDEBAR_MAX_WIDTH = 520

export function readPageSidebarWidth(storage?: Pick<Storage, 'getItem'> | null): number {
  if (!storage) return PAGE_SIDEBAR_DEFAULT_WIDTH
  const stored = storage.getItem(PAGE_SIDEBAR_WIDTH_STORAGE_KEY)
    || storage.getItem(LEGACY_PAGE_SIDEBAR_WIDTH_STORAGE_KEY)
  const value = Number.parseInt(stored || '', 10)
  if (!Number.isFinite(value)) return PAGE_SIDEBAR_DEFAULT_WIDTH
  return Math.min(PAGE_SIDEBAR_MAX_WIDTH, Math.max(PAGE_SIDEBAR_MIN_WIDTH, Math.round(value)))
}

export function persistPageSidebarWidth(width: number, storage?: Storage | null): void {
  if (!storage) return
  const value = String(Math.min(PAGE_SIDEBAR_MAX_WIDTH, Math.max(PAGE_SIDEBAR_MIN_WIDTH, Math.round(width))))
  storage.setItem(PAGE_SIDEBAR_WIDTH_STORAGE_KEY, value)
  // Keep the old key readable for existing local builds and easy rollback.
  storage.setItem(LEGACY_PAGE_SIDEBAR_WIDTH_STORAGE_KEY, value)
}

export function emitPageSidebarWidthChanged(width: number): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<{ width: number }>(PAGE_SIDEBAR_WIDTH_CHANGED_EVENT, {
    detail: { width },
  }))
}
