import { reactive } from 'vue'

const visibleSurfaceSessions = reactive(new Map<string, string>())
export const visibleChatSessionIds = reactive(new Set<string>())

function rebuildVisibleSessionIds() {
  visibleChatSessionIds.clear()
  for (const sessionId of visibleSurfaceSessions.values()) {
    if (sessionId) visibleChatSessionIds.add(sessionId)
  }
}

export function registerVisibleChatSurface(surfaceId: string, sessionId: string) {
  if (!surfaceId || !sessionId) return
  visibleSurfaceSessions.set(surfaceId, sessionId)
  rebuildVisibleSessionIds()
}

export function unregisterVisibleChatSurface(surfaceId: string) {
  if (!visibleSurfaceSessions.delete(surfaceId)) return
  rebuildVisibleSessionIds()
}
