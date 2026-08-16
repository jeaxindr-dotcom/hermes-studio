import type { Context } from 'koa'
import { realpath, stat } from 'fs/promises'
import {
  checkUpdateAgent,
  deleteCodingAgent,
  getCodingAgentsStatus,
  installCodingAgent,
  openCodingAgentNativeTerminal,
  prepareCodingAgentLaunch,
  readCodingAgentConfigFile,
  sendCodingAgentRunInput,
  startCodingAgentRun,
  stopCodingAgentRun,
  writeCodingAgentConfigFile,
  type CodingAgentConfigScope,
} from '../services/coding-agents'
import { getSession } from '../db/hermes/session-store'
import { listUserProfiles } from '../db/hermes/users-store'

function configScope(ctx: Context): CodingAgentConfigScope {
  const body = ctx.request.body as { profile?: unknown; provider?: unknown } | undefined
  return {
    profile: ctx.state.profile?.name || (typeof ctx.query.profile === 'string' ? ctx.query.profile : '') || (typeof body?.profile === 'string' ? body.profile : ''),
    provider: (typeof ctx.query.provider === 'string' ? ctx.query.provider : '') || (typeof body?.provider === 'string' ? body.provider : ''),
  }
}

type WorkspaceLaunchBody = {
  profile?: string
  workspaceSessionId?: string | null
}

async function authorizedLaunchScope(ctx: Context, body: WorkspaceLaunchBody): Promise<{ profile?: string; workspace?: string }> {
  const workspaceSessionId = String(body.workspaceSessionId || '').trim()
  if (!workspaceSessionId) return { profile: ctx.state.profile?.name || body.profile }

  const session = getSession(workspaceSessionId)
  if (!session) throw Object.assign(new Error('Workspace session not found'), { status: 404 })
  const profile = String(session.profile || 'default')
  const user = ctx.state.user
  if (user && user.role !== 'super_admin') {
    const allowedProfiles = new Set(listUserProfiles(user.id).map(item => item.profile_name))
    if (!allowedProfiles.has(profile)) {
      throw Object.assign(new Error(`Profile "${profile}" is not available for this user`), { status: 403 })
    }
  }

  const rawWorkspace = String(session.workspace || '').trim()
  if (!rawWorkspace) throw Object.assign(new Error('Session workspace not found'), { status: 404 })
  const workspace = await realpath(rawWorkspace)
  const info = await stat(workspace)
  if (!info.isDirectory()) throw Object.assign(new Error('Session workspace is not a directory'), { status: 400 })
  return { profile, workspace }
}

export async function status(ctx: Context) {
  try {
    ctx.body = await getCodingAgentsStatus()
  } catch (err: any) {
    ctx.status = 500
    ctx.body = { error: err.message || 'Failed to inspect coding agents' }
  }
}

export async function install(ctx: Context) {
  try {
    const result = await installCodingAgent(ctx.params.id)
    ctx.body = result
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to install coding agent' }
  }
}

export async function checkUpdate(ctx: Context) {
  try {
    ctx.body = await checkUpdateAgent(ctx.params.id)
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to check coding agent update' }
  }
}

export async function remove(ctx: Context) {
  try {
    const result = await deleteCodingAgent(ctx.params.id)
    ctx.body = result
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to delete coding agent' }
  }
}

export async function readConfigFile(ctx: Context) {
  try {
    ctx.body = await readCodingAgentConfigFile(ctx.params.id, ctx.params.key, configScope(ctx))
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to read coding agent config file' }
  }
}

export async function writeConfigFile(ctx: Context) {
  try {
    const { content } = ctx.request.body as { content?: string }
    ctx.body = await writeCodingAgentConfigFile(ctx.params.id, ctx.params.key, content || '', configScope(ctx))
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to write coding agent config file' }
  }
}

export async function prepareLaunch(ctx: Context) {
  try {
    const body = ctx.request.body as {
      mode?: any
      profile?: string
      workspaceSessionId?: string | null
      provider?: string
      model?: string
      baseUrl?: string
      apiKey?: string
      apiMode?: any
    }
    const launchScope = await authorizedLaunchScope(ctx, body)
    ctx.body = await prepareCodingAgentLaunch(ctx.params.id, {
      mode: body.mode,
      profile: launchScope.profile,
      workspace: launchScope.workspace,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      apiMode: body.apiMode,
    })
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to prepare coding agent launch' }
  }
}

export async function nativeLaunch(ctx: Context) {
  try {
    const body = ctx.request.body as {
      mode?: any
      profile?: string
      workspaceSessionId?: string | null
      provider?: string
      model?: string
      baseUrl?: string
      apiKey?: string
      apiMode?: any
    }
    const launchScope = await authorizedLaunchScope(ctx, body)
    ctx.body = await openCodingAgentNativeTerminal(ctx.params.id, {
      mode: body.mode,
      profile: launchScope.profile,
      workspace: launchScope.workspace,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      apiMode: body.apiMode,
    })
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to launch native terminal' }
  }
}

export async function startRun(ctx: Context) {
  try {
    const body = ctx.request.body as {
      sessionId?: string
      mode?: any
      profile?: string
      workspaceSessionId?: string | null
      provider?: string
      model?: string
      baseUrl?: string
      apiKey?: string
      apiMode?: any
    }
    const launchScope = await authorizedLaunchScope(ctx, body)
    ctx.body = await startCodingAgentRun(ctx.params.id, {
      sessionId: String(body.sessionId || ''),
      mode: body.mode,
      profile: launchScope.profile,
      workspace: launchScope.workspace,
      provider: body.provider,
      model: body.model,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      apiMode: body.apiMode,
    })
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to start coding agent run' }
  }
}

export async function sendRunInput(ctx: Context) {
  try {
    const body = ctx.request.body as { input?: string }
    ctx.body = await sendCodingAgentRunInput(String(ctx.params.sessionId || ''), String(body.input || ''))
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to send coding agent input' }
  }
}

export async function stopRun(ctx: Context) {
  try {
    ctx.body = await stopCodingAgentRun(String(ctx.params.sessionId || ''))
  } catch (err: any) {
    ctx.status = err.status || 500
    ctx.body = { error: err.message || 'Failed to stop coding agent run' }
  }
}
