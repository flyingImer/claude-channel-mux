export function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

export function findZellijSessionLine(output: string, sessionName: string): string | undefined {
  return output
    .split('\n')
    .map(stripAnsi)
    .find(line => line.trim().split(/\s+/)[0] === sessionName)
}
