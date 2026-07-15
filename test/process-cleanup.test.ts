import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect } from 'bun:test'
import { listCcmSessionUuids, reapCcmSessionProcesses, type ProcessSignal } from '../process-cleanup.ts'

function fakeProc(entries: Record<number, string>): string {
  const root = join(tmpdir(), `ccm-proc-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(root, { recursive: true })
  for (const [pid, environ] of Object.entries(entries)) {
    const dir = join(root, pid)
    mkdirSync(dir)
    writeFileSync(join(dir, 'environ'), environ)
  }
  return root
}

test('listCcmSessionUuids reads exact CCM env ownership labels', () => {
  const root = fakeProc({
    100: 'CC_CHANNEL_SESSION_UUID=uuid-a\0PATH=/bin\0',
    101: 'OTHER=1\0CC_CHANNEL_SESSION_UUID=uuid-b\0',
    102: 'CC_CHANNEL_SESSION_UUIDISH=uuid-c\0',
    103: 'PATH=/bin\0',
  })
  try {
    expect(listCcmSessionUuids({ procRoot: root })).toEqual(['uuid-a', 'uuid-b'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reapCcmSessionProcesses signals only matching UUID processes', async () => {
  const root = fakeProc({
    200: 'CC_CHANNEL_SESSION_UUID=target\0',
    201: 'CC_CHANNEL_SESSION_UUID=other\0',
    202: 'PATH=/bin\0',
    203: 'CC_CHANNEL_SESSION_UUID=target\0',
  })
  const calls: Array<[number, ProcessSignal]> = []
  try {
    const result = await reapCcmSessionProcesses('target', {
      procRoot: root,
      selfPid: 999999,
      graceMs: 0,
      sleepFn: async () => {},
      killFn: (pid, signal) => { calls.push([pid, signal]) },
    })
    expect(result.matchedPids).toEqual([200, 203])
    expect(calls).toEqual([[200, 'SIGTERM'], [203, 'SIGTERM'], [200, 'SIGKILL'], [203, 'SIGKILL']])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reapCcmSessionProcesses re-checks UUID before SIGKILL', async () => {
  const root = fakeProc({ 300: 'CC_CHANNEL_SESSION_UUID=target\0' })
  const calls: Array<[number, ProcessSignal]> = []
  try {
    const result = await reapCcmSessionProcesses('target', {
      procRoot: root,
      selfPid: 999999,
      graceMs: 0,
      sleepFn: async () => {},
      killFn: (pid, signal) => {
        calls.push([pid, signal])
        if (signal === 'SIGTERM') writeFileSync(join(root, String(pid), 'environ'), 'CC_CHANNEL_SESSION_UUID=other\0')
      },
    })
    expect(result.matchedPids).toEqual([300])
    expect(calls).toEqual([[300, 'SIGTERM']])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
