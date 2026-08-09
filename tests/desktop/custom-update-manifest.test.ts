import { describe, expect, it } from 'vitest'
import {
  CUSTOM_UPDATE_FEED_URL,
  CUSTOM_UPDATE_REPOSITORY,
  CUSTOM_UPDATE_TRUSTED_HOSTS,
  UPSTREAM_REPOSITORY,
  customizationManifestUrl,
  validateCustomizationManifest,
} from '../../packages/desktop/src/main/custom-update-manifest'

const customCommit = 'a'.repeat(40)
const upstreamCommit = 'b'.repeat(40)

function validManifest() {
  return {
    schemaVersion: 1,
    variant: 'hermes-studio-custom',
    desktopVersion: '0.6.40',
    update: {
      provider: 'generic',
      feedUrl: CUSTOM_UPDATE_FEED_URL,
      allowOfficialFallback: false,
    },
    source: {
      repository: CUSTOM_UPDATE_REPOSITORY,
      ref: 'feat/agents-tasks-code-workspace',
      commit: customCommit,
    },
    upstream: {
      repository: UPSTREAM_REPOSITORY,
      baseCommit: upstreamCommit,
    },
  }
}

describe('custom update manifest contract', () => {
  it('uses the fork release feed and derives its manifest URL', () => {
    expect(CUSTOM_UPDATE_FEED_URL).toBe('https://github.com/jeaxindr-dotcom/hermes-studio/releases/latest/download')
    expect(customizationManifestUrl()).toBe(`${CUSTOM_UPDATE_FEED_URL}/customization-manifest.json`)
    expect(CUSTOM_UPDATE_TRUSTED_HOSTS).toEqual(expect.arrayContaining([
      'github.com',
      'release-assets.githubusercontent.com',
    ]))
  })

  it('accepts only a validated custom build for the requested desktop version', () => {
    expect(validateCustomizationManifest(validManifest(), '0.6.40')).toEqual({ ok: true })

    expect(validateCustomizationManifest({
      ...validManifest(),
      variant: 'official',
    }, '0.6.40').ok).toBe(false)
    expect(validateCustomizationManifest({
      ...validManifest(),
      desktopVersion: '0.6.39',
    }, '0.6.40').ok).toBe(false)
    expect(validateCustomizationManifest({
      ...validManifest(),
      source: { ...validManifest().source, commit: 'abc123' },
    }, '0.6.40').ok).toBe(false)
    expect(validateCustomizationManifest({
      ...validManifest(),
      update: { ...validManifest().update, allowOfficialFallback: true },
    }, '0.6.40').ok).toBe(false)
  })
})
