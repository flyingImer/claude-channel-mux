import type { AgentKind } from './agents/types.js'

export type AgentRuntimeKind = AgentKind
export const AGENT_RUNTIMES = ['claude', 'codex'] as const satisfies readonly AgentRuntimeKind[]
export type AgentSlotMeta = { transport?: string; nativeSessionId?: string; cwd?: string; model?: string; sourceCwd?: string; worktreeBranch?: string; worktreePath?: string }
export type ChannelBinding = string | {
  active?: AgentRuntimeKind
  observers?: AgentRuntimeKind[]
  sessions?: Partial<Record<AgentRuntimeKind, string>>
  cwd?: string
  agentMeta?: Partial<Record<AgentRuntimeKind, AgentSlotMeta>>
}
export type NormalizedBinding = { active: AgentRuntimeKind; observers: AgentRuntimeKind[]; sessions: Partial<Record<AgentRuntimeKind, string>>; cwd?: string; agentMeta: Partial<Record<AgentRuntimeKind, AgentSlotMeta>> }
export type BindingSessionEntry = { runtime: AgentRuntimeKind; uuid: string; active: boolean }


function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export function isAgentRuntimeKind(value: unknown): value is AgentRuntimeKind {
  return value === 'claude' || value === 'codex'
}

function runtimeValue(value: unknown): AgentRuntimeKind | undefined {
  return isAgentRuntimeKind(value) ? value : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function sessionMap(value: unknown): Partial<Record<AgentRuntimeKind, string>> {
  const record = recordValue(value)
  if (!record) return {}
  return {
    ...(stringValue(record.claude) ? { claude: stringValue(record.claude) } : {}),
    ...(stringValue(record.codex) ? { codex: stringValue(record.codex) } : {}),
  }
}

function observerList(value: unknown, active?: AgentRuntimeKind): AgentRuntimeKind[] {
  if (!Array.isArray(value)) return []
  const out: AgentRuntimeKind[] = []
  for (const item of value) {
    const runtime = runtimeValue(item)
    if (!runtime || runtime === active || out.includes(runtime)) continue
    out.push(runtime)
  }
  return out
}

function slotMeta(value: unknown): AgentSlotMeta | undefined {
  const record = recordValue(value)
  if (!record) return undefined
  const meta: AgentSlotMeta = {}
  for (const key of ['transport', 'nativeSessionId', 'cwd', 'model', 'sourceCwd', 'worktreeBranch', 'worktreePath'] as const) {
    const string = stringValue(record[key])
    if (string) meta[key] = string
  }
  return Object.keys(meta).length ? meta : undefined
}

function agentMetaMap(value: unknown): Partial<Record<AgentRuntimeKind, AgentSlotMeta>> {
  const record = recordValue(value)
  if (!record) return {}
  return {
    ...(slotMeta(record.claude) ? { claude: slotMeta(record.claude) } : {}),
    ...(slotMeta(record.codex) ? { codex: slotMeta(record.codex) } : {}),
  }
}

export function bindingsFromJson(value: unknown): Record<string, ChannelBinding> {
  const record = recordValue(value)
  if (!record) return {}
  const bindings: Record<string, ChannelBinding> = {}
  for (const [channelKey, rawBinding] of Object.entries(record)) {
    const legacyUuid = stringValue(rawBinding)
    if (legacyUuid) {
      bindings[channelKey] = legacyUuid
      continue
    }
    const binding = recordValue(rawBinding)
    if (!binding) continue
    const active = runtimeValue(binding.active)
    const observers = observerList(binding.observers, active)
    const sessions = sessionMap(binding.sessions)
    const cwd = stringValue(binding.cwd)
    const agentMeta = agentMetaMap(binding.agentMeta)
    if (!active && observers.length === 0 && Object.keys(sessions).length === 0 && !cwd && Object.keys(agentMeta).length === 0) continue
    bindings[channelKey] = {
      ...(active ? { active } : {}),
      ...(observers.length ? { observers } : {}),
      ...(Object.keys(sessions).length ? { sessions } : {}),
      ...(cwd ? { cwd } : {}),
      ...(Object.keys(agentMeta).length ? { agentMeta } : {}),
    }
  }
  return bindings
}

export function normalizeBinding(value: ChannelBinding | undefined, defaultRuntime: AgentRuntimeKind): NormalizedBinding {
  if (typeof value === 'string') return { active: 'claude', observers: [], sessions: { claude: value }, agentMeta: {} }
  const sessions = value?.sessions ?? {}
  const explicitActive = value?.active === 'claude' || value?.active === 'codex' ? value.active : undefined
  const active = explicitActive
    ?? (sessions[defaultRuntime]
      ? defaultRuntime
      : sessions.claude
        ? 'claude'
        : sessions.codex
          ? 'codex'
          : defaultRuntime)
  const cwd = typeof value === 'object' && typeof value?.cwd === 'string' && value.cwd.trim()
    ? value.cwd.trim()
    : undefined
  const agentMeta = typeof value === 'object' && value?.agentMeta && typeof value.agentMeta === 'object'
    ? { ...value.agentMeta }
    : {}
  const observers = typeof value === 'object' ? observerList(value?.observers, active) : []
  return { active, observers, sessions: { ...sessions }, cwd, agentMeta }
}

export function bindingSessionEntries(binding: NormalizedBinding): BindingSessionEntry[] {
  const entries: BindingSessionEntry[] = []
  for (const runtime of AGENT_RUNTIMES) {
    const uuid = binding.sessions[runtime]
    if (uuid) entries.push({ runtime, uuid, active: runtime === binding.active })
  }
  return entries
}

export function serializeBinding(binding: NormalizedBinding, defaultRuntime: AgentRuntimeKind): ChannelBinding | undefined {
  const sessions: Partial<Record<AgentRuntimeKind, string>> = {}
  const agentMeta: Partial<Record<AgentRuntimeKind, AgentSlotMeta>> = {}
  for (const runtime of AGENT_RUNTIMES) {
    const uuid = binding.sessions[runtime]
    const meta = binding.agentMeta[runtime]
    if (uuid) sessions[runtime] = uuid
    if (meta && Object.keys(meta).length > 0) agentMeta[runtime] = meta
  }
  const sessionKeys = Object.keys(sessions)
  const observers = binding.observers.filter(runtime => runtime !== binding.active)
  if (sessionKeys.length === 0 && observers.length === 0 && !binding.cwd && binding.active === defaultRuntime) return undefined
  const active = binding.active
  return { active, ...(observers.length ? { observers } : {}), sessions, ...(binding.cwd ? { cwd: binding.cwd } : {}), ...(Object.keys(agentMeta).length > 0 ? { agentMeta } : {}) }
}


export function keepAgentModelMeta(meta: AgentSlotMeta | undefined): AgentSlotMeta | undefined {
  return meta?.model ? { model: meta.model } : undefined
}
