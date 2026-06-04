import { homedir } from 'os'
import { join } from 'path'
import { commandPrefix } from '../../shell.js'

export type CodexApprovalPolicy = 'never' | 'on-failure' | 'on-request' | 'untrusted'
export type CodexAppServerListen = 'stdio' | 'websocket'
export type CodexWorktreeMode = string

export type CodexResolvedConfig = {
  command: string[]
  launchArgs: string[]
  appServerListen: CodexAppServerListen
  worktreeMode: CodexWorktreeMode
  home: string
  model?: string
  approvalPolicy: CodexApprovalPolicy
  sandbox: string
  sessionsDir: string
}

export function codexModelFromEnv(env: NodeJS.ProcessEnv, modelOverride?: string): string | undefined {
  const model = (modelOverride ?? env.CCM_CODEX_MODEL ?? env.CODEX_MODEL ?? '').trim()
  return model || undefined
}

export function codexLaunchArgs(model?: string): string[] {
  const args: string[] = []
  if (model) args.push('-m', model)
  return args
}

export function codexApprovalPolicyFromEnv(env: NodeJS.ProcessEnv): CodexApprovalPolicy {
  const raw = (env.CCM_CODEX_APPROVAL_POLICY ?? env.CHANNEL_DAEMON_CODEX_APPROVAL_POLICY ?? '').trim().toLowerCase()
  if (raw === 'yolo' || raw === 'never') return 'never'
  if (raw === 'on-failure' || raw === 'on_failure') return 'on-failure'
  if (raw === 'on-request' || raw === 'on_request') return 'on-request'
  if (raw === 'untrusted') return 'untrusted'
  return 'on-request'
}

export function codexSandboxFromEnv(env: NodeJS.ProcessEnv): string {
  const raw = (env.CCM_CODEX_SANDBOX ?? env.CHANNEL_DAEMON_CODEX_SANDBOX ?? '').trim().toLowerCase()
  return raw === 'danger-full-access' || raw === 'danger_full_access' || raw === 'yolo' ? 'danger-full-access' : 'workspace-write'
}

export function codexDangerFullAccess(config: Pick<CodexResolvedConfig, 'sandbox'>): boolean {
  return config.sandbox === 'danger-full-access'
}

export function codexResolvedConfigFromEnv(env: NodeJS.ProcessEnv, modelOverride?: string): CodexResolvedConfig {
  const model = codexModelFromEnv(env, modelOverride)
  const home = env.CODEX_HOME ?? join(homedir(), '.codex')
  const appServerListen = (env.CCM_CODEX_APP_SERVER_LISTEN ?? env.CHANNEL_DAEMON_CODEX_APP_SERVER_LISTEN ?? 'websocket').toLowerCase() === 'stdio' ? 'stdio' : 'websocket'
  const worktreeMode = (env.CCM_CODEX_WORKTREE ?? env.CHANNEL_DAEMON_CODEX_WORKTREE ?? 'auto').toLowerCase()
  return {
    command: commandPrefix(env.CODEX_BIN, 'codex'),
    launchArgs: codexLaunchArgs(model),
    appServerListen,
    worktreeMode,
    home,
    model,
    approvalPolicy: codexApprovalPolicyFromEnv(env),
    sandbox: codexSandboxFromEnv(env),
    sessionsDir: join(home, 'sessions'),
  }
}

export function codexConfigWithModelOverride(config: CodexResolvedConfig, modelOverride?: string): CodexResolvedConfig {
  const model = (modelOverride ?? config.model ?? '').trim() || undefined
  return { ...config, model, launchArgs: codexLaunchArgs(model) }
}
