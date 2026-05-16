import type { AgentKind } from './types.js'

export function agentLabel(runtime: AgentKind): string {
  return runtime === 'codex' ? '🟢 Codex' : '🟣 Claude'
}

export function agentName(runtime: AgentKind): string {
  return runtime === 'codex' ? 'Codex' : 'Claude'
}

export function agentHeader(runtime: AgentKind): string {
  return runtime === 'codex' ? '**🟢 Codex**' : '**🟣 Claude**'
}

export function formatAgentReply(runtime: AgentKind, text: string): string {
  const trimmed = text.trim()
  const label = agentLabel(runtime)
  const header = agentHeader(runtime)
  if (!trimmed) return header
  if (
    trimmed.startsWith(header + '\n') || trimmed.startsWith(header + '\r\n') ||
    trimmed.startsWith(label + '\n') || trimmed.startsWith(label + '\r\n')
  ) return trimmed
  return `${header}\n${trimmed}`
}
