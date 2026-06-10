import { test, expect } from 'bun:test'
import { homedir } from 'os'
import { AGENT_RUNTIMES, bindingAuthorizedRoomsForSession, bindingSessionEntries, bindingsFromJson, isAgentRuntimeKind, keepAgentModelMeta, normalizeBinding, serializeBinding } from '../bindings.ts'

test('normalizeBinding upgrades legacy string bindings to Claude sessions', () => {
  expect(normalizeBinding('legacy-uuid', 'codex')).toEqual({
    active: 'claude',
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
  expect(binding).toEqual({ active: 'codex', observers: ['claude'], sessions: { claude: 'cc', codex: 'cx' }, agentMeta: {} })
  expect(serializeBinding(binding, 'claude')).toEqual({ active: 'codex', observers: ['claude'], sessions: { claude: 'cc', codex: 'cx' } })
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
  expect(serializeBinding({ active: 'claude', observers: [], sessions: {}, agentMeta: {} }, 'claude')).toBeUndefined()
  expect(serializeBinding({ active: 'codex', observers: [], sessions: { claude: '', codex: 'cx' }, agentMeta: { codex: {} } }, 'claude')).toEqual({
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
    'telegram:T1': { active: 'codex', sessions: { claude: 'cc', codex: 'cx', other: 'bad' }, cwd: ' /repo ', agentMeta: { codex: { model: 'gpt', cwd: '/repo', desiredRunning: false, bad: 1 } } },
    'slack:bad': { active: 'other', sessions: { claude: 1 }, cwd: '   ', agentMeta: { codex: { model: '' } } },
    'slack:number-active': { active: 1, sessions: { codex: 2 } },
    'slack:null': null,
  })).toEqual({
    'slack:C1': 'legacy-uuid',
    'telegram:T1': { active: 'codex', sessions: { claude: 'cc', codex: 'cx' }, cwd: '/repo', agentMeta: { codex: { cwd: '/repo', model: 'gpt', desiredRunning: false } } },
  })
  expect(bindingsFromJson([])).toEqual({})
})


test('bindingSessionEntries returns typed active session entries', () => {
  expect(bindingSessionEntries({ active: 'codex', observers: [], sessions: { claude: 'cc', codex: 'cx' }, agentMeta: {} })).toEqual([
    { runtime: 'claude', uuid: 'cc', active: false },
    { runtime: 'codex', uuid: 'cx', active: true },
  ])
  expect(bindingSessionEntries({ active: 'claude', observers: [], sessions: { claude: '', codex: undefined }, agentMeta: {} })).toEqual([])
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


test('AGENT_RUNTIMES is the shared runtime order', () => {
  expect(AGENT_RUNTIMES).toEqual(['claude', 'codex'])
})


test('isAgentRuntimeKind accepts only supported runtimes', () => {
  expect(isAgentRuntimeKind('claude')).toBe(true)
  expect(isAgentRuntimeKind('codex')).toBe(true)
  expect(isAgentRuntimeKind('other')).toBe(false)
  expect(isAgentRuntimeKind(1)).toBe(false)
})
