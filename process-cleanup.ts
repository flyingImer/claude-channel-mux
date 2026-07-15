import { existsSync, readFileSync, readdirSync } from 'fs'

export type ProcessSignal = 'SIGTERM' | 'SIGKILL'

export type ReapSessionProcessesOptions = {
  procRoot?: string
  selfPid?: number
  graceMs?: number
  killFn?: (pid: number, signal: ProcessSignal) => void
  sleepFn?: (ms: number) => Promise<void>
}

export type ReapSessionProcessesResult = {
  matchedPids: number[]
  terminatedPids: number[]
  killedPids: number[]
}

const DEFAULT_GRACE_MS = 1500

function readProcFile(procRoot: string, pid: number, name: string): string | undefined {
  try { return readFileSync(`${procRoot}/${pid}/${name}`, 'utf8') } catch { return undefined }
}

function procExists(procRoot: string, pid: number): boolean {
  return existsSync(`${procRoot}/${pid}`)
}

function parseEnvPairs(environ: string): string[] {
  return environ.split('\0').filter(Boolean)
}

function sessionUuidFromEnv(procRoot: string, pid: number): string | undefined {
  const environ = readProcFile(procRoot, pid, 'environ')
  if (!environ) return undefined
  const pair = parseEnvPairs(environ).find(entry => entry.startsWith('CC_CHANNEL_SESSION_UUID='))
  const uuid = pair?.slice('CC_CHANNEL_SESSION_UUID='.length).trim()
  return uuid || undefined
}

function ccmSessionProcessPids(uuid: string, procRoot: string, selfPid: number): number[] {
  let entries: string[]
  try { entries = readdirSync(procRoot) } catch { return [] }
  const pids: number[] = []
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    if (pid === selfPid) continue
    if (sessionUuidFromEnv(procRoot, pid) === uuid) pids.push(pid)
  }
  return pids.sort((a, b) => a - b)
}

async function waitForExit(procRoot: string, pids: number[], graceMs: number, sleepFn: (ms: number) => Promise<void>): Promise<void> {
  const deadline = Date.now() + Math.max(0, graceMs)
  while (Date.now() < deadline) {
    if (pids.every(pid => !procExists(procRoot, pid))) return
    await sleepFn(Math.min(100, deadline - Date.now()))
  }
}

export function listCcmSessionUuids(options: Pick<ReapSessionProcessesOptions, 'procRoot' | 'selfPid'> = {}): string[] {
  const procRoot = options.procRoot ?? '/proc'
  const selfPid = options.selfPid ?? process.pid
  let entries: string[]
  try { entries = readdirSync(procRoot) } catch { return [] }
  const uuids = new Set<string>()
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    const pid = Number(entry)
    if (pid === selfPid) continue
    const uuid = sessionUuidFromEnv(procRoot, pid)
    if (uuid) uuids.add(uuid)
  }
  return [...uuids].sort()
}

export async function reapCcmSessionProcesses(uuid: string, options: ReapSessionProcessesOptions = {}): Promise<ReapSessionProcessesResult> {
  const procRoot = options.procRoot ?? '/proc'
  const selfPid = options.selfPid ?? process.pid
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS
  const killFn = options.killFn ?? ((pid, signal) => process.kill(pid, signal))
  const sleepFn = options.sleepFn ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const matchedPids = ccmSessionProcessPids(uuid, procRoot, selfPid)
  const terminatedPids: number[] = []
  const killedPids: number[] = []

  for (const pid of matchedPids) {
    try {
      killFn(pid, 'SIGTERM')
      terminatedPids.push(pid)
    } catch {
    }
  }

  if (terminatedPids.length > 0) await waitForExit(procRoot, terminatedPids, graceMs, sleepFn)

  for (const pid of terminatedPids) {
    if (!procExists(procRoot, pid)) continue
    if (sessionUuidFromEnv(procRoot, pid) !== uuid) continue
    try {
      killFn(pid, 'SIGKILL')
      killedPids.push(pid)
    } catch {
    }
  }

  return { matchedPids, terminatedPids, killedPids }
}
