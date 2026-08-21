import { execFileSync } from 'child_process'
import { readFileSync, readdirSync } from 'fs'

export function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

export function findZellijSessionLine(output: string, sessionName: string): string | undefined {
  return output
    .split('\n')
    .map(stripAnsi)
    .find(line => line.trim().split(/\s+/)[0] === sessionName)
}

export function exitedCcmZellijSessionNames(output: string): string[] {
  const names = new Set<string>()
  for (const rawLine of output.split('\n')) {
    const line = stripAnsi(rawLine).trim()
    if (!/\bEXITED\b/.test(line)) continue
    const sessionName = line.split(/\s+/)[0]
    if (/^ccm-(?:cc|cx)-[a-z0-9][a-z0-9_-]{0,7}$/.test(sessionName)) names.add(sessionName)
  }
  return [...names]
}

function uuidPrefix(uuid: string): string {
  const prefix = uuid.trim().slice(0, 8).toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,7}$/.test(prefix)) throw new Error(`invalid session uuid prefix: ${uuid}`)
  return prefix
}

export function claudeBackendZellijSessionName(uuid: string): string {
  return `ccm-cc-${uuidPrefix(uuid)}`
}

export function codexTuiZellijSessionName(uuid: string): string {
  return `ccm-cx-${uuidPrefix(uuid)}`
}

export function zellijAttachCommand(sessionName: string): string {
  if (!/^[A-Za-z0-9_.:-]+$/.test(sessionName)) throw new Error(`unsafe zellij session name: ${sessionName}`)
  return `zellij attach ${sessionName}`
}

export type ZellijClient = {
  clientId: string
  paneId?: string
  runningCommand?: string
}

export function parseZellijClients(output: string): ZellijClient[] {
  const lines = stripAnsi(output).split('\n').map(line => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const dataLines = /^CLIENT_ID\s+/i.test(lines[0]) ? lines.slice(1) : lines
  return dataLines.flatMap(line => {
    const parts = line.split(/\s+/)
    const clientId = parts[0]
    if (!clientId || /^CLIENT_ID$/i.test(clientId)) return []
    return [{ clientId, paneId: parts[1], runningCommand: parts.slice(2).join(' ') || undefined }]
  })
}

export type ProcessMemory = {
  pid: number
  vmRssKb?: number
  rssAnonKb?: number
  vmDataKb?: number
}

function processStatusNumber(status: string, key: string): number | undefined {
  const match = new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, 'm').exec(status)
  return match ? Number(match[1]) : undefined
}

export function readProcessMemory(pid: number): ProcessMemory | undefined {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    return {
      pid,
      vmRssKb: processStatusNumber(status, 'VmRSS'),
      rssAnonKb: processStatusNumber(status, 'RssAnon'),
      vmDataKb: processStatusNumber(status, 'VmData'),
    }
  } catch {
    return undefined
  }
}

export function findZellijServerProcess(sessionName: string, procRoot = '/proc'): ProcessMemory | undefined {
  let entries: string[]
  try { entries = readdirSync(procRoot) } catch { return undefined }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    try {
      const cmdline = readFileSync(`${procRoot}/${entry}/cmdline`, 'utf8').replace(/\0/g, ' ')
      if (!cmdline.includes('zellij --server') && !cmdline.includes('/zellij --server')) continue
      if (!cmdline.includes(`/${sessionName}`) && !cmdline.match(new RegExp(`\\b${sessionName}\\b`))) continue
      const memory = readProcessMemory(pid)
      if (memory) return memory
    } catch {
      // Ignore processes that exit while scanning.
    }
  }
  return undefined
}

export function zellijListSessionsNoFormatting(): string {
  return execFileSync('zellij', ['list-sessions', '--no-formatting'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000,
  }).trim()
}
