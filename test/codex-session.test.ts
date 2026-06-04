import { expect, test } from 'bun:test'
import type { AgentSession } from '../agents/types.js'
import { CodexAppServerSession, type CodexRemoteTuiAdapter, type CodexRemoteTuiStatus } from '../agents/codex/session.js'
import { codexResolvedConfigFromEnv } from '../agents/codex/config.js'

const capabilities = { streaming: true, cancel: true, resume: true, toolCalling: true } as const

function session(sessionId = '019e94e57c377cb3b3152443705b9aaf', nativeSessionId = 'thread-1', appServerUrl = 'ws://127.0.0.1:0'): AgentSession {
  return {
    kind: 'codex',
    sessionId,
    nativeSessionId,
    transport: 'codex-app-server',
    cwd: '/repo',
    status: 'idle',
    capabilities,
    meta: { appServerUrl },
  }
}

function fakeTui(status: CodexRemoteTuiStatus = { kind: 'missing' }): CodexRemoteTuiAdapter & { commands: string[]; tabs: string[]; closed: string[]; skipped: string[]; logs: string[]; ensured: number } {
  const tui = {
    commands: [] as string[],
    tabs: [] as string[],
    closed: [] as string[],
    skipped: [] as string[],
    logs: [] as string[],
    ensured: 0,
    available: () => true,
    ensureSession: async () => { tui.ensured += 1 },
    status: () => status,
    closeTab: (tabName: string) => { tui.closed.push(tabName) },
    newTab: async (tabName: string, command: string) => {
      tui.tabs.push(tabName)
      tui.commands.push(command)
    },
    waitForPane: async () => ({ kind: 'missing' } as CodexRemoteTuiStatus),
    autoSkipUpdatePrompt: async (sessionId: string) => { tui.skipped.push(sessionId) },
    log: (line: string) => tui.logs.push(line),
  }
  return tui
}

function lifecycleWith(options: { driver?: Record<string, unknown>; tui?: CodexRemoteTuiAdapter; stored?: Map<string, AgentSession>; logs?: string[] } = {}): CodexAppServerSession {
  const stored = options.stored ?? new Map<string, AgentSession>()
  const logs = options.logs ?? []
  return new CodexAppServerSession({
    config: codexResolvedConfigFromEnv({ CODEX_HOME: '/codex-home' }),
    driver: options.driver as never,
    tui: options.tui ?? fakeTui(),
    remember: value => stored.set(value.sessionId, value),
    forget: sessionId => stored.delete(sessionId),
    session: sessionId => stored.get(sessionId),
    log: line => logs.push(line),
  })
}

test('Codex session lifecycle owns app-server start storage and logging', async () => {
  const stored = new Map<string, AgentSession>()
  const logs: string[] = []
  const started = session('ccm-session', 'native-thread')
  const lifecycle = lifecycleWith({
    stored,
    logs,
    driver: { start: async input => ({ ...started, sessionId: input.sessionId, cwd: input.cwd }) },
  })

  const result = await lifecycle.start('ccm-session', '/work', { model: 'room-model' })
  expect(result.nativeSessionId).toBe('native-thread')
  expect(stored.get('ccm-session')).toEqual(result)
  expect(logs.join('\n')).toContain('started codex app-server session ccm-sess thread=native-thread')
})

test('Codex session lifecycle owns app-server resume only when caller supplies native id', async () => {
  const calls: Array<{ sessionId: string; cwd: string; nativeSessionId?: string; options?: { model?: string } }> = []
  const lifecycle = lifecycleWith({
    driver: {
      resume: async input => {
        calls.push(input)
        return session(input.sessionId, input.nativeSessionId ?? 'new-thread')
      },
    },
  })

  await lifecycle.resume('ccm-session', '/work', 'app-server-thread', { model: 'room-model' })
  expect(calls).toEqual([{ sessionId: 'ccm-session', cwd: '/work', nativeSessionId: 'app-server-thread', options: { model: 'room-model' } }])
})

test('Codex session lifecycle owns app-server stop and closes remote TUI tab', async () => {
  const stored = new Map<string, AgentSession>([['ccm-session', session('ccm-session', 'thread-1')]])
  const stopped: string[] = []
  const tui = fakeTui()
  const lifecycle = lifecycleWith({
    stored,
    tui,
    driver: { stop: async value => { stopped.push(value.sessionId) } },
  })

  await lifecycle.stop('ccm-session')
  expect(stopped).toEqual(['ccm-session'])
  expect(stored.has('ccm-session')).toBe(false)
  expect(tui.closed).toEqual(['ccm:cx:ccm-sess'])
})

test('Codex remote TUI launch details stay behind the lifecycle seam', async () => {
  const tui = fakeTui()
  const lifecycle = lifecycleWith({ tui, driver: {} })

  const meta = await lifecycle.attachTui('019e94e57c377cb3b3152443705b9aaf', session())
  expect(meta).toEqual({ appServerUrl: 'ws://127.0.0.1:0', codexHome: '/codex-home', tuiTabName: 'ccm:cx:019e94e5' })
  expect(tui.ensured).toBe(1)
  expect(tui.tabs).toEqual(['ccm:cx:019e94e5'])
  expect(tui.commands[0]).toContain('CODEX_HOME=')
  expect(tui.commands[0]).toContain("'--remote' 'ws://127.0.0.1:0'")
  expect(tui.commands[0]).not.toContain("'resume'")
  expect(tui.commands[0]).not.toContain("'thread-1'")
})

test('Codex remote TUI reuses matching app-server pane and closes stale panes', async () => {
  const matchingTui = fakeTui({ kind: 'alive', paneId: 7, terminalCommand: 'codex --remote ws://127.0.0.1:0' })
  const matching = await lifecycleWith({ tui: matchingTui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1'))
  expect(matching?.tuiTabName).toBe('ccm:cx:ccm-sess')
  expect(matchingTui.tabs).toEqual([])
  expect(matchingTui.skipped).toEqual(['ccm-session'])

  const staleTui = fakeTui({ kind: 'alive', paneId: 8, terminalCommand: 'codex --remote ws://127.0.0.1:9999' })
  await lifecycleWith({ tui: staleTui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1'))
  expect(staleTui.closed).toEqual(['ccm:cx:ccm-sess'])
  expect(staleTui.tabs).toEqual(['ccm:cx:ccm-sess'])
})

test('Codex remote TUI skips non-websocket app-server sessions', async () => {
  const tui = fakeTui()
  const meta = await lifecycleWith({ tui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1', 'stdio://'))
  expect(meta).toBeUndefined()
  expect(tui.ensured).toBe(0)
  expect(tui.tabs).toEqual([])
})
