export function parseAgentCommandName(rawCommand: string): string {
  const command = rawCommand.trim().replace(/^\//, '')
  return (command.split(/\s+/)[0] ?? '').toLowerCase()
}

export function parseAgentCommandArgs(rawCommand: string): string {
  const command = rawCommand.trim().replace(/^\//, '')
  const firstSpace = command.search(/\s/)
  return firstSpace === -1 ? '' : command.slice(firstSpace).trim()
}

export function agentCommandBodyAfterPrefix(text: string, prefix: 'cc' | 'cx'): string | undefined {
  const normalized = text.replace(/<@[A-Z0-9]+>/g, '').trim()
  const match = new RegExp(`^\\/${prefix}(?:[\\s_]+|\\s+)`, 'i').exec(normalized)
  if (!match) return undefined
  return normalized.slice(match[0].length).trim()
}

export function formatParsedAgentCommand(command: string): string {
  return `🧭 Parsed command:\n\`\`\`\n${command}\n\`\`\``
}
