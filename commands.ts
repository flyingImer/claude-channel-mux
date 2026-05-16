export function parseAgentCommandName(rawCommand: string): string {
  const command = rawCommand.trim().replace(/^\//, '')
  return (command.split(/\s+/)[0] ?? '').toLowerCase()
}

export function parseAgentCommandArgs(rawCommand: string): string {
  const command = rawCommand.trim().replace(/^\//, '')
  const firstSpace = command.search(/\s/)
  return firstSpace === -1 ? '' : command.slice(firstSpace).trim()
}
