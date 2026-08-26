import { resolve as resolvePath } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import type { AgentKind } from './agents/types.js'

export type AgentRuntimeKind = AgentKind
export const AGENT_RUNTIMES = ['claude', 'codex'] as const satisfies readonly AgentRuntimeKind[]
export type AgentSlotMeta = { transport?: string; nativeSessionId?: string; cwd?: string; model?: string; sourceCwd?: string; worktreeBranch?: string; worktreePath?: string; codexHome?: string; tuiTabName?: string; bindingGeneration?: string; desiredRunning?: boolean; label?: string }
export type ChannelBinding = {
  active?: AgentRuntimeKind
  orchestrator?: boolean
  parentRoomId?: string
  observers?: AgentRuntimeKind[]
  sessions?: Partial<Record<AgentRuntimeKind, string>>
  cwd?: string
  agentMeta?: Partial<Record<AgentRuntimeKind, AgentSlotMeta>>
}
export type OrchestratorSource = 'explicit-enabled' | 'explicit-disabled' | 'worker-forced-disabled' | 'worker-enabled' | 'malformed-disabled' | 'ordinary-default-enabled'
export type NormalizedBinding = { active: AgentRuntimeKind; isOrchestrator: boolean; orchestrator?: boolean; orchestratorSource: OrchestratorSource; parentRoomId?: string; observers: AgentRuntimeKind[]; sessions: Partial<Record<AgentRuntimeKind, string>>; cwd?: string; agentMeta: Partial<Record<AgentRuntimeKind, AgentSlotMeta>> }
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

function cwdValue(value: unknown): string | undefined {
  const cwd = stringValue(value)
  if (!cwd) return undefined
  const homePrefixCandidate = cwd.startsWith(homedir() + '/home/') ? cwd.slice(homedir().length) : undefined
  if (homePrefixCandidate && existsSync(homePrefixCandidate)) return homePrefixCandidate
  if (cwd.startsWith('/')) return cwd
  const rootCandidate = resolvePath('/', cwd)
  return existsSync(rootCandidate) ? rootCandidate : resolvePath(process.env.CHANNEL_DAEMON_CWD ?? homedir(), cwd)
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
  for (const key of ['transport', 'nativeSessionId', 'cwd', 'model', 'sourceCwd', 'worktreeBranch', 'worktreePath', 'codexHome', 'tuiTabName', 'bindingGeneration', 'label'] as const) {
    const string = stringValue(record[key])
      if (string) meta[key] = key === 'cwd' || key === 'sourceCwd' || key === 'worktreePath' ? cwdValue(string)! : string
  }
  if (typeof record.desiredRunning === 'boolean') meta.desiredRunning = record.desiredRunning
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
      bindings[channelKey] = { sessions: { claude: legacyUuid } }
      continue
    }
    const binding = recordValue(rawBinding)
    if (!binding) continue
    const active = runtimeValue(binding.active)
    const orchestratorRaw = binding.orchestrator
    // Capability is a single boolean (absent = default). Migrate the legacy `isOrchestrator`
    // boolean into it, and fail a malformed value closed to off rather than silently default-on.
    const orchestrator = typeof orchestratorRaw === 'boolean'
      ? orchestratorRaw
      : orchestratorRaw !== undefined
        ? false
        : typeof binding.isOrchestrator === 'boolean'
          ? binding.isOrchestrator
          : undefined
    const parentRoomId = stringValue(binding.parentRoomId)
    const observers = observerList(binding.observers, active)
    const sessions = sessionMap(binding.sessions)
    const cwd = cwdValue(binding.cwd)
    const agentMeta = agentMetaMap(binding.agentMeta)
    if (!active && orchestrator === undefined && !parentRoomId && observers.length === 0 && Object.keys(sessions).length === 0 && !cwd && Object.keys(agentMeta).length === 0) continue
    bindings[channelKey] = {
      ...(active ? { active } : {}),
      ...(orchestrator !== undefined ? { orchestrator } : {}),
      ...(parentRoomId ? { parentRoomId } : {}),
      ...(observers.length ? { observers } : {}),
      ...(Object.keys(sessions).length ? { sessions } : {}),
      ...(cwd ? { cwd } : {}),
      ...(Object.keys(agentMeta).length ? { agentMeta } : {}),
    }
  }
  return bindings
}

export function normalizeBinding(value: ChannelBinding | undefined, defaultRuntime: AgentRuntimeKind): NormalizedBinding {
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
  const cwd = typeof value === 'object' ? cwdValue(value?.cwd) : undefined
  const agentMeta = typeof value === 'object' && value?.agentMeta && typeof value.agentMeta === 'object'
    ? agentMetaMap(value.agentMeta)
    : {}
  const observers = typeof value === 'object' ? observerList(value?.observers, active) : []
  const orchestratorRaw = typeof value === 'object' ? value?.orchestrator : undefined
  const malformed = orchestratorRaw !== undefined && typeof orchestratorRaw !== 'boolean'
  const explicitOrchestrator = typeof orchestratorRaw === 'boolean' ? orchestratorRaw : undefined
  const parentRoomId = typeof value === 'object' ? stringValue(value?.parentRoomId) : undefined
  const isWorker = !!parentRoomId
  const isOrchestrator = malformed
    ? false
    : explicitOrchestrator !== undefined
      ? explicitOrchestrator
      : !isWorker
  // Keep the explicit capability for serialization. A malformed value heals to explicit off.
  const orchestrator = malformed ? false : explicitOrchestrator
  const orchestratorSource: OrchestratorSource = malformed
    ? 'malformed-disabled'
    : isOrchestrator
      ? (isWorker ? 'worker-enabled' : explicitOrchestrator === true ? 'explicit-enabled' : 'ordinary-default-enabled')
      : (isWorker ? 'worker-forced-disabled' : 'explicit-disabled')
  return { active, isOrchestrator, ...(orchestrator !== undefined ? { orchestrator } : {}), orchestratorSource, ...(parentRoomId ? { parentRoomId } : {}), observers, sessions: { ...sessions }, cwd, agentMeta }
}

export function bindingSessionEntries(binding: NormalizedBinding): BindingSessionEntry[] {
  const entries: BindingSessionEntry[] = []
  for (const runtime of AGENT_RUNTIMES) {
    const uuid = binding.sessions[runtime]
    if (uuid) entries.push({ runtime, uuid, active: runtime === binding.active })
  }
  return entries
}

export function bindingAuthorizedRoomsForSession(bindings: Record<string, ChannelBinding>, uuid: string): string[] {
  const normalized = Object.entries(bindings).map(([channelKey, raw]) => [channelKey, normalizeBinding(raw, 'claude')] as const)
  return normalized
    .filter(([, binding]) => bindingSessionEntries(binding).some(entry => entry.uuid === uuid))
    .map(([channelKey]) => channelKey)
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
  if (binding.orchestratorSource === 'ordinary-default-enabled' && sessionKeys.length === 0 && observers.length === 0 && !binding.cwd && binding.active === defaultRuntime && binding.orchestrator === undefined && !binding.parentRoomId) return undefined
  const active = binding.active
  return { active, ...(binding.orchestrator !== undefined ? { orchestrator: binding.orchestrator } : {}), ...(binding.parentRoomId ? { parentRoomId: binding.parentRoomId } : {}), ...(observers.length ? { observers } : {}), sessions, ...(binding.cwd ? { cwd: binding.cwd } : {}), ...(Object.keys(agentMeta).length > 0 ? { agentMeta } : {}) }
}

export function setBindingOrchestratorFlag(bindings: Record<string, ChannelBinding>, channelKey: string, enabled: boolean, defaultRuntime: AgentRuntimeKind): void {
  const binding = normalizeBinding(bindings[channelKey], defaultRuntime)
  binding.isOrchestrator = enabled
  binding.orchestrator = enabled
  // Worker lineage (parentRoomId) is preserved: a worker room that a human break-glass enables
  // stays identifiable as a worker, and stays disable-able back to worker-forced-disabled.
  binding.orchestratorSource = enabled
    ? (binding.parentRoomId ? 'worker-enabled' : 'explicit-enabled')
    : (binding.parentRoomId ? 'worker-forced-disabled' : 'explicit-disabled')
  const serialized = serializeBinding(binding, defaultRuntime)
  if (serialized) bindings[channelKey] = serialized
  else delete bindings[channelKey]
}

export function setBindingWorkerRole(bindings: Record<string, ChannelBinding>, channelKey: string, parentRoomId: string, defaultRuntime: AgentRuntimeKind): void {
  const binding = normalizeBinding(bindings[channelKey], defaultRuntime)
  binding.isOrchestrator = false
  binding.orchestrator = false
  binding.orchestratorSource = 'worker-forced-disabled'
  binding.parentRoomId = parentRoomId
  const serialized = serializeBinding(binding, defaultRuntime)
  if (serialized) bindings[channelKey] = serialized
}

// Succession, not escalation: promotes a room (typically one just created for this purpose, so
// currently worker-forced-disabled under the outgoing orchestrator) to be the new orchestrator.
// This is rotate_orchestrator's one exception to "worker lifecycle automation never creates
// orchestrators" — the net orchestrator count does not grow, and the operation is audit-logged.
// orchestratorSource is derived (normalizeBinding recomputes it from {orchestrator, parentRoomId}
// on every read; serializeBinding never persists it), so once parentRoomId is cleared this room
// reads back as plain 'explicit-enabled', same as any other manually-flagged orchestrator — there
// is no persisted bit to distinguish "enabled via rotation" from "enabled via /ccm orch on".
// That distinction lives in the append-only audit log (the orchestrator_rotated event), not here.
export function setBindingSuccessorRole(bindings: Record<string, ChannelBinding>, channelKey: string, defaultRuntime: AgentRuntimeKind): void {
  const binding = normalizeBinding(bindings[channelKey], defaultRuntime)
  binding.isOrchestrator = true
  binding.orchestrator = true
  binding.parentRoomId = undefined
  const serialized = serializeBinding(binding, defaultRuntime)
  if (serialized) bindings[channelKey] = serialized
  else delete bindings[channelKey]
}


export function keepAgentModelMeta(meta: AgentSlotMeta | undefined): AgentSlotMeta | undefined {
  const kept: AgentSlotMeta = {}
  if (meta?.model) kept.model = meta.model
  if (typeof meta?.desiredRunning === 'boolean') kept.desiredRunning = meta.desiredRunning
  return Object.keys(kept).length ? kept : undefined
}
