export const CUSTOM_UPDATE_FEED_URL = 'https://github.com/jeaxindr-dotcom/hermes-studio/releases/latest/download'
export const CUSTOM_UPDATE_TRUSTED_HOSTS = [
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
] as const
export const CUSTOM_UPDATE_MANIFEST_NAME = 'customization-manifest.json'
export const CUSTOM_UPDATE_REPOSITORY = 'https://github.com/jeaxindr-dotcom/hermes-studio'
export const UPSTREAM_REPOSITORY = 'https://github.com/EKKOLearnAI/hermes-studio'

export type CustomizationManifest = {
  schemaVersion?: unknown
  variant?: unknown
  desktopVersion?: unknown
  update?: {
    provider?: unknown
    feedUrl?: unknown
    allowOfficialFallback?: unknown
  }
  source?: {
    repository?: unknown
    ref?: unknown
    commit?: unknown
  }
  upstream?: {
    repository?: unknown
    baseCommit?: unknown
  }
  customCommit?: unknown
  upstreamCommit?: unknown
}

export type ManifestValidation =
  | { ok: true }
  | { ok: false; reason: string }

export function customizationManifestUrl(feedUrl = CUSTOM_UPDATE_FEED_URL): string {
  return `${feedUrl.replace(/\/+$/, '')}/${CUSTOM_UPDATE_MANIFEST_NAME}`
}

function isCommit(value: unknown): boolean {
  return /^[0-9a-f]{40}$/i.test(String(value || '').trim())
}

export function validateCustomizationManifest(
  value: unknown,
  expectedDesktopVersion: string,
): ManifestValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'Customization manifest is not an object.' }
  }
  const manifest = value as CustomizationManifest
  if (manifest.schemaVersion !== 1) {
    return { ok: false, reason: 'Unsupported customization manifest schema.' }
  }
  if (manifest.variant !== 'hermes-studio-custom') {
    return { ok: false, reason: 'The release is not a Hermes Studio Custom build.' }
  }
  if (String(manifest.desktopVersion || '').trim() !== String(expectedDesktopVersion || '').trim()) {
    return { ok: false, reason: 'The customization manifest targets a different desktop version.' }
  }
  if (manifest.update?.provider !== 'generic'
    || manifest.update.feedUrl !== CUSTOM_UPDATE_FEED_URL
    || manifest.update.allowOfficialFallback !== false) {
    return { ok: false, reason: 'The customization manifest does not pin the custom update feed.' }
  }
  const sourceCommit = manifest.source?.commit || manifest.customCommit
  if (!isCommit(sourceCommit)) {
    return { ok: false, reason: 'The customization manifest has no valid source commit.' }
  }
  if (manifest.source && manifest.source.repository !== CUSTOM_UPDATE_REPOSITORY) {
    return { ok: false, reason: 'The customization manifest points to another source repository.' }
  }
  if (manifest.upstream && manifest.upstream.repository !== UPSTREAM_REPOSITORY) {
    return { ok: false, reason: 'The customization manifest points to another upstream repository.' }
  }
  return { ok: true }
}
