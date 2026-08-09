import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  deleteCodingAgent: vi.fn(),
  getCodingAgentsStatus: vi.fn(),
  installCodingAgent: vi.fn(),
  openCodingAgentNativeTerminal: vi.fn(),
  prepareCodingAgentLaunch: vi.fn(),
  readCodingAgentConfigFile: vi.fn(),
  sendCodingAgentRunInput: vi.fn(),
  startCodingAgentRun: vi.fn(),
  stopCodingAgentRun: vi.fn(),
  writeCodingAgentConfigFile: vi.fn(),
}))
const getSessionMock = vi.hoisted(() => vi.fn())
const listUserProfilesMock = vi.hoisted(() => vi.fn())

vi.mock('../../packages/server/src/services/coding-agents', () => serviceMocks)
vi.mock('../../packages/server/src/db/hermes/session-store', () => ({ getSession: getSessionMock }))
vi.mock('../../packages/server/src/db/hermes/users-store', () => ({ listUserProfiles: listUserProfilesMock }))

const roots: string[] = []

function tempDirectory() {
  const root = mkdtempSync(join(tmpdir(), 'studio-coding-scope-'))
  roots.push(root)
  return root
}

function context(body: Record<string, unknown>, user: Record<string, unknown> = { id: 'user-1', role: 'super_admin' }) {
  return {
    request: { body },
    state: { user },
    params: { id: 'codex' },
    query: {},
    status: 200,
    body: undefined,
  } as any
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('coding-agent workspace authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.prepareCodingAgentLaunch.mockResolvedValue({ ok: true })
    listUserProfilesMock.mockReturnValue([])
  })

  it('derives profile and canonical workspace only from the authorized session', async () => {
    const workspace = tempDirectory()
    const nested = join(workspace, 'nested')
    mkdirSync(nested)
    getSessionMock.mockReturnValue({ id: 'session-1', profile: 'actual-profile', workspace: nested })
    const ctx = context({
      workspaceSessionId: 'session-1',
      profile: 'spoofed-profile',
      workspace: 'C:/attacker/path',
      mode: 'scoped',
    })

    const { prepareLaunch } = await import('../../packages/server/src/controllers/coding-agents')
    await prepareLaunch(ctx)

    expect(serviceMocks.prepareCodingAgentLaunch).toHaveBeenCalledWith('codex', expect.objectContaining({
      profile: 'actual-profile',
      workspace: nested,
      mode: 'scoped',
    }))
    expect(serviceMocks.prepareCodingAgentLaunch.mock.calls[0][1]).not.toHaveProperty('workspaceSessionId')
    expect(serviceMocks.prepareCodingAgentLaunch.mock.calls[0][1].workspace).not.toBe('C:/attacker/path')
  })

  it('rejects a session profile unavailable to a non-super-admin user', async () => {
    const workspace = tempDirectory()
    getSessionMock.mockReturnValue({ id: 'session-1', profile: 'private', workspace })
    listUserProfilesMock.mockReturnValue([{ profile_name: 'allowed' }])
    const ctx = context({ workspaceSessionId: 'session-1' }, { id: 'user-1', role: 'admin' })

    const { prepareLaunch } = await import('../../packages/server/src/controllers/coding-agents')
    await prepareLaunch(ctx)

    expect(ctx.status).toBe(403)
    expect(serviceMocks.prepareCodingAgentLaunch).not.toHaveBeenCalled()
  })

  it('rejects missing and non-directory session workspaces', async () => {
    const { prepareLaunch } = await import('../../packages/server/src/controllers/coding-agents')

    getSessionMock.mockReturnValueOnce({ id: 'session-1', profile: 'default', workspace: '' })
    const missing = context({ workspaceSessionId: 'session-1' })
    await prepareLaunch(missing)
    expect(missing.status).toBe(404)

    const root = tempDirectory()
    const file = join(root, 'workspace.txt')
    writeFileSync(file, 'not a directory')
    getSessionMock.mockReturnValueOnce({ id: 'session-2', profile: 'default', workspace: file })
    const notDirectory = context({ workspaceSessionId: 'session-2' })
    await prepareLaunch(notDirectory)
    expect(notDirectory.status).toBe(400)
    expect(serviceMocks.prepareCodingAgentLaunch).not.toHaveBeenCalled()
  })
})
