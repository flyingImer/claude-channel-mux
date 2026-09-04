import { test, expect } from 'bun:test'
import { homedir } from 'os'
import { AGENT_RUNTIMES, bindingAuthorizedRoomsForSession, bindingSessionEntries, bindingsFromJson, isAgentRuntimeKind, keepAgentModelMeta, normalizeBinding, serializeBinding, setBindingOrchestratorFlag, setBindingSuccessorRole, setBindingWorkerRole } from '../bindings.ts'

test('bindingsFromJson migrates legacy string bindings to new session schema', () => {
  const parsed = bindingsFromJson({ 'slack:C1': 'legacy-uuid' })
  expect(parsed).toEqual({ 'slack:C1': { sessions: { claude: 'legacy-uuid' } } })
  expect(normalizeBinding(parsed['slack:C1'], 'codex')).toEqual({
    active: 'claude',
    isOrchestrator: true,
    orchestratorSource: 'ordinary-default-enabled',
    observers: [],
    sessions: { claude: 'legacy-uuid' },
    agentMeta: {},
  })
})

test('normalizeBinding chooses default runtime when that session exists', () => {
  expect(normalizeBinding({ sessions: { claude: 'cc', codex: 'cx' } }, 'codex').active).toBe('codex')
  expect(normalizeBinding({ sessions: { claude: 'cc', codex: 'cx' } }, 'claude').active).toBe('claude')
})

test('bindings preserve room observer agents', () => {
  const binding = normalizeBinding({ active: 'codex', observers: ['claude', 'codex'], sessions: { claude: 'cc', codex: 'cx' } }, 'claude')
  expect(binding).toEqual({ active: 'codex', isOrchestrator: true, orchestratorSource: 'ordinary-default-enabled', observers: ['claude'], sessions: { claude: 'cc', codex: 'cx' }, agentMeta: {} })
  expect(serializeBinding(binding, 'claude')).toEqual({ active: 'codex', observers: ['claude'], sessions: { claude: 'cc', codex: 'cx' } })
})

test('ordinary room bindings default to orchestrator-capable while explicit disable persists', () => {
  expect(normalizeBinding(undefined, 'claude')).toMatchObject({ isOrchestrator: true, orchestratorSource: 'ordinary-default-enabled' })
  expect(normalizeBinding({ active: 'codex', sessions: { codex: 'cx' } }, 'claude')).toMatchObject({ isOrchestrator: true, orchestratorSource: 'ordinary-default-enabled' })
  const disabled = normalizeBinding({ orchestrator: false }, 'claude')
  expect(disabled).toMatchObject({ isOrchestrator: false, orchestrator: false, orchestratorSource: 'explicit-disabled' })
  expect(serializeBinding(disabled, 'claude')).toEqual({ active: 'claude', orchestrator: false, sessions: {} })
})

test('malformed explicit orchestrator capability fails closed', () => {
  const binding = normalizeBinding({ orchestrator: 'surprise' } as never, 'claude')
  expect(binding).toMatchObject({ isOrchestrator: false, orchestratorSource: 'malformed-disabled' })
  expect(serializeBinding(binding, 'claude')).toEqual({ active: 'claude', orchestrator: false, sessions: {} })
})

test('worker room role forces orchestrator capability off and records parent lineage', () => {
  const bindings = bindingsFromJson({ 'slack:WORKER': { active: 'claude', sessions: { claude: 'cc' } } })
  setBindingWorkerRole(bindings, 'slack:WORKER', 'slack:PARENT', 'claude')
  expect(normalizeBinding(bindings['slack:WORKER'], 'claude')).toMatchObject({ isOrchestrator: false, orchestrator: false, orchestratorSource: 'worker-forced-disabled', parentRoomId: 'slack:PARENT' })
  expect(serializeBinding(normalizeBinding(bindings['slack:WORKER'], 'claude'), 'claude')).toMatchObject({ active: 'claude', orchestrator: false, parentRoomId: 'slack:PARENT' })
})

test('break-glass enabling a worker room keeps its worker lineage and is reversible', () => {
  const bindings = bindingsFromJson({ 'slack:WORKER': { active: 'claude', sessions: { claude: 'cc' } } })
  setBindingWorkerRole(bindings, 'slack:WORKER', 'slack:PARENT', 'claude')
  setBindingOrchestratorFlag(bindings, 'slack:WORKER', true, 'claude')
  expect(normalizeBinding(bindings['slack:WORKER'], 'claude')).toMatchObject({ isOrchestrator: true, orchestrator: true, orchestratorSource: 'worker-enabled', parentRoomId: 'slack:PARENT' })
  setBindingOrchestratorFlag(bindings, 'slack:WORKER', false, 'claude')
  expect(normalizeBinding(bindings['slack:WORKER'], 'claude')).toMatchObject({ isOrchestrator: false, orchestratorSource: 'worker-forced-disabled', parentRoomId: 'slack:PARENT' })
})

test('normalizeBinding trims cwd and preserves agent metadata', () => {
  const rawBinding: Record<string, unknown> = { active: 'codex', sessions: { codex: 'cx' }, cwd: ' /repo ', agentMeta: { codex: { model: 'gpt', appServerUrl: 'ws://127.0.0.1:1', codexHome: '/home/me/.codex', tuiTabName: 'ccm:cx:abc', desiredRunning: false } } }
  const normalized = normalizeBinding(rawBinding, 'claude')
  expect(normalized.cwd).toBe('/repo')
  expect(normalized.agentMeta.codex?.model).toBe('gpt')
  expect('appServerUrl' in (normalized.agentMeta.codex ?? {})).toBe(false)
  expect(normalized.agentMeta.codex?.codexHome).toBe('/home/me/.codex')
  expect(normalized.agentMeta.codex?.tuiTabName).toBe('ccm:cx:abc')
  expect(normalized.agentMeta.codex?.desiredRunning).toBe(false)
})

test('normalizeBinding resolves relative persisted cwd values to absolute paths', () => {
  const normalized = normalizeBinding({ cwd: 'repo/project', agentMeta: { codex: { cwd: 'repo/project', sourceCwd: 'repo', worktreePath: 'repo/project/.codex/worktrees/cx' } } }, 'claude')
  expect(normalized.cwd?.startsWith('/')).toBe(true)
  expect(normalized.agentMeta.codex?.cwd?.startsWith('/')).toBe(true)
  expect(normalized.agentMeta.codex?.sourceCwd?.startsWith('/')).toBe(true)
  expect(normalized.agentMeta.codex?.worktreePath?.startsWith('/')).toBe(true)
})

test('normalizeBinding restores persisted absolute paths missing the leading slash', () => {
  const normalized = normalizeBinding({ cwd: 'home/repo/ejwang', agentMeta: { codex: { sourceCwd: 'home/repo/ejwang' } } }, 'claude')
  expect(normalized.cwd).toBe('/home/repo/ejwang')
  expect(normalized.agentMeta.codex?.sourceCwd).toBe('/home/repo/ejwang')
})

test('normalizeBinding restores absolute paths accidentally rooted under the daemon home', () => {
  const normalized = normalizeBinding({ cwd: `${homedir()}/home/repo/ejwang` }, 'claude')
  expect(normalized.cwd).toBe('/home/repo/ejwang')
})

test('serializeBinding omits empty default bindings and empty metadata', () => {
  expect(serializeBinding({ active: 'claude', isOrchestrator: true, orchestratorSource: 'ordinary-default-enabled', observers: [], sessions: {}, agentMeta: {} }, 'claude')).toBeUndefined()
  expect(serializeBinding({ active: 'codex', isOrchestrator: true, orchestratorSource: 'ordinary-default-enabled', observers: [], sessions: { claude: '', codex: 'cx' }, agentMeta: { codex: {} } }, 'claude')).toEqual({
    active: 'codex',
    sessions: { codex: 'cx' },
  })
})


test('keepAgentModelMeta preserves model and desired running state', () => {
  expect(keepAgentModelMeta(undefined)).toBeUndefined()
  expect(keepAgentModelMeta({ cwd: '/repo', nativeSessionId: 'native' })).toBeUndefined()
  expect(keepAgentModelMeta({ model: 'gpt-5.4', cwd: '/repo', nativeSessionId: 'native' })).toEqual({ model: 'gpt-5.4' })
  expect(keepAgentModelMeta({ model: 'gpt-5.4', desiredRunning: false, cwd: '/repo', nativeSessionId: 'native' })).toEqual({ model: 'gpt-5.4', desiredRunning: false })
})


test('bindingsFromJson keeps valid bindings and drops malformed persisted state', () => {
  expect(bindingsFromJson({
    'slack:C1': 'legacy-uuid',
    'slack:legacy-orch': { active: 'codex', isOrchestrator: true, sessions: { codex: 'cx2' } },
    'telegram:T1': { active: 'codex', sessions: { claude: 'cc', codex: 'cx', other: 'bad' }, cwd: ' /repo ', orchestrator: false, parentRoomId: 'slack:PARENT', agentMeta: { codex: { model: 'gpt', cwd: '/repo', desiredRunning: false, bad: 1 } } },
    'slack:bad': { active: 'other', sessions: { claude: 1 }, cwd: '   ', agentMeta: { codex: { model: '' } } },
    'slack:number-active': { active: 1, sessions: { codex: 2 } },
    'slack:null': null,
  })).toEqual({
    'slack:C1': { sessions: { claude: 'legacy-uuid' } },
    'slack:legacy-orch': { active: 'codex', orchestrator: true, sessions: { codex: 'cx2' } },
    'telegram:T1': { active: 'codex', orchestrator: false, parentRoomId: 'slack:PARENT', sessions: { claude: 'cc', codex: 'cx' }, cwd: '/repo', agentMeta: { codex: { cwd: '/repo', model: 'gpt', desiredRunning: false } } },
  })
  expect(bindingsFromJson([])).toEqual({})
})


test('bindingSessionEntries returns typed active session entries', () => {
  expect(bindingSessionEntries({ active: 'codex', isOrchestrator: true, orchestratorSource: 'ordinary-default-enabled', observers: [], sessions: { claude: 'cc', codex: 'cx' }, agentMeta: {} })).toEqual([
    { runtime: 'claude', uuid: 'cc', active: false },
    { runtime: 'codex', uuid: 'cx', active: true },
  ])
  expect(bindingSessionEntries({ active: 'claude', isOrchestrator: true, orchestratorSource: 'ordinary-default-enabled', observers: [], sessions: { claude: '', codex: undefined }, agentMeta: {} })).toEqual([])
})


test('bindingAuthorizedRoomsForSession uses only direct room/session bindings', () => {
  const bindings = bindingsFromJson({
    'slack:first': { active: 'codex', sessions: { codex: 'thread-a' }, agentMeta: { codex: { appServerUrl: 'ws://127.0.0.1:1' } } },
    'slack:second': { active: 'codex', sessions: { codex: 'thread-b' }, agentMeta: { codex: { appServerUrl: 'ws://127.0.0.1:1' } } },
    'slack:other-app-server': { active: 'codex', sessions: { codex: 'thread-c' }, agentMeta: { codex: { appServerUrl: 'ws://127.0.0.1:2' } } },
    'slack:claude': { active: 'claude', sessions: { claude: 'thread-a' } },
  })

  expect(bindingAuthorizedRoomsForSession(bindings, 'thread-a').sort()).toEqual(['slack:claude', 'slack:first'])
})

test('setBindingOrchestratorFlag toggles current room without changing worker rooms', () => {
  const bindings = bindingsFromJson({
    'slack:ORCH': { active: 'codex', sessions: { codex: 'cx' } },
    'slack:WORKER': { active: 'claude', orchestrator: false, parentRoomId: 'slack:ORCH', sessions: { claude: 'cc' } },
  })

  setBindingOrchestratorFlag(bindings, 'slack:ORCH', true, 'claude')
  expect(normalizeBinding(bindings['slack:ORCH'], 'claude').isOrchestrator).toBe(true)
  expect(normalizeBinding(bindings['slack:WORKER'], 'claude').isOrchestrator).toBe(false)

  setBindingOrchestratorFlag(bindings, 'slack:ORCH', false, 'claude')
  expect(normalizeBinding(bindings['slack:ORCH'], 'claude').isOrchestrator).toBe(false)
  expect(normalizeBinding(bindings['slack:ORCH'], 'claude').orchestratorSource).toBe('explicit-disabled')
})


test('setBindingSuccessorRole promotes a worker-forced-disabled room and clears its parent lineage', () => {
  const bindings = bindingsFromJson({
    'slack:ORCH': { active: 'codex', sessions: { codex: 'cx' } },
    'slack:SUCCESSOR': { active: 'claude', orchestrator: false, parentRoomId: 'slack:ORCH', sessions: { claude: 'cc' } },
  })

  setBindingSuccessorRole(bindings, 'slack:SUCCESSOR', 'claude')
  const successor = normalizeBinding(bindings['slack:SUCCESSOR'], 'claude')
  // orchestratorSource is derived from {orchestrator, parentRoomId}, not persisted itself: once
  // parentRoomId is cleared this reads back as an ordinary explicit-enabled orchestrator, same as
  // any other manually-flagged room. The "this happened via rotation" fact lives in the audit log.
  expect(successor).toMatchObject({ isOrchestrator: true, orchestrator: true, orchestratorSource: 'explicit-enabled' })
  expect(successor.parentRoomId).toBeUndefined()
  expect(serializeBinding(successor, 'claude')).not.toHaveProperty('parentRoomId')
})

test('setBindingSuccessorRole promotes a room with no prior binding', () => {
  const bindings = bindingsFromJson({})
  setBindingSuccessorRole(bindings, 'slack:FRESH', 'claude')
  expect(normalizeBinding(bindings['slack:FRESH'], 'claude')).toMatchObject({ isOrchestrator: true, orchestrator: true, orchestratorSource: 'explicit-enabled' })
})

test('setBindingSuccessorRole is reversible via setBindingOrchestratorFlag and does not resurrect worker lineage', () => {
  const bindings = bindingsFromJson({
    'slack:ORCH': { active: 'codex', sessions: { codex: 'cx' } },
    'slack:SUCCESSOR': { active: 'claude', orchestrator: false, parentRoomId: 'slack:ORCH', sessions: { claude: 'cc' } },
  })
  setBindingSuccessorRole(bindings, 'slack:SUCCESSOR', 'claude')
  setBindingOrchestratorFlag(bindings, 'slack:SUCCESSOR', false, 'claude')
  // Once parentRoomId is cleared by promotion, later disabling reads as an ordinary explicit
  // disable, not a worker-forced-disable: rotation is a one-way lineage break by design.
  expect(normalizeBinding(bindings['slack:SUCCESSOR'], 'claude')).toMatchObject({ isOrchestrator: false, orchestratorSource: 'explicit-disabled' })
  expect(normalizeBinding(bindings['slack:SUCCESSOR'], 'claude').parentRoomId).toBeUndefined()
})


test('AGENT_RUNTIMES is the shared runtime order', () => {
  expect(AGENT_RUNTIMES).toEqual(['claude', 'codex'])
})


test('isAgentRuntimeKind accepts only supported runtimes', () => {
  expect(isAgentRuntimeKind('claude')).toBe(true)
  expect(isAgentRuntimeKind('codex')).toBe(true)
  expect(isAgentRuntimeKind('other')).toBe(false)
  expect(isAgentRuntimeKind(1)).toBe(false)
})

test('harness membership survives JSON round-trip, is inherited by worker rooms, and is settable', async () => {
  const { bindingsFromJson, normalizeBinding, serializeBinding, setBindingWorkerRole, setBindingHarness } = await import('../bindings.js')
  const raw = { 'slack:P': { orchestrator: true, cwd: '/w', harness: 'durable', sessions: { claude: 'u1' } } }
  const parsed = bindingsFromJson(raw)
  expect(parsed['slack:P']?.harness).toBe('durable')
  const n = normalizeBinding(parsed['slack:P'], 'claude')
  expect(n.harness).toBe('durable')
  expect(serializeBinding(n, 'claude')?.harness).toBe('durable')
  setBindingWorkerRole(parsed, 'slack:C', 'slack:P', 'claude')
  expect(parsed['slack:C']?.harness).toBe('durable')
  setBindingHarness(parsed, 'slack:C', 'overall', 'claude')
  expect(parsed['slack:C']?.harness).toBe('overall')
  setBindingHarness(parsed, 'slack:C', undefined, 'claude')
  expect(parsed['slack:C']?.harness).toBeUndefined()
  expect(parsed['slack:C']?.parentRoomId).toBe('slack:P')
})
