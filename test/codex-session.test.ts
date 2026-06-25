import { expect, test } from 'bun:test'
import type { AgentSession } from '../agents/types.js'
import { CodexAppServerSession, codexTuiLooksStuckWorking, type CodexRemoteTuiAdapter, type CodexRemoteTuiStatus } from '../agents/codex/session.js'
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

function fakeTui(
  status: CodexRemoteTuiStatus = { kind: 'missing' },
  waitStatus: CodexRemoteTuiStatus = { kind: 'alive', paneId: 1, terminalCommand: "codex --remote ws://127.0.0.1:0 resume thread-1 -C /repo" },
  screen = '',
): CodexRemoteTuiAdapter & { commands: string[]; tabs: string[]; closed: string[]; closedSessions: string[]; skipped: string[]; logs: string[]; ensured: string[]; screens: Array<{ sessionId: string; paneId: number }> } {
  const tui = {
    commands: [] as string[],
    tabs: [] as string[],
    closed: [] as string[],
    closedSessions: [] as string[],
    skipped: [] as string[],
    logs: [] as string[],
    screens: [] as Array<{ sessionId: string; paneId: number }>,
    ensured: [] as string[],
    available: () => true,
    ensureSession: async (sessionId: string) => { tui.ensured.push(sessionId) },
    status: () => status,
    screen: async (sessionId: string, paneId: number) => { tui.screens.push({ sessionId, paneId }); return screen },
    closeTab: (sessionId: string, tabName: string) => { tui.closed.push(`${sessionId}:${tabName}`) },
    newTab: async (tabName: string, command: string) => {
      tui.tabs.push(tabName)
      tui.commands.push(command)
    },
    waitForPane: async () => waitStatus,
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

test('Codex session lifecycle stores app-server native threads under the CCM slot id', async () => {
  const stored = new Map<string, AgentSession>()
  const lifecycle = lifecycleWith({
    stored,
    driver: { start: async () => session('native-thread', 'native-thread') },
  })

  const result = await lifecycle.start('ccm-session', '/work')
  expect(result.sessionId).toBe('ccm-session')
  expect(result.nativeSessionId).toBe('native-thread')
  expect(stored.get('ccm-session')).toEqual(result)
  expect(stored.has('native-thread')).toBe(false)
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

test('Codex session lifecycle resumes native threads under the CCM slot id', async () => {
  const stored = new Map<string, AgentSession>()
  const lifecycle = lifecycleWith({
    stored,
    driver: { resume: async () => session('native-thread', 'native-thread') },
  })

  const result = await lifecycle.resume('ccm-session', '/work', 'native-thread')
  expect(result.sessionId).toBe('ccm-session')
  expect(result.nativeSessionId).toBe('native-thread')
  expect(stored.get('ccm-session')).toEqual(result)
  expect(stored.has('native-thread')).toBe(false)
})

test('Codex session lifecycle does not substitute CCM uuid for missing native id', async () => {
  const calls: Array<{ sessionId: string; cwd: string; nativeSessionId?: string; options?: { model?: string } }> = []
  const lifecycle = lifecycleWith({
    driver: {
      resume: async input => {
        calls.push(input)
        return session(input.sessionId, input.nativeSessionId ?? 'new-thread')
      },
    },
  })

  await lifecycle.resume('ccm-session', '/work', undefined, { model: 'room-model' })
  expect(calls).toEqual([{ sessionId: 'ccm-session', cwd: '/work', nativeSessionId: undefined, options: { model: 'room-model' } }])
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
  expect(tui.closed).toEqual(['ccm-session:ccm:cx:ccm-sess'])
})

test('Codex session lifecycle prefers closing disposable TUI session on stop', async () => {
  const stored = new Map<string, AgentSession>([['ccm-session', session('ccm-session', 'thread-1')]])
  const stopped: string[] = []
  const tui = fakeTui()
  tui.closeSession = async sessionId => { tui.closedSessions.push(sessionId) }
  const lifecycle = lifecycleWith({
    stored,
    tui,
    driver: { stop: async value => { stopped.push(value.sessionId) } },
  })

  await lifecycle.stop('ccm-session')
  expect(stopped).toEqual(['ccm-session'])
  expect(stored.has('ccm-session')).toBe(false)
  expect(tui.closedSessions).toEqual(['ccm-session'])
  expect(tui.closed).toEqual([])
})

test('Codex remote TUI launch details stay behind the lifecycle seam', async () => {
  const tui = fakeTui()
  const lifecycle = lifecycleWith({ tui, driver: {} })
  const previousBaseUrl = process.env.ANTHROPIC_BASE_URL
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:24000'

  try {
    const meta = await lifecycle.attachTui('019e94e57c377cb3b3152443705b9aaf', session())
    expect(meta).toEqual({ appServerUrl: 'ws://127.0.0.1:0', codexHome: '/codex-home', tuiTabName: 'ccm:cx:019e94e5' })
    expect(tui.ensured).toEqual(['019e94e57c377cb3b3152443705b9aaf'])
    expect(tui.tabs).toEqual(['ccm:cx:019e94e5'])
    expect(tui.commands[0]).toContain("ANTHROPIC_BASE_URL='http://127.0.0.1:24000'")
    expect(tui.commands[0]).toContain('CODEX_HOME=')
    expect(tui.commands[0]).toContain("'--remote' 'ws://127.0.0.1:0'")
    expect(tui.commands[0]).toContain("'resume' 'thread-1'")
    expect(tui.commands[0]).toContain("'-C' '/repo'")
  } finally {
    if (previousBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = previousBaseUrl
  }
})

test('Codex remote TUI attach coalesces concurrent launches for the same session', async () => {
  let releaseNewTab: (() => void) | undefined
  let enteredNewTab: (() => void) | undefined
  const newTabEntered = new Promise<void>(resolve => { enteredNewTab = resolve })
  const tui = fakeTui()
  const originalNewTab = tui.newTab
  tui.newTab = async (tabName: string, command: string) => {
    enteredNewTab?.()
    await new Promise<void>(resolve => { releaseNewTab = resolve })
    await originalNewTab(tabName, command)
  }
  const lifecycle = lifecycleWith({ tui, driver: {} })

  const first = lifecycle.attachTui('ccm-session', session('ccm-session', 'thread-1'))
  await newTabEntered
  const second = lifecycle.attachTui('ccm-session', session('ccm-session', 'thread-1'))
  releaseNewTab?.()
  const results = await Promise.all([first, second])

  expect(results).toEqual([
    { appServerUrl: 'ws://127.0.0.1:0', codexHome: '/codex-home', tuiTabName: 'ccm:cx:ccm-sess' },
    { appServerUrl: 'ws://127.0.0.1:0', codexHome: '/codex-home', tuiTabName: 'ccm:cx:ccm-sess' },
  ])
  expect(tui.tabs).toEqual(['ccm:cx:ccm-sess'])
  expect(tui.commands).toHaveLength(1)
  expect(tui.skipped).toEqual(['ccm-session'])
})

test('Codex remote TUI reuses matching app-server pane and closes stale panes', async () => {
  const matchingTui = fakeTui({ kind: 'alive', paneId: 7, terminalCommand: 'codex --remote ws://127.0.0.1:0 resume thread-1 -C /repo' })
  const matching = await lifecycleWith({ tui: matchingTui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1'))
  expect(matching?.tuiTabName).toBe('ccm:cx:ccm-sess')
  expect(matchingTui.tabs).toEqual([])
  expect(matchingTui.skipped).toEqual(['ccm-session'])

  const sharedWrongThreadTui = fakeTui({ kind: 'alive', paneId: 8, terminalCommand: 'codex --remote ws://127.0.0.1:0 resume other-thread -C /repo' })
  await lifecycleWith({ tui: sharedWrongThreadTui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1'))
  expect(sharedWrongThreadTui.closed).toEqual(['ccm-session:ccm:cx:ccm-sess'])
  expect(sharedWrongThreadTui.tabs).toEqual(['ccm:cx:ccm-sess'])

  const staleTui = fakeTui({ kind: 'alive', paneId: 9, terminalCommand: 'codex --remote ws://127.0.0.1:9999 resume thread-1 -C /repo' })
  await lifecycleWith({ tui: staleTui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1'))
  expect(staleTui.closed).toEqual(['ccm-session:ccm:cx:ccm-sess'])
  expect(staleTui.tabs).toEqual(['ccm:cx:ccm-sess'])
})

test('Codex remote TUI detects Codex panes stuck in working state', () => {
  expect(codexTuiLooksStuckWorking('\n• Working (4m 00s • esc to interrupt)\n')).toBe(true)
  expect(codexTuiLooksStuckWorking('\n› Write tests\n')).toBe(false)
})

test('Codex idle reconciliation restarts matching remote TUI stuck in working state', async () => {
  const tui = fakeTui(
    { kind: 'alive', paneId: 42, terminalCommand: 'codex --remote ws://127.0.0.1:0 resume thread-1 -C /repo' },
    { kind: 'alive', paneId: 43, terminalCommand: 'codex --remote ws://127.0.0.1:0 resume thread-1 -C /repo' },
    '\n• CX_NEW_AFTER_STOP_OK_20260609\n\n• Working (4m 00s • esc to interrupt)\n',
  )
  const lifecycle = lifecycleWith({ tui, driver: {} })

  await expect(lifecycle.reconcileIdleTui('ccm-session', session('ccm-session', 'thread-1'))).resolves.toBe(true)

  expect(tui.screens).toEqual([{ sessionId: 'ccm-session', paneId: 42 }])
  expect(tui.closed).toEqual(['ccm-session:ccm:cx:ccm-sess'])
  expect(tui.tabs).toEqual(['ccm:cx:ccm-sess'])
  expect(tui.logs.join('\n')).toContain('pane still shows Working after app-server idle')
})

test('Codex idle reconciliation leaves healthy remote TUI alone', async () => {
  const tui = fakeTui(
    { kind: 'alive', paneId: 42, terminalCommand: 'codex --remote ws://127.0.0.1:0 resume thread-1 -C /repo' },
    { kind: 'alive', paneId: 43, terminalCommand: 'codex --remote ws://127.0.0.1:0 resume thread-1 -C /repo' },
    '\n› Write tests\n',
  )
  const lifecycle = lifecycleWith({ tui, driver: {} })

  await expect(lifecycle.reconcileIdleTui('ccm-session', session('ccm-session', 'thread-1'))).resolves.toBe(false)

  expect(tui.screens).toEqual([{ sessionId: 'ccm-session', paneId: 42 }])
  expect(tui.closed).toEqual([])
  expect(tui.tabs).toEqual([])
})

test('Codex remote TUI attach rejects when launched pane is not ready', async () => {
  const missingTui = fakeTui({ kind: 'missing' }, { kind: 'missing' })
  await expect(lifecycleWith({ tui: missingTui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1')))
    .rejects.toThrow('codex remote TUI failed to become ready for ccm-sess tab=ccm:cx:ccm-sess: missing pane')
  expect(missingTui.tabs).toEqual(['ccm:cx:ccm-sess'])
  expect(missingTui.skipped).toEqual([])

  const wrongPaneTui = fakeTui(
    { kind: 'missing' },
    { kind: 'alive', paneId: 2, terminalCommand: 'codex --remote ws://127.0.0.1:9999' },
  )
  await expect(lifecycleWith({ tui: wrongPaneTui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1')))
    .rejects.toThrow('codex remote TUI failed to become ready for ccm-sess tab=ccm:cx:ccm-sess: alive pane 2')
  expect(wrongPaneTui.skipped).toEqual([])

  const remoteOnlyTui = fakeTui(
    { kind: 'missing' },
    { kind: 'alive', paneId: 3, terminalCommand: 'codex --remote ws://127.0.0.1:0' },
  )
  await expect(lifecycleWith({ tui: remoteOnlyTui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1')))
    .rejects.toThrow('codex remote TUI failed to become ready for ccm-sess tab=ccm:cx:ccm-sess: alive pane 3')
  expect(remoteOnlyTui.skipped).toEqual([])
})

test('Codex remote TUI skips non-websocket app-server sessions', async () => {
  const tui = fakeTui()
  const meta = await lifecycleWith({ tui, driver: {} }).attachTui('ccm-session', session('ccm-session', 'thread-1', 'stdio://'))
  expect(meta).toBeUndefined()
  expect(tui.ensured).toEqual([])
  expect(tui.tabs).toEqual([])
})
