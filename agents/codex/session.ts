import type { AgentSession } from '../types.js'
import { commandLine, shellArg } from '../../shell.js'
import type { CodexResolvedConfig } from './config.js'
import type { CodexAppServerAgentDriver } from './app-server-driver.js'

export type CodexRemoteTuiStatus =
  | { kind: 'alive'; paneId: number; terminalCommand?: string; paneCommand?: string }
  | { kind: 'exited'; paneId: number; exitStatus: number | null }
  | { kind: 'missing' }
  | { kind: 'zellij_down' }
  | { kind: 'unknown'; reason: string }

export type CodexRemoteTuiAdapter = {
  available(): boolean
  ensureSession(): Promise<void>
  status(tabName: string): CodexRemoteTuiStatus
  closeTab(tabName: string): void
  newTab(tabName: string, command: string): Promise<void>
  waitForPane(tabName: string): Promise<CodexRemoteTuiStatus>
  autoSkipUpdatePrompt(sessionId: string, paneId: number): Promise<void>
  log(line: string): void
}

export type CodexSessionLifecycleOptions = {
  config: CodexResolvedConfig
  driver: CodexAppServerAgentDriver
  tui: CodexRemoteTuiAdapter
  remember(session: AgentSession): void
  forget(sessionId: string): void
  session(sessionId: string): AgentSession | undefined
  log(line: string): void
}

export function codexTuiTabName(sessionId: string): string {
  return `ccm:cx:${sessionId.slice(0, 8)}`
}

export function codexTuiPaneMatchesAppServer(status: CodexRemoteTuiStatus, appServerUrl: string): boolean {
  return status.kind === 'alive' && [status.terminalCommand, status.paneCommand].some(command => command?.includes(appServerUrl))
}

function codexRemoteTuiCommand(config: CodexResolvedConfig, session: AgentSession, appServerUrl: string): string {
  const envExports = `export CODEX_HOME=${shellArg(config.home)} DISABLE_AUTOUPDATER=1;`
  const cmd = commandLine(config.command, [...config.launchArgs, '--remote', appServerUrl, 'resume', session.nativeSessionId])
  return `${envExports} cd ${shellArg(session.cwd)} && exec ${cmd}`
}

export class CodexAppServerSession {
  constructor(private readonly opts: CodexSessionLifecycleOptions) {}

  private get config(): CodexResolvedConfig { return this.opts.config }
  private get tui(): CodexRemoteTuiAdapter { return this.opts.tui }

  tabName(sessionId: string): string {
    return codexTuiTabName(sessionId)
  }

  async attachTui(sessionId: string, session: AgentSession): Promise<{ appServerUrl?: string; codexHome: string; tuiTabName: string } | undefined> {
    const tabName = this.tabName(sessionId)
    if (!this.tui.available()) {
      this.tui.log(`daemon: codex remote TUI skipped for ${sessionId.slice(0, 8)}: zellij unavailable`)
      return undefined
    }
    const appServerUrl = session.meta?.appServerUrl
    if (!appServerUrl || appServerUrl === 'stdio://') {
      this.tui.log(`daemon: codex remote TUI skipped for ${sessionId.slice(0, 8)}: app-server is not websocket-backed`)
      return undefined
    }

    await this.tui.ensureSession()
    const status = this.tui.status(tabName)
    if (status.kind === 'alive') {
      if (codexTuiPaneMatchesAppServer(status, appServerUrl)) {
        await this.tui.autoSkipUpdatePrompt(sessionId, status.paneId)
        return { appServerUrl, codexHome: this.config.home, tuiTabName: tabName }
      }
      this.tui.log('daemon: closing stale codex remote TUI ' + sessionId.slice(0, 8) + ' tab=' + tabName + ' expected=' + appServerUrl)
      this.tui.closeTab(tabName)
    }
    if (status.kind === 'exited') this.tui.closeTab(tabName)

    await this.tui.newTab(tabName, codexRemoteTuiCommand(this.config, session, appServerUrl))
    this.tui.log(`daemon: attached codex remote TUI ${sessionId.slice(0, 8)} tab=${tabName} url=${appServerUrl}`)
    const paneStatus = await this.tui.waitForPane(tabName)
    if (paneStatus.kind === 'alive') await this.tui.autoSkipUpdatePrompt(sessionId, paneStatus.paneId)
    return { appServerUrl, codexHome: this.config.home, tuiTabName: tabName }
  }

  async start(sessionId: string, cwd: string, options: { model?: string } = {}): Promise<AgentSession> {
    const session = await this.opts.driver.start({ sessionId, cwd, options })
    this.opts.remember(session)
    this.opts.log(`daemon: started codex app-server session ${sessionId.slice(0, 8)} thread=${session.nativeSessionId}`)
    return session
  }

  async resume(sessionId: string, cwd: string, nativeSessionId: string | undefined, options: { model?: string } = {}): Promise<AgentSession> {
    const session = await this.opts.driver.resume({ sessionId, cwd, nativeSessionId, options })
    this.opts.remember(session)
    this.opts.log(`daemon: started codex app-server session ${sessionId.slice(0, 8)} thread=${session.nativeSessionId}`)
    return session
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.opts.session(sessionId)
    if (!session) return
    this.opts.forget(sessionId)
    await this.opts.driver.stop?.(session)
    if (this.tui.available()) this.tui.closeTab(this.tabName(sessionId))
  }
}
